// The enrolment proof (Tobias 2026-11-15, plan § 2): the login script of a test zone (repo
// Testumgebung) signs, for a tester who is logged in, `n1.<payload>.<signature>` with ECDSA P-256 /
// SHA-256 (IEEE P1363, as Web Crypto signs). Payload = base64url of exactly
// {"v":1,"app":"tkd","bis":<seconds>,"n":"<16 random bytes>"}; the signature covers the ASCII text
// `n1.<payload>`. The Treffpunkt holds only the public keys (konfiguration/apps.json).
import { verify, type KeyObject } from 'node:crypto';
import { APP, istObjekt, objektMit } from './eingabe.ts';

/** A proof may be valid for at most this long … */
export const NACHWEIS_HOECHSTENS_S = 300;
/** … plus this much for clocks that differ. */
export const UHR_SPIELRAUM_S = 60;

const NACHWEIS = /^n1\.([A-Za-z0-9_-]{1,400})\.([A-Za-z0-9_-]{86})$/;
const ZUFALL = /^[A-Za-z0-9_-]{22}$/;

export interface Nachweis {
  readonly app: string;
  readonly bis: number;
  readonly n: string;
}

export type NachweisFehler =
  | 'nachweis-ungueltig'
  | 'app-unbekannt'
  | 'nachweis-nicht-eingerichtet'
  | 'nachweis-unterschrift'
  | 'nachweis-abgelaufen';

/** The app a proof names, read without checking anything else (to pick the answer's CORS). */
export function nachweisApp(text: string): string | undefined {
  const nutzlast = NACHWEIS.exec(text)?.[1];
  if (nutzlast === undefined) return undefined;
  try {
    const inhalt: unknown = JSON.parse(Buffer.from(nutzlast, 'base64url').toString('utf8'));
    const app = istObjekt(inhalt) ? inhalt['app'] : undefined;
    return typeof app === 'string' && APP.test(app) ? app : undefined;
  } catch {
    return undefined;
  }
}

export function nachweisPruefen(
  text: string,
  schluesselFuer: (app: string) => readonly KeyObject[] | undefined,
  jetztS: number,
): Nachweis | { readonly fehler: NachweisFehler } {
  const teile = NACHWEIS.exec(text);
  if (!teile) return { fehler: 'nachweis-ungueltig' };
  const [, nutzlast = '', signatur = ''] = teile;
  let inhalt: unknown;
  try {
    inhalt = JSON.parse(Buffer.from(nutzlast, 'base64url').toString('utf8'));
  } catch {
    return { fehler: 'nachweis-ungueltig' };
  }
  const feld = objektMit(inhalt, ['v', 'app', 'bis', 'n']);
  if (!feld || !istObjekt(inhalt)) return { fehler: 'nachweis-ungueltig' };
  const { v, app, bis, n } = feld;
  if (v !== 1 || typeof app !== 'string' || !APP.test(app)) return { fehler: 'nachweis-ungueltig' };
  if (
    typeof bis !== 'number' ||
    !Number.isSafeInteger(bis) ||
    typeof n !== 'string' ||
    !ZUFALL.test(n)
  ) {
    return { fehler: 'nachweis-ungueltig' };
  }
  const schluessel = schluesselFuer(app);
  if (!schluessel) return { fehler: 'app-unbekannt' };
  if (schluessel.length === 0) return { fehler: 'nachweis-nicht-eingerichtet' };
  const daten = Buffer.from(`n1.${nutzlast}`, 'ascii');
  const sig = Buffer.from(signatur, 'base64url');
  const echt = schluessel.some((key) => {
    try {
      return verify('sha256', daten, { key, dsaEncoding: 'ieee-p1363' }, sig);
    } catch {
      return false;
    }
  });
  if (!echt) return { fehler: 'nachweis-unterschrift' };
  if (bis <= jetztS || bis > jetztS + NACHWEIS_HOECHSTENS_S + UHR_SPIELRAUM_S) {
    return { fehler: 'nachweis-abgelaufen' };
  }
  return { app, bis, n };
}
