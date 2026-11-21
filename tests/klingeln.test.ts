import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { createServer as createHttpsServer, globalAgent } from 'node:https';
import {
  createServer as createNetServer,
  type AddressInfo,
  type Server as NetServer,
  type Socket,
} from 'node:net';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { createServer as createTlsServer } from 'node:tls';
import { readFileSync } from 'node:fs';
import {
  DRINGLICHKEITEN,
  httpsSendenMit,
  klingelAnfrageLesen,
  MAX_ENDPUNKT,
  MAX_PUSH,
  MAX_TTL_S,
  MAX_VAPID,
  pushDienstVon,
  SENDEN_TIMEOUT_MS,
  type KlingelAnfrage,
} from '../src/klingeln.ts';
import { zertifikatSelbst } from './hilfen.ts';

const VAPID = `vapid t=aaa.bbb.ccc, k=${'B'.repeat(87)}`;
const gut = () => ({
  endpunkt: 'https://fcm.googleapis.com/fcm/send/abc',
  vapid: VAPID,
  ttl: 900,
  dringlichkeit: 'high',
  inhalt: Buffer.alloc(100, 1).toString('base64url'),
});

test('known push services by exact host or subdomain', () => {
  assert.equal(pushDienstVon('https://fcm.googleapis.com/fcm/send/x'), 'Google');
  assert.equal(pushDienstVon('https://web.push.apple.com/QW'), 'Apple');
  assert.equal(pushDienstVon('https://api.push.apple.com/x'), 'Apple');
  assert.equal(pushDienstVon('https://updates.push.services.mozilla.com/wpush/v2/x'), 'Mozilla');
  assert.equal(pushDienstVon('https://wns2-par02p.notify.windows.com/w/?token=x'), 'Microsoft');
});

test('look-alikes, http, ports and logins are refused', () => {
  for (const e of [
    'https://push.apple.com/x',
    'https://evilpush.apple.com/x',
    'https://push.apple.com.boese.example/x',
    'https://fcm.googleapis.com.boese.example/x',
    'https://boese.example/fcm.googleapis.com',
    'http://fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://nutzer@fcm.googleapis.com/x',
    'https://fcm.googleapis.com',
    `https://fcm.googleapis.com/${'x'.repeat(900)}`,
  ]) {
    assert.equal(pushDienstVon(e), undefined, e);
  }
});

test('a ring request is read strictly', () => {
  const a = klingelAnfrageLesen(gut());
  assert.ok(a);
  assert.equal(a.koerper.length, 100);
  for (const falsch of [
    { ...gut(), extra: 1 },
    { ...gut(), vapid: 'Bearer x' },
    { ...gut(), vapid: `vapid t=a.b.c, k=${'B'.repeat(86)}` },
    // The pattern fits, but the header is longer than any real VAPID header (1024).
    { ...gut(), vapid: `vapid t=${'a'.repeat(1000)}.b.c, k=${'B'.repeat(87)}` },
    { ...gut(), ttl: -1 },
    { ...gut(), ttl: 86_401 },
    { ...gut(), ttl: 1.5 },
    { ...gut(), dringlichkeit: 'sofort' },
    { ...gut(), inhalt: '' },
    { ...gut(), inhalt: 'a+b/' },
    { ...gut(), inhalt: Buffer.alloc(MAX_PUSH + 1).toString('base64url') },
    { ...gut(), endpunkt: 'https://boese.example/x' },
    [gut()],
    null,
  ]) {
    assert.equal(klingelAnfrageLesen(falsch), undefined, JSON.stringify(falsch));
  }
  assert.ok(
    klingelAnfrageLesen({ ...gut(), inhalt: Buffer.alloc(MAX_PUSH).toString('base64url') }),
  );
});

