// Through real HTTP on a free local port: the head is judged before the body, body limits per
// endpoint, a body too slow, a query refused, an abort is no error, an internal error says nothing.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { connect, type AddressInfo } from 'node:net';
import { test } from 'node:test';
import {
  ANFRAGE_ZEIT_MS,
  KOERPER_ZEIT_MS,
  KOPF_ZEIT_MS,
  LEERLAUF_ZEIT_MS,
  PRUEFABSTAND_MS,
  serverAnlegen,
} from '../src/http.ts';
import { KOERPER_BYTES } from '../src/grenzen.ts';
import { FAEHIGKEITEN, VERSION, type Treffpunkt } from '../src/treffpunkt.ts';
import { besitzText } from '../src/zulassung.ts';
import {
  aufbauen,
  einschreiben,
  einschreibenMitSchluessel,
  neuesGeraet,
  TKD,
  type Aufbau,
} from './hilfen.ts';
import { sign } from 'node:crypto';

async function mitServer(
  t: Treffpunkt,
  fn: (basis: string, zeilen: string[]) => Promise<void>,
  koerperZeitMs?: number,
): Promise<void> {
  const zeilen: string[] = [];
  const server = serverAnlegen(
    t,
    (z) => zeilen.push(z),
    koerperZeitMs === undefined ? {} : { koerperZeitMs },
  );
  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, zeilen);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((fertig) => server.close(() => fertig()));
  }
}

/** An enrolled device's header, so the body is read at all. */
async function mitZugang(a: Aufbau): Promise<Record<string, string>> {
  return { authorization: `Bearer ${(await einschreiben(a)).zugang}` };
}

