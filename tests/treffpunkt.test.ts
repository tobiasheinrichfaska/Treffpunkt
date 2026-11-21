// The rules end to end through `behandeln` (docs/schnittstelle.md): each refusal has its test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRENZEN, KOERPER_BYTES, type Grenzen } from '../src/grenzen.ts';
import { FAEHIGKEITEN, VERSION, verfahrenFuer } from '../src/treffpunkt.ts';
import { einladungAusstellen, neueKennung, zugangAusstellen } from '../src/zugang.ts';
import {
  AZP,
  aufbauen,
  einschreiben,
  FREMD,
  inhalt,
  nachweis,
  post,
  TKD,
  zufallN,
  type Aufbau,
} from './hilfen.ts';

const VAPID = `vapid t=aaa.bbb.ccc, k=${'B'.repeat(87)}`;
const ring = {
  endpunkt: 'https://fcm.googleapis.com/fcm/send/abc',
  vapid: VAPID,
  ttl: 900,
  dringlichkeit: 'high',
  inhalt: Buffer.alloc(64, 7).toString('base64url'),
};
/** The wall clock as the login script and the tests see it (with any step of `uhr.wand`). */
const jetztS = (a: Aufbau) => Math.floor((a.uhr.ms + a.uhr.wand) / 1000);
const frischerNachweis = (a: Aufbau, app = 'tkd') =>
  nachweis(a.paar, { v: 1, app, bis: jetztS(a) + 300, n: zufallN() });

test('GET /gesund answers for the health check with the commit; nothing else is GET', async () => {
  const commit = 'a'.repeat(40);
  const a = aufbauen({ stand: commit });
  const r = await a.t.behandeln({
    methode: 'GET',
    pfad: '/gesund',
    kopf: {},
    koerper: Buffer.alloc(0),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.koerper), {
    ok: true,
    stand: commit,
    v: VERSION,
    faehigkeiten: [...FAEHIGKEITEN],
    verfahren: verfahrenFuer(undefined, '1'),
  });
  const ohne = await aufbauen({ stand: 'nicht ein commit' }).t.behandeln({
    methode: 'GET',
    pfad: '/gesund',
    kopf: {},
    koerper: Buffer.alloc(0),
  });
  assert.deepEqual(JSON.parse(ohne.koerper), {
    ok: true,
    stand: 'unbekannt',
    v: VERSION,
    faehigkeiten: [...FAEHIGKEITEN],
    verfahren: verfahrenFuer(undefined, '1'),
  });
  const g = await a.t.behandeln({
    methode: 'GET',
    pfad: '/v1/ping',
    kopf: { origin: TKD },
    koerper: Buffer.alloc(0),
  });
  assert.equal(g.status, 405);
  const u = await a.t.behandeln({
    methode: 'POST',
    pfad: '/v1/liste',
    kopf: {},
    koerper: Buffer.alloc(0),
  });
  assert.equal(u.status, 404);
});

test('preflight only for a known origin and POST', async () => {
  const a = aufbauen();
  const vorab = (origin: string | undefined, methode: string) =>
    a.t.behandeln({
      methode: 'OPTIONS',
      pfad: '/v1/abholen',
      kopf: { origin, 'access-control-request-method': methode },
      koerper: Buffer.alloc(0),
    });
  const ok = await vorab(AZP, 'POST');
  assert.equal(ok.status, 204);
  assert.equal(ok.kopf['Access-Control-Allow-Origin'], AZP);
  assert.equal(
    ok.kopf['Access-Control-Allow-Headers'],
    'authorization, content-type, x-treffpunkt-signatur, x-treffpunkt-p',
  );
  assert.equal(ok.kopf['X-Content-Type-Options'], 'nosniff');
  assert.equal(ok.kopf['Vary'], 'Origin');
  for (const r of [
    await vorab(FREMD, 'POST'),
    await vorab(undefined, 'POST'),
    await vorab(TKD, 'PUT'),
  ]) {
    assert.equal(r.status, 403);
    assert.equal(r.kopf['Access-Control-Allow-Origin'], undefined);
  }
});

test('every answer: no-store, nosniff, and the origin only if it is known', async () => {
  const a = aufbauen();
  const r = await post(a, 'ping', {}, { herkunft: TKD });
  assert.equal(r.kopf['Cache-Control'], 'no-store');
  assert.equal(r.kopf['X-Content-Type-Options'], 'nosniff');
  assert.equal(r.kopf['Access-Control-Allow-Origin'], TKD);
  const f = await post(a, 'ping', {}, { herkunft: FREMD });
  assert.equal(f.status, 403);
  assert.equal(f.daten['art'], 'herkunft');
  assert.equal(f.kopf['Access-Control-Allow-Origin'], undefined);
  const ohne = await post(a, 'ping', {}, { herkunft: null });
  assert.equal(ohne.daten['art'], 'herkunft');
});

test('only JSON, only up to the size per endpoint, only readable', async () => {
  const a = aufbauen();
  const { zugang } = await einschreiben(a);
  assert.equal((await post(a, 'ping', {}, { zugang, typ: 'text/plain' })).status, 415);
  assert.equal((await post(a, 'ping', {}, { zugang, roh: Buffer.alloc(20_000, 32) })).status, 413);
  assert.equal((await post(a, 'ping', {}, { zugang, roh: Buffer.from('{kaputt') })).status, 400);
  assert.equal(
    (await post(a, 'klingeln', {}, { zugang, roh: Buffer.alloc(9000, 32) })).status,
    413,
  );
  // Without an access the head decides first: the size is never looked at.
  assert.equal((await post(a, 'ping', {}, { roh: Buffer.alloc(20_000, 32) })).status, 401);
  // Exactly at its limit a body is taken, one byte more is not.
  const h = await einschreiben(a);
  const aufgefuellt = (daten: unknown, bytes: number) => {
    const text = JSON.stringify(daten);
    return Buffer.from(text + ' '.repeat(bytes - text.length));
  };
  for (const [endpunkt, daten, bytes] of [
    ['ping', {}, KOERPER_BYTES.klein],
    ['klingeln', ring, KOERPER_BYTES.klingeln],
    ['ablegen', { an: [{ geraet: h.geraet, inhalt: inhalt('x') }] }, KOERPER_BYTES.ablegen],
  ] as const) {
    // With a length the head judges it, without one the rules do once the body is there.
    for (const ohneLaenge of [false, true]) {
      const genau = await post(
        a,
        endpunkt,
        {},
        { zugang, roh: aufgefuellt(daten, bytes), ohneLaenge },
      );
      assert.equal(genau.status, 200, endpunkt);
      const mehr = await post(
        a,
        endpunkt,
        {},
        { zugang, roh: aufgefuellt(daten, bytes + 1), ohneLaenge },
      );
      assert.equal(mehr.status, 413, endpunkt);
    }
  }
});

test('enrolment with a proof: a device id and a one-time access', async () => {
  const a = aufbauen();
  const n = frischerNachweis(a);
  const r = await post(a, 'einschreiben', { nachweis: n });
  assert.equal(r.status, 201);
  assert.match(r.daten['geraet'] as string, /^geraet-[0-9a-f]{32}$/);
  assert.equal(r.daten['bis'], '2027-02-13');
  const ping = await post(a, 'ping', {}, { zugang: r.daten['zugang'] as string });
  assert.deepEqual(ping.daten, { geraet: r.daten['geraet'], app: 'tkd', bis: '2027-02-13' });
  const nochmal = await post(a, 'einschreiben', { nachweis: n });
  assert.equal(nochmal.status, 409);
  assert.equal(nochmal.daten['art'], 'verbraucht');
});

test('enrolment refused: foreign key, app without key, wrong origin for the app, both or none', async () => {
  const a = aufbauen({ ohneNachweisTkd: true });
  const r1 = await post(a, 'einschreiben', { nachweis: frischerNachweis(a) });
  assert.equal(r1.daten['art'], 'nachweis-nicht-eingerichtet');
  const r2 = await post(
    a,
    'einschreiben',
    { nachweis: frischerNachweis(a, 'azp') },
    { herkunft: TKD },
  );
  assert.equal(r2.daten['art'], 'herkunft');
  const b = aufbauen();
  const fremd = aufbauen();
  const r3 = await post(b, 'einschreiben', { nachweis: frischerNachweis(fremd) });
  assert.equal(r3.daten['art'], 'nachweis-unterschrift');
  const r4 = await post(b, 'einschreiben', {
    nachweis: frischerNachweis(b),
    einladung: 'e1.x',
  });
  assert.equal(r4.daten['art'], 'unlesbar');
  assert.equal((await post(b, 'einschreiben', {})).daten['art'], 'unlesbar');
  assert.equal(
    (await post(b, 'einschreiben', { nachweis: 'n1.a.b', x: 1 })).daten['art'],
    'unlesbar',
  );
});

