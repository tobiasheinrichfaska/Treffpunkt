// The container's start in parts (src/start.ts): settings fail closed, the clocks, the Treffpunkt
// built with the monotonic clock, the timers that tidy up and write the counts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer, globalAgent } from 'node:https';
import type { AddressInfo, LookupFunction } from 'node:net';
import { performance } from 'node:perf_hooks';
import { mock, test } from 'node:test';
import { SENDEN_TIMEOUT_MS } from '../src/klingeln.ts';
import {
  AUFRAEUMEN_MS,
  einstellungenLesen,
  treffpunktFuer,
  uhrenAnlegen,
  ZAEHLER_MS,
  zeitgeberStarten,
} from '../src/start.ts';
import { KonfigurationFehler } from '../src/konfiguration.ts';
import type { Treffpunkt } from '../src/treffpunkt.ts';
import { einladungAusstellen } from '../src/zugang.ts';
import {
  inhalt,
  post,
  schluesselpaar,
  zertifikatSelbst,
  type Aufbau,
  type Ergebnis,
} from './hilfen.ts';

const SCHLUESSEL = Buffer.alloc(32, 7).toString('base64url');
const APPS = readFileSync(new URL('../konfiguration/apps.json', import.meta.url), 'utf8');

test('settings: read strictly, anything wrong stops the start', () => {
  const lesen = (p: string | URL) =>
    String(p).endsWith('stand.txt') ? `${'c'.repeat(40)}\n` : APPS;
  const e = einstellungenLesen({ TREFFPUNKT_SCHLUESSEL: SCHLUESSEL }, lesen);
  assert.equal(e.port, 8080);
  assert.equal(e.stand, 'c'.repeat(40));
  assert.deepEqual([...e.apps.keys()], ['tkd', 'azp']);
  for (const env of [
    {},
    { TREFFPUNKT_SCHLUESSEL: 'kurz' },
    { TREFFPUNKT_SCHLUESSEL: SCHLUESSEL, PORT: '0' },
    { TREFFPUNKT_SCHLUESSEL: SCHLUESSEL, PORT: 'acht' },
    { TREFFPUNKT_SCHLUESSEL: SCHLUESSEL, PORT: '65536' },
  ]) {
    assert.throws(() => einstellungenLesen(env, lesen), KonfigurationFehler, JSON.stringify(env));
  }
  const keineDatei = () => {
    throw new Error('ENOENT');
  };
  assert.throws(
    () => einstellungenLesen({ TREFFPUNKT_SCHLUESSEL: SCHLUESSEL }, keineDatei),
    KonfigurationFehler,
  );
  // Old secrets still accepted: optional, each as strong as the current one, never the current one.
  assert.equal(e.schluesselAlt.length, 0);
  const alt = Buffer.alloc(32, 9).toString('base64url');
  const ring = einstellungenLesen(
    {
      TREFFPUNKT_SCHLUESSEL: SCHLUESSEL,
      TREFFPUNKT_SCHLUESSEL_ALT: `${alt}@2027-01-20, ${alt}@2027-02-01`,
    },
    lesen,
  );
  assert.equal(ring.schluesselAlt.length, 2);
  assert.equal(ring.schluesselAlt[0]?.bisMs, Date.UTC(2027, 0, 21));
  for (const falsch of [
    `${SCHLUESSEL}@2027-01-20`,
    'kurz@2027-01-20',
    alt,
    `${alt}@2027-02-30`,
    `${alt}@20.1.2027`,
  ]) {
    assert.throws(
      () =>
        einstellungenLesen(
          { TREFFPUNKT_SCHLUESSEL: SCHLUESSEL, TREFFPUNKT_SCHLUESSEL_ALT: falsch },
          lesen,
        ),
      KonfigurationFehler,
    );
  }
  // The developer access comes from the environment only; none given means none.
  assert.equal(e.entwickler.schluessel.length, 0);
  assert.equal(e.entwickler.passwoerter.length, 0);
  const mitEntwickler = einstellungenLesen(
    { TREFFPUNKT_SCHLUESSEL: SCHLUESSEL, TREFFPUNKT_ENTWICKLER_SCHLUESSEL: schluesselpaar().roh },
    lesen,
  );
  assert.equal(mitEntwickler.entwickler.schluessel.length, 1);
  assert.throws(
    () =>
      einstellungenLesen(
        { TREFFPUNKT_SCHLUESSEL: SCHLUESSEL, TREFFPUNKT_ENTWICKLER_PASSWOERTER: '[{"app":"tkd"}]' },
        lesen,
      ),
    KonfigurationFehler,
  );
  // Without stand.txt the start goes on; /gesund then says „unbekannt“.
  const ohneStand = (p: string | URL) => {
    if (String(p).endsWith('stand.txt')) throw new Error('ENOENT');
    return APPS;
  };
  assert.equal(
    einstellungenLesen({ TREFFPUNKT_SCHLUESSEL: SCHLUESSEL }, ohneStand).stand,
    'unbekannt',
  );
});

