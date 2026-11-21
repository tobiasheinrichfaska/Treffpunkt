// Device access without a device list (plan § 4): the access is a value signed with the
// Treffpunkt's secret (HMAC-SHA-256) over app, device id and end. An invitation (QR from an enrolled
// device) is signed the same way under another label, so neither can pass for the other. A new
// secret makes every access and invitation invalid at once.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ZUGANG_TAGE = 90;
export const EINLADUNG_S = 600;

export type Zufall = (bytes: number) => Buffer;

const ZUGANG =
  /^z1\.([a-z][a-z0-9]{1,15})\.(geraet-[0-9a-f]{32})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{43})$/;
const EINLADUNG =
  /^e1\.([a-z][a-z0-9]{1,15})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

function mac(schluessel: Buffer, text: string): string {
  return createHmac('sha256', schluessel).update(text, 'utf8').digest('base64url');
}

function gleich(a: string, b: string): boolean {
  const x = Buffer.from(a, 'base64url');
  const y = Buffer.from(b, 'base64url');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function neueKennung(zufall: Zufall = randomBytes): string {
  return `geraet-${zufall(16).toString('hex')}`;
}

export interface Zugang {
  readonly app: string;
  readonly geraet: string;
  /** End in seconds since 1970. */
  readonly bis: number;
}

export function zugangAusstellen(
  schluessel: Buffer,
  app: string,
  geraet: string,
  jetztS: number,
): { readonly zugang: string; readonly bis: number } {
  const bis = jetztS + ZUGANG_TAGE * 86_400;
  const kopf = `z1.${app}.${geraet}.${bis}`;
  return { zugang: `${kopf}.${mac(schluessel, `zugang:${kopf}`)}`, bis };
}

export type ZugangUrteil = Zugang | { readonly fehler: 'zugang-ungueltig' | 'zugang-abgelaufen' };

export function zugangPruefen(schluessel: Buffer, text: string, jetztS: number): ZugangUrteil {
  const teile = ZUGANG.exec(text);
  if (!teile) return { fehler: 'zugang-ungueltig' };
  const [, app = '', geraet = '', bisText = '', signatur = ''] = teile;
  const kopf = `z1.${app}.${geraet}.${bisText}`;
  if (!gleich(signatur, mac(schluessel, `zugang:${kopf}`))) return { fehler: 'zugang-ungueltig' };
  const bis = Number(bisText);
  if (bis <= jetztS) return { fehler: 'zugang-abgelaufen' };
  return { app, geraet, bis };
}

export interface Einladung {
  readonly app: string;
  readonly bis: number;
  /** Random value; an invitation is taken once (the Treffpunkt keeps the used ones until `bis`). */
  readonly n: string;
}

export function einladungAusstellen(
  schluessel: Buffer,
  app: string,
  jetztS: number,
  zufall: Zufall = randomBytes,
): { readonly einladung: string; readonly bis: number } {
  const bis = jetztS + EINLADUNG_S;
  const kopf = `e1.${app}.${bis}.${zufall(16).toString('base64url')}`;
  return { einladung: `${kopf}.${mac(schluessel, `einladung:${kopf}`)}`, bis };
}

export type EinladungUrteil =
  Einladung | { readonly fehler: 'einladung-ungueltig' | 'einladung-abgelaufen' };

export function einladungPruefen(
  schluessel: Buffer,
  text: string,
  jetztS: number,
): EinladungUrteil {
  const teile = EINLADUNG.exec(text);
  if (!teile) return { fehler: 'einladung-ungueltig' };
  const [, app = '', bisText = '', n = '', signatur = ''] = teile;
  const kopf = `e1.${app}.${bisText}.${n}`;
  if (!gleich(signatur, mac(schluessel, `einladung:${kopf}`))) {
    return { fehler: 'einladung-ungueltig' };
  }
  const bis = Number(bisText);
  if (bis <= jetztS) return { fehler: 'einladung-abgelaufen' };
  if (bis > jetztS + EINLADUNG_S) return { fehler: 'einladung-ungueltig' };
  return { app, bis, n };
}