test('invitation by QR: an enrolled device invites, the new device enrols once', async () => {
  const a = aufbauen();
  const trainer = await einschreiben(a);
  const e = await post(a, 'einladen', {}, { zugang: trainer.zugang });
  assert.equal(e.status, 201);
  assert.equal(e.daten['gueltigS'], 600);
  const einladung = e.daten['einladung'] as string;
  const neu = await post(a, 'einschreiben', { einladung });
  assert.equal(neu.status, 201);
  assert.notEqual(neu.daten['geraet'], trainer.geraet);
  assert.equal((await post(a, 'einschreiben', { einladung })).daten['art'], 'verbraucht');
});

test('invitation: expires after 10 minutes, only for its own app, can be switched off per app', async () => {
  const a = aufbauen({ einladenAzp: false });
  const trainer = await einschreiben(a);
  const e = await post(a, 'einladen', {}, { zugang: trainer.zugang });
  const einladung = e.daten['einladung'] as string;
  assert.equal(
    (await post(a, 'einschreiben', { einladung }, { herkunft: AZP })).daten['art'],
    'herkunft',
  );
  a.uhr.ms += 600_000;
  assert.equal((await post(a, 'einschreiben', { einladung })).daten['art'], 'einladung-abgelaufen');
  const buero = await einschreiben(a, 'azp');
  const aus = await post(a, 'einladen', {}, { zugang: buero.zugang, herkunft: AZP });
  assert.equal(aus.daten['art'], 'einladen-aus');
});

test('an invitation made before einladen was switched off is refused too', async () => {
  const a = aufbauen({ einladenAzp: false });
  const { einladung } = einladungAusstellen(a.schluessel, 'azp', jetztS(a));
  const r = await post(a, 'einschreiben', { einladung }, { herkunft: AZP });
  assert.equal(r.daten['art'], 'einladen-aus');
});

test('access: missing, changed, expired, blocked, other app’s origin', async () => {
  const a = aufbauen({ gesperrt: ['geraet-00000000000000000000000000000001'] });
  const g = await einschreiben(a);
  assert.equal((await post(a, 'ping', {})).daten['art'], 'zugang-fehlt');
  assert.equal(
    (await post(a, 'ping', {}, { zugang: `${g.zugang}x` })).daten['art'],
    'zugang-ungueltig',
  );
  assert.equal(
    (await post(a, 'ping', {}, { zugang: g.zugang, herkunft: AZP })).daten['art'],
    'herkunft',
  );
  const gesperrt = zugangAusstellen(
    a.schluessel,
    'tkd',
    'geraet-00000000000000000000000000000001',
    jetztS(a),
  );
  assert.equal((await post(a, 'ping', {}, { zugang: gesperrt.zugang })).daten['art'], 'gesperrt');
  a.uhr.ms += 90 * 86_400_000;
  const r = await post(a, 'ping', {}, { zugang: g.zugang });
  assert.equal(r.status, 401);
  assert.equal(r.daten['art'], 'zugang-abgelaufen');
});

test('renewing gives a new access with a new end; the old one keeps working until its end', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  a.uhr.ms += 30 * 86_400_000;
  const r = await post(a, 'erneuern', {}, { zugang: g.zugang });
  assert.equal(r.status, 200);
  assert.equal(r.daten['bis'], '2027-03-15');
  a.uhr.ms += 70 * 86_400_000;
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).status, 401);
  // The same device, now until the new end: peers keep reaching it under its id.
  const ping = await post(a, 'ping', {}, { zugang: r.daten['zugang'] as string });
  assert.equal(ping.status, 200);
  assert.deepEqual(ping.daten, { geraet: g.geraet, app: 'tkd', bis: '2027-03-15' });
});

test('drop and collect between two devices, with presence', async () => {
  const a = aufbauen();
  const rolf = await einschreiben(a);
  const thomas = await einschreiben(a);
  const leer = await post(a, 'abholen', { anwesend: [rolf.geraet] }, { zugang: thomas.zugang });
  assert.deepEqual(leer.daten, { nachrichten: [], anwesend: [], mehr: false });
  const ab = await post(
    a,
    'ablegen',
    { an: [{ geraet: rolf.geraet, inhalt: inhalt('Stand 18') }] },
    { zugang: thomas.zugang },
  );
  assert.deepEqual(ab.daten, { ergebnisse: [{ geraet: rolf.geraet, ok: true, anwesend: false }] });
  a.uhr.ms += 1500;
  const hol = await post(a, 'abholen', { anwesend: [thomas.geraet] }, { zugang: rolf.zugang });
  assert.deepEqual(hol.daten, {
    nachrichten: [{ von: thomas.geraet, inhalt: inhalt('Stand 18'), alterMs: 1500 }],
    anwesend: [thomas.geraet],
    mehr: false,
  });
  const zweit = await post(a, 'abholen', {}, { zugang: rolf.zugang });
  assert.deepEqual(zweit.daten['nachrichten'], []);
});

test('drop to several receivers at once, each refused on its own', async () => {
  const a = aufbauen({ grenzen: { jeEmpfaengerAnzahl: 1 } });
  const trainer = await einschreiben(a);
  const eltern = [await einschreiben(a), await einschreiben(a), await einschreiben(a)];
  await post(
    a,
    'ablegen',
    { an: [{ geraet: eltern[2]?.geraet, inhalt: inhalt('vorher') }] },
    { zugang: trainer.zugang },
  );
  const r = await post(
    a,
    'ablegen',
    { an: eltern.map((e) => ({ geraet: e.geraet, inhalt: inhalt(`für ${e.geraet}`) })) },
    { zugang: trainer.zugang },
  );
  const ergebnisse = r.daten['ergebnisse'] as { ok: boolean; art?: string }[];
  assert.deepEqual(
    ergebnisse.map((e) => e.ok),
    [true, true, false],
  );
  assert.equal(ergebnisse[2]?.art, 'empfaenger-voll');
  // The counts every 5 minutes name the reason, so a full Treffpunkt shows.
  assert.equal(a.t.zaehlstand().fehler['empfaenger-voll'], 1);
});

test('drop refused as a whole when unreadable: too many, twice the same, to oneself, empty, too large', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  const viele = Array.from({ length: GRENZEN.empfaengerJeAblegen + 1 }, (_, i) => ({
    geraet: `geraet-${i.toString(16).padStart(32, '0')}`,
    inhalt: inhalt('x'),
  }));
  for (const an of [
    [],
    viele,
    [
      { geraet: h.geraet, inhalt: inhalt('1') },
      { geraet: h.geraet, inhalt: inhalt('2') },
    ],
    [{ geraet: g.geraet, inhalt: inhalt('selbst') }],
    [{ geraet: h.geraet, inhalt: '' }],
    [{ geraet: h.geraet, inhalt: Buffer.alloc(GRENZEN.nachrichtBytes + 1).toString('base64url') }],
    [{ geraet: 'Rolf', inhalt: inhalt('x') }],
    [{ geraet: h.geraet, inhalt: inhalt('x'), extra: 1 }],
  ]) {
    const r = await post(a, 'ablegen', { an }, { zugang: g.zugang });
    assert.equal(r.status, 400, JSON.stringify(an).slice(0, 80));
  }
  const groesst = Buffer.alloc(GRENZEN.nachrichtBytes).toString('base64url');
  // Nothing of a refused request was taken, not even its readable entries before the bad one.
  assert.deepEqual((await post(a, 'abholen', {}, { zugang: h.zugang })).daten['nachrichten'], []);
  const ok = await post(
    a,
    'ablegen',
    { an: [{ geraet: h.geraet, inhalt: groesst }] },
    { zugang: g.zugang },
  );
  assert.equal(ok.status, 200);
  // As many receivers as allowed, and no more, are taken.
  const genug = await post(a, 'ablegen', { an: viele.slice(1) }, { zugang: g.zugang });
  assert.equal(genug.status, 200);
  assert.equal((genug.daten['ergebnisse'] as unknown[]).length, GRENZEN.empfaengerJeAblegen);
});