test('the clock for waiting never goes back, whatever the wall clock does', (t) => {
  const uhren = uhrenAnlegen();
  let wand = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => (wand -= 3_600_000));
  const erst = uhren.takt();
  const zweit = uhren.takt();
  const dritt = uhren.takt();
  assert.ok(uhren.jetzt() < 2_000_000_000_000);
  assert.ok(erst <= zweit && zweit <= dritt, `${erst} ${zweit} ${dritt}`);
});

test('the Treffpunkt of the start runs waiting on the monotonic clock', async () => {
  // the repo's apps.json takes no group for tkd (limit 0): the limit is raised here as bunny would, by the environment
  const e = einstellungenLesen(
    { TREFFPUNKT_SCHLUESSEL: SCHLUESSEL, TREFFPUNKT_MANDANTEN: 'tkd=5' },
    () => APPS,
  );
  const uhr = { wand: Date.UTC(2026, 10, 16, 12), takt: 1000 };
  const t = treffpunktFuer(e, { jetzt: () => uhr.wand, takt: () => uhr.takt }, async () => 201);
  // Enrol two devices by invitation (no proof key needed here).
  const geraete = [];
  for (let i = 0; i < 2; i++) {
    const { einladung } = einladungAusstellen(e.schluessel, 'tkd', Math.floor(uhr.wand / 1000));
    const r = await t.behandeln({
      methode: 'POST',
      pfad: '/v1/einschreiben',
      kopf: { origin: 'https://tkdtest.b-cdn.net', 'content-type': 'application/json' },
      koerper: Buffer.from(JSON.stringify({ einladung })),
    });
    geraete.push(JSON.parse(r.koerper) as { geraet: string; zugang: string });
  }
  const a = { t, uhr: { ms: 0, wand: 0 } } as unknown as Aufbau;
  const [g, h] = geraete;
  assert.ok(g && h);
  await post(
    a,
    'ablegen',
    { an: [{ geraet: h.geraet, inhalt: inhalt('x') }] },
    { zugang: g.zugang },
  );
  // The wall clock stands still; 31 s of the monotonic clock pass: the message is gone.
  uhr.takt += 31_000;
  t.aufraeumen();
  assert.equal(t.zaehlstand().wartend, 0);
});

test('the timers tidy up every second and write the counts every five minutes', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    let aufgeraeumt = 0;
    const t = {
      aufraeumen: () => (aufgeraeumt += 1),
      zaehlstand: () => ({ wartend: 0 }),
    } as unknown as Treffpunkt;
    const zeilen: string[] = [];
    const stoppen = zeitgeberStarten(t, (z) => zeilen.push(z));
    mock.timers.tick(AUFRAEUMEN_MS);
    assert.equal(aufgeraeumt, 1);
    mock.timers.tick(ZAEHLER_MS - AUFRAEUMEN_MS);
    assert.equal(aufgeraeumt, ZAEHLER_MS / AUFRAEUMEN_MS);
    assert.equal(zeilen.length, 1);
    assert.match(zeilen[0] ?? '', /"ereignis":"zaehler"/);
    stoppen();
    mock.timers.tick(ZAEHLER_MS);
    assert.equal(zeilen.length, 1);
    assert.deepEqual([AUFRAEUMEN_MS, ZAEHLER_MS], [1000, 300_000]);
  } finally {
    mock.timers.reset();
  }
});

