// `npm run probe -- --host https://<treffpunkt>`: checks a running Treffpunkt from outside, with
// invented data only (plan § 9). Without credentials it checks what every stranger sees; with
// `--einladung <code or link>` (an `e1.…` invitation, or the Trainerbuch's `#neu=` link for a new
// device, which carries one; valid 10 min, used once — the probe takes it) it enrols two
// test clients and checks drop, collect, presence, a refusal, the largest body the pull zone lets
// through and ringing with invented endpoints.
// Prints verdicts only, never an access, an invitation or content.
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { einladungAus } from './einladung.ts';
import { standPasst } from './stand.ts';

const { values } = parseArgs({
  options: {
    host: { type: 'string' },
    herkunft: { type: 'string', default: 'https://tkdtest.b-cdn.net' },
    einladung: { type: 'string' },
    stand: { type: 'string' },
  },
});
const host = values.host?.replace(/\/$/, '');
if (!host || !/^https?:\/\/[^/?#]+$/.test(host)) {
  console.error(
    'Aufruf: npm run probe -- --host https://<treffpunkt> [--stand <commit>] [--einladung <code oder link>]',
  );
  process.exit(2);
}
const herkunft = values.herkunft;
let fehler = 0;

function urteil(ok: boolean, text: string, mehr = ''): void {
  if (!ok) fehler++;
  console.log(`${ok ? '✓' : '✗'} ${text}${mehr ? ` (${mehr})` : ''}`);
}

async function post(
  pfad: string,
  daten: unknown,
  zugang?: string,
  kopf: Record<string, string> = {},
): Promise<{ status: number; daten: Record<string, unknown>; kopf: Headers }> {
  const r = await fetch(`${host}${pfad}`, {
    method: 'POST',
    headers: {
      origin: herkunft,
      'content-type': 'application/json',
      ...(zugang ? { authorization: `Bearer ${zugang}` } : {}),
      ...kopf,
    },
    body: typeof daten === 'string' ? daten : JSON.stringify(daten),
  });
  const text = await r.text();
  let json: Record<string, unknown>;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  return { status: r.status, daten: json, kopf: r.headers };
}

const b64 = (s: string): string => Buffer.from(s).toString('base64url');

async function ohneZugang(): Promise<void> {
  const g = await fetch(`${host}/gesund`);
  urteil(g.status === 200, 'GET /gesund antwortet 200', String(g.status));
  const gesund = (await g.json().catch(() => ({}))) as { stand?: unknown };
  const stand = typeof gesund.stand === 'string' ? gesund.stand : 'nicht genannt (älteres Image)';
  if (values.stand) {
    urteil(standPasst(values.stand, stand), 'Es läuft das Image dieses Commits', stand);
  } else {
    console.log(`  Image: ${stand}`);
  }
  const vorab = await fetch(`${host}/v1/abholen`, {
    method: 'OPTIONS',
    headers: { origin: herkunft, 'access-control-request-method': 'POST' },
  });
  urteil(
    vorab.status === 204 && vorab.headers.get('access-control-allow-origin') === herkunft,
    'Vorabanfrage für die eigene Herkunft erlaubt',
    String(vorab.status),
  );
  const fremd = await fetch(`${host}/v1/abholen`, {
    method: 'OPTIONS',
    headers: { origin: 'https://boese.example', 'access-control-request-method': 'POST' },
  });
  urteil(
    fremd.status === 403 && !fremd.headers.get('access-control-allow-origin'),
    'Vorabanfrage für eine fremde Herkunft abgelehnt',
    String(fremd.status),
  );
  const ping = await post('/v1/ping', {});
  urteil(ping.status === 401, 'ping ohne Zugang: 401', String(ping.status));
  // The Treffpunkt sends no-store; bunny's pull zone hands the browser no-cache instead. Both
  // keep the browser from using a stored answer; what matters is that the edge never serves one.
  const cache = ping.kopf.get('cache-control') ?? 'fehlt';
  urteil(['no-store', 'no-cache'].includes(cache), 'Antwort wird nicht zwischengespeichert', cache);
  for (let i = 0; i < 2; i++) {
    const g = await fetch(`${host}/gesund`);
    const rand = g.headers.get('cdn-cache');
    urteil(
      rand !== 'HIT',
      `Rand liefert /gesund nicht aus dem Cache (${i + 1}.)`,
      rand ?? 'kein CDN',
    );
  }
  const frage = await post('/v1/ping?geraet=x', {});
  urteil(frage.status === 400, 'Adresse mit Abfrage abgelehnt', String(frage.status));
  const fremdPost = await post('/v1/ping', {}, undefined, { origin: 'https://boese.example' });
  urteil(fremdPost.status === 403, 'POST von fremder Herkunft: 403', String(fremdPost.status));
}

async function mitEinladung(einladung: string): Promise<void> {
  const a = await post('/v1/einschreiben', { einladung });
  urteil(a.status === 201, 'Test-Client A schreibt sich mit der Einladung ein', String(a.status));
  if (a.status !== 201) return;
  const zugangA = a.daten['zugang'] as string;
  const geraetA = a.daten['geraet'] as string;
  const nochmal = await post('/v1/einschreiben', { einladung });
  urteil(nochmal.status === 409, 'Dieselbe Einladung ein zweites Mal: 409', String(nochmal.status));
  const e = await post('/v1/einladen', {}, zugangA);
  urteil(e.status === 201, 'A lädt Test-Client B ein', String(e.status));
  const b = await post('/v1/einschreiben', { einladung: e.daten['einladung'] });
  urteil(b.status === 201, 'B schreibt sich ein', String(b.status));
  if (b.status !== 201) return;
  const zugangB = b.daten['zugang'] as string;
  const geraetB = b.daten['geraet'] as string;
  // Present is who collected within 30 s: both collect once.
  await post('/v1/abholen', {}, zugangA);
  await post('/v1/abholen', {}, zugangB);
  const ab = await post(
    '/v1/ablegen',
    { an: [{ geraet: geraetB, inhalt: b64('erfunden: Stand 18') }] },
    zugangA,
  );
  const erg = (ab.daten['ergebnisse'] as { ok: boolean; anwesend: boolean }[] | undefined)?.[0];
  urteil(ab.status === 200 && erg?.ok === true, 'A legt für B ab', String(ab.status));
  urteil(erg?.anwesend === true, 'B gilt als anwesend');
  const hol = await post('/v1/abholen', { anwesend: [geraetA] }, zugangB);
  const n = (hol.daten['nachrichten'] as { von: string; inhalt: string }[] | undefined) ?? [];
  urteil(
    n.length === 1 && n[0]?.von === geraetA && n[0]?.inhalt === b64('erfunden: Stand 18'),
    'B holt genau diese Nachricht ab',
  );
  urteil(
    JSON.stringify(hol.daten['anwesend']) === JSON.stringify([geraetA]),
    'B sieht A als anwesend',
  );
  const leer = await post('/v1/abholen', {}, zugangB);
  urteil(JSON.stringify(leer.daten['nachrichten']) === '[]', 'Beim zweiten Abholen ist sie weg');
  const gross = await post(
    '/v1/ablegen',
    { an: [{ geraet: geraetB, inhalt: Buffer.alloc(65_537).toString('base64url') }] },
    zugangA,
  );
  urteil(gross.status === 400, 'Nachricht über 64 KB abgelehnt', String(gross.status));
  // The largest body the pull zone lets through: 50 messages of 64 KB (about 4.4 MB of JSON) to
  // invented ids. The Treffpunkt takes up to 6 MB; an edge that cuts earlier answers 413 or 5xx.
  // The invented messages wait 30 s in RAM, then they are gone.
  const viele = Array.from({ length: 50 }, () => ({
    geraet: `geraet-${randomBytes(16).toString('hex')}`,
    inhalt: Buffer.alloc(65_536, 1).toString('base64url'),
  }));
  const koerper = JSON.stringify({ an: viele }).length;
  const breit = await post('/v1/ablegen', { an: viele }, zugangA);
  const alle = (breit.daten['ergebnisse'] as { ok: boolean }[] | undefined) ?? [];
  urteil(
    breit.status === 200 && alle.length === 50 && alle.every((x) => x.ok),
    `Ein Ablegen mit ${(koerper / 1_048_576).toFixed(1)} MB kommt durch die Pull-Zone`,
    String(breit.status),
  );
  // An invented subscription with an invented VAPID key: the push service must refuse it (4xx).
  // That proves the ring got there; the 13.11 probe with a signed key saw Google 410, Apple 400.
  const vapid = `vapid t=e30.e30.AA, k=${'B'.repeat(87)}`;
  for (const [name, endpunkt] of [
    ['Google', 'https://fcm.googleapis.com/fcm/send/erfunden-treffpunkt-probe'],
    ['Apple', 'https://web.push.apple.com/erfunden-treffpunkt-probe'],
  ] as const) {
    const k = await post(
      '/v1/klingeln',
      {
        endpunkt,
        vapid,
        ttl: 60,
        dringlichkeit: 'normal',
        inhalt: Buffer.alloc(100, 1).toString('base64url'),
      },
      zugangA,
    );
    const dienst = k.daten['dienst'];
    urteil(
      k.status === 200 && typeof dienst === 'number' && dienst >= 400 && dienst < 500,
      `Klingeln an ${name} weitergereicht, erfundenes Abo abgelehnt`,
      `${k.status}, Dienst ${String(dienst)}`,
    );
  }
}

const einladung = values.einladung === undefined ? undefined : einladungAus(values.einladung);
if (values.einladung !== undefined && einladung === undefined) {
  console.error(
    'Keine Einladung erkannt: erwartet wird `e1.…` oder der Link „…#neu=…“ eines Geräts, das sich am Treffpunkt eingeschrieben hat.',
  );
  process.exit(2);
}
await ohneZugang();
if (einladung) await mitEinladung(einladung);
console.log(fehler === 0 ? '\nAlles wie erwartet.' : `\n${fehler} Prüfung(en) nicht wie erwartet.`);
process.exit(fehler === 0 ? 0 : 1);