test('apps are separate: a TKD device drops for an AZP id, the AZP device gets nothing', async () => {
  const a = aufbauen();
  const tkd = await einschreiben(a);
  const azp = await einschreiben(a, 'azp');
  // The TKD device is present in its own app, so the empty presence below shows the separation.
  await post(a, 'abholen', {}, { zugang: tkd.zugang });
  await post(
    a,
    'ablegen',
    { an: [{ geraet: azp.geraet, inhalt: inhalt('hallo') }] },
    { zugang: tkd.zugang },
  );
  const r = await post(
    a,
    'abholen',
    { anwesend: [tkd.geraet] },
    { zugang: azp.zugang, herkunft: AZP },
  );
  assert.deepEqual(r.daten, { nachrichten: [], anwesend: [], mehr: false });
});

test('apps are separate the other way too: an AZP device drops, invites and renews in its own app', async () => {
  const a = aufbauen();
  const tkd = await einschreiben(a);
  const azp = await einschreiben(a, 'azp');
  const azp2 = await einschreiben(a, 'azp');
  const vonAzp = { zugang: azp.zugang, herkunft: AZP };
  await post(
    a,
    'ablegen',
    {
      an: [
        { geraet: tkd.geraet, inhalt: inhalt('an tkd') },
        { geraet: azp2.geraet, inhalt: inhalt('an azp') },
      ],
    },
    vonAzp,
  );
  const beiTkd = await post(a, 'abholen', {}, { zugang: tkd.zugang });
  assert.deepEqual(beiTkd.daten['nachrichten'], []);
  const beiAzp = await post(a, 'abholen', {}, { zugang: azp2.zugang, herkunft: AZP });
  assert.deepEqual(
    (beiAzp.daten['nachrichten'] as { von: string; inhalt: string }[]).map((n) => [
      n.von,
      n.inhalt,
    ]),
    [[azp.geraet, inhalt('an azp')]],
  );
  // An invitation of an AZP device is one of AZP: from TKD's page it is refused.
  const e = (await post(a, 'einladen', {}, vonAzp)).daten['einladung'] as string;
  assert.match(e, /^e1\.azp\./);
  assert.equal((await post(a, 'einschreiben', { einladung: e })).daten['art'], 'herkunft');
  const neu = await post(a, 'einschreiben', { einladung: e }, { herkunft: AZP });
  assert.equal(neu.status, 201);
  const neuPing = await post(
    a,
    'ping',
    {},
    { zugang: neu.daten['zugang'] as string, herkunft: AZP },
  );
  assert.equal(neuPing.daten['app'], 'azp');
  // A renewed AZP access stays the same device of AZP.
  const erneuert = await post(a, 'erneuern', {}, vonAzp);
  const ping = await post(
    a,
    'ping',
    {},
    { zugang: erneuert.daten['zugang'] as string, herkunft: AZP },
  );
  assert.deepEqual([ping.daten['geraet'], ping.daten['app']], [azp.geraet, 'azp']);
});

test('a message waits at most 30 s', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  await post(
    a,
    'ablegen',
    { an: [{ geraet: h.geraet, inhalt: inhalt('zu spät') }] },
    { zugang: g.zugang },
  );
  a.uhr.ms += 30_000;
  assert.deepEqual((await post(a, 'abholen', {}, { zugang: h.zugang })).daten['nachrichten'], []);
});

test('presence is asked only for named ids, at most 200, never oneself', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  await post(a, 'abholen', {}, { zugang: g.zugang });
  const r = await post(a, 'abholen', { anwesend: [g.geraet] }, { zugang: g.zugang });
  assert.deepEqual(r.daten['anwesend'], []);
  const zuViele = Array.from(
    { length: 201 },
    (_, i) => `geraet-${i.toString(16).padStart(32, '0')}`,
  );
  assert.equal((await post(a, 'abholen', { anwesend: zuViele }, { zugang: g.zugang })).status, 400);
  const genug = await post(a, 'abholen', { anwesend: zuViele.slice(1) }, { zugang: g.zugang });
  assert.equal(genug.status, 200);
  assert.deepEqual(genug.daten['anwesend'], []);
});

test('requests per device and minute are limited, each device on its own', async () => {
  const a = aufbauen({ grenzen: { anfragenJeMinute: 3 } });
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  for (let i = 0; i < 3; i++)
    assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).status, 200);
  const r = await post(a, 'ping', {}, { zugang: g.zugang });
  assert.equal(r.status, 429);
  assert.equal((await post(a, 'ping', {}, { zugang: h.zugang })).status, 200);
  a.uhr.ms += 60_000;
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).status, 200);
});

test('enrolments per app and hour, invitations per device and hour are limited', async () => {
  const a = aufbauen({ grenzen: { einschreibenJeStunde: 1, einladenJeStunde: 1 } });
  const g = await einschreiben(a);
  const r = await post(a, 'einschreiben', { nachweis: frischerNachweis(a) });
  assert.equal(r.daten['art'], 'zu-viele-einschreibungen');
  assert.equal((await post(a, 'einladen', {}, { zugang: g.zugang })).status, 201);
  assert.equal(
    (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['art'],
    'zu-viele-einladungen',
  );
  await einschreiben(a, 'azp');
});

test('ringing: handed on with the given request, only the status comes back', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  a.dienst = 201;
  const r = await post(a, 'klingeln', ring, { zugang: g.zugang });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.daten).sort(), ['dienst', 'ms']);
  assert.equal(r.daten['dienst'], 201);
  const gesendet = a.gesendet[0];
  assert.ok(gesendet);
  assert.equal(gesendet.endpunkt, ring.endpunkt);
  assert.equal(gesendet.vapid, VAPID);
  assert.equal(gesendet.ttl, 900);
  assert.equal(gesendet.dringlichkeit, 'high');
  assert.equal(gesendet.koerper.length, 64);
});

test('ringing: unknown push service refused before anything is sent; 60 an hour; service down', async () => {
  const a = aufbauen({ grenzen: { klingelnJeStunde: 2 } });
  const g = await einschreiben(a);
  const boese = await post(
    a,
    'klingeln',
    { ...ring, endpunkt: 'https://boese.example/x' },
    { zugang: g.zugang },
  );
  assert.equal(boese.daten['art'], 'klingeln-ungueltig');
  assert.equal(a.gesendet.length, 0);
  // The refused request above used up nothing: both of the two allowed rings go out.
  assert.equal((await post(a, 'klingeln', ring, { zugang: g.zugang })).status, 200);
  assert.equal((await post(a, 'klingeln', ring, { zugang: g.zugang })).status, 200);
  const vorher = a.gesendet.length;
  assert.equal(
    (await post(a, 'klingeln', ring, { zugang: g.zugang })).daten['art'],
    'klingeln-zu-oft',
  );
  // Refused before it leaves: the push service never sees it.
  assert.equal(a.gesendet.length, vorher);
  // Per device: another device may still ring.
  const h = await einschreiben(a);
  assert.equal((await post(a, 'klingeln', ring, { zugang: h.zugang })).status, 200);
  a.uhr.ms += 3_600_000;
  a.dienst = new Error('nicht erreicht');
  const weg = await post(a, 'klingeln', ring, { zugang: g.zugang });
  assert.equal(weg.status, 502);
  assert.equal(weg.daten['art'], 'push-dienst');
});

test('the counts name endpoints and kinds of refusal, never an id or content', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  await post(
    a,
    'ablegen',
    { an: [{ geraet: h.geraet, inhalt: inhalt('geheim') }] },
    { zugang: g.zugang },
  );
  await post(a, 'ping', {}, { zugang: 'falsch' });
  const stand = a.t.zaehlstand();
  const text = JSON.stringify(stand);
  assert.equal(stand.anfragen['ablegen'], 1);
  assert.equal(stand.fehler['zugang-ungueltig'], 1);
  assert.equal(stand.wartend, 1);
  assert.doesNotMatch(text, /geraet-|z1\.|geheim|Z2VoZWlt/);
  assert.deepEqual(a.t.zaehlstand().anfragen, {});
});

test('tidying up removes what expired', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  await post(
    a,
    'ablegen',
    { an: [{ geraet: h.geraet, inhalt: inhalt('x') }] },
    { zugang: g.zugang },
  );
  a.uhr.ms += 31_000;
  a.t.aufraeumen();
  assert.equal(a.t.zaehlstand().wartend, 0);
});