test('the ringing limits are those of the interface', () => {
  const text = readFileSync(new URL('../docs/schnittstelle.md', import.meta.url), 'utf8').replace(
    /\s+/g,
    ' ',
  );
  const abschnitt = text.slice(
    text.indexOf('### `POST /v1/klingeln`'),
    text.indexOf('## Ablehnungen'),
  );
  const tausend = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const [letzte, ...andere] = [...DRINGLICHKEITEN].reverse();
  for (const satz of [
    `\`endpunkt\`: höchstens ${MAX_ENDPUNKT} Zeichen`,
    `höchstens ${MAX_VAPID} Zeichen`,
    `\`ttl\`: ganze Sekunden von 0 bis ${tausend(MAX_TTL_S)}`,
    `\`dringlichkeit\`: ${andere
      .reverse()
      .map((d) => `\`${d}\``)
      .join(', ')} oder \`${letzte ?? ''}\``,
    `1 bis ${MAX_PUSH} Byte`,
    `binnen ${SENDEN_TIMEOUT_MS / 1000} s`,
  ]) {
    assert.ok(abschnitt.includes(satz), satz);
  }
  // The limits hold exactly at their edge.
  const lang = `https://fcm.googleapis.com/${'x'.repeat(MAX_ENDPUNKT - 27)}`;
  assert.equal(lang.length, MAX_ENDPUNKT);
  assert.ok(klingelAnfrageLesen({ ...gut(), endpunkt: lang }));
  assert.equal(klingelAnfrageLesen({ ...gut(), endpunkt: `${lang}x` }), undefined);
  const vapid = `vapid t=${'a'.repeat(MAX_VAPID - 8 - 4 - 4 - 87)}.b.c, k=${'B'.repeat(87)}`;
  assert.equal(vapid.length, MAX_VAPID);
  assert.ok(klingelAnfrageLesen({ ...gut(), vapid }));
  assert.equal(
    klingelAnfrageLesen({ ...gut(), vapid: vapid.replace('vapid t=', 'vapid t=a') }),
    undefined,
  );
  for (const ttl of [0, MAX_TTL_S]) assert.ok(klingelAnfrageLesen({ ...gut(), ttl }), String(ttl));
  for (const dringlichkeit of DRINGLICHKEITEN) {
    assert.ok(klingelAnfrageLesen({ ...gut(), dringlichkeit }), dringlichkeit);
  }
});

// --- The real way out (httpsSendenMit), against local servers ---

const anfrageAn = (adresse: string): KlingelAnfrage => {
  const a = klingelAnfrageLesen(gut());
  assert.ok(a);
  return { ...a, endpunkt: adresse };
};

/** Settles within `ms`, or names that it did not. */
async function binnen<T>(p: Promise<T>, ms: number): Promise<T | 'haengt'> {
  let uhr: NodeJS.Timeout | undefined;
  const haengt = new Promise<'haengt'>((weiter) => (uhr = setTimeout(() => weiter('haengt'), ms)));
  try {
    return await Promise.race([p, haengt]);
  } finally {
    clearTimeout(uhr);
  }
}

async function lauschen(server: NetServer): Promise<number> {
  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));
  return (server.address() as AddressInfo).port;
}

