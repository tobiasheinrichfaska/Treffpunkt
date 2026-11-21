// Admission without a list (auftrag-zulassung, parts A–C). Four signed things, all stateless:
//  - the device certificate `c1.…` (HMAC with the Treffpunkt's secret): app, tenant, device id, role,
//    the device's public key, end — plus the device's own signature over every request (proof of
//    possession), so a stolen certificate alone is useless;
//  - the invitation `e2.…` (HMAC): app, tenant, who invites, the role of the one invited;
//  - the founder ticket `g1.…` and the evaluation ticket `a1.…` (ECDSA, signed with the developer's
//    private key, which only he holds; the Treffpunkt knows the public part);
//  - the developer password (scrypt hash from the environment).
// The old `z1`/`e1` of src/zugang.ts stay for old apps (phase 1) until `streng` turns them off.
import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';
import { oeffentlicherSchluessel } from './konfiguration.ts';
import type { Zufall } from './zugang.ts';

export const ZERTIFIKAT_TAGE = 60;
/** How far a request's signed time may be from the clock, either way. */
export const BESITZ_SPIELRAUM_S = 120;
/** A founder or evaluation ticket lives at most this long (plus the clocks' margin). */
export const ENTWICKLER_HOECHSTENS_S = 3600;
export const ENTWICKLER_SPIELRAUM_S = 60;

/** The tenant of everything issued before tenants existed (auftrag-zulassung B 3). */
export const ALT_MANDANT = '1';