test('the wall clock set back: nothing waits longer than 30 s, and ages stay true', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  const ab = (text: string) =>
    post(a, 'ablegen', { an: [{ geraet: h.geraet, inhalt: inhalt(text) }] }, { zugang: g.zugang });
  await ab('vor dem Sprung');
  a.uhr.wand = -600_000;
  a.uhr.ms += 1500;
  await ab('nach dem Sprung');
  const hol = await post(a, 'abholen', {}, { zugang: h.zugang });
  assert.deepEqual(
    (hol.daten['nachrichten'] as { alterMs: number }[]).map((n) => n.alterMs),
    [1500, 0],
  );
  await ab('wartet');
  a.uhr.ms += 31_000;
  a.t.aufraeumen();
  assert.equal(a.t.zaehlstand().wartend, 0);
});

test('an invitation chain does not use up the enrolments with a proof (own quota)', async () => {
  const a = aufbauen({ grenzen: { einschreibenJeStunde: 2, einschreibenEinladungJeStunde: 1 } });
  const trainer = await einschreiben(a);
  const einladung = async () =>
    (await post(a, 'einladen', {}, { zugang: trainer.zugang })).daten['einladung'] as string;
  assert.equal((await post(a, 'einschreiben', { einladung: await einladung() })).status, 201);
  const zweite = await post(a, 'einschreiben', { einladung: await einladung() });
  assert.equal(zweite.daten['art'], 'zu-viele-einschreibungen');
  // The proof quota (2) still has its second place, used by the trainer only once.
  assert.equal((await post(a, 'einschreiben', { nachweis: frischerNachweis(a) })).status, 201);
});

test('refused enrolments use up no quota: a proof taken already, an origin of another app', async () => {
  const a = aufbauen({ grenzen: { einschreibenJeStunde: 2 } });
  const genommen = frischerNachweis(a);
  assert.equal((await post(a, 'einschreiben', { nachweis: genommen })).status, 201);
  assert.equal((await post(a, 'einschreiben', { nachweis: genommen })).status, 409);
  const fremd = await post(a, 'einschreiben', { nachweis: frischerNachweis(a) }, { herkunft: AZP });
  assert.equal(fremd.daten['art'], 'herkunft');
  assert.equal((await post(a, 'einschreiben', { nachweis: frischerNachweis(a) })).status, 201);
});

test('an origin of another app gets its refusal without a CORS header', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  const ping = await post(a, 'ping', {}, { zugang: g.zugang, herkunft: AZP });
  assert.equal(ping.daten['art'], 'herkunft');
  assert.equal(ping.kopf['Access-Control-Allow-Origin'], undefined);
  const ein = await post(a, 'einschreiben', { nachweis: frischerNachweis(a) }, { herkunft: AZP });
  assert.equal(ein.daten['art'], 'herkunft');
  assert.equal(ein.kopf['Access-Control-Allow-Origin'], undefined);
});

test('a proof and an invitation stay used across tidying up, until their end', async () => {
  const a = aufbauen();
  const n = frischerNachweis(a);
  assert.equal((await post(a, 'einschreiben', { nachweis: n })).status, 201);
  const trainer = await einschreiben(a);
  const e = (await post(a, 'einladen', {}, { zugang: trainer.zugang })).daten['einladung'];
  assert.equal((await post(a, 'einschreiben', { einladung: e })).status, 201);
  a.uhr.ms += 1000;
  a.t.aufraeumen();
  assert.equal((await post(a, 'einschreiben', { nachweis: n })).daten['art'], 'verbraucht');
  assert.equal((await post(a, 'einschreiben', { einladung: e })).daten['art'], 'verbraucht');
  // Close to their end too: the proof in its last second, the invitation in its last second.
  a.uhr.ms += 298_000;
  a.t.aufraeumen();
  assert.equal((await post(a, 'einschreiben', { nachweis: n })).daten['art'], 'verbraucht');
  a.uhr.ms += 300_000;
  a.t.aufraeumen();
  assert.equal((await post(a, 'einschreiben', { einladung: e })).daten['art'], 'verbraucht');
});

test('every limit survives tidying up: requests, ringing, invitations, enrolments', async () => {
  const a = aufbauen({
    grenzen: {
      anfragenJeMinute: 4,
      klingelnJeStunde: 1,
      einladenJeStunde: 1,
      einschreibenJeStunde: 1,
      einschreibenEinladungJeStunde: 1,
    },
  });
  const g = await einschreiben(a);
  assert.equal((await post(a, 'klingeln', ring, { zugang: g.zugang })).status, 200);
  const e = (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['einladung'];
  assert.equal((await post(a, 'einschreiben', { einladung: e })).status, 201);
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).status, 200);
  a.uhr.ms += 1000;
  a.t.aufraeumen();
  assert.equal(
    (await post(a, 'klingeln', ring, { zugang: g.zugang })).daten['art'],
    'klingeln-zu-oft',
  );
  assert.equal(
    (await post(a, 'einschreiben', { nachweis: frischerNachweis(a) })).daten['art'],
    'zu-viele-einschreibungen',
  );
  // The fourth request of this device in the minute: the limit is used up.
  assert.equal(
    (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['art'],
    'zu-viele-anfragen',
  );
});

