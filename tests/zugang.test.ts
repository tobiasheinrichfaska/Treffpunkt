import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  EINLADUNG_S,
  einladungAusstellen,
  einladungPruefen,
  neueKennung,
  ZUGANG_TAGE,
  zugangAusstellen,
  zugangPruefen,
} from '../src/zugang.ts';
import { GERAET } from '../src/eingabe.ts';

const K = randomBytes(32);
const JETZT = 1_794_000_000;
const G = 'geraet-0123456789abcdef0123456789abcdef';

test('a device id has 128 random bits in the Trainerbuch form', () => {
  const a = neueKennung();
  assert.match(a, GERAET);
  assert.notEqual(a, neueKennung());
});

test('an access holds app, device and end, and is valid for 90 days', () => {
  const { zugang, bis } = zugangAusstellen(K, 'tkd', G, JETZT);
  assert.equal(bis, JETZT + ZUGANG_TAGE * 86_400);
  assert.deepEqual(zugangPruefen(K, zugang, JETZT), { app: 'tkd', geraet: G, bis });
  assert.deepEqual(zugangPruefen(K, zugang, bis), { fehler: 'zugang-abgelaufen' });
});

test('a changed access is refused: app, device, end, signature, other key', () => {
  const { zugang } = zugangAusstellen(K, 'tkd', G, JETZT);
  const teile = zugang.split('.');
  const mit = (i: number, wert: string) => teile.map((t, j) => (j === i ? wert : t)).join('.');
  for (const falsch of [
    mit(1, 'azp'),
    mit(2, 'geraet-ffffffffffffffffffffffffffffffff'),
    mit(3, String(JETZT + 999_999_999)),
    mit(4, 'A'.repeat(43)),
    `${zugang}x`,
    zugang.replace('z1.', 'z2.'),
  ]) {
    assert.deepEqual(zugangPruefen(K, falsch, JETZT), { fehler: 'zugang-ungueltig' }, falsch);
  }
  assert.deepEqual(zugangPruefen(randomBytes(32), zugang, JETZT), { fehler: 'zugang-ungueltig' });
});

test('an invitation is valid 10 minutes, one app, and cannot pass for an access', () => {
  const { einladung, bis } = einladungAusstellen(K, 'tkd', JETZT);
  assert.equal(bis, JETZT + EINLADUNG_S);
  const e = einladungPruefen(K, einladung, JETZT);
  assert.ok(!('fehler' in e));
  assert.equal(e.app, 'tkd');
  assert.deepEqual(einladungPruefen(K, einladung, bis), { fehler: 'einladung-abgelaufen' });
  assert.deepEqual(zugangPruefen(K, einladung, JETZT), { fehler: 'zugang-ungueltig' });
  const { zugang } = zugangAusstellen(K, 'tkd', G, JETZT);
  assert.deepEqual(einladungPruefen(K, zugang, JETZT), { fehler: 'einladung-ungueltig' });
});

test('an invitation with a changed app or end is refused', () => {
  const { einladung } = einladungAusstellen(K, 'tkd', JETZT);
  assert.deepEqual(einladungPruefen(K, einladung.replace('e1.tkd.', 'e1.azp.'), JETZT), {
    fehler: 'einladung-ungueltig',
  });
  const teile = einladung.split('.');
  teile[2] = String(JETZT + 100_000);
  assert.deepEqual(einladungPruefen(K, teile.join('.'), JETZT), { fehler: 'einladung-ungueltig' });
});

test('an invitation made for longer than 10 minutes is refused (only the Treffpunkt makes them)', () => {
  const { einladung } = einladungAusstellen(K, 'tkd', JETZT + 3600);
  assert.deepEqual(einladungPruefen(K, einladung, JETZT), { fehler: 'einladung-ungueltig' });
});
