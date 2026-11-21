// The Treffpunkt's settings: the apps it serves (konfiguration/apps.json, in the repo, no secrets)
// and its secret (environment variable TREFFPUNKT_SCHLUESSEL, only at bunny). Anything wrong stops
// the start with a German reason — the Treffpunkt never runs half configured (fail closed).
import { createPublicKey, type KeyObject } from 'node:crypto';
import { APP, GERAET, istObjekt, MANDANT, objektMit, ROHSCHLUESSEL } from './eingabe.ts';

export interface AppEinstellung {
  readonly id: string;
  readonly name: string;
  /** Origins whose pages may call the Treffpunkt for this app (CORS), e.g. `https://tkdtest.b-cdn.net`. */
  readonly herkuenfte: readonly string[];
  /** Public keys of the login scripts that sign enrolment proofs (ECDSA P-256); none = no proofs. */
  readonly nachweisSchluessel: readonly KeyObject[];
  /** Whether an enrolled device may invite another one (QR from a trainer's or office device). */
  readonly einladen: boolean;
  /** Blocked device ids: refused at once, whatever their access says. */
  readonly gesperrt: ReadonlySet<string>;
  /** Tenants (per app) for which only the new procedure holds: certificate with proof of possession,
   * no `z1` access, no login-script proof, no `e1` invitation (auftrag-zulassung D, phase 3). Set by
   * hand, never automatically. */
  readonly streng: ReadonlySet<string>;
}

/** A developer password, from the environment only: just its hash, never the text. */
export interface Entwicklerpasswort {
  readonly app: string;
  readonly mandant: string;
  /** `scrypt$<salt>$<hash>`, both base64url (`npm run entwickler -- passwort`). */
  readonly hash: string;
  /** Seconds since 1970. */
  readonly bis: number;
  readonly hoechstens: number;
  /** Also when the tenant already has devices (default: only while it has none). */
  readonly auchMitGeraeten: boolean;
}

/** What only the developer holds the key for: tickets he signs, and passwords he lays down. */
export interface Entwickler {
  readonly schluessel: readonly KeyObject[];
  readonly passwoerter: readonly Entwicklerpasswort[];
}

export type Apps = ReadonlyMap<string, AppEinstellung>;

const HERKUNFT = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const NAME = /^[\p{L}\p{N} ._-]{1,60}$/u;
const MIN_SCHLUESSEL_BYTES = 32;

export class KonfigurationFehler extends Error {}

/** A login script's public key from its raw form (as `npm run nachweis-schluessel` prints it). */
export function oeffentlicherSchluessel(text: string): KeyObject {
  const roh = ROHSCHLUESSEL.test(text) ? Buffer.from(text, 'base64url') : undefined;
  if (!roh || roh.length !== 65 || roh[0] !== 0x04) {
    throw new KonfigurationFehler('Nachweis-Schlüssel: kein P-256-Punkt (87 Zeichen base64url)');
  }
  try {
    return createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: roh.subarray(1, 33).toString('base64url'),
        y: roh.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
  } catch {
    throw new KonfigurationFehler('Nachweis-Schlüssel: Punkt liegt nicht auf der Kurve');
  }
}

function appLesen(id: string, wert: unknown): AppEinstellung {
  const feld = objektMit(wert, [
    'name',
    'herkuenfte',
    'nachweisSchluessel',
    'einladen',
    'gesperrt',
    'streng',
  ]);
  if (!feld) throw new KonfigurationFehler(`App ${id}: unbekannte Felder`);
  const { name, herkuenfte, nachweisSchluessel, einladen, gesperrt, streng = [] } = feld;
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new KonfigurationFehler(`App ${id}: Name fehlt oder ungültig`);
  }
  if (
    !Array.isArray(herkuenfte) ||
    herkuenfte.length === 0 ||
    !herkuenfte.every((h) => typeof h === 'string' && HERKUNFT.test(h))
  ) {
    throw new KonfigurationFehler(`App ${id}: Herkünfte fehlen oder sind keine https-Adressen`);
  }
  if (
    !Array.isArray(nachweisSchluessel) ||
    !nachweisSchluessel.every((s) => typeof s === 'string')
  ) {
    throw new KonfigurationFehler(`App ${id}: nachweisSchluessel muss eine Liste sein`);
  }
  if (typeof einladen !== 'boolean') {
    throw new KonfigurationFehler(`App ${id}: einladen muss ja oder nein sein`);
  }
  if (!Array.isArray(gesperrt) || !gesperrt.every((g) => typeof g === 'string' && GERAET.test(g))) {
    throw new KonfigurationFehler(`App ${id}: gesperrt muss eine Liste von Gerätekennungen sein`);
  }
  if (!Array.isArray(streng) || !streng.every((m) => typeof m === 'string' && MANDANT.test(m))) {
    throw new KonfigurationFehler(`App ${id}: streng muss eine Liste von Mandanten sein`);
  }
  return {
    id,
    name,
    herkuenfte: herkuenfte as string[],
    nachweisSchluessel: (nachweisSchluessel as string[]).map(oeffentlicherSchluessel),
    einladen,
    gesperrt: new Set(gesperrt as string[]),
    streng: new Set(streng as string[]),
  };
}