test('invitations per device and enrolments by invitation survive tidying up', async () => {
  const a = aufbauen({ grenzen: { einladenJeStunde: 1, einschreibenEinladungJeStunde: 1 } });
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  const e = (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['einladung'];
  assert.equal((await post(a, 'einschreiben', { einladung: e })).status, 201);
  a.uhr.ms += 1000;
  a.t.aufraeumen();
  assert.equal(
    (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['art'],
    'zu-viele-einladungen',
  );
  const f = (await post(a, 'einladen', {}, { zugang: h.zugang })).daten['einladung'];
  assert.equal(
    (await post(a, 'einschreiben', { einladung: f })).daten['art'],
    'zu-viele-einschreibungen',
  );
});

test('an access or invitation of an app no longer configured: app-unbekannt', async () => {
  const a = aufbauen();
  const alt = zugangAusstellen(a.schluessel, 'alt', neueKennung(), jetztS(a));
  const r = await post(a, 'ping', {}, { zugang: alt.zugang });
  assert.equal(r.status, 403);
  assert.equal(r.daten['art'], 'app-unbekannt');
  const { einladung } = einladungAusstellen(a.schluessel, 'alt', jetztS(a));
  assert.equal((await post(a, 'einschreiben', { einladung })).daten['art'], 'app-unbekannt');
});

test('presence: a drop says the receiver is present; presence survives tidying up', async () => {
  const a = aufbauen();
  const rolf = await einschreiben(a);
  const thomas = await einschreiben(a);
  await post(a, 'abholen', {}, { zugang: rolf.zugang });
  a.uhr.ms += 1000;
  a.t.aufraeumen();
  const ab = await post(
    a,
    'ablegen',
    { an: [{ geraet: rolf.geraet, inhalt: inhalt('Stand 19') }] },
    { zugang: thomas.zugang },
  );
  assert.deepEqual(ab.daten, { ergebnisse: [{ geraet: rolf.geraet, ok: true, anwesend: true }] });
  const hol = await post(a, 'abholen', { anwesend: [rolf.geraet] }, { zugang: thomas.zugang });
  assert.deepEqual(hol.daten['anwesend'], [rolf.geraet]);
});

test('the head is judged before the body: path, origin, type, access, limit per endpoint', () => {
  const a = aufbauen();
  const vor = (pfad: string, kopf: Record<string, string>, methode = 'POST') =>
    a.t.vorpruefen({
      methode,
      pfad,
      kopf: { origin: TKD, 'content-type': 'application/json', ...kopf },
    });
  const art = (r: ReturnType<typeof vor>) =>
    'antwort' in r ? (JSON.parse(r.antwort.koerper) as { art?: string }).art : undefined;
  assert.equal(art(vor('/nirgends', {})), 'unbekannt');
  assert.equal(art(vor('/v1/ablegen', { origin: FREMD })), 'herkunft');
  assert.equal(art(vor('/v1/ablegen', { 'content-type': 'text/plain' })), 'typ');
  assert.equal(art(vor('/v1/ablegen', {})), 'zugang-fehlt');
  assert.equal(art(vor('/v1/ablegen', { authorization: 'Bearer z1.tkd.x' })), 'zugang-ungueltig');
  const z = zugangAusstellen(a.schluessel, 'tkd', neueKennung(), jetztS(a)).zugang;
  const mit = { authorization: `Bearer ${z}` };
  const grenze = (r: ReturnType<typeof vor>) => {
    assert.ok('hoechstens' in r);
    r.freigeben();
    return r.hoechstens;
  };
  assert.equal(grenze(vor('/v1/ablegen', mit)), KOERPER_BYTES.ablegen);
  assert.equal(grenze(vor('/v1/klingeln', mit)), KOERPER_BYTES.klingeln);
  assert.equal(grenze(vor('/v1/abholen', mit)), KOERPER_BYTES.klein);
  assert.equal(grenze(vor('/v1/einschreiben', {})), KOERPER_BYTES.klein);
  const g = vor('/gesund', {}, 'GET');
  assert.ok('antwort' in g && g.antwort.status === 200);
});

test('a request judged by its head is counted once, refused or not', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  a.t.zaehlstand();
  const kopf = { origin: TKD, 'content-type': 'application/json' };
  a.t.vorpruefen({ methode: 'POST', pfad: '/v1/ping', kopf });
  const mit = { ...kopf, authorization: `Bearer ${g.zugang}` };
  a.t.vorpruefen({ methode: 'POST', pfad: '/v1/ping', kopf: mit });
  await a.t.behandeln({ methode: 'POST', pfad: '/v1/ping', kopf: mit, koerper: Buffer.from('{}') });
  // Refused for a foreign origin or a type that is no JSON: counted for their endpoint as well.
  a.t.vorpruefen({ methode: 'POST', pfad: '/v1/ping', kopf: { ...mit, origin: FREMD } });
  a.t.vorpruefen({
    methode: 'POST',
    pfad: '/v1/ping',
    kopf: { ...mit, 'content-type': 'text/plain' },
  });
  const stand = a.t.zaehlstand();
  assert.deepEqual(stand.anfragen, { ping: 4 });
  assert.deepEqual(stand.fehler, { 'zugang-fehlt': 1, herkunft: 1, typ: 1 });
  // Refused while room is taken (429 per minute, 413 by its announced length): counted too.
  const b = aufbauen({ grenzen: { anfragenJeMinute: 1 } });
  const h = await einschreiben(b);
  const mitH = { ...kopf, authorization: `Bearer ${h.zugang}` };
  b.t.zaehlstand();
  const lang = { ...mitH, 'content-length': String(KOERPER_BYTES.ablegen + 1) };
  b.t.vorpruefen({ methode: 'POST', pfad: '/v1/ablegen', kopf: lang });
  b.t.vorpruefen({ methode: 'POST', pfad: '/v1/ablegen', kopf: mitH });
  const zwei = b.t.zaehlstand();
  assert.deepEqual(zwei.anfragen, { ablegen: 2 });
  assert.deepEqual(zwei.fehler, { 'zu-gross': 1, 'zu-viele-anfragen': 1 });
});

test('from an origin of another app every credential gets the same opaque refusal', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  const ohneCors = (r: {
    status: number;
    daten: Record<string, unknown>;
    kopf: Record<string, string>;
  }) => {
    assert.equal(r.status, 403);
    assert.equal(r.daten['art'], 'herkunft');
    assert.equal(r.kopf['Access-Control-Allow-Origin'], undefined);
  };
  ohneCors(await post(a, 'ping', {}, { zugang: g.zugang, herkunft: AZP }));
  ohneCors(await post(a, 'ping', {}, { zugang: `${g.zugang}x`, herkunft: AZP }));
  const alt = zugangAusstellen(a.schluessel, 'tkd', neueKennung(), jetztS(a) - 91 * 86_400);
  ohneCors(await post(a, 'ping', {}, { zugang: alt.zugang, herkunft: AZP }));
  const abgelaufen = nachweis(a.paar, { v: 1, app: 'tkd', bis: jetztS(a) - 1, n: zufallN() });
  ohneCors(await post(a, 'einschreiben', { nachweis: abgelaufen }, { herkunft: AZP }));
  const falsch = `${frischerNachweis(a).slice(0, -2)}AA`;
  ohneCors(await post(a, 'einschreiben', { nachweis: falsch }, { herkunft: AZP }));
  const { einladung } = einladungAusstellen(a.schluessel, 'tkd', jetztS(a));
  ohneCors(await post(a, 'einschreiben', { einladung: `${einladung}x` }, { herkunft: AZP }));
  // From the app's own origin the same refusals stay readable.
  const eigen = await post(a, 'ping', {}, { zugang: `${g.zugang}x` });
  assert.equal(eigen.daten['art'], 'zugang-ungueltig');
  assert.equal(eigen.kopf['Access-Control-Allow-Origin'], TKD);
});

test('the wall clock set back brings no used proof or invitation back', async () => {
  const a = aufbauen();
  const n = frischerNachweis(a);
  assert.equal((await post(a, 'einschreiben', { nachweis: n })).status, 201);
  const trainer = await einschreiben(a);
  const e = (await post(a, 'einladen', {}, { zugang: trainer.zugang })).daten['einladung'];
  assert.equal((await post(a, 'einschreiben', { einladung: e })).status, 201);
  a.uhr.ms += 601_000;
  a.t.aufraeumen();
  a.uhr.wand = -400_000;
  assert.notEqual((await post(a, 'einschreiben', { nachweis: n })).status, 201);
  assert.notEqual((await post(a, 'einschreiben', { einladung: e })).status, 201);
});

test('the wall clock set forward wipes no limit; presence ends after 30 s', async () => {
  const a = aufbauen({ grenzen: { anfragenJeMinute: 2, klingelnJeStunde: 1 } });
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  assert.equal((await post(a, 'klingeln', ring, { zugang: g.zugang })).status, 200);
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).status, 200);
  a.uhr.wand = 600_000;
  a.t.aufraeumen();
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).daten['art'], 'zu-viele-anfragen');
  assert.equal((await post(a, 'klingeln', ring, { zugang: h.zugang })).status, 200);
  assert.equal(
    (await post(a, 'klingeln', ring, { zugang: h.zugang })).daten['art'],
    'klingeln-zu-oft',
  );
  const b = aufbauen();
  const rolf = await einschreiben(b);
  const thomas = await einschreiben(b);
  await post(b, 'abholen', {}, { zugang: rolf.zugang });
  b.uhr.ms += 31_000;
  const ab = await post(
    b,
    'ablegen',
    { an: [{ geraet: rolf.geraet, inhalt: inhalt('x') }] },
    { zugang: thomas.zugang },
  );
  assert.deepEqual(ab.daten, { ergebnisse: [{ geraet: rolf.geraet, ok: true, anwesend: false }] });
  const hol = await post(b, 'abholen', { anwesend: [rolf.geraet] }, { zugang: thomas.zugang });
  assert.deepEqual(hol.daten['anwesend'], []);
});

test('ages and durations are whole milliseconds, also from a clock with fractions', async () => {
  let schritt = 0;
  const a = aufbauen({ takt: (ms) => ms / 3 + (schritt++ % 2) * 0.37 });
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  await post(
    a,
    'ablegen',
    { an: [{ geraet: h.geraet, inhalt: inhalt('x') }] },
    { zugang: g.zugang },
  );
  a.uhr.ms += 1000;
  const hol = await post(a, 'abholen', {}, { zugang: h.zugang });
  const alter = (hol.daten['nachrichten'] as { alterMs: number }[])[0]?.alterMs;
  assert.ok(Number.isSafeInteger(alter), String(alter));
  const k = await post(a, 'klingeln', ring, { zugang: g.zugang });
  assert.ok(Number.isSafeInteger(k.daten['ms']), String(k.daten['ms']));
});

const kopfVon = (zugang?: string, laenge?: number) => ({
  origin: TKD,
  'content-type': 'application/json',
  ...(zugang ? { authorization: `Bearer ${zugang}` } : {}),
  ...(laenge === undefined ? {} : { 'content-length': String(laenge) }),
});

