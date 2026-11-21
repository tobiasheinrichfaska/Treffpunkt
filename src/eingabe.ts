// Strict reading of everything that comes from outside: base64url, JSON objects with fixed fields,
// device ids and app ids. Anything unexpected is refused, never repaired.

/** A device id: assigned by the Treffpunkt at enrolment, 128 random bits (as in the Trainerbuch). */
export const GERAET = /^geraet-[0-9a-f]{32}$/;
/** An app id such as `tkd` or `azp`. */
export const APP = /^[a-z][a-z0-9]{1,15}$/;
/** A tenant (a school): lower case, digits, `-`; never `standard` (no silent default, auftrag-zulassung B 3). */
export const MANDANT = /^(?!standard$)[a-z0-9-]{1,20}$/;
/** A device's role: office, a trainer/employee `lb:<id>`, or none. */
export const ROLLE = /^(buero|ohne|lb:[A-Za-z0-9_-]{1,40})$/;
/** A device's public key, raw: an uncompressed P-256 point, 65 bytes = 87 characters base64url. */
export const ROHSCHLUESSEL = /^[A-Za-z0-9_-]{87}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** base64url without padding, canonical only (re-encoding gives the same text), at most `max` bytes. */
export function base64urlLesen(text: unknown, max: number): Buffer | undefined {
  if (typeof text !== 'string' || !BASE64URL.test(text)) return undefined;
  if (text.length > Math.ceil((max * 4) / 3)) return undefined;
  const bytes = Buffer.from(text, 'base64url');
  if (bytes.length > max || bytes.toString('base64url') !== text) return undefined;
  return bytes;
}

export function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert);
}

/** A JSON object whose keys are all in `erlaubt` (missing ones are the caller's business). */
export function objektMit(
  wert: unknown,
  erlaubt: readonly string[],
): Record<string, unknown> | undefined {
  if (!istObjekt(wert)) return undefined;
  return Object.keys(wert).every((k) => erlaubt.includes(k)) ? wert : undefined;
}

/** JSON from a request body, or undefined (no exception escapes). */
export function jsonLesen(koerper: Buffer): unknown {
  try {
    return JSON.parse(koerper.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** A list of distinct device ids, at most `max`. */
export function geraeteListe(wert: unknown, max: number): string[] | undefined {
  if (!Array.isArray(wert) || wert.length > max) return undefined;
  if (!wert.every((g): g is string => typeof g === 'string' && GERAET.test(g))) return undefined;
  return new Set(wert).size === wert.length ? wert : undefined;
}
