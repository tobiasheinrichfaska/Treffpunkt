// What the container's start needs, in parts a test can run: reading the settings (fail closed),
// the two clocks, the Treffpunkt from them, and the timers (tidy up every second, counts every five
// minutes). src/server.ts only puts them together.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { httpsSenden, type Senden } from './klingeln.ts';
import {
  appsLesen,
  entwicklerLesen,
  KonfigurationFehler,
  schluesselLesen,
  type Apps,
  type Entwickler,
} from './konfiguration.ts';
import { protokollieren, type Schreiber } from './protokoll.ts';
import { treffpunktAnlegen, type Treffpunkt } from './treffpunkt.ts';

export const AUFRAEUMEN_MS = 1000;
export const ZAEHLER_MS = 5 * 60_000;

export interface Einstellungen {
  readonly schluessel: Buffer;
  readonly schluesselAlt: readonly { readonly schluessel: Buffer; readonly bisMs: number }[];
  readonly apps: Apps;
  readonly port: number;
  readonly stand: string;
  readonly entwickler: Entwickler;
}

/** The commit the image was built from (Dockerfile writes `stand.txt`); `/gesund` answers it. */
function standLesen(lesen: (pfad: URL) => string): string {
  try {
    return lesen(new URL('../stand.txt', import.meta.url)).trim();
  } catch {
    return 'unbekannt';
  }
}

/** Environment: TREFFPUNKT_SCHLUESSEL (secret, at bunny only), PORT (default 8080), TREFFPUNKT_APPS
 * (default konfiguration/apps.json next to src/), TREFFPUNKT_SCHLUESSEL_ALT (old secrets still accepted until a date, `<wert>@<JJJJ-MM-TT>`, comma separated, optional), TREFFPUNKT_ENTWICKLER_SCHLUESSEL (the developer's
 * public keys) and TREFFPUNKT_ENTWICKLER_PASSWOERTER (hashes only), both optional. Anything wrong throws KonfigurationFehler. */
export function einstellungenLesen(
  env: Readonly<Record<string, string | undefined>>,
  lesen: (pfad: string | URL) => string = (p) => readFileSync(p, 'utf8'),
): Einstellungen {
  const pfad =
    env['TREFFPUNKT_APPS'] ?? fileURLToPath(new URL('../konfiguration/apps.json', import.meta.url));
  let text: string;
  try {
    text = lesen(pfad);
  } catch {
    throw new KonfigurationFehler('apps.json nicht lesbar');
  }
  const apps = appsLesen(text);
  const schluessel = schluesselLesen(env['TREFFPUNKT_SCHLUESSEL']);
  const schluesselAlt = (env['TREFFPUNKT_SCHLUESSEL_ALT'] ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((t) => {
      // `<wert>@<JJJJ-MM-TT>`: accepted until the end of that day (UTC), then ignored by itself.
      const m = /^([^@]+)@(\d{4}-\d{2}-\d{2})$/.exec(t);
      const tag = m?.[2] === undefined ? Number.NaN : Date.parse(`${m[2]}T00:00:00Z`);
      if (!m?.[1] || Number.isNaN(tag) || new Date(tag).toISOString().slice(0, 10) !== m[2]) {
        throw new KonfigurationFehler('TREFFPUNKT_SCHLUESSEL_ALT: Form <wert>@<JJJJ-MM-TT>');
      }
      return { schluessel: schluesselLesen(m[1]), bisMs: tag + 86_400_000 };
    });
  if (schluesselAlt.some((a) => a.schluessel.equals(schluessel))) {
    throw new KonfigurationFehler('TREFFPUNKT_SCHLUESSEL_ALT darf nicht der aktuelle Wert sein');
  }
  const port = Number(env['PORT'] ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new KonfigurationFehler('PORT ungültig');
  }
  const entwickler = entwicklerLesen(
    env['TREFFPUNKT_ENTWICKLER_SCHLUESSEL'],
    env['TREFFPUNKT_ENTWICKLER_PASSWOERTER'],
  );
  return { schluessel, schluesselAlt, apps, port, stand: standLesen(lesen), entwickler };
}

export interface Uhren {
  /** The wall clock, for the times inside accesses, invitations and proofs. */
  readonly jetzt: () => number;
  /** A clock that never steps back, for waiting, presence and the counters. */
  readonly takt: () => number;
}

export function uhrenAnlegen(): Uhren {
  return { jetzt: () => Date.now(), takt: () => performance.now() };
}

export function treffpunktFuer(
  e: Einstellungen,
  uhren: Uhren = uhrenAnlegen(),
  senden: Senden = httpsSenden,
): Treffpunkt {
  return treffpunktAnlegen({
    schluessel: e.schluessel,
    schluesselAlt: e.schluesselAlt,
    apps: e.apps,
    jetzt: uhren.jetzt,
    takt: uhren.takt,
    stand: e.stand,
    entwickler: e.entwickler,
    senden,
  });
}

/** Tidies up every second and writes the counts every five minutes; returns the stop. */
export function zeitgeberStarten(t: Treffpunkt, schreiben?: Schreiber): () => void {
  const aufraeumen = setInterval(() => t.aufraeumen(), AUFRAEUMEN_MS);
  const zaehler = setInterval(
    () => protokollieren({ ereignis: 'zaehler', ...t.zaehlstand() }, schreiben),
    ZAEHLER_MS,
  );
  aufraeumen.unref();
  zaehler.unref();
  return () => {
    clearInterval(aufraeumen);
    clearInterval(zaehler);
  };
}