/** konfiguration/apps.json, strictly. */
export function appsLesen(text: string): Apps {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    throw new KonfigurationFehler('apps.json ist kein JSON');
  }
  const oben = objektMit(roh, ['apps']);
  if (!oben || !istObjekt(oben.apps)) throw new KonfigurationFehler('apps.json: Feld „apps“ fehlt');
  const apps = new Map<string, AppEinstellung>();
  for (const [id, wert] of Object.entries(oben.apps)) {
    if (!APP.test(id)) throw new KonfigurationFehler(`App-Kennung ungültig: ${id}`);
    apps.set(id, appLesen(id, wert));
  }
  if (apps.size === 0) throw new KonfigurationFehler('apps.json: keine App');
  return apps;
}

/** TREFFPUNKT_SCHLUESSEL: base64url, at least 32 random bytes (`npm run schluessel`). */
export function schluesselLesen(wert: string | undefined): Buffer {
  const bytes = wert && /^[A-Za-z0-9_-]+$/.test(wert) ? Buffer.from(wert, 'base64url') : undefined;
  if (!bytes || bytes.length < MIN_SCHLUESSEL_BYTES) {
    throw new KonfigurationFehler(
      `TREFFPUNKT_SCHLUESSEL fehlt oder ist kürzer als ${MIN_SCHLUESSEL_BYTES} Byte`,
    );
  }
  return bytes;
}

/** Every origin of every app — what a preflight may be answered for (it carries no access yet). */
export function alleHerkuenfte(apps: Apps): ReadonlySet<string> {
  return new Set([...apps.values()].flatMap((a) => a.herkuenfte));
}

const PASSWORT_HASH = /^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;

/** TREFFPUNKT_ENTWICKLER_SCHLUESSEL (public keys, raw, comma separated) and
 * TREFFPUNKT_ENTWICKLER_PASSWOERTER (JSON list). Both optional: without them there is no
 * developer access. Anything wrong throws (fail closed). */
export function entwicklerLesen(
  schluesselText: string | undefined,
  passwoerterText: string | undefined,
): Entwickler {
  const schluessel = (schluesselText ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((t) => {
      try {
        return oeffentlicherSchluessel(t);
      } catch {
        throw new KonfigurationFehler('TREFFPUNKT_ENTWICKLER_SCHLUESSEL: kein P-256-Punkt');
      }
    });
  if (passwoerterText === undefined || passwoerterText.trim() === '') {
    return { schluessel, passwoerter: [] };
  }
  let roh: unknown;
  try {
    roh = JSON.parse(passwoerterText);
  } catch {
    throw new KonfigurationFehler('TREFFPUNKT_ENTWICKLER_PASSWOERTER ist kein JSON');
  }
  if (!Array.isArray(roh) || roh.length > 20) {
    throw new KonfigurationFehler('TREFFPUNKT_ENTWICKLER_PASSWOERTER muss eine Liste sein');
  }
  const passwoerter = roh.map((eintrag): Entwicklerpasswort => {
    const f = objektMit(eintrag, [
      'app',
      'mandant',
      'hash',
      'bis',
      'hoechstens',
      'auchMitGeraeten',
    ]);
    const { app, mandant, hash, bis, hoechstens, auchMitGeraeten = false } = f ?? {};
    if (
      typeof app !== 'string' ||
      !APP.test(app) ||
      typeof mandant !== 'string' ||
      !MANDANT.test(mandant) ||
      typeof hash !== 'string' ||
      !PASSWORT_HASH.test(hash) ||
      typeof bis !== 'number' ||
      !Number.isSafeInteger(bis) ||
      typeof hoechstens !== 'number' ||
      !Number.isInteger(hoechstens) ||
      hoechstens < 1 ||
      hoechstens > 1000 ||
      typeof auchMitGeraeten !== 'boolean'
    ) {
      throw new KonfigurationFehler('TREFFPUNKT_ENTWICKLER_PASSWOERTER: Eintrag ungültig');
    }
    return { app, mandant, hash, bis, hoechstens, auchMitGeraeten };
  });
  return { schluessel, passwoerter };
}
