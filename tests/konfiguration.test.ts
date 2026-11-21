import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { passwortHash, passwortPasst } from '../src/zulassung.ts';
import {
  appsLesen,
  entwicklerLesen,
  KonfigurationFehler,
  oeffentlicherSchluessel,
  schluesselLesen,
} from '../src/konfiguration.ts';
import { schluesselpaar } from './hilfen.ts';

const gut = () => ({
  name: 'TKD-Trainerbuch',
  herkuenfte: ['https://tkdtest.b-cdn.net'],
  nachweisSchluessel: [] as string[],
  einladen: true,
  gesperrt: [] as string[],
});
const mit = (app: Record<string, unknown>) => JSON.stringify({ apps: { tkd: app } });

test('the apps.json in the repo is valid: tkd and azp, https origins of their test zones', () => {
  const apps = appsLesen(
    readFileSync(new URL('../konfiguration/apps.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual([...apps.keys()], ['tkd', 'azp']);
  assert.deepEqual(apps.get('tkd')?.herkuenfte, ['https://tkdtest.b-cdn.net']);
  assert.deepEqual(apps.get('azp')?.herkuenfte, ['https://azptest.b-cdn.net']);
  // The login scripts' public key (Testumgebung, npm run nachweis-schluessel, 2026-11-15): without
  // it no first device could enrol.
  assert.equal(apps.get('tkd')?.nachweisSchluessel.length, 1);
  assert.equal(apps.get('azp')?.nachweisSchluessel.length, 1);
});

test('a public key of a login script is read; anything else stops the start', () => {
  const paar = schluesselpaar();
  assert.equal(
    appsLesen(mit({ ...gut(), nachweisSchluessel: [paar.roh] })).get('tkd')?.nachweisSchluessel
      .length,
    1,
  );
  assert.throws(() => oeffentlicherSchluessel('A'.repeat(87)), KonfigurationFehler);
  const kein = Buffer.alloc(65);
  kein[0] = 4;
  assert.throws(() => oeffentlicherSchluessel(kein.toString('base64url')), KonfigurationFehler);
});

test('wrong settings stop the start with a reason', () => {
  for (const falsch of [
    'kein json',
    JSON.stringify({}),
    JSON.stringify({ apps: {} }),
    JSON.stringify({ apps: { tkd: gut() }, mehr: 1 }),
    JSON.stringify({ apps: { TKD: gut() } }),
    mit({ ...gut(), extra: 1 }),
    mit({ ...gut(), herkuenfte: [] }),
    mit({ ...gut(), herkuenfte: ['http://tkdtest.b-cdn.net'] }),
    mit({ ...gut(), herkuenfte: ['https://tkdtest.b-cdn.net/'] }),
    mit({ ...gut(), herkuenfte: ['*'] }),
    mit({ ...gut(), einladen: 'ja' }),
    mit({ ...gut(), gesperrt: ['Rolf'] }),
    mit({ ...gut(), name: '' }),
  ]) {
    assert.throws(() => appsLesen(falsch), KonfigurationFehler, falsch);
  }
});

test('the secret must be at least 32 bytes of base64url', () => {
  assert.equal(schluesselLesen(Buffer.alloc(32, 1).toString('base64url')).length, 32);
  for (const falsch of [
    undefined,
    '',
    'kurz',
    Buffer.alloc(31).toString('base64url'),
    'a+b/'.repeat(20),
  ]) {
    assert.throws(() => schluesselLesen(falsch), KonfigurationFehler);
  }
});

test('`streng` is a list of tenants per app (default none); anything else stops the start', () => {
  assert.equal(appsLesen(mit(gut())).get('tkd')?.streng.size, 0);
  const streng = appsLesen(mit({ ...gut(), streng: ['1', 'schule-2'] })).get('tkd')?.streng;
  assert.deepEqual([...(streng ?? [])], ['1', 'schule-2']);
  for (const falsch of [['standard'], ['Schule'], [1], 'ja', ['a b']]) {
    assert.throws(
      () => appsLesen(mit({ ...gut(), streng: falsch })),
      KonfigurationFehler,
      JSON.stringify(falsch),
    );
  }
});

test('the developer keys and password entries are read strictly; none means no developer access', () => {
  const paar = schluesselpaar();
  const zweites = schluesselpaar();
  assert.deepEqual(entwicklerLesen(undefined, undefined), { schluessel: [], passwoerter: [] });
  assert.equal(entwicklerLesen(`${paar.roh}, ${zweites.roh}`, '').schluessel.length, 2);
  assert.throws(() => entwicklerLesen('A'.repeat(87), undefined), KonfigurationFehler);
  assert.throws(() => entwicklerLesen('kurz', undefined), KonfigurationFehler);
  const eintrag = {
    app: 'tkd',
    mandant: 'vorfuehrung',
    hash: passwortHash('invented'),
    bis: 1_900_000_000,
    hoechstens: 3,
  };
  const gut2 = entwicklerLesen(undefined, JSON.stringify([eintrag]));
  assert.deepEqual(gut2.passwoerter, [{ ...eintrag, auchMitGeraeten: false }]);
  for (const falsch of [
    'kein json',
    '{}',
    JSON.stringify([{ ...eintrag, extra: 1 }]),
    JSON.stringify([{ ...eintrag, hash: 'klartext' }]),
    JSON.stringify([{ ...eintrag, mandant: 'standard' }]),
    JSON.stringify([{ ...eintrag, hoechstens: 0 }]),
    JSON.stringify([{ ...eintrag, hoechstens: 1001 }]),
    JSON.stringify([{ ...eintrag, bis: '2030-01-01' }]),
    JSON.stringify([{ ...eintrag, app: 'TKD' }]),
    JSON.stringify([{ ...eintrag, auchMitGeraeten: 'ja' }]),
    JSON.stringify(Array.from({ length: 21 }, () => eintrag)),
  ]) {
    assert.throws(() => entwicklerLesen(undefined, falsch), KonfigurationFehler, falsch);
  }
});

test('a password hash is salted and checked; the text never appears in it', () => {
  const h = passwortHash('invented-demo');
  assert.match(h, /^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.equal(passwortPasst('invented-demo', h), true);
  assert.equal(passwortPasst('invented-demo!', h), false);
  assert.notEqual(passwortHash('invented-demo'), h);
  assert.equal(h.includes('invented'), false);
  assert.equal(passwortPasst('x', 'kein hash'), false);
});