test('bodies on the way: two per device, a cap with and one without an access, freed again', async () => {
  const a = aufbauen({
    grenzen: {
      koerperImFlugBytes: 3_000_000,
      koerperOhneZugangImFlugBytes: 20_000,
      koerperKleinReserveBytes: 0,
    },
  });
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  const vor = (zugang: string | undefined, laenge?: number, pfad = '/v1/ablegen') =>
    a.t.vorpruefen({ methode: 'POST', pfad, kopf: kopfVon(zugang, laenge) });
  const art = (r: ReturnType<typeof vor>) =>
    'antwort' in r ? (JSON.parse(r.antwort.koerper) as { art?: string }).art : 'frei';
  const erst = vor(g.zugang, 1_000_000);
  const zweit = vor(g.zugang, 1_000_000);
  assert.equal(art(erst), 'frei');
  assert.equal(art(zweit), 'frei');
  assert.equal(art(vor(g.zugang, 10)), 'zu-viele-anfragen');
  // Over all devices with an access: 3 MB; without a length the endpoint's 6 MB is taken.
  assert.equal(art(vor(h.zugang)), 'beschaeftigt');
  const dritt = vor(h.zugang, 1_000_000);
  assert.equal(art(dritt), 'frei');
  assert.equal(art(vor(h.zugang, 1_000_000)), 'beschaeftigt');
  // Enrolments have their own pot: still room there.
  const ein = vor(undefined, 16_000, '/v1/einschreiben');
  assert.equal(art(ein), 'frei');
  assert.equal(art(vor(undefined, 16_000, '/v1/einschreiben')), 'beschaeftigt');
  assert.equal(a.t.zaehlstand().unterwegs, 2);
  for (const r of [erst, zweit, dritt, ein]) if ('freigeben' in r) r.freigeben();
  // Freed twice counts once: the pots are exactly empty again, not below.
  if ('freigeben' in erst) erst.freigeben();
  if ('freigeben' in ein) ein.freigeben();
  // No device id stays behind once its bodies are read.
  assert.equal(a.t.zaehlstand().unterwegs, 0);
  const wieder = vor(g.zugang, 1_000_000);
  assert.equal(art(wieder), 'frei');
  assert.equal(art(vor(g.zugang, 1_000_000)), 'frei');
  assert.equal(art(vor(h.zugang, 1_000_000)), 'frei');
  assert.equal(art(vor(h.zugang, 1)), 'beschaeftigt');
  assert.equal(art(vor(undefined, 16_000, '/v1/einschreiben')), 'frei');
  assert.equal(art(vor(undefined, 16_000, '/v1/einschreiben')), 'beschaeftigt');
});

test('a device over its requests per minute is refused before its body', async () => {
  const a = aufbauen({ grenzen: { anfragenJeMinute: 1 } });
  const g = await einschreiben(a);
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).status, 200);
  const r = a.t.vorpruefen({ methode: 'POST', pfad: '/v1/ablegen', kopf: kopfVon(g.zugang) });
  assert.ok('antwort' in r);
  assert.equal(r.antwort.status, 429);
});

test('a wall clock that ran ahead and is set right locks nobody out', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  // While the clock is a year ahead, the access looks expired; that is the clock's fault.
  a.uhr.wand = 365 * 86_400_000;
  a.t.aufraeumen();
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).status, 401);
  a.uhr.wand = 0;
  a.uhr.ms += 60_000;
  a.t.aufraeumen();
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).status, 200);
  assert.equal((await post(a, 'einschreiben', { nachweis: frischerNachweis(a) })).status, 201);
});

test('an expired access stays expired when the wall clock is set back; new ones are issued right', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  a.uhr.ms += 90 * 86_400_000 - 60_000;
  // h renews just before its end, g does not.
  const neu = (await post(a, 'erneuern', {}, { zugang: h.zugang })).daten['zugang'] as string;
  a.uhr.ms += 61_000;
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).daten['art'], 'zugang-abgelaufen');
  a.uhr.wand = -86_400_000;
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).daten['art'], 'zugang-abgelaufen');
  assert.equal((await post(a, 'erneuern', {}, { zugang: g.zugang })).status, 401);
  // An invitation issued now is judged by the same time: it enrols.
  const e = (await post(a, 'einladen', {}, { zugang: neu })).daten['einladung'];
  assert.equal((await post(a, 'einschreiben', { einladung: e })).status, 201);
});

