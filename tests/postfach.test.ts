import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRENZEN } from '../src/grenzen.ts';
import { postfachAnlegen } from '../src/postfach.ts';

const A = 'geraet-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'geraet-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'geraet-cccccccccccccccccccccccccccccccc';
const T = 1_000_000;
const text = (s: string) => Buffer.from(s);
/** For the byte limits with a few bytes: each message counts its content only. */
const genau = { ...GRENZEN, nachrichtMindestBytes: 0 };
const kennung = (i: number) => `geraet-${i.toString(16).padStart(32, '0')}`;

test('a message is handed out once, in order, and then gone', () => {
  const p = postfachAnlegen(GRENZEN);
  assert.deepEqual(p.ablegen('tkd', A, B, text('1'), T), { ok: true });
  assert.deepEqual(p.ablegen('tkd', C, B, text('2'), T + 1), { ok: true });
  const r = p.abholen('tkd', B, T + 2);
  assert.deepEqual(
    r.nachrichten.map((n) => [n.von, n.inhalt.toString()]),
    [
      [A, '1'],
      [C, '2'],
    ],
  );
  assert.equal(r.mehr, false);
  assert.equal(p.abholen('tkd', B, T + 3).nachrichten.length, 0);
  assert.deepEqual(p.stand(), { wartend: 0, bytes: 0, anwesend: 0, postfaecher: 0, absender: 0 });
});

test('a message waits at most 30 s', () => {
  const p = postfachAnlegen(GRENZEN);
  p.ablegen('tkd', A, B, text('alt'), T);
  p.ablegen('tkd', A, B, text('neu'), T + 20_000);
  const r = p.abholen('tkd', B, T + GRENZEN.wartezeitMs);
  assert.deepEqual(
    r.nachrichten.map((n) => n.inhalt.toString()),
    ['neu'],
  );
  p.ablegen('tkd', A, C, text('x'), T);
  p.aufraeumen(T + GRENZEN.wartezeitMs);
  // Nothing left, not even the empty mailbox of C, who never collected.
  assert.deepEqual(p.stand(), { wartend: 0, bytes: 0, anwesend: 0, postfaecher: 0, absender: 0 });
});

test('mailboxes are per app: a device of another app never gets it', () => {
  const p = postfachAnlegen(GRENZEN);
  p.ablegen('azp', A, B, text('von azp'), T);
  assert.equal(p.abholen('tkd', B, T).nachrichten.length, 0);
  assert.equal(p.abholen('azp', B, T).nachrichten.length, 1);
});

test('limits: per receiver count and bytes, per sender, per app, in total', () => {
  const klein = { ...GRENZEN, jeEmpfaengerAnzahl: 2 };
  const p1 = postfachAnlegen(klein);
  p1.ablegen('tkd', A, B, text('1'), T);
  p1.ablegen('tkd', A, B, text('2'), T);
  assert.deepEqual(p1.ablegen('tkd', A, B, text('3'), T), { ok: false, art: 'empfaenger-voll' });

  const p2 = postfachAnlegen({ ...genau, jeEmpfaengerBytes: 5 });
  p2.ablegen('tkd', A, B, text('1234'), T);
  assert.deepEqual(p2.ablegen('tkd', A, B, text('56'), T), { ok: false, art: 'empfaenger-voll' });

  const p3 = postfachAnlegen({ ...genau, jeAbsenderBytes: 5 });
  p3.ablegen('tkd', A, B, text('1234'), T);
  assert.deepEqual(p3.ablegen('tkd', A, C, text('56'), T), { ok: false, art: 'absender-voll' });
  assert.deepEqual(p3.ablegen('tkd', C, B, text('56'), T), { ok: true });

  const p4 = postfachAnlegen({ ...genau, jeAppBytes: 5 });
  p4.ablegen('tkd', A, B, text('1234'), T);
  assert.deepEqual(p4.ablegen('tkd', C, A, text('56'), T), { ok: false, art: 'app-voll' });
  assert.deepEqual(p4.ablegen('azp', C, A, text('56'), T), { ok: true });

  const p5 = postfachAnlegen({ ...genau, gesamtBytes: 5 });
  p5.ablegen('tkd', A, B, text('1234'), T);
  assert.deepEqual(p5.ablegen('azp', C, A, text('56'), T), { ok: false, art: 'voll' });
});