test('the push service is reached over TLS only with a certificate that checks', async () => {
  const { key, cert } = zertifikatSelbst();
  assert.equal(new X509Certificate(cert).subject, 'CN=treffpunkt');
  const gesehen: { pfad: string | undefined; kopf: Record<string, unknown>; koerper: Buffer }[] =
    [];
  let geschlossen: number | undefined;
  const server = createHttpsServer({ key, cert }, (req, res) => {
    const teile: Buffer[] = [];
    req.on('data', (t: Buffer) => teile.push(t));
    req.on('end', () => {
      gesehen.push({ pfad: req.url, kopf: req.headers, koerper: Buffer.concat(teile) });
      if (req.url === '/weiter') res.writeHead(302, { location: '/push' }).end();
      else if (req.url === '/offen') {
        // Answers at once, then keeps the body open and says nothing more.
        res.writeHead(201).write('{');
        req.socket.on('close', () => (geschlossen = performance.now()));
      } else res.writeHead(201).end('{"x":"wird nicht weitergegeben"}');
    });
  });
  const port = await lauschen(server);
  const senden = httpsSendenMit(2000);
  try {
    // A certificate nobody vouches for: refused, nothing sent.
    await assert.rejects(senden(anfrageAn(`https://127.0.0.1:${port}/push`)), /self.signed/i);
    assert.equal(gesehen.length, 0);
    // Trusted (as a real push service's would be): the status, and the push as it was given.
    const vorher = globalAgent.options.ca;
    globalAgent.options.ca = cert;
    try {
      assert.equal(await senden(anfrageAn(`https://127.0.0.1:${port}/push`)), 201);
      const a = anfrageAn('');
      assert.deepEqual(
        {
          pfad: gesehen[0]?.pfad,
          authorization: gesehen[0]?.kopf['authorization'],
          ttl: gesehen[0]?.kopf['ttl'],
          urgency: gesehen[0]?.kopf['urgency'],
          kodierung: gesehen[0]?.kopf['content-encoding'],
          typ: gesehen[0]?.kopf['content-type'],
          gleich: gesehen[0]?.koerper.equals(a.koerper),
        },
        {
          pfad: '/push',
          authorization: VAPID,
          ttl: '900',
          urgency: 'high',
          kodierung: 'aes128gcm',
          typ: 'application/octet-stream',
          gleich: true,
        },
      );
      // A redirect is answered as it is, never followed.
      assert.equal(await senden(anfrageAn(`https://127.0.0.1:${port}/weiter`)), 302);
      assert.deepEqual(
        gesehen.map((g) => g.pfad),
        ['/push', '/weiter'],
      );
      // An answer whose body never ends holds the socket only until it has been silent for the
      // time limit.
      const beginn = performance.now();
      assert.equal(await httpsSendenMit(300)(anfrageAn(`https://127.0.0.1:${port}/offen`)), 201);
      await binnen(
        new Promise<void>((weiter) => {
          const uhr = setInterval(() => {
            if (geschlossen !== undefined) {
              clearInterval(uhr);
              weiter();
            }
          }, 20);
        }),
        3000,
      );
      assert.ok(geschlossen !== undefined && geschlossen - beginn < 2000, 'Verbindung offen');
    } finally {
      globalAgent.options.ca = vorher;
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((fertig) => server.close(() => fertig()));
  }
});

test('a push service that is silent, or answers too slowly, counts as not reached', async () => {
  const { key, cert } = zertifikatSelbst();
  const offen: Socket[] = [];
  // Silent: takes the connection and says nothing, not even TLS.
  const still = createNetServer((s) => offen.push(s));
  // Slow: speaks TLS, then writes its answer one byte every 100 ms, so the socket is never idle for
  // long, but the head of the answer never ends.
  const langsam = createTlsServer({ key, cert }, (s) => {
    offen.push(s);
    let n = 0;
    const text = 'HTTP/1.1 201 Created\r\nX-Langsam: ';
    const uhr = setInterval(() => s.write(text[n++] ?? 'a'), 100);
    s.on('close', () => clearInterval(uhr));
    s.on('error', () => clearInterval(uhr));
  });
  const ports = [await lauschen(still), await lauschen(langsam)];
  const vorher = globalAgent.options.ca;
  globalAgent.options.ca = cert;
  try {
    for (const port of ports) {
      const beginn = performance.now();
      const ergebnis = await binnen(
        httpsSendenMit(400)(anfrageAn(`https://127.0.0.1:${port}/push`)).then(
          () => 'erreicht',
          (e: Error) => e.message,
        ),
        3000,
      );
      assert.equal(ergebnis, 'Zeitüberschreitung', `Port ${port}`);
      assert.ok(performance.now() - beginn < 2000);
    }
  } finally {
    globalAgent.options.ca = vorher;
    for (const s of offen) s.destroy();
    await Promise.all(
      [still, langsam].map((s) => new Promise<void>((fertig) => s.close(() => fertig()))),
    );
  }
});