test('the wall clock set forward by the whole window wipes no quota', async () => {
  const a = aufbauen({
    grenzen: {
      klingelnJeStunde: 1,
      einladenJeStunde: 1,
      einschreibenJeStunde: 2,
      einschreibenEinladungJeStunde: 1,
    },
  });
  const g = await einschreiben(a);
  assert.equal((await post(a, 'klingeln', ring, { zugang: g.zugang })).status, 200);
  const e = (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['einladung'];
  const neu = await post(a, 'einschreiben', { einladung: e });
  assert.equal(neu.status, 201);
  a.uhr.wand = 3_600_000;
  a.t.aufraeumen();
  assert.equal(
    (await post(a, 'klingeln', ring, { zugang: g.zugang })).daten['art'],
    'klingeln-zu-oft',
  );
  assert.equal(
    (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['art'],
    'zu-viele-einladungen',
  );
  assert.equal((await post(a, 'einschreiben', { nachweis: frischerNachweis(a) })).status, 201);
  assert.equal(
    (await post(a, 'einschreiben', { nachweis: frischerNachweis(a) })).daten['art'],
    'zu-viele-einschreibungen',
  );
  // Invitations go by the Treffpunkt's own clock, so one made now is good; its quota is used up.
  const vomNeuen = { zugang: neu.daten['zugang'] as string };
  const zweite = (await post(a, 'einladen', {}, vomNeuen)).daten['einladung'];
  assert.match(String(zweite), /^e1\./);
  assert.equal(
    (await post(a, 'einschreiben', { einladung: zweite })).daten['art'],
    'zu-viele-einschreibungen',
  );
});

test('strict bodies: no unknown field at the top of any endpoint', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  const zugang = g.zugang;
  for (const [endpunkt, daten] of [
    ['ping', { x: 1 }],
    ['erneuern', { x: 1 }],
    ['einladen', { x: 1 }],
    ['abholen', { anwesend: [], x: 1 }],
    ['ablegen', { an: [{ geraet: h.geraet, inhalt: inhalt('x') }], x: 1 }],
    ['einschreiben', { nachweis: frischerNachweis(a), x: 1 }],
  ] as const) {
    const r = await post(a, endpunkt, daten, { zugang });
    assert.equal(r.status, 400, endpunkt);
    assert.equal(r.daten['art'], 'unlesbar', endpunkt);
  }
});

test('tidying up forgets what ended: used marks, every counter, presence, mailboxes', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  await post(a, 'klingeln', ring, { zugang: g.zugang });
  await post(a, 'abholen', {}, { zugang: g.zugang });
  // Both invitation counters and an invitation's mark get an entry too …
  const e = (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['einladung'];
  assert.equal((await post(a, 'einschreiben', { einladung: e })).status, 201);
  // … and a mailbox nobody collects, with a large body (it is booked in the bytes of the minute).
  await post(
    a,
    'ablegen',
    { an: [{ geraet: neueKennung(), inhalt: Buffer.alloc(20_000, 1).toString('base64url') }] },
    { zugang: g.zugang },
  );
  a.t.aufraeumen();
  const vorher = a.t.zaehlstand();
  assert.equal(vorher.marken, 2);
  // Requests, ringing, invitations, both enrolment counters, and the bytes of the minute (device, app).
  assert.equal(vorher.zaehlerSchluessel, 7);
  assert.ok(vorher.anwesend > 0 && vorher.postfaecher > 0);
  a.uhr.ms += 2 * 3_600_000;
  a.t.aufraeumen();
  const nachher = a.t.zaehlstand();
  assert.deepEqual(
    [nachher.marken, nachher.zaehlerSchluessel, nachher.anwesend, nachher.postfaecher],
    [0, 0, 0, 0],
  );
});

test('bodies on the way are kept per app: one app’s devices cannot stall another app', async () => {
  const a = aufbauen({
    grenzen: { koerperJeAppImFlugBytes: 3_000_000, koerperKleinReserveBytes: 0 },
  });
  const azp1 = await einschreiben(a, 'azp');
  const azp2 = await einschreiben(a, 'azp');
  const tkd = await einschreiben(a);
  const vor = (zugang: string, herkunft: string, laenge: number) =>
    a.t.vorpruefen({
      methode: 'POST',
      pfad: '/v1/ablegen',
      kopf: { ...kopfVon(zugang, laenge), origin: herkunft },
    });
  const art = (r: ReturnType<typeof vor>) =>
    'antwort' in r ? (JSON.parse(r.antwort.koerper) as { art?: string }).art : 'frei';
  assert.equal(art(vor(azp1.zugang, AZP, 1_500_000)), 'frei');
  assert.equal(art(vor(azp1.zugang, AZP, 1_500_000)), 'frei');
  assert.equal(art(vor(azp2.zugang, AZP, 1_500_000)), 'beschaeftigt');
  assert.equal(art(vor(tkd.zugang, TKD, 1_500_000)), 'frei');
});

test('a wall clock that ran ahead and is set right brings no used proof back', async () => {
  const a = aufbauen();
  a.uhr.wand = 200_000;
  // The login script's clock is right: the proof ends 300 s from the true time.
  const n = nachweis(a.paar, {
    v: 1,
    app: 'tkd',
    bis: Math.floor(a.uhr.ms / 1000) + 300,
    n: zufallN(),
  });
  assert.equal((await post(a, 'einschreiben', { nachweis: n })).status, 201);
  assert.equal((await post(a, 'einschreiben', { nachweis: n })).status, 409);
  a.uhr.ms += 110_000;
  a.t.aufraeumen();
  a.uhr.wand = 0;
  a.t.aufraeumen();
  assert.equal((await post(a, 'einschreiben', { nachweis: n })).daten['art'], 'verbraucht');
});

test('a wall clock ahead at the start: proofs are refused until a restart, and the counts say so', async () => {
  const a = aufbauen({ wandStart: 3_600_000 });
  a.uhr.wand = 0;
  a.uhr.ms += 60_000;
  const n = nachweis(a.paar, {
    v: 1,
    app: 'tkd',
    bis: Math.floor(a.uhr.ms / 1000) + 300,
    n: zufallN(),
  });
  assert.equal(
    (await post(a, 'einschreiben', { nachweis: n })).daten['art'],
    'nachweis-abgelaufen',
  );
  assert.equal(a.t.zaehlstand().uhrRueckstandS, 3600);
  assert.equal(aufbauen().t.zaehlstand().uhrRueckstandS, 0);
});

test('every request with an access counts per minute, also one whose body is unreadable', async () => {
  const a = aufbauen({ grenzen: { anfragenJeMinute: 3 } });
  const g = await einschreiben(a);
  for (let i = 0; i < 3; i++) {
    const r = await post(a, 'ablegen', {}, { zugang: g.zugang, roh: Buffer.from('{') });
    assert.equal(r.daten['art'], 'unlesbar');
  }
  const vierte = await post(a, 'ablegen', {}, { zugang: g.zugang, roh: Buffer.from('{') });
  assert.equal(vierte.daten['art'], 'zu-viele-anfragen');
});

test('bytes per minute: large bodies of a device and an app, collecting always goes on', async () => {
  const a = aufbauen({
    grenzen: { koerperBytesJeGeraetMinute: 100_000, koerperBytesJeAppMinute: 160_000 },
  });
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  const k = await einschreiben(a);
  const z = await einschreiben(a, 'azp');
  const ziel = await einschreiben(a);
  const zielAzp = await einschreiben(a, 'azp');
  /** A drop of exactly `bytes` (large from KOERPER_BYTES.klein + 1 on). */
  const ablage = (bytes: number, an = ziel.geraet) => {
    const text = JSON.stringify({ an: [{ geraet: an, inhalt: inhalt('x') }] });
    return Buffer.from(text + ' '.repeat(bytes - text.length));
  };
  const senden = async (zugang: string, bytes: number, herkunft = TKD, an = ziel.geraet) => {
    const r = await post(a, 'ablegen', {}, { zugang, herkunft, roh: ablage(bytes, an) });
    return r.status === 200 ? 'ok' : r.daten['art'];
  };
  const klein = async (zugang: string) => [
    (await post(a, 'abholen', {}, { zugang })).status,
    (await post(a, 'ping', {}, { zugang })).status,
    (await post(a, 'ablegen', {}, { zugang, roh: ablage(KOERPER_BYTES.klein) })).status,
  ];
  // The device's minute up to its edge; one more large body waits (429), small ones go on.
  assert.deepEqual([await senden(g.zugang, 50_000), await senden(g.zugang, 50_000)], ['ok', 'ok']);
  assert.equal(await senden(g.zugang, KOERPER_BYTES.klein + 1), 'zu-viele-anfragen');
  assert.deepEqual(await klein(g.zugang), [200, 200, 200]);
  // The app's minute: 100 000 of g, 60 000 more of h, then no more large bodies (503) …
  assert.equal(await senden(h.zugang, 60_000), 'ok');
  assert.equal(await senden(h.zugang, KOERPER_BYTES.klein + 1), 'beschaeftigt');
  assert.equal(await senden(k.zugang, KOERPER_BYTES.klein + 1), 'beschaeftigt');
  // … while every device of the app still collects, pings and drops small, and the other app goes on.
  assert.deepEqual(await klein(k.zugang), [200, 200, 200]);
  assert.equal(await senden(z.zugang, 50_000, AZP, zielAzp.geraet), 'ok');
  // Too large stays 413, never 503.
  assert.equal(await senden(k.zugang, KOERPER_BYTES.ablegen + 1), 'zu-gross');
  // A minute later both may send again.
  a.uhr.ms += 60_000;
  assert.equal(await senden(g.zugang, 50_000), 'ok');
  assert.equal(await senden(h.zugang, 50_000), 'ok');
});

test('bytes per minute are booked only for a body read: announced and broken off costs nothing', async () => {
  const a = aufbauen({
    grenzen: { koerperBytesJeGeraetMinute: 100_000, koerperBytesJeAppMinute: 200_000 },
  });
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  // Heads announcing 90 000 bytes, whose bodies never come (the client went away): all get room …
  for (let i = 0; i < 5; i++) {
    const r = a.t.vorpruefen({
      methode: 'POST',
      pfad: '/v1/ablegen',
      kopf: kopfVon(g.zugang, 90_000),
    });
    assert.ok('freigeben' in r, String(i));
    r.freigeben();
  }
  // … and nothing of the minute was used: a real body of 90 000 bytes still passes.
  const text = JSON.stringify({ an: [{ geraet: h.geraet, inhalt: inhalt('x') }] });
  const roh = Buffer.from(text + ' '.repeat(90_000 - text.length));
  assert.equal((await post(a, 'ablegen', {}, { zugang: g.zugang, roh })).status, 200);
  // A body refused for its form still was read and parsed: it counts (20 000 + 90 000 > 100 000).
  const kaputt = Buffer.alloc(20_000, 32);
  assert.equal((await post(a, 'ablegen', {}, { zugang: h.zugang, roh: kaputt })).status, 400);
  const danach = await post(a, 'ablegen', {}, { zugang: h.zugang, roh });
  assert.equal(danach.daten['art'], 'zu-viele-anfragen');
});

test('too large stays 413 when the pots are busy or the device has two bodies on the way', async () => {
  const a = aufbauen();
  const geraete = [await einschreiben(a), await einschreiben(a), await einschreiben(a)];
  const vor = (zugang: string, laenge: number) =>
    a.t.vorpruefen({ methode: 'POST', pfad: '/v1/ablegen', kopf: kopfVon(zugang, laenge) });
  const art = (r: ReturnType<typeof vor>) =>
    'antwort' in r ? (JSON.parse(r.antwort.koerper) as { art?: string }).art : 'frei';
  // Five bodies of 6 MB: 30 of the app's 32 MB, two of them from the first device.
  for (const [i, g] of [0, 0, 1, 1, 2].map((n) => [n, geraete[n]] as const)) {
    assert.equal(art(vor(g?.zugang ?? '', KOERPER_BYTES.ablegen)), 'frei', String(i));
  }
  assert.equal(art(vor(geraete[2]?.zugang ?? '', 7_340_032)), 'zu-gross');
  assert.equal(art(vor(geraete[0]?.zugang ?? '', 7_340_032)), 'zu-gross');
  // A length beyond the safe integers (Node passes such digits on) is too large as well.
  const riesig = a.t.vorpruefen({
    methode: 'POST',
    pfad: '/v1/ablegen',
    kopf: { ...kopfVon(geraete[2]?.zugang ?? ''), 'content-length': '9007199254740993' },
  });
  assert.equal(art(riesig), 'zu-gross');
});

test('strict values: presence ids, canonical base64url, the push service’s status, the type’s form', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  const zugang = g.zugang;
  for (const anwesend of [['Rolf'], [h.geraet, h.geraet]]) {
    assert.equal((await post(a, 'abholen', { anwesend }, { zugang })).daten['art'], 'unlesbar');
  }
  // „AR“ decodes like „AQ“, but is not how base64url writes that byte.
  const ab = await post(a, 'ablegen', { an: [{ geraet: h.geraet, inhalt: 'AR' }] }, { zugang });
  assert.equal(ab.daten['art'], 'unlesbar');
  for (const dienst of [0, 99, 600]) {
    a.dienst = dienst;
    assert.equal((await post(a, 'klingeln', ring, { zugang })).daten['art'], 'push-dienst');
  }
  a.dienst = 201;
  const typ = await post(a, 'ping', {}, { zugang, typ: 'Application/JSON; charset=utf-8' });
  assert.equal(typ.status, 200);
});

