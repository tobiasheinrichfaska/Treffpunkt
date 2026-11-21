import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
import { test } from 'node:test';
import { nachweisPruefen, NACHWEIS_HOECHSTENS_S, UHR_SPIELRAUM_S } from '../src/nachweis.ts';
import { oeffentlicherSchluessel } from '../src/konfiguration.ts';
import { nachweis, schluesselpaar, zufallN } from './hilfen.ts';

const JETZT = 1_794_000_000;
const PAAR = schluesselpaar();
const ANDERES = schluesselpaar();
const SCHLUESSEL = [oeffentlicherSchluessel(PAAR.roh)];
const fuer = (app: string) => (app === 'tkd' ? SCHLUESSEL : app === 'leer' ? [] : undefined);
const gut = () => ({ v: 1, app: 'tkd', bis: JETZT + 300, n: zufallN() });

test('a proof signed by the login script is taken', () => {
  const inhalt = gut();
  assert.deepEqual(nachweisPruefen(nachweis(PAAR, inhalt), fuer, JETZT), {
    app: 'tkd',
    bis: inhalt.bis,
    n: inhalt.n,
  });
});

test('a proof signed with another key is refused', () => {
  assert.deepEqual(nachweisPruefen(nachweis(ANDERES, gut()), fuer, JETZT), {
    fehler: 'nachweis-unterschrift',
  });
});

test('a changed payload breaks the signature', () => {
  const echt = nachweis(PAAR, gut());
  const [, , sig] = echt.split('.');
  const anders = Buffer.from(JSON.stringify({ ...gut(), app: 'tkd' })).toString('base64url');
  assert.deepEqual(nachweisPruefen(`n1.${anders}.${sig}`, fuer, JETZT), {
    fehler: 'nachweis-unterschrift',
  });
});

test('unknown app, app without keys', () => {
  assert.deepEqual(nachweisPruefen(nachweis(PAAR, { ...gut(), app: 'xyz' }), fuer, JETZT), {
    fehler: 'app-unbekannt',
  });
  assert.deepEqual(nachweisPruefen(nachweis(PAAR, { ...gut(), app: 'leer' }), fuer, JETZT), {
    fehler: 'nachweis-nicht-eingerichtet',
  });
});

test('expired, or valid for longer than 5 minutes (plus clock leeway)', () => {
  for (const bis of [JETZT, JETZT - 1, JETZT + NACHWEIS_HOECHSTENS_S + UHR_SPIELRAUM_S + 1]) {
    assert.deepEqual(nachweisPruefen(nachweis(PAAR, { ...gut(), bis }), fuer, JETZT), {
      fehler: 'nachweis-abgelaufen',
    });
  }
  const grenze = JETZT + NACHWEIS_HOECHSTENS_S + UHR_SPIELRAUM_S;
  assert.ok(!('fehler' in nachweisPruefen(nachweis(PAAR, { ...gut(), bis: grenze }), fuer, JETZT)));
});

test('strict payload: extra field, other version, wrong types, short random value', () => {
  for (const inhalt of [
    { ...gut(), tester: 'Rolf' },
    { ...gut(), v: 2 },
    { ...gut(), bis: String(JETZT + 300) },
    { ...gut(), bis: JETZT + 300.5 },
    { ...gut(), n: 'kurz' },
    { ...gut(), app: 'TKD' },
  ]) {
    assert.deepEqual(nachweisPruefen(nachweis(PAAR, inhalt), fuer, JETZT), {
      fehler: 'nachweis-ungueltig',
    });
  }
});

test('the signature must be IEEE P1363 (64 bytes), not DER', () => {
  const der = nachweis(PAAR, gut(), (d) => sign('sha256', d, PAAR.privat));
  assert.deepEqual(nachweisPruefen(der, fuer, JETZT), { fehler: 'nachweis-ungueltig' });
});

test('not a proof at all', () => {
  for (const text of ['', 'n1..', 'n2.abc.def', 'x'.repeat(600)]) {
    assert.deepEqual(nachweisPruefen(text, fuer, JETZT), { fehler: 'nachweis-ungueltig' });
  }
});