/** Waits in real time (not by timers, which a test may mock) until `bedingung` holds. */
async function bis(bedingung: () => boolean, ms = 3000): Promise<boolean> {
  const ende = performance.now() + ms;
  while (!bedingung() && performance.now() < ende) {
    await new Promise((weiter) => setImmediate(weiter));
  }
  return bedingung();
}

test('the start rings through the real sender: TLS to the push service, cut after its 10 s', async () => {
  // A stand-in for Google's push service: takes the push and never answers.
  const { key, cert } = zertifikatSelbst({ dns: ['fcm.googleapis.com'] });
  let angekommen = 0;
  const dienst = createHttpsServer({ key, cert }, (req) => {
    angekommen += 1;
    req.resume();
  });
  await new Promise<void>((fertig) => dienst.listen(0, '127.0.0.1', fertig));
  const { port } = dienst.address() as AddressInfo;
  // Only in this test: the host leads to the stand-in, and its certificate is trusted.
  const lookup: LookupFunction = (_host, optionen, antwort) => {
    if (optionen.all) antwort(null, [{ address: '127.0.0.1', family: 4 }]);
    else antwort(null, '127.0.0.1', 4);
  };
  const optionen = globalAgent.options as Record<string, unknown>;
  const vorher = { ca: optionen['ca'], port: optionen['port'], lookup: optionen['lookup'] };
  Object.assign(optionen, { ca: cert, port, lookup });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // the repo's apps.json takes no group for tkd (limit 0): the limit is raised here as bunny would, by the environment
    const e = einstellungenLesen(
      { TREFFPUNKT_SCHLUESSEL: SCHLUESSEL, TREFFPUNKT_MANDANTEN: 'tkd=5' },
      () => APPS,
    );
    const uhr = { wand: Date.UTC(2026, 10, 16, 12), takt: 1000 };
    // No sender given: the one the container uses.
    const t = treffpunktFuer(e, { jetzt: () => uhr.wand, takt: () => uhr.takt });
    const { einladung } = einladungAusstellen(e.schluessel, 'tkd', Math.floor(uhr.wand / 1000));
    const ein = await t.behandeln({
      methode: 'POST',
      pfad: '/v1/einschreiben',
      kopf: { origin: 'https://tkdtest.b-cdn.net', 'content-type': 'application/json' },
      koerper: Buffer.from(JSON.stringify({ einladung })),
    });
    const { zugang } = JSON.parse(ein.koerper) as { zugang: string };
    const a = { t, uhr: { ms: 0, wand: 0 } } as unknown as Aufbau;
    let ergebnis: Ergebnis | undefined;
    void post(
      a,
      'klingeln',
      {
        endpunkt: 'https://fcm.googleapis.com/fcm/send/abc',
        vapid: `vapid t=aaa.bbb.ccc, k=${'B'.repeat(87)}`,
        ttl: 900,
        dringlichkeit: 'high',
        inhalt: Buffer.alloc(64, 7).toString('base64url'),
      },
      { zugang },
    ).then((r) => (ergebnis = r));
    assert.ok(await bis(() => angekommen === 1), 'der Push kam nicht beim Dienst an');
    // Just before the deadline the device still waits; at the deadline it hears „push-dienst“.
    mock.timers.tick(SENDEN_TIMEOUT_MS - 1);
    assert.equal(await bis(() => ergebnis !== undefined, 200), false);
    mock.timers.tick(1);
    assert.ok(await bis(() => ergebnis !== undefined), 'keine Antwort nach der Frist');
    assert.equal(ergebnis?.status, 502);
    assert.equal(ergebnis?.daten['art'], 'push-dienst');
    assert.equal(SENDEN_TIMEOUT_MS, 10_000);
  } finally {
    mock.timers.reset();
    for (const [name, wert] of Object.entries(vorher)) {
      if (wert === undefined) Reflect.deleteProperty(optionen, name);
      else optionen[name] = wert;
    }
    dienst.closeAllConnections();
    await new Promise<void>((fertig) => dienst.close(() => fertig()));
  }
});
