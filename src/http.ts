// HTTP around the rules: reads the body up to a limit, refuses addresses with a query (ids and
// secrets never travel in the address — the pull zone logs addresses), hands the rest on.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { protokollieren, type Schreiber } from './protokoll.ts';
import type { Antwort, Treffpunkt } from './treffpunkt.ts';

/** How long a body may take to arrive; then 408 `zu-langsam`, readable for the app. */
export const KOERPER_ZEIT_MS = 14_000;
/** How long the headers may take; then Node answers a bare 408 (no origin known yet). */
export const KOPF_ZEIT_MS = 10_000;
/** Node's limit for the whole request, above headers plus body, so the readable 408 comes first. */
export const ANFRAGE_ZEIT_MS = 30_000;
/** How often Node looks at those two limits (its default, 30 s, would let them run late by that). */
export const PRUEFABSTAND_MS = 1_000;
/** How long a connection without a request stays open: well above Node's default of 5 s, so Node
 * does not close one the pull zone is just reusing for the next request. */
export const LEERLAUF_ZEIT_MS = 65_000;

function senden(res: ServerResponse, a: Antwort): void {
  res.writeHead(a.status, { ...a.kopf, 'Content-Length': String(Buffer.byteLength(a.koerper)) });
  res.end(a.koerper);
}

/** A refusal before or while reading the body: the rest of the request is not read. */
function abweisen(res: ServerResponse, a: Antwort): void {
  res.setHeader('Connection', 'close');
  senden(res, a);
}

/** `zu-gross`: over the endpoint's limit, nothing more is kept. `zu-langsam`: not complete in time.
 * `abgebrochen`: the client went away before its body was complete — nobody to answer, and no fault
 * of the Treffpunkt. */
type Koerper = Buffer | 'zu-gross' | 'zu-langsam' | 'abgebrochen';

function koerperLesen(req: IncomingMessage, hoechstens: number, zeitMs: number): Promise<Koerper> {
  return new Promise((erfuellen) => {
    const angesagt = Number(req.headers['content-length'] ?? 0);
    if (angesagt > hoechstens) {
      erfuellen('zu-gross');
      return;
    }
    let teile: Buffer[] = [];
    let laenge = 0;
    let fertig = false;
    const ende = (k: Koerper): void => {
      if (fertig) return;
      fertig = true;
      clearTimeout(uhr);
      // Stop keeping it, but let the rest drain: destroying the socket now would reset the
      // connection before the answer reaches the client.
      if (!Buffer.isBuffer(k)) teile = [];
      erfuellen(k);
    };
    const uhr = setTimeout(() => ende('zu-langsam'), zeitMs);
    req.on('data', (teil: Buffer) => {
      if (fertig) return;
      laenge += teil.length;
      if (laenge > hoechstens) ende('zu-gross');
      else teile.push(teil);
    });
    req.on('end', () => ende(Buffer.concat(teile)));
    req.on('error', () => ende('abgebrochen'));
    req.on('close', () => {
      if (!req.complete) ende('abgebrochen');
    });
  });
}

export function serverAnlegen(
  treffpunkt: Treffpunkt,
  schreiben?: Schreiber,
  optionen: {
    readonly koerperZeitMs?: number;
    readonly kopfZeitMs?: number;
    readonly anfrageZeitMs?: number;
  } = {},
): Server & { readonly koerperZeitMs: number } {
  const zeitMs = optionen.koerperZeitMs ?? KOERPER_ZEIT_MS;
  const server = createServer(
    {
      headersTimeout: optionen.kopfZeitMs ?? KOPF_ZEIT_MS,
      requestTimeout: optionen.anfrageZeitMs ?? ANFRAGE_ZEIT_MS,
      connectionsCheckingInterval: PRUEFABSTAND_MS,
    },
    async (req, res) => {
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      try {
        const adresse = req.url ?? '';
        if (adresse.includes('?') || adresse.includes('#')) {
          abweisen(res, treffpunkt.ablehnen('unlesbar', origin));
          return;
        }
        const kopf: Record<string, string | undefined> = {};
        for (const [name, wert] of Object.entries(req.headers)) {
          kopf[name] = Array.isArray(wert) ? wert.join(', ') : wert;
        }
        const kopfteil = { methode: req.method ?? '', pfad: adresse, kopf };
        // Path, method, origin, type and access are judged before a byte of the body is kept.
        const vor = treffpunkt.vorpruefen(kopfteil);
        if ('antwort' in vor) {
          if (vor.antwort.status >= 400) abweisen(res, vor.antwort);
          else senden(res, vor.antwort);
          return;
        }
        try {
          const koerper = await koerperLesen(req, vor.hoechstens, zeitMs);
          // The room was for reading the body: once it is read (or refused), it is free again —
          // a ring waiting on the push service holds none.
          vor.freigeben();
          if (koerper === 'abgebrochen') {
            res.destroy();
            return;
          }
          if (koerper === 'zu-gross' || koerper === 'zu-langsam') {
            abweisen(res, treffpunkt.ablehnen(koerper, origin));
            return;
          }
          senden(res, await treffpunkt.behandeln({ ...kopfteil, koerper }));
        } finally {
          // However the request ended, the room is free (freigeben is idempotent).
          vor.freigeben();
        }
      } catch (e) {
        // Only the kind of error, never its text (it might quote a request).
        protokollieren(
          { ereignis: 'intern', fehler: e instanceof Error ? e.name : 'unbekannt' },
          schreiben,
        );
        if (res.headersSent) {
          res.destroy();
          return;
        }
        try {
          senden(res, treffpunkt.ablehnen('intern', origin));
        } catch {
          res.destroy();
        }
      }
    },
  );
  server.keepAliveTimeout = LEERLAUF_ZEIT_MS;
  // The body's limit, readable like headersTimeout and requestTimeout.
  return Object.assign(server, { koerperZeitMs: zeitMs });
}
