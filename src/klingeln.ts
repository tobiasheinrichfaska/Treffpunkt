// Ringing (Trainerbuch plan § 4a, 2026-11-13): the ringing device built, encrypted (RFC 8291) and
// signed (RFC 8292) the push itself; the Treffpunkt only hands it to a known push service, because
// browsers may not (CORS). The checks are those of `php/hub/treffpunkt.php` and
// `parseKlingelAnfrage` in the Trainerbuch: exact push services, https without port or login, VAPID
// header by pattern, TTL, urgency, body at most 4096 bytes. Only the push service's status goes back.
import { request } from 'node:https';
import { base64urlLesen, objektMit } from './eingabe.ts';

/** The same list as `PUSH_SERVICES` in the Trainerbuch (`src/logic/push/webpush.ts`). */
export const PUSH_DIENSTE = [
  { name: 'Apple', host: '.push.apple.com', endung: true },
  { name: 'Google', host: 'fcm.googleapis.com', endung: false },
  { name: 'Mozilla', host: 'updates.push.services.mozilla.com', endung: false },
  { name: 'Microsoft', host: '.notify.windows.com', endung: true },
] as const;

export const MAX_ENDPUNKT = 900;
export const MAX_VAPID = 1024;
export const MAX_PUSH = 4096;
export const MAX_TTL_S = 86_400;
export const DRINGLICHKEITEN = ['very-low', 'low', 'normal', 'high'] as const;
export const SENDEN_TIMEOUT_MS = 10_000;

const ENDPUNKT = /^https:\/\/[A-Za-z0-9.-]+\/[\x21-\x7e]*$/;
const VAPID = /^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=[A-Za-z0-9_-]{87}$/;

export type Dringlichkeit = (typeof DRINGLICHKEITEN)[number];

export interface KlingelAnfrage {
  readonly endpunkt: string;
  readonly vapid: string;
  readonly ttl: number;
  readonly dringlichkeit: Dringlichkeit;
  readonly koerper: Buffer;
}

export function pushDienstVon(endpunkt: string): string | undefined {
  if (endpunkt.length > MAX_ENDPUNKT || !ENDPUNKT.test(endpunkt)) return undefined;
  let url: URL;
  try {
    url = new URL(endpunkt);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  return PUSH_DIENSTE.find((d) =>
    d.endung ? host.endsWith(d.host) && host.length > d.host.length : host === d.host,
  )?.name;
}

export function klingelAnfrageLesen(roh: unknown): KlingelAnfrage | undefined {
  const feld = objektMit(roh, ['endpunkt', 'vapid', 'ttl', 'dringlichkeit', 'inhalt']);
  if (!feld) return undefined;
  const { endpunkt, vapid, ttl, dringlichkeit, inhalt } = feld;
  if (typeof endpunkt !== 'string' || !pushDienstVon(endpunkt)) return undefined;
  if (typeof vapid !== 'string' || vapid.length > MAX_VAPID || !VAPID.test(vapid)) return undefined;
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 0 || ttl > MAX_TTL_S)
    return undefined;
  if (!DRINGLICHKEITEN.includes(dringlichkeit as Dringlichkeit)) return undefined;
  const koerper = base64urlLesen(inhalt, MAX_PUSH);
  if (!koerper || koerper.length === 0) return undefined;
  return { endpunkt, vapid, ttl, dringlichkeit: dringlichkeit as Dringlichkeit, koerper };
}

/** Hands the push on and answers with the push service's status; throws if it was not reached. */
export type Senden = (anfrage: KlingelAnfrage) => Promise<number>;

/** The real way out: https only, TLS checked (Node's default), no redirects (Node never follows).
 * The push service has `zeitMs` for the head of its answer, however slowly it writes; a socket
 * silent for that long is closed too, also after the answer. Either way: not reached. */
export function httpsSendenMit(zeitMs: number): Senden {
  return (a) =>
    new Promise((erfuellen, ablehnen) => {
      const anfrage = request(
        a.endpunkt,
        {
          method: 'POST',
          headers: {
            Authorization: a.vapid,
            TTL: String(a.ttl),
            Urgency: a.dringlichkeit,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(a.koerper.length),
          },
          timeout: zeitMs,
        },
        (antwort) => {
          clearTimeout(frist);
          // What the push service wrote is not needed and not passed on.
          antwort.resume();
          erfuellen(antwort.statusCode ?? 0);
        },
      );
      const zuSpaet = (): void => {
        anfrage.destroy(new Error('Zeitüberschreitung'));
      };
      const frist = setTimeout(zuSpaet, zeitMs);
      anfrage.on('timeout', zuSpaet);
      anfrage.on('error', (e) => {
        clearTimeout(frist);
        ablehnen(e);
      });
      anfrage.end(a.koerper);
    });
}

export const httpsSenden: Senden = httpsSendenMit(SENDEN_TIMEOUT_MS);
