// The probe's check of the running image (a short commit, as the documents give it, fits) and what
// it takes as an invitation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { einladungAus } from '../scripts/einladung.ts';
import { standPasst } from '../scripts/stand.ts';
import { einladungAusstellen } from '../src/zugang.ts';

const VOLL = 'c59ac2dd6b8317c68266681da620e5bdfa462a14';

test('the probe takes a commit short or full, never too short or another one', () => {
  assert.equal(standPasst('c59ac2d', VOLL), true);
  assert.equal(standPasst(VOLL, VOLL), true);
  assert.equal(standPasst('C59AC2D', VOLL), true);
  assert.equal(standPasst('c59ac', VOLL), false);
  assert.equal(standPasst('2678b19', VOLL), false);
  assert.equal(standPasst('c59ac2d', 'unbekannt'), false);
  assert.equal(standPasst('c59ac2d', 'nicht genannt (älteres Image)'), false);
});

test('the probe takes an invitation, or the Trainerbuch link that carries one, nothing else', () => {
  const { einladung } = einladungAusstellen(Buffer.alloc(32, 7), 'tkd', 1_800_000_000);
  const link = (inhalt: unknown) =>
    `https://tkdtest.b-cdn.net/#neu=${Buffer.from(JSON.stringify(inhalt)).toString('base64url')}`;
  // As the Trainerbuch builds it (src/logic/krypto/einladung.ts, `einladungsLink`).
  const wie = {
    m: 'tkd-einladung:1',
    g: 'geraet-x',
    t: 'trainer-1',
    c: 'abc',
    b: 1,
    tp: einladung,
  };
  assert.equal(einladungAus(einladung), einladung);
  assert.equal(einladungAus(` ${einladung}\n`), einladung);
  assert.equal(einladungAus(link(wie)), einladung);
  const ohneTp: Record<string, unknown> = { ...wie };
  delete ohneTp['tp'];
  for (const falsch of [
    '',
    'z1.tkd.geraet-x.1.y',
    link(ohneTp),
    link({ ...wie, tp: 'e1.kaputt' }),
    link([einladung]),
    'https://tkdtest.b-cdn.net/#neu=nicht+base64',
    `${einladung}x`,
  ]) {
    assert.equal(einladungAus(falsch), undefined, falsch);
  }
});