test('health check with the commit, and a refusal over HTTP', async () => {
  const a = aufbauen({ stand: 'b'.repeat(40) });
  await mitServer(a.t, async (basis) => {
    const g = await fetch(`${basis}/gesund`);
    assert.equal(g.status, 200);
    assert.deepEqual(await g.json(), {
      ok: true,
      stand: 'b'.repeat(40),
      v: VERSION,
      faehigkeiten: [...FAEHIGKEITEN],
    });
    const p = await fetch(`${basis}/v1/ping`, {
      method: 'POST',
      headers: { origin: TKD, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(p.status, 401);
    assert.equal(p.headers.get('access-control-allow-origin'), TKD);
  });
});

/** Like every answer of the rules: no-store, nosniff, Vary, and CORS for the app's origin. */
function wieJedeAntwort(r: Response): void {
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('vary'), 'Origin');
  assert.equal(r.headers.get('access-control-allow-origin'), TKD);
}

test('an address with a query is refused (ids never travel in the address)', async () => {
  await mitServer(aufbauen().t, async (basis) => {
    const r = await fetch(`${basis}/v1/ping?geraet=geraet-1`, {
      method: 'POST',
      headers: { origin: TKD, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 400);
    wieJedeAntwort(r);
    assert.equal(((await r.json()) as { art: string }).art, 'unlesbar');
    // From a foreign origin the same refusal is not readable.
    const fremd = await fetch(`${basis}/v1/ping?x=1`, {
      method: 'POST',
      headers: { origin: 'https://boese.example', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(fremd.status, 400);
    assert.equal(fremd.headers.get('access-control-allow-origin'), null);
  });
});

test('a body over the largest limit is refused, readable for the app', async () => {
  const a = aufbauen();
  const zugang = await mitZugang(a);
  await mitServer(a.t, async (basis) => {
    const r = await fetch(`${basis}/v1/ablegen`, {
      method: 'POST',
      headers: { origin: TKD, 'content-type': 'application/json', ...zugang },
      body: Buffer.alloc(KOERPER_BYTES.ablegen + 1, 32),
    });
    assert.equal(r.status, 413);
    wieJedeAntwort(r);
    assert.equal(((await r.json()) as { art: string }).art, 'zu-gross');
  });
});

test('a body exactly at its limit is taken over HTTP, announced or not', async () => {
  const a = aufbauen();
  const h = await einschreiben(a);
  const zugang = await mitZugang(a);
  const aufgefuellt = (daten: unknown, bytes: number) => {
    const text = JSON.stringify(daten);
    return Buffer.from(text + ' '.repeat(bytes - text.length));
  };
  const ablage = aufgefuellt(
    { an: [{ geraet: h.geraet, inhalt: Buffer.from('x').toString('base64url') }] },
    KOERPER_BYTES.ablegen,
  );
  await mitServer(a.t, async (basis) => {
    const mitLaenge = await roh(
      basis,
      '/v1/ablegen',
      { ...zugang, 'content-length': String(ablage.length) },
      (req) => req.end(ablage),
    );
    assert.equal(mitLaenge.status, 200);
    // Without a length (chunked), counted while it is read.
    const ohneLaenge = await roh(basis, '/v1/ablegen', zugang, (req) => {
      req.write(ablage.subarray(0, 1000));
      req.end(ablage.subarray(1000));
    });
    assert.equal(ohneLaenge.status, 200);
    const ping = aufgefuellt({}, KOERPER_BYTES.klein);
    const klein = await roh(
      basis,
      '/v1/ping',
      { ...zugang, 'content-length': String(ping.length) },
      (req) => req.end(ping),
    );
    assert.equal(klein.status, 200);
  });
});

/** One request through node:http; resolves with the status (and `art`), or the error code if the
 * line broke, or „keine Antwort“ after `warteMs`. */
function roh(
  basis: string,
  pfad: string,
  kopf: Record<string, string>,
  schreiben: (req: ReturnType<typeof request>) => void,
  warteMs = 5000,
): Promise<{ status: number | string; art?: string; cors?: string; verbindung?: string }> {
  return new Promise((fertig) => {
    const req = request(`${basis}${pfad}`, {
      method: 'POST',
      headers: { origin: TKD, 'content-type': 'application/json', ...kopf },
    });
    const zeit = setTimeout(() => {
      req.destroy();
      fertig({ status: 'keine Antwort' });
    }, warteMs);
    req.on('response', (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (t: string) => (text += t));
      res.on('end', () => {
        clearTimeout(zeit);
        req.destroy();
        let art: string | undefined;
        try {
          art = (JSON.parse(text) as { art?: string }).art;
        } catch {
          art = undefined;
        }
        const cors = res.headers['access-control-allow-origin'];
        const verbindung = res.headers.connection;
        fertig({
          status: res.statusCode ?? 0,
          ...(art ? { art } : {}),
          ...(typeof cors === 'string' ? { cors } : {}),
          ...(typeof verbindung === 'string' ? { verbindung } : {}),
        });
      });
    });
    req.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(zeit);
      fertig({ status: e.code ?? 'fehler' });
    });
    schreiben(req);
  });
}

/** Writes `bytes` in pieces and never ends the body. */
function stroemen(bytes: number) {
  return (req: ReturnType<typeof request>): void => {
    const stueck = Buffer.alloc(65_536, 32);
    let geschrieben = 0;
    const weiter = (): void => {
      while (geschrieben < bytes) {
        geschrieben += stueck.length;
        if (!req.write(stueck)) {
          req.once('drain', weiter);
          return;
        }
      }
    };
    weiter();
  };
}

test('the head is judged before the body: no body is read for a refused request', async () => {
  const a = aufbauen();
  await mitServer(a.t, async (basis) => {
    // A length is announced, but nothing follows: only an answer from the head arrives at all.
    const nurKopf = (req: ReturnType<typeof request>) => req.flushHeaders();
    const lang = { 'content-length': String(KOERPER_BYTES.ablegen) };
    // „close“: the server does not read the rest; with keep-alive Node would take it all in.
    assert.deepEqual(await roh(basis, '/nirgends', lang, nurKopf), {
      status: 404,
      art: 'unbekannt',
      verbindung: 'close',
    });
    const ohne = await roh(basis, '/v1/ablegen', lang, nurKopf);
    assert.equal(ohne.art, 'zugang-fehlt');
    assert.equal(ohne.verbindung, 'close');
    assert.equal(
      (await roh(basis, '/v1/ablegen', { ...lang, 'content-type': 'text/plain' }, nurKopf)).art,
      'typ',
    );
    assert.equal(
      (await roh(basis, '/v1/ablegen', { ...lang, origin: 'https://boese.example' }, nurKopf))
        .status,
      403,
    );
  });
});

test('an announced length over the endpoint’s limit is refused at once', async () => {
  const a = aufbauen();
  const zugang = await mitZugang(a);
  await mitServer(a.t, async (basis) => {
    const nurKopf = (req: ReturnType<typeof request>) => req.flushHeaders();
    const ablegen = await roh(
      basis,
      '/v1/ablegen',
      { ...zugang, 'content-length': String(KOERPER_BYTES.ablegen + 1) },
      nurKopf,
    );
    assert.deepEqual(ablegen, { status: 413, art: 'zu-gross', cors: TKD, verbindung: 'close' });
    const ping = await roh(
      basis,
      '/v1/ping',
      { ...zugang, 'content-length': String(KOERPER_BYTES.klein + 1) },
      nurKopf,
    );
    assert.equal(ping.art, 'zu-gross');
    // Far over every room limit, it is still „too large“, never „try again“.
    const riesig = await roh(
      basis,
      '/v1/ablegen',
      { ...zugang, 'content-length': '100000000' },
      nurKopf,
    );
    assert.equal(riesig.art, 'zu-gross');
    const ohne = await roh(basis, '/v1/einschreiben', { 'content-length': '10000000' }, nurKopf);
    assert.equal(ohne.art, 'zu-gross');
  });
});

test('a body without a length gets 413 once it grows over the endpoint’s limit', async () => {
  const a = aufbauen();
  const zugang = await mitZugang(a);
  await mitServer(a.t, async (basis) => {
    // The bodies never end: only a server that stops at the limit answers at all.
    const ablegen = await roh(basis, '/v1/ablegen', zugang, stroemen(KOERPER_BYTES.ablegen + 2e5));
    assert.deepEqual(ablegen, { status: 413, art: 'zu-gross', cors: TKD, verbindung: 'close' });
    const ping = await roh(basis, '/v1/ping', zugang, stroemen(KOERPER_BYTES.klein + 65_536));
    assert.equal(ping.art, 'zu-gross');
  });
});

test('a body that arrives too slowly gets a readable 408', async () => {
  const a = aufbauen();
  const zugang = await mitZugang(a);
  await mitServer(
    a.t,
    async (basis) => {
      const r = await roh(basis, '/v1/ablegen', { ...zugang, 'content-length': '1000' }, (req) =>
        req.write('{'),
      );
      assert.deepEqual(r, { status: 408, art: 'zu-langsam', cors: TKD, verbindung: 'close' });
    },
    200,
  );
});

test('a client that goes away mid-body is no internal error', async () => {
  const a = aufbauen();
  const zugang = await mitZugang(a);
  // Wait for the server to have handled the abort (its room freed), not for a fixed time.
  let frei: () => void = () => undefined;
  const erledigt = new Promise<void>((weiter) => (frei = weiter));
  let behandelt = 0;
  const beobachtet: Treffpunkt = {
    ...a.t,
    behandeln: (anfrage) => {
      behandelt += 1;
      return a.t.behandeln(anfrage);
    },
    vorpruefen: (k) => {
      const v = a.t.vorpruefen(k);
      if ('antwort' in v) return v;
      return {
        hoechstens: v.hoechstens,
        freigeben: () => {
          v.freigeben();
          frei();
        },
      };
    },
  };
  await mitServer(beobachtet, async (basis, zeilen) => {
    await roh(basis, '/v1/ablegen', { ...zugang, 'content-length': '1000' }, (req) => {
      req.write('{');
      setTimeout(() => req.destroy(), 50);
    });
    await Promise.race([
      erledigt,
      new Promise((_, nein) => setTimeout(() => nein(new Error('nicht erledigt')), 5000).unref()),
    ]);
    await new Promise((weiter) => setImmediate(weiter));
    assert.deepEqual(zeilen, []);
    // Nobody is answered and nothing is counted as a refusal (the counts every 5 minutes would show
    // it): the rules never see the half body.
    assert.equal(behandelt, 0);
    const stand = a.t.zaehlstand();
    assert.deepEqual(stand.fehler, {});
    // Its id left with the body.
    assert.equal(stand.unterwegs, 0);
  });
});

test('an internal error answers 500 and logs only its kind', async () => {
  const echt = aufbauen().t;
  const kaputt: Treffpunkt = {
    vorpruefen: () => ({ hoechstens: KOERPER_BYTES.klein, freigeben: () => undefined }),
    behandeln: async () => {
      throw new TypeError('geraet-0123 Inhalt geheim');
    },
    ablehnen: (art, origin) => echt.ablehnen(art, origin),
    aufraeumen: () => undefined,
    zaehlstand: () => ({
      anfragen: {},
      fehler: {},
      wartend: 0,
      bytes: 0,
      marken: 0,
      zaehlerSchluessel: 0,
      anwesend: 0,
      postfaecher: 0,
      absender: 0,
      geraete: 0,
      gesperrt: 0,
      unterwegs: 0,
      uhrRueckstandS: 0,
    }),
  };
  await mitServer(kaputt, async (basis, zeilen) => {
    const fremd = await fetch(`${basis}/v1/ping`, {
      method: 'POST',
      headers: { origin: 'https://boese.example' },
      body: '{}',
    });
    assert.equal(fremd.status, 500);
    assert.equal(fremd.headers.get('access-control-allow-origin'), null);
    // The app's own page can read the refusal, like every other one.
    const eigen = await fetch(`${basis}/v1/ping`, {
      method: 'POST',
      headers: { origin: TKD },
      body: '{}',
    });
    assert.equal(eigen.status, 500);
    wieJedeAntwort(eigen);
    assert.equal(((await eigen.json()) as { art: string }).art, 'intern');
    zeilen.length = 0;
    const r = await fetch(`${basis}/v1/ping`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 500);
    assert.equal(zeilen.length, 1);
    assert.match(zeilen[0] ?? '', /"fehler":"TypeError"/);
    assert.doesNotMatch(zeilen[0] ?? '', /geraet|geheim/);
  });
});

test('two bodies per device on the way; the room is freed when a request ends or breaks off', async () => {
  const a = aufbauen();
  const zugang = await mitZugang(a);
  await mitServer(a.t, async (basis) => {
    const offen: ReturnType<typeof request>[] = [];
    const halten = (req: ReturnType<typeof request>) => {
      offen.push(req);
      req.write('{');
    };
    const lang = { ...zugang, 'content-length': '1000000' };
    // Two bodies that never end: no answer within 300 ms, the server waits for them.
    const eins = roh(basis, '/v1/ablegen', lang, halten, 300);
    const zwei = roh(basis, '/v1/ablegen', lang, halten, 300);
    await new Promise((weiter) => setTimeout(weiter, 100));
    const drei = await roh(basis, '/v1/ablegen', lang, (req) => req.flushHeaders());
    assert.equal(drei.status, 429);
    assert.equal(drei.art, 'zu-viele-anfragen');
    assert.deepEqual(
      [(await eins).status, (await zwei).status],
      ['keine Antwort', 'keine Antwort'],
    );
    for (const req of offen) req.destroy();
    await new Promise((weiter) => setTimeout(weiter, 100));
    // Both broke off: the room is free again.
    const vier = await fetch(`${basis}/v1/ping`, {
      method: 'POST',
      headers: { origin: TKD, 'content-type': 'application/json', ...zugang },
      body: '{}',
    });
    assert.equal(vier.status, 200);
    const fuenf = roh(basis, '/v1/ablegen', lang, halten, 300);
    const sechs = roh(basis, '/v1/ablegen', lang, halten, 300);
    assert.deepEqual(
      [(await fuenf).status, (await sechs).status],
      ['keine Antwort', 'keine Antwort'],
    );
    for (const req of offen) req.destroy();
  });
});

test('headers that do not come in time get Node’s 408 soon after, not 30 s later', async () => {
  const a = aufbauen();
  const zeilen: string[] = [];
  // The whole request may take as long as in production: only the header limit is short here.
  const server = serverAnlegen(a.t, (z) => zeilen.push(z), {
    kopfZeitMs: 300,
    anfrageZeitMs: ANFRAGE_ZEIT_MS,
  });
  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));
  const { port } = server.address() as AddressInfo;
  try {
    const start = Date.now();
    const antwort = await new Promise<string>((fertig) => {
      const s = connect(port, '127.0.0.1', () => s.write('POST /v1/ping HTTP/1.1\r\nHost: x\r\n'));
      let text = '';
      s.on('data', (d) => (text += d.toString()));
      s.on('close', () => fertig(text));
      setTimeout(() => s.destroy(), 5000).unref();
    });
    assert.match(antwort, /^HTTP\/1\.1 408/);
    assert.ok(Date.now() - start < 2500, `nach ${Date.now() - start} ms`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((fertig) => server.close(() => fertig()));
  }
});

test('the room is for reading the body: rings waiting on the push service hold none', async () => {
  const a = aufbauen({ sendenMs: 600 });
  const zugang = await mitZugang(a);
  await mitServer(a.t, async (basis) => {
    const klingeln = () =>
      fetch(`${basis}/v1/klingeln`, {
        method: 'POST',
        headers: { origin: TKD, 'content-type': 'application/json', ...zugang },
        body: JSON.stringify({
          endpunkt: 'https://fcm.googleapis.com/fcm/send/abc',
          vapid: `vapid t=aaa.bbb.ccc, k=${'B'.repeat(87)}`,
          ttl: 60,
          dringlichkeit: 'normal',
          inhalt: Buffer.alloc(16, 1).toString('base64url'),
        }),
      });
    const zwei = [klingeln(), klingeln()];
    await new Promise((weiter) => setTimeout(weiter, 200));
    const abholen = await fetch(`${basis}/v1/abholen`, {
      method: 'POST',
      headers: { origin: TKD, 'content-type': 'application/json', ...zugang },
      body: '{}',
    });
    assert.equal(abholen.status, 200);
    assert.deepEqual(
      (await Promise.all(zwei)).map((r) => r.status),
      [200, 200],
    );
  });
});

test('the time limits are those of the interface: headers 10 s, body 14 s, whole request 30 s', () => {
  assert.deepEqual(
    [KOPF_ZEIT_MS, KOERPER_ZEIT_MS, ANFRAGE_ZEIT_MS, LEERLAUF_ZEIT_MS, PRUEFABSTAND_MS],
    [10_000, 14_000, 30_000, 65_000, 1000],
  );
  const server = serverAnlegen(aufbauen().t);
  assert.equal(server.headersTimeout, KOPF_ZEIT_MS);
  assert.equal(server.requestTimeout, ANFRAGE_ZEIT_MS);
  assert.equal(server.koerperZeitMs, KOERPER_ZEIT_MS);
  // An idle connection stays open 65 s; Node looks at the deadlines every second.
  assert.equal(server.keepAliveTimeout, LEERLAUF_ZEIT_MS);
  assert.equal(
    (server as unknown as { connectionsCheckingInterval: number }).connectionsCheckingInterval,
    PRUEFABSTAND_MS,
  );
  // Above headers plus body, so a slow body always gets the readable 408 first.
  assert.ok(ANFRAGE_ZEIT_MS > KOPF_ZEIT_MS + KOERPER_ZEIT_MS);
  const text = readFileSync(new URL('../docs/schnittstelle.md', import.meta.url), 'utf8').replace(
    /\s+/g,
    ' ',
  );
  for (const satz of [
    'nicht in 10 s',
    'es sieht jede Sekunde nach',
    'nicht in 14 s angekommen',
    'höchstens 30 s dauern',
    'ohne Anfrage bleibt 65 s offen',
  ]) {
    assert.ok(text.includes(satz), satz);
  }
});

test('a body refused while it is read still counts its endpoint once', async () => {
  const a = aufbauen();
  const zugang = await mitZugang(a);
  a.t.zaehlstand();
  await mitServer(
    a.t,
    async (basis) => {
      const r = await roh(basis, '/v1/ablegen', { ...zugang, 'content-length': '10' }, (req) =>
        req.write('{'),
      );
      assert.equal(r.status, 408);
      const stand = a.t.zaehlstand();
      assert.deepEqual(stand.anfragen, { ablegen: 1 });
      assert.deepEqual(stand.fehler, { 'zu-langsam': 1 });
    },
    200,
  );
});

test('over real HTTP a certificate with its signature header passes the head, and a stale one is refused', async () => {
  const a = aufbauen();
  const g = neuesGeraet();
  assert.equal((await einschreibenMitSchluessel(a, g, { rolle: 'buero' })).status, 201);
  await mitServer(a.t, async (basis) => {
    const schicken = async (t: number) => {
      const koerper = '{}';
      const sig = sign(
        'sha256',
        Buffer.from(besitzText('POST', '/v1/ping', t, Buffer.from(koerper), g.zertifikat ?? '')),
        { key: g.paar.privat, dsaEncoding: 'ieee-p1363' },
      ).toString('base64url');
      return fetch(`${basis}/v1/ping`, {
        method: 'POST',
        headers: {
          origin: TKD,
          'content-type': 'application/json',
          authorization: `Bearer ${g.zertifikat}`,
          'x-treffpunkt-signatur': `${t}.${sig}`,
          'x-treffpunkt-p': '2',
        },
        body: koerper,
      });
    };
    const jetzt = Math.floor((a.uhr.ms + a.uhr.wand) / 1000);
    const ok = await schicken(jetzt);
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as Record<string, unknown>)['rolle'], 'buero');
    const alt = await schicken(jetzt - 500);
    assert.equal(alt.status, 401);
    assert.equal(((await alt.json()) as Record<string, unknown>)['art'], 'besitz-zeit');
    const vor = await fetch(`${basis}/v1/ping`, {
      method: 'OPTIONS',
      headers: { origin: TKD, 'access-control-request-method': 'POST' },
    });
    assert.equal(vor.status, 204);
    assert.match(vor.headers.get('access-control-allow-headers') ?? '', /x-treffpunkt-signatur/);
  });
});