test('an invitation shown while the wall clock ran ahead works after it is set right, and only 10 min', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  a.uhr.wand = 5 * 60_000;
  const e = (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['einladung'];
  a.uhr.wand = 0;
  a.uhr.ms += 60_000;
  assert.equal((await post(a, 'einschreiben', { einladung: e })).status, 201);
  // Ahead by 30 days: the code must not wait until then and be valid a month later.
  const b = aufbauen();
  const h = await einschreiben(b);
  b.uhr.wand = 30 * 86_400_000;
  const f = (await post(b, 'einladen', {}, { zugang: h.zugang })).daten['einladung'];
  b.uhr.wand = 0;
  b.uhr.ms += 30 * 86_400_000;
  assert.equal(
    (await post(b, 'einschreiben', { einladung: f })).daten['art'],
    'einladung-abgelaufen',
  );
});

test('every counter holds for its whole window and lets go right after it', async () => {
  // Requests: two a minute.
  const m = aufbauen({ grenzen: { anfragenJeMinute: 2 } });
  const d = await einschreiben(m);
  assert.equal((await post(m, 'ping', {}, { zugang: d.zugang })).status, 200);
  assert.equal((await post(m, 'ping', {}, { zugang: d.zugang })).status, 200);
  m.uhr.ms += 59_000;
  assert.equal((await post(m, 'ping', {}, { zugang: d.zugang })).daten['art'], 'zu-viele-anfragen');
  m.uhr.ms += 1_000;
  assert.equal((await post(m, 'ping', {}, { zugang: d.zugang })).status, 200);
  // Ringing, inviting, enrolling: per hour, all counted at the same moment.
  const a = aufbauen({
    grenzen: {
      klingelnJeStunde: 1,
      einladenJeStunde: 1,
      einschreibenJeStunde: 2,
      einschreibenEinladungJeStunde: 1,
    },
  });
  const g = await einschreiben(a);
  const h = await einschreiben(a);
  assert.equal((await post(a, 'klingeln', ring, { zugang: g.zugang })).status, 200);
  const e = (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['einladung'];
  assert.equal((await post(a, 'einschreiben', { einladung: e })).status, 201);
  a.uhr.ms += 3_599_000 - 5 * 60_000;
  const f = (await post(a, 'einladen', {}, { zugang: h.zugang })).daten['einladung'];
  a.uhr.ms += 5 * 60_000;
  assert.deepEqual(
    {
      klingeln: (await post(a, 'klingeln', ring, { zugang: g.zugang })).daten['art'],
      einladen: (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['art'],
      nachweis: (await post(a, 'einschreiben', { nachweis: frischerNachweis(a) })).daten['art'],
      einladung: (await post(a, 'einschreiben', { einladung: f })).daten['art'],
    },
    {
      klingeln: 'klingeln-zu-oft',
      einladen: 'zu-viele-einladungen',
      nachweis: 'zu-viele-einschreibungen',
      einladung: 'zu-viele-einschreibungen',
    },
  );
  a.uhr.ms += 1_000;
  assert.equal((await post(a, 'klingeln', ring, { zugang: g.zugang })).status, 200);
  assert.equal((await post(a, 'einladen', {}, { zugang: g.zugang })).status, 201);
  assert.equal((await post(a, 'einschreiben', { nachweis: frischerNachweis(a) })).status, 201);
  assert.equal((await post(a, 'einschreiben', { einladung: f })).status, 201);
});

test('a wall clock behind at the start and set right later: invitations still live 10 minutes', async () => {
  const a = aufbauen({ wandStart: -15 * 60_000 });
  a.uhr.ms += 1000;
  a.uhr.wand = 0;
  const g = await einschreiben(a);
  const e = (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['einladung'];
  a.uhr.ms += 9 * 60_000;
  assert.equal((await post(a, 'einschreiben', { einladung: e })).status, 201);
  const f = (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['einladung'];
  a.uhr.ms += 10 * 60_000;
  assert.equal(
    (await post(a, 'einschreiben', { einladung: f })).daten['art'],
    'einladung-abgelaufen',
  );
  // While the wall clock runs ahead by 2 minutes, an invitation lives its 10 minutes as well.
  a.uhr.wand = 2 * 60_000;
  const k = (await post(a, 'einladen', {}, { zugang: g.zugang })).daten['einladung'];
  a.uhr.ms += 9 * 60_000;
  assert.equal((await post(a, 'einschreiben', { einladung: k })).status, 201);
});

test('with the wall clock behind, renewed and new accesses are issued from the right time', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  a.uhr.wand = -100 * 86_400_000;
  const neu = await post(a, 'erneuern', {}, { zugang: g.zugang });
  assert.equal(neu.status, 200);
  assert.equal(neu.daten['bis'], '2027-02-13');
  // The login script's clock is right; the new device's access is made from the right time too.
  const n = nachweis(a.paar, {
    v: 1,
    app: 'tkd',
    bis: Math.floor(a.uhr.ms / 1000) + 300,
    n: zufallN(),
  });
  const ein = await post(a, 'einschreiben', { nachweis: n });
  assert.equal(ein.daten['bis'], '2027-02-13');
  a.uhr.ms += 60 * 86_400_000;
  for (const zugang of [neu.daten['zugang'], ein.daten['zugang']] as string[]) {
    assert.equal((await post(a, 'ping', {}, { zugang })).status, 200);
  }
});

test('large slow bodies leave room for the small ones: collecting, pinging and small drops go on', async () => {
  const MB = 1_048_576;
  const pruefen = async (grenzen: Partial<Grenzen>, gross: readonly number[]) => {
    const a = aufbauen({ grenzen });
    const geraete = [await einschreiben(a), await einschreiben(a), await einschreiben(a)];
    const vierter = await einschreiben(a);
    const vor = (zugang: string, pfad: string, laenge?: number) =>
      a.t.vorpruefen({ methode: 'POST', pfad, kopf: kopfVon(zugang, laenge) });
    const art = (r: ReturnType<typeof vor>) =>
      'antwort' in r ? (JSON.parse(r.antwort.koerper) as { art?: string }).art : 'frei';
    // Large bodies fill the pot right up to its edge less the reserve: all of them get room.
    const gehalten = gross.map((mb, i) =>
      vor(geraete[Math.floor(i / 2)]?.zugang ?? '', '/v1/ablegen', mb * MB),
    );
    assert.deepEqual(
      gehalten.map(art),
      gross.map(() => 'frei'),
    );
    // One byte more of a large body, or a drop without a length (it counts as 6 MB): no room.
    assert.equal(art(vor(vierter.zugang, '/v1/ablegen', KOERPER_BYTES.klein + 1)), 'beschaeftigt');
    assert.equal(art(vor(vierter.zugang, '/v1/ablegen')), 'beschaeftigt');
    // The reserve is the small bodies': a small drop of another device, collecting, pinging …
    for (const [pfad, laenge] of [
      ['/v1/ablegen', KOERPER_BYTES.klein],
      ['/v1/abholen', 2],
      ['/v1/ping', 2],
      ['/v1/erneuern', 2],
      ['/v1/klingeln', 2],
    ] as const) {
      const r = vor(vierter.zugang, pfad, laenge);
      assert.equal(art(r), 'frei', pfad);
      if ('freigeben' in r) r.freigeben();
    }
  };
  // The pot of the app: 32 MB, 31 of them for large bodies.
  await pruefen({}, [6, 6, 6, 6, 6, 1]);
  // The pot of all devices with an access: here 4 MB, 3 of them for large bodies.
  await pruefen({ koerperImFlugBytes: 4 * MB }, [1, 1, 1]);
});