test('every message counts at least 1 KB: tiny messages to fresh ids do not fill the memory', () => {
  const p = postfachAnlegen(GRENZEN);
  const passen = GRENZEN.jeAbsenderBytes / GRENZEN.nachrichtMindestBytes;
  for (let i = 0; i < passen; i++) {
    assert.deepEqual(p.ablegen('tkd', A, kennung(i), text('x'), T), { ok: true });
  }
  assert.deepEqual(p.ablegen('tkd', A, kennung(passen), text('x'), T), {
    ok: false,
    art: 'absender-voll',
  });
  assert.deepEqual(p.stand(), {
    wartend: passen,
    bytes: GRENZEN.jeAbsenderBytes,
    anwesend: 0,
    postfaecher: passen,
    absender: 1,
  });
  // A message larger than the minimum counts its content.
  const q = postfachAnlegen(GRENZEN);
  q.ablegen('tkd', A, B, Buffer.alloc(5000), T);
  assert.equal(q.stand().bytes, 5000);
  q.abholen('tkd', B, T);
  assert.deepEqual(q.stand(), { wartend: 0, bytes: 0, anwesend: 0, postfaecher: 0, absender: 0 });
});

test('a kept message has a buffer of its own, not a slice of the shared pool', () => {
  const p = postfachAnlegen(GRENZEN);
  const klein = Buffer.from('AQ', 'base64url');
  assert.notEqual(klein.buffer.byteLength, klein.length);
  p.ablegen('tkd', A, B, klein, T);
  const [n] = p.abholen('tkd', B, T).nachrichten;
  assert.ok(n);
  assert.equal(n.inhalt.buffer.byteLength, n.inhalt.length);
  assert.deepEqual([...n.inhalt], [1]);
});

test('collecting and expiry free the limits again', () => {
  const p = postfachAnlegen({ ...genau, jeAbsenderBytes: 5 });

  test('the limits per app and per receiver are freed too, by collecting and by expiry', () => {
    const app = postfachAnlegen({ ...genau, jeAppBytes: 5 });
    app.ablegen('tkd', A, B, text('1234'), T);
    app.abholen('tkd', B, T);
    assert.deepEqual(app.ablegen('tkd', C, A, text('1234'), T), { ok: true });
    const kasten = postfachAnlegen({ ...genau, jeEmpfaengerBytes: 5 });
    kasten.ablegen('tkd', A, B, text('1234'), T);
    kasten.ablegen('tkd', A, B, text('1'), T + 20_000);
    // The first has expired; its bytes no longer count for B's box.
    assert.deepEqual(kasten.ablegen('tkd', C, B, text('1234'), T + 30_000), { ok: true });
    const teil = postfachAnlegen({ ...genau, abholenBytes: 4, jeEmpfaengerBytes: 8 });
    teil.ablegen('tkd', A, B, text('1234'), T);
    teil.ablegen('tkd', A, B, text('5678'), T);
    assert.equal(teil.abholen('tkd', B, T).mehr, true);
    assert.deepEqual(teil.ablegen('tkd', C, B, text('9abc'), T), { ok: true });
  });
  p.ablegen('tkd', A, B, text('1234'), T);
  p.abholen('tkd', B, T);
  assert.deepEqual(p.ablegen('tkd', A, C, text('1234'), T), { ok: true });
  assert.deepEqual(p.ablegen('tkd', A, C, text('56'), T + GRENZEN.wartezeitMs), { ok: true });
});

test('one collect hands out at most abholenBytes, the rest stays (mehr)', () => {
  const p = postfachAnlegen({ ...GRENZEN, abholenBytes: 5 });
  p.ablegen('tkd', A, B, text('1234'), T);
  p.ablegen('tkd', A, B, text('5678'), T);
  const erst = p.abholen('tkd', B, T);
  assert.equal(erst.nachrichten.length, 1);
  assert.equal(erst.mehr, true);
  const dann = p.abholen('tkd', B, T);
  assert.equal(dann.nachrichten.length, 1);
  assert.equal(dann.mehr, false);
});

test('presence: only named ids, only within 30 s, only the same app', () => {
  const p = postfachAnlegen(GRENZEN);
  p.anwesendMerken('tkd', A, T);
  p.anwesendMerken('azp', C, T);
  assert.deepEqual(p.anwesend('tkd', [A, B, C], T + 1), [A]);
  assert.deepEqual(p.anwesend('tkd', [A], T + GRENZEN.anwesendMs), []);
});