const APP = '([a-z][a-z0-9]{1,15})';
const MANDANT = '((?!standard\\.)[a-z0-9-]{1,20})';
const GERAET = '(geraet-[0-9a-f]{32})';
const ROLLE = '(buero|ohne|lb:[A-Za-z0-9_-]{1,40})';
const SCHLUESSEL = '([A-Za-z0-9_-]{87})';
const BIS = '([1-9][0-9]{0,11})';
const MAC = '([A-Za-z0-9_-]{43})';
const ZERTIFIKAT = new RegExp(
  `^c1\\.${APP}\\.${MANDANT}\\.${GERAET}\\.${ROLLE}\\.${SCHLUESSEL}\\.${BIS}\\.${MAC}$`,
);
const EINLADUNG_NEU = new RegExp(
  `^e2\\.${APP}\\.${MANDANT}\\.${GERAET}\\.${ROLLE}\\.${BIS}\\.([A-Za-z0-9_-]{22})\\.${MAC}$`,
);
const GRUENDER = new RegExp(
  `^g1\\.${APP}\\.${MANDANT}\\.${BIS}\\.([A-Za-z0-9_-]{22})\\.([A-Za-z0-9_-]{86})$`,
);
const AUSWERTUNG = new RegExp(`^a1\\.${BIS}\\.([A-Za-z0-9_-]{22})\\.([A-Za-z0-9_-]{86})$`);
const BESITZ = /^([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{86})$/;

function mac(schluessel: Buffer, text: string): string {
  return createHmac('sha256', schluessel).update(text, 'utf8').digest('base64url');
}

function gleich(a: string, b: string): boolean {
  const x = Buffer.from(a, 'base64url');
  const y = Buffer.from(b, 'base64url');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The app a certificate or invitation names, read without checking anything else. */
export function appImText(text: string): string | undefined {
  return new RegExp(`^(?:c1|e1|e2|z1|g1)\\.${APP}\\.`).exec(text)?.[1];
}

// ---- Certificate -----------------------------------------------------------------------------

export interface Zertifikat {
  readonly app: string;
  readonly mandant: string;
  readonly geraet: string;
  readonly rolle: string;
  /** The device's public key, raw (87 characters). */
  readonly schluessel: string;
  readonly bis: number;
}

export function zertifikatAusstellen(
  geheim: Buffer,
  z: Omit<Zertifikat, 'bis'>,
  jetztS: number,
): { readonly zertifikat: string; readonly bis: number } {
  const bis = jetztS + ZERTIFIKAT_TAGE * 86_400;
  const kopf = `c1.${z.app}.${z.mandant}.${z.geraet}.${z.rolle}.${z.schluessel}.${bis}`;
  return { zertifikat: `${kopf}.${mac(geheim, `zertifikat:${kopf}`)}`, bis };
}

export type ZertifikatUrteil =
  Zertifikat | { readonly fehler: 'zugang-ungueltig' | 'zugang-abgelaufen' };

export function zertifikatPruefen(geheim: Buffer, text: string, jetztS: number): ZertifikatUrteil {
  const t = ZERTIFIKAT.exec(text);
  if (!t) return { fehler: 'zugang-ungueltig' };
  const [, app = '', mandant = '', geraet = '', rolle = '', schluessel = '', bisText = '', m = ''] =
    t;
  const kopf = `c1.${app}.${mandant}.${geraet}.${rolle}.${schluessel}.${bisText}`;
  if (!gleich(m, mac(geheim, `zertifikat:${kopf}`))) return { fehler: 'zugang-ungueltig' };
  const bis = Number(bisText);
  if (bis <= jetztS) return { fehler: 'zugang-abgelaufen' };
  return { app, mandant, geraet, rolle, schluessel, bis };
}

// ---- Proof of possession ---------------------------------------------------------------------

/** What the device signs (ECDSA P-256 / SHA-256, IEEE P1363) for one request. */
export function besitzText(
  methode: string,
  pfad: string,
  t: number,
  koerper: Uint8Array,
  zertifikat: string,
): string {
  const hash = createHash('sha256').update(koerper).digest('base64url');
  return `v1\n${methode}\n${pfad}\n${t}\n${hash}\n${zertifikat}`;
}

export type BesitzFehler = 'besitz-fehlt' | 'besitz-ungueltig' | 'besitz-zeit';

/** Judges the header `X-Treffpunkt-Signatur: <t>.<signature>`; says the signature to remember
 * (against replay) when it holds. */
export function besitzPruefen(
  z: Zertifikat,
  zertifikat: string,
  kopfWert: string | undefined,
  methode: string,
  pfad: string,
  koerper: Uint8Array,
  jetztS: number,
): { readonly t: number; readonly signatur: string } | { readonly fehler: BesitzFehler } {
  if (kopfWert === undefined) return { fehler: 'besitz-fehlt' };
  const teile = BESITZ.exec(kopfWert);
  if (!teile) return { fehler: 'besitz-ungueltig' };
  const t = Number(teile[1]);
  const signatur = teile[2] ?? '';
  const echt = (() => {
    try {
      return verify(
        'sha256',
        Buffer.from(besitzText(methode, pfad, t, koerper, zertifikat), 'utf8'),
        { key: oeffentlicherSchluessel(z.schluessel), dsaEncoding: 'ieee-p1363' },
        Buffer.from(signatur, 'base64url'),
      );
    } catch {
      return false;
    }
  })();
  if (!echt) return { fehler: 'besitz-ungueltig' };
  if (Math.abs(t - jetztS) > BESITZ_SPIELRAUM_S) return { fehler: 'besitz-zeit' };
  return { t, signatur };
}

// ---- Invitation (new) ------------------------------------------------------------------------

export interface EinladungNeu {
  readonly app: string;
  readonly mandant: string;
  /** The device that invited. */
  readonly von: string;
  /** The role the invited device gets. */
  readonly rolle: string;
  readonly bis: number;
  readonly n: string;
}

export function einladungNeuAusstellen(
  geheim: Buffer,
  e: Omit<EinladungNeu, 'bis' | 'n'>,
  jetztS: number,
  dauerS: number,
  zufall: Zufall = randomBytes,
): { readonly einladung: string; readonly bis: number } {
  const bis = jetztS + dauerS;
  const kopf = `e2.${e.app}.${e.mandant}.${e.von}.${e.rolle}.${bis}.${zufall(16).toString('base64url')}`;
  return { einladung: `${kopf}.${mac(geheim, `einladung:${kopf}`)}`, bis };
}

export type EinladungNeuUrteil =
  EinladungNeu | { readonly fehler: 'einladung-ungueltig' | 'einladung-abgelaufen' };

export function einladungNeuPruefen(
  geheim: Buffer,
  text: string,
  jetztS: number,
  dauerS: number,
): EinladungNeuUrteil {
  const t = EINLADUNG_NEU.exec(text);
  if (!t) return { fehler: 'einladung-ungueltig' };
  const [, app = '', mandant = '', von = '', rolle = '', bisText = '', n = '', m = ''] = t;
  const kopf = `e2.${app}.${mandant}.${von}.${rolle}.${bisText}.${n}`;
  if (!gleich(m, mac(geheim, `einladung:${kopf}`))) return { fehler: 'einladung-ungueltig' };
  const bis = Number(bisText);
  if (bis <= jetztS) return { fehler: 'einladung-abgelaufen' };
  if (bis > jetztS + dauerS) return { fehler: 'einladung-ungueltig' };
  return { app, mandant, von, rolle, bis, n };
}

// ---- Developer tickets (signed with the developer's private key) -----------------------------

export interface Gruender {
  readonly app: string;
  readonly mandant: string;
  readonly bis: number;
  readonly n: string;
}

export function gruenderAusstellen(
  privat: KeyObject,
  g: Omit<Gruender, 'n'>,
  zufall: Zufall = randomBytes,
): string {
  const kopf = `g1.${g.app}.${g.mandant}.${g.bis}.${zufall(16).toString('base64url')}`;
  return `${kopf}.${sign('sha256', Buffer.from(kopf), { key: privat, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

export function auswertungAusstellen(
  privat: KeyObject,
  bis: number,
  zufall: Zufall = randomBytes,
): string {
  const kopf = `a1.${bis}.${zufall(16).toString('base64url')}`;
  return `${kopf}.${sign('sha256', Buffer.from(kopf), { key: privat, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

export type EntwicklerFehler =
  'entwickler-nicht-eingerichtet' | 'entwickler-ungueltig' | 'entwickler-abgelaufen';

function entwicklerEcht(schluessel: readonly KeyObject[], kopf: string, signatur: string): boolean {
  const sig = Buffer.from(signatur, 'base64url');
  return schluessel.some((key) => {
    try {
      return verify('sha256', Buffer.from(kopf), { key, dsaEncoding: 'ieee-p1363' }, sig);
    } catch {
      return false;
    }
  });
}

function entwicklerFrist(bis: number, jetztS: number): boolean {
  return bis > jetztS && bis <= jetztS + ENTWICKLER_HOECHSTENS_S + ENTWICKLER_SPIELRAUM_S;
}

export function gruenderPruefen(
  schluessel: readonly KeyObject[],
  text: string,
  jetztS: number,
): Gruender | { readonly fehler: EntwicklerFehler } {
  const t = GRUENDER.exec(text);
  if (!t) return { fehler: 'entwickler-ungueltig' };
  const [, app = '', mandant = '', bisText = '', n = '', signatur = ''] = t;
  if (schluessel.length === 0) return { fehler: 'entwickler-nicht-eingerichtet' };
  if (!entwicklerEcht(schluessel, `g1.${app}.${mandant}.${bisText}.${n}`, signatur)) {
    return { fehler: 'entwickler-ungueltig' };
  }
  const bis = Number(bisText);
  if (!entwicklerFrist(bis, jetztS)) return { fehler: 'entwickler-abgelaufen' };
  return { app, mandant, bis, n };
}

export function auswertungPruefen(
  schluessel: readonly KeyObject[],
  text: string,
  jetztS: number,
): { readonly bis: number; readonly n: string } | { readonly fehler: EntwicklerFehler } {
  const t = AUSWERTUNG.exec(text);
  if (!t) return { fehler: 'entwickler-ungueltig' };
  const [, bisText = '', n = '', signatur = ''] = t;
  if (schluessel.length === 0) return { fehler: 'entwickler-nicht-eingerichtet' };
  if (!entwicklerEcht(schluessel, `a1.${bisText}.${n}`, signatur)) {
    return { fehler: 'entwickler-ungueltig' };
  }
  const bis = Number(bisText);
  if (!entwicklerFrist(bis, jetztS)) return { fehler: 'entwickler-abgelaufen' };
  return { bis, n };
}

// ---- Developer password ----------------------------------------------------------------------

/** `scrypt$<salt>$<hash>`: what goes into TREFFPUNKT_ENTWICKLER_PASSWOERTER, never the text. */
export function passwortHash(passwort: string, zufall: Zufall = randomBytes): string {
  const salt = zufall(16);
  return `scrypt$${salt.toString('base64url')}$${scryptSync(passwort, salt, 32).toString('base64url')}`;
}

export function passwortPasst(passwort: string, hash: string): boolean {
  const [art, salt, soll] = hash.split('$');
  if (art !== 'scrypt' || !salt || !soll) return false;
  const ist = scryptSync(passwort, Buffer.from(salt, 'base64url'), 32);
  const erwartet = Buffer.from(soll, 'base64url');
  return ist.length === erwartet.length && timingSafeEqual(ist, erwartet);
}

// ---- Roles -----------------------------------------------------------------------------------

/** What a device of `rolle` may give a device it invites: the office any role; a `lb:<id>` device
 * only its own (its second devices); a device without a role nothing. */
export function darfEinladen(rolle: string, fuer: string): boolean {
  if (rolle === 'buero') return true;
  return rolle.startsWith('lb:') && fuer === rolle;
}

/** What a device of `rolle` may block: the office every device of its tenant; a `lb:<id>` device the
 * ones with its own role (itself included); every device itself. */
export function darfSperren(rolle: string, ziel: { rolle: string } | undefined, selbst: boolean) {
  if (selbst || rolle === 'buero') return true;
  return rolle.startsWith('lb:') && ziel?.rolle === rolle;
}
