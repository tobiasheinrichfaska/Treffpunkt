// The Treffpunkt's rules, without HTTP: one request in, one answer out (docs/schnittstelle.md).
// Everything is kept in RAM; a restart loses only what waits (at most 30 s) and the counters.
import { randomBytes } from 'node:crypto';
import {
  base64url,
  base64urlLesen,
  GERAET,
  geraeteListe,
  jsonLesen,
  MANDANT,
  objektMit,
  ROHSCHLUESSEL,
  ROLLE,
} from './eingabe.ts';
import { GRENZEN, KOERPER_BYTES, zaehlerAnlegen, type Grenzen } from './grenzen.ts';
import { klingelAnfrageLesen, type Senden } from './klingeln.ts';
import {
  alleHerkuenfte,
  oeffentlicherSchluessel,
  type AppEinstellung,
  type Apps,
  type Entwickler,
} from './konfiguration.ts';
import { nachweisApp, nachweisPruefen } from './nachweis.ts';
import { postfachAnlegen, type AblegenFehler } from './postfach.ts';
import {
  EINLADUNG_S,
  einladungAusstellen,
  einladungPruefen,
  neueKennung,
  zugangAusstellen,
  zugangPruefen,
  type Zufall,
} from './zugang.ts';
import {
  ALT_MANDANT,
  ZERTIFIKAT_TAGE,
  BESITZ_SPIELRAUM_S,
  appImText,
  auswertungPruefen,
  besitzPruefen,
  darfEinladen,
  darfSperren,
  einladungNeuAusstellen,
  einladungNeuPruefen,
  gruenderPruefen,
  passwortPasst,
  zertifikatAusstellen,
  zertifikatPruefen,
  type Zertifikat,
} from './zulassung.ts';

/** The interface version and what this Treffpunkt can do; an app that gets no `v` from `/gesund`
 * talks to an older Treffpunkt and falls back to the old procedure (auftrag-zulassung D 1). */
export const VERSION = 2;
export const FAEHIGKEITEN = [
  'mandant',
  'zertifikat',
  'besitznachweis',
  'einladung2',
  'gruender',
  'sperren',
  'geraete',
] as const;

/** The techniques this Treffpunkt serves and which one it prefers (`verfahren` in `/gesund`, `ping` and the answers
 * of enrolling and renewing): `zugang` = the old ticket `z1.…` (a bearer value, tenant `1` only), `zertifikat` = the
 * certificate with the device's proof of possession. `einschreiben` = the ways a device can enrol: `nachweis` (login
 * script) and `einladung` (`e1`) are the old ones, `einladung2` (`e2`), `gruender` and `passwort` the new ones. An app
 * uses the preferred technique when it can and falls back to the other only where the answer still offers it. */
export interface Verfahren {
  readonly angeboten: readonly ('zugang' | 'zertifikat')[];
  readonly bevorzugt: 'zertifikat';
  readonly einschreiben: readonly (
    'nachweis' | 'einladung' | 'einladung2' | 'gruender' | 'passwort'
  )[];
}
const EINSCHREIBEN_ALT = ['nachweis', 'einladung'] as const;
const EINSCHREIBEN_NEU = ['einladung2', 'gruender', 'passwort'] as const;

/** What is served for a tenant of an app: the old technique only in tenant `1` and only where `streng` has not
 * switched it off; the new one everywhere. Without an app (an unknown origin): what the code serves at all. */
export function verfahrenFuer(
  app: Pick<AppEinstellung, 'streng'> | undefined,
  mandant: string,
): Verfahren {
  const altMoeglich = app === undefined || (mandant === ALT_MANDANT && !app.streng.has(mandant));
  return altMoeglich
    ? {
        angeboten: ['zugang', 'zertifikat'],
        bevorzugt: 'zertifikat',
        einschreiben: [...EINSCHREIBEN_ALT, ...EINSCHREIBEN_NEU],
      }
    : { angeboten: ['zertifikat'], bevorzugt: 'zertifikat', einschreiben: EINSCHREIBEN_NEU };
}

export const ENDPUNKTE = [
  'ping',
  'einschreiben',
  'erneuern',
  'einladen',
  'ablegen',
  'abholen',
  'klingeln',
  'geraete',
  'sperren',
  'auswertung',
] as const;
export type Endpunkt = (typeof ENDPUNKTE)[number];

/** Every refusal: HTTP status and a short German reason for the app to show. */
export const FEHLER = {
  unbekannt: [404, 'Unbekannter Endpunkt'],
  methode: [405, 'Nur POST (und GET /gesund)'],
  herkunft: [403, 'Herkunft nicht erlaubt'],
  typ: [415, 'Nur JSON (Content-Type: application/json)'],
  'zu-gross': [413, 'Anfrage zu groß'],
  'zu-langsam': [408, 'Anfrage kam zu langsam an – noch einmal senden'],
  unlesbar: [400, 'Anfrage nicht lesbar'],
  'zugang-fehlt': [401, 'Zugang fehlt'],
  'zugang-ungueltig': [401, 'Zugang ungültig'],
  'zugang-abgelaufen': [401, 'Zugang abgelaufen – bitte neu einschreiben'],
  'app-unbekannt': [403, 'App unbekannt'],
  gesperrt: [403, 'Gerät gesperrt'],
  'zu-viele-anfragen': [429, 'Zu viele Anfragen – kurz warten'],
  beschaeftigt: [503, 'Treffpunkt gerade ausgelastet – gleich noch einmal'],
  'nachweis-ungueltig': [400, 'Nachweis nicht lesbar'],
  'nachweis-nicht-eingerichtet': [403, 'Für diese App ist kein Nachweis eingerichtet'],
  'nachweis-unterschrift': [403, 'Nachweis nicht echt'],
  'nachweis-abgelaufen': [403, 'Nachweis abgelaufen – neu holen'],
  'einladung-ungueltig': [403, 'Einladung nicht echt'],
  'einladung-abgelaufen': [403, 'Einladung abgelaufen – eine neue zeigen lassen'],
  'einladen-aus': [403, 'Einladen ist für diese App aus'],
  verbraucht: [409, 'Nachweis oder Einladung schon benutzt'],
  'zu-viele-einschreibungen': [429, 'Gerade zu viele neue Geräte – später noch einmal'],
  'zu-viele-einladungen': [429, 'Zu viele Einladungen – später noch einmal'],
  'klingeln-ungueltig': [400, 'Klingeln nicht lesbar oder kein bekannter Push-Dienst'],
  'klingeln-zu-oft': [429, 'Zu oft angeklingelt – höchstens 60 je Stunde'],
  'push-dienst': [502, 'Push-Dienst nicht erreicht'],
  'neue-fassung-noetig': [426, 'Neue Fassung der App nötig – bitte aktualisieren'],
  'besitz-fehlt': [401, 'Besitznachweis des Geräts fehlt'],
  'besitz-ungueltig': [401, 'Besitznachweis des Geräts ungültig'],
  'besitz-zeit': [401, 'Besitznachweis mit falscher Uhrzeit – Uhr prüfen'],
  'geraete-voll': [409, 'Höchstzahl Geräte erreicht'],
  'rolle-nicht-erlaubt': [403, 'Dafür fehlt dem Gerät die Rolle'],
  'geraet-unbekannt': [404, 'Gerät unbekannt'],
  'sperrliste-voll': [503, 'Sperrliste voll'],
  'entwickler-nicht-eingerichtet': [403, 'Entwicklerzugang ist nicht eingerichtet'],
  'entwickler-ungueltig': [403, 'Entwicklerzugang nicht echt'],
  'entwickler-abgelaufen': [403, 'Entwicklerzugang abgelaufen oder aufgebraucht'],
  'entwickler-belegt': [403, 'Dieser Mandant hat schon Geräte'],
  intern: [500, 'Fehler im Treffpunkt'],
} as const satisfies Record<string, readonly [number, string]>;
export type Fehlerart = keyof typeof FEHLER;

/** Why one receiver of `ablegen` was refused (the others may still be taken). */
export const ABLEGEN_FEHLER: Readonly<Record<AblegenFehler, string>> = {
  voll: 'Treffpunkt voll – gleich noch einmal',
  'app-voll': 'Zu viel Wartendes für diese App – gleich noch einmal',
  'absender-voll': 'Zu viel Wartendes von diesem Gerät – erst abholen lassen',
  'empfaenger-voll': 'Postfach des Empfängers voll – erst abholen lassen',
};

export interface Umgebung {
  readonly schluessel: Buffer;
  /** Old secrets still accepted for what they signed (TREFFPUNKT_SCHLUESSEL_ALT); never used to sign. */
  readonly schluesselAlt?: readonly { readonly schluessel: Buffer; readonly bisMs: number }[];
  readonly apps: Apps;
  /** Milliseconds since 1970, for the times inside accesses, invitations and proofs (tests pass their
   * own clock). */
  readonly jetzt: () => number;
  /** A clock that never steps back (`performance.now()`), for how long a message waits, presence and
   * the counters: when the wall clock is set back, nothing may wait longer than 30 s. Without it,
   * `jetzt` is used. */
  readonly takt?: () => number;
  readonly senden: Senden;
  /** The developer's public keys and passwords (none: no developer access). */
  readonly entwickler?: Entwickler;
  readonly zufall?: Zufall;
  readonly grenzen?: Grenzen;
  /** The commit the image was built from (`stand.txt`), answered by `/gesund`. */
  readonly stand?: string;
}

/** A request before its body: what the HTTP layer can judge without reading anything. */
export interface Kopfteil {
  readonly methode: string;
  readonly pfad: string;
  /** Header names in lower case, as Node gives them. */
  readonly kopf: Readonly<Record<string, string | undefined>>;
}

export interface Anfrage extends Kopfteil {
  readonly koerper: Buffer;
}

export interface Antwort {
  readonly status: number;
  readonly kopf: Readonly<Record<string, string>>;
  readonly koerper: string;
}

/** What the log may say: counts per endpoint and per kind of refusal, nothing else. */
export interface Zaehlstand {
  readonly anfragen: Readonly<Record<string, number>>;
  readonly fehler: Readonly<Record<string, number>>;
  readonly wartend: number;
  readonly bytes: number;
  /** Sizes of what tidying up keeps short: used proofs and invitations, counter keys, presence,
   * mailboxes. */
  readonly marken: number;
  readonly zaehlerSchluessel: number;
  readonly anwesend: number;
  readonly postfaecher: number;
  /** Senders with something waiting (their ids leave with their last message). */
  readonly absender: number;
  /** Devices with a body on the way (their ids leave once it is read or broken off). */
  readonly unterwegs: number;
  /** How many seconds the wall clock is behind the start plus the time since: more than a few means
   * it ran ahead at the start and was set right since — then a restart is due (docs/sicherheit.md). */
  readonly uhrRueckstandS: number;
  /** Devices known per RAM (all tenants) and blocked ids held. */
  readonly geraete: number;
  readonly gesperrt: number;
}

/** What the HTTP layer refuses itself, before or instead of `behandeln`. */
export type HttpFehler = 'zu-gross' | 'zu-langsam' | 'unlesbar' | 'intern';

export interface Treffpunkt {
  /** Judges a request by its head alone (path, method, origin, type, access) and counts it against
   * the device's requests per minute: either the final answer — then the body is never read — or
   * the most the body of this endpoint may hold, with room taken for it until `freigeben`. The HTTP
   * layer always asks this first; `behandeln` alone does not count requests per minute. */
  vorpruefen(
    kopfteil: Kopfteil,
  ):
    { readonly antwort: Antwort } | { readonly hoechstens: number; readonly freigeben: () => void };
  behandeln(anfrage: Anfrage): Promise<Antwort>;
  /** A refusal of the HTTP layer with the same headers as every answer (CORS for a known origin),
   * counted like the others. */
  ablehnen(art: HttpFehler, origin: string | undefined): Antwort;
  aufraeumen(): void;
  /** The counts since the last call (then set to zero). */
  zaehlstand(): Zaehlstand;
}

const isoTag = (sekunden: number): string => new Date(sekunden * 1000).toISOString().slice(0, 10);
const APP_IN_GRUENDER = /^g1\.([a-z][a-z0-9]{1,15})\./;
const P_KOPF = /^[0-9]{1,3}$/;
const BIS_TAGE_MS = 90 * 86_400_000;
const STAND = /^[0-9a-f]{40}$/;

/** Who asks, from the access (`z1`, the old procedure) or the certificate (`c1`, the new one). */
interface Ich {
  readonly app: string;
  readonly mandant: string;
  /** App and tenant: what the mailboxes and presence are kept under. */
  readonly scope: string;
  readonly geraet: string;
  readonly bis: number;
  readonly verfahren: 'alt' | 'neu';
  /** From the certificate; for an old access what the device registered under (else `ohne`). */
  readonly rolle: string;
  /** Only with a certificate. */
  readonly zertifikat?: Zertifikat;
  readonly zertifikatText?: string;
}

/** What the head of a request says, if it may go on: its endpoint, origin, body limit and access.
 * `herkunft` is empty for `auswertung` without an Origin (the developer's tool). */
interface Kopfurteil {
  readonly endpunkt: Endpunkt;
  readonly herkunft: string;
  readonly hoechstens: number;
  readonly zugang?: { readonly z: Ich; readonly app: AppEinstellung };
}

/** What the Treffpunkt knows about a device of a tenant, in RAM only. */
interface Eintrag {
  rolle: string;
  /** The inviting device, `entwickler`, `nachweis` or `alt`. */
  von: string;
  seitMs: number;
  zuletztMs: number;
  zuletztTakt: number;
  verfahren: 'alt' | 'neu';
  p: number | undefined;
}

type KopfErgebnis =
  | { readonly fertig: Antwort; readonly zaehlbar?: Endpunkt }
  | { readonly art: Fehlerart; readonly herkunft?: string; readonly zaehlbar?: Endpunkt }
  | Kopfurteil;

export function treffpunktAnlegen(u: Umgebung): Treffpunkt {
  const grenzen = u.grenzen ?? GRENZEN;
  const zufall = u.zufall ?? randomBytes;
  const taktRoh = u.takt ?? u.jetzt;
  /** Whole milliseconds: `performance.now()` has fractions, the answers carry integers. */
  const takt = (): number => Math.floor(taktRoh());
  /** The wall time accesses, invitations and proofs are judged by: never earlier than the start plus
   * the monotonic time since (`untergrenze`), so setting the wall clock back makes nothing expired
   * valid again. A clock that runs ahead after the start counts only while it does: once it is set
   * right, nothing stays locked out. A clock that was ahead at the start keeps the floor ahead until
   * a restart (the counts show it as `uhrRueckstandS`). */
  const wandStart = u.jetzt();
  const taktStart = taktRoh();
  const untergrenze = (): number => wandStart + (taktRoh() - taktStart);
  const wandJetzt = (): number => Math.max(u.jetzt(), untergrenze());
  /** Bodies on the way: per device, and bytes without an access, with one, and per app. */
  const imFlugJeGeraet = new Map<string, number>();
  const imFlugBytes = { mit: 0, ohne: 0 };
  const imFlugJeApp = new Map<string, number>();
  const herkuenfte = alleHerkuenfte(u.apps);
  const stand = u.stand !== undefined && STAND.test(u.stand) ? u.stand : 'unbekannt';
  const postfach = postfachAnlegen(grenzen);
  const anfragen = zaehlerAnlegen(grenzen.anfragenJeMinute, grenzen.minuteMs);
  const klingeln = zaehlerAnlegen(grenzen.klingelnJeStunde, grenzen.stundeMs);
  const einladen = zaehlerAnlegen(grenzen.einladenJeStunde, grenzen.stundeMs);
  const einschreiben = zaehlerAnlegen(grenzen.einschreibenJeStunde, grenzen.stundeMs);
  const eingeladen = zaehlerAnlegen(grenzen.einschreibenEinladungJeStunde, grenzen.stundeMs);
  /** Bytes of bodies per minute, per device and per app: reading and parsing run on one thread. */
  const bytesJeGeraet = zaehlerAnlegen(grenzen.koerperBytesJeGeraetMinute, grenzen.minuteMs);
  const bytesJeApp = zaehlerAnlegen(grenzen.koerperBytesJeAppMinute, grenzen.minuteMs);
  /** Proofs, invitations and tickets taken, until their end: each is good for one device only. */
  const verbraucht = new Map<string, number>();
  const entwickler = u.entwickler ?? { schluessel: [], passwoerter: [] };
  const passwortVersuche = zaehlerAnlegen(grenzen.passwortVersucheJeStunde, grenzen.stundeMs);
  const sperren = zaehlerAnlegen(grenzen.sperrenJeStunde, grenzen.stundeMs);
  /** Devices per tenant (`app:mandant`), what the card „Treffpunkt“ shows and the limit counts. */
  const register = new Map<string, Map<string, Eintrag>>();
  /** Blocked devices per tenant until the end of what they could still hold (90 days, by the floor). */
  const gesperrtListe = new Map<string, Map<string, number>>();
  /** Signatures of requests taken, until their time is out: a captured request cannot be replayed. */
  const besitzGesehen = new Map<string, number>();
  /** Developer passwords used (by index in the settings), and the last request of the old
   * procedure per tenant (monotonic clock): what the evaluation shows. */
  const passwortGenutzt = new Map<number, number>();
  const altZuletzt = new Map<string, number>();
  const laeuftSeit = takt();
  let gezaehlt = { anfragen: new Map<string, number>(), fehler: new Map<string, number>() };

  const zaehlen = (karte: Map<string, number>, was: string): void => {
    karte.set(was, (karte.get(was) ?? 0) + 1);
  };

  const bekannt = (origin: string | undefined): string | undefined =>
    origin !== undefined && herkuenfte.has(origin) ? origin : undefined;

  function kopf(herkunft: string | undefined): Record<string, string> {
    const k: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin',
    };
    if (herkunft) k['Access-Control-Allow-Origin'] = herkunft;
    return k;
  }

  function antwort(status: number, daten: unknown, herkunft: string | undefined): Antwort {
    return { status, kopf: kopf(herkunft), koerper: JSON.stringify(daten) };
  }

  function fehler(art: Fehlerart, herkunft?: string): Antwort {
    zaehlen(gezaehlt.fehler, art);
    const [status, text] = FEHLER[art];
    return antwort(status, { fehler: text, art }, herkunft);
  }

  function vorab(herkunft: string | undefined, methode: string | undefined): Antwort {
    if (!herkunft || methode !== 'POST') return fehler('herkunft');
    return {
      status: 204,
      kopf: {
        'Access-Control-Allow-Origin': herkunft,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers':
          'authorization, content-type, x-treffpunkt-signatur, x-treffpunkt-p',
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Origin',
      },
      koerper: '',
    };
  }

  /** The ring of secrets: what is made is signed with the current one, what is judged may be signed
   * with it or with an old one that is still entered (a change of the secret without everyone
   * enrolling again). A signature that is genuine but late (expired) counts as the verdict. */
  function ring<T extends object>(urteil: (k: Buffer) => T, ungueltig: string): T {
    let zuletzt: T | undefined;
    // An old secret counts until its date (the wall clock, never earlier than the floor).
    const jetzt = wandJetzt();
    const geheimnisse = [
      u.schluessel,
      ...(u.schluesselAlt ?? []).filter((a) => a.bisMs > jetzt).map((a) => a.schluessel),
    ];
    for (const k of geheimnisse) {
      const r = urteil(k);
      if (!('fehler' in r) || r.fehler !== ungueltig) return r;
      zuletzt = r;
    }
    return zuletzt as T;
  }

  const scopeVon = (app: string, mandant: string): string => `${app}:${mandant}`;
  const sperrenFuer = (scope: string): Map<string, number> => {
    let m = gesperrtListe.get(scope);
    if (!m) {
      m = new Map();
      gesperrtListe.set(scope, m);
    }
    return m;
  };
  const istGesperrt = (app: AppEinstellung, scope: string, geraet: string): boolean =>
    app.gesperrt.has(geraet) || gesperrtListe.get(scope)?.has(geraet) === true;

  /** What the answer says about this Treffpunkt, for apps that ask what it can do: the version, the abilities and
   * the techniques it serves for this tenant and prefers (`verfahrenFuer`). */
  const faehigFuer = (app: AppEinstellung | undefined, mandant: string) => ({
    v: VERSION,
    faehigkeiten: FAEHIGKEITEN,
    verfahren: verfahrenFuer(app, mandant),
  });

  /** A device's public key as the request carries it: an uncompressed P-256 point, or undefined. */
  function geraetSchluessel(wert: unknown): string | undefined | null {
    if (wert === undefined) return undefined;
    if (typeof wert !== 'string' || !ROHSCHLUESSEL.test(wert)) return null;
    try {
      oeffentlicherSchluessel(wert);
      return wert;
    } catch {
      return null;
    }
  }

  function einschreibenBehandeln(
    roh: unknown,
    herkunft: string,
    jetztMs: number,
    taktMs: number,
  ): Antwort {
    const jetztS = Math.floor(jetztMs / 1000);
    const feld = objektMit(roh, [
      'nachweis',
      'einladung',
      'gruender',
      'passwort',
      'app',
      'mandant',
      'geraetSchluessel',
      'rolle',
    ]);
    if (!feld) return fehler('unlesbar', herkunft);
    const { nachweis, einladung, gruender, passwort } = feld;
    const wege = [nachweis, einladung, gruender, passwort].filter((w) => w !== undefined);
    if (wege.length !== 1 || typeof wege[0] !== 'string') return fehler('unlesbar', herkunft);
    const schluessel = geraetSchluessel(feld['geraetSchluessel']);
    if (schluessel === null) return fehler('unlesbar', herkunft);
    const rolleGenannt = feld['rolle'];
    if (
      rolleGenannt !== undefined &&
      (typeof rolleGenannt !== 'string' || !ROLLE.test(rolleGenannt))
    ) {
      return fehler('unlesbar', herkunft);
    }
    // `app` and `mandant` belong to the password only; every other proof carries them itself.
    if (passwort === undefined && (feld['app'] !== undefined || feld['mandant'] !== undefined)) {
      return fehler('unlesbar', herkunft);
    }
    // The app the credential names, before its signature is checked: from an origin of another
    // app, every answer is the same opaque refusal, so its page learns nothing about the credential.
    const genannt =
      typeof nachweis === 'string'
        ? nachweisApp(nachweis)
        : typeof einladung === 'string'
          ? appImText(einladung)
          : typeof gruender === 'string'
            ? APP_IN_GRUENDER.exec(gruender)?.[1]
            : typeof feld['app'] === 'string'
              ? feld['app']
              : undefined;
    const genannteApp = genannt === undefined ? undefined : u.apps.get(genannt);
    if (genannteApp && !genannteApp.herkuenfte.includes(herkunft)) return fehler('herkunft');

    let app: AppEinstellung | undefined;
    let marke: string | undefined;
    let bis = 0;
    let kontingent: typeof einschreiben = einschreiben;
    let mandant = ALT_MANDANT;
    let rolle = typeof rolleGenannt === 'string' ? rolleGenannt : 'ohne';
    let von = 'alt';
    /** Whether this is the old procedure (login-script proof, `e1`): it ends with `streng`. */
    let alt = false;
    let einlosungDesPassworts: number | undefined;
    if (typeof nachweis === 'string') {
      const n = nachweisPruefen(nachweis, (id) => u.apps.get(id)?.nachweisSchluessel, jetztS);
      if ('fehler' in n) return fehler(n.fehler, herkunft);
      app = u.apps.get(n.app);
      marke = `n:${n.n}`;
      bis = n.bis;
      von = 'nachweis';
      alt = true;
    } else if (typeof einladung === 'string') {
      // Made and judged by the Treffpunkt's own clock (start + monotonic time), whatever the wall
      // clock does: an invitation lives its 10 minutes, ahead, behind or set right.
      const jetztEinladungS = Math.floor(untergrenze() / 1000);
      kontingent = eingeladen;
      if (einladung.startsWith('e2.')) {
        const e = ring(
          (k) => einladungNeuPruefen(k, einladung, jetztEinladungS, EINLADUNG_S),
          'einladung-ungueltig',
        );
        if ('fehler' in e) return fehler(e.fehler, herkunft);
        // The role comes with the invitation, never from the new device.
        if (rolleGenannt !== undefined) return fehler('unlesbar', herkunft);
        app = u.apps.get(e.app);
        marke = `e:${e.n}`;
        bis = e.bis;
        mandant = e.mandant;
        rolle = e.rolle;
        von = e.von;
        if (app && istGesperrt(app, scopeVon(e.app, e.mandant), e.von)) {
          return fehler('einladung-ungueltig', herkunft);
        }
      } else {
        const e = ring(
          (k) => einladungPruefen(k, einladung, jetztEinladungS),
          'einladung-ungueltig',
        );
        if ('fehler' in e) return fehler(e.fehler, herkunft);
        app = u.apps.get(e.app);
        marke = `e:${e.n}`;
        bis = e.bis;
        alt = true;
      }
      if (app && !app.einladen) return fehler('einladen-aus', herkunft);
    } else if (typeof gruender === 'string') {
      const g = gruenderPruefen(entwickler.schluessel, gruender, jetztS);
      if ('fehler' in g) return fehler(g.fehler, herkunft);
      if (schluessel === undefined) return fehler('unlesbar', herkunft);
      app = u.apps.get(g.app);
      marke = `g:${g.n}`;
      bis = g.bis;
      mandant = g.mandant;
      rolle = 'buero';
      von = 'entwickler';
      if (rolleGenannt !== undefined) return fehler('unlesbar', herkunft);
    } else {
      // The developer password: the app and tenant are named, the key is needed.
      const { app: appName, mandant: mandantName } = feld;
      if (typeof appName !== 'string' || typeof mandantName !== 'string') {
        return fehler('unlesbar', herkunft);
      }
      if (!MANDANT.test(mandantName) || schluessel === undefined || rolleGenannt !== undefined) {
        return fehler('unlesbar', herkunft);
      }
      app = u.apps.get(appName);
      if (!app) return fehler('app-unbekannt', herkunft);
      if (entwickler.passwoerter.length === 0)
        return fehler('entwickler-nicht-eingerichtet', herkunft);
      if (!passwortVersuche.erlaubt(app.id, taktMs))
        return fehler('zu-viele-einschreibungen', herkunft);
      const nummer = entwickler.passwoerter.findIndex(
        (p) =>
          p.app === appName &&
          p.mandant === mandantName &&
          passwortPasst(passwort as string, p.hash),
      );
      const p = entwickler.passwoerter[nummer];
      if (!p) return fehler('entwickler-ungueltig', herkunft);
      if (p.bis * 1000 <= jetztMs || (passwortGenutzt.get(nummer) ?? 0) >= p.hoechstens) {
        return fehler('entwickler-abgelaufen', herkunft);
      }
      if (!p.auchMitGeraeten && (register.get(scopeVon(appName, mandantName))?.size ?? 0) > 0) {
        return fehler('entwickler-belegt', herkunft);
      }
      mandant = mandantName;
      rolle = 'buero';
      von = 'entwickler';
      einlosungDesPassworts = nummer;
    }
    if (!app) return fehler('app-unbekannt', herkunft);
    // An origin of another app gets no CORS header: its page cannot read the refusal.
    if (!app.herkuenfte.includes(herkunft)) return fehler('herkunft');
    // The old procedure is switched off for a tenant by hand (`streng`), once everyone has the new.
    if (alt && app.streng.has(mandant)) return fehler('neue-fassung-noetig', herkunft);
    // Access `z1` carries no tenant (it means tenant `1`) and is issued only there, and not where
    // only the new procedure holds; everywhere else the certificate, so a key is needed.
    const mitZugang = mandant === ALT_MANDANT && !app.streng.has(mandant);
    if (schluessel === undefined && !mitZugang) return fehler('unlesbar', herkunft);
    if (marke !== undefined && verbraucht.has(marke)) return fehler('verbraucht', herkunft);
    const scope = scopeVon(app.id, mandant);
    const bekannte = register.get(scope);
    if ((bekannte?.size ?? 0) >= grenzen.geraeteJeMandant) return fehler('geraete-voll', herkunft);
    // Counted only now: garbage, a proof taken already or a foreign origin uses up nothing.
    if (!kontingent.erlaubt(app.id, taktMs)) return fehler('zu-viele-einschreibungen', herkunft);
    if (marke !== undefined) verbraucht.set(marke, bis * 1000);
    if (einlosungDesPassworts !== undefined) {
      passwortGenutzt.set(
        einlosungDesPassworts,
        (passwortGenutzt.get(einlosungDesPassworts) ?? 0) + 1,
      );
    }
    const geraet = neueKennung(zufall);
    const verfahren = schluessel === undefined ? 'alt' : 'neu';
    const eintrag: Eintrag = {
      rolle,
      von,
      seitMs: jetztMs,
      zuletztMs: jetztMs,
      zuletztTakt: taktMs,
      verfahren,
      p: undefined,
    };
    if (bekannte) bekannte.set(geraet, eintrag);
    else register.set(scope, new Map([[geraet, eintrag]]));
    const antwortDaten: Record<string, unknown> = { geraet };
    let ende: number;
    if (mitZugang) {
      const z = zugangAusstellen(u.schluessel, app.id, geraet, jetztS);
      antwortDaten['zugang'] = z.zugang;
      ende = z.bis;
    } else {
      ende = jetztS + ZERTIFIKAT_TAGE * 86_400;
    }
    if (schluessel !== undefined) {
      const c = zertifikatAusstellen(
        u.schluessel,
        { app: app.id, mandant, geraet, rolle, schluessel },
        jetztS,
      );
      antwortDaten['zertifikat'] = c.zertifikat;
      antwortDaten['mandant'] = mandant;
      antwortDaten['rolle'] = rolle;
      ende = c.bis;
      Object.assign(antwortDaten, faehigFuer(app, mandant));
    }
    antwortDaten['bis'] = isoTag(ende);
    return antwort(201, antwortDaten, herkunft);
  }

  function ablegenBehandeln(roh: unknown, z: Ich, herkunft: string, taktMs: number): Antwort {
    const feld = objektMit(roh, ['an']);
    const liste = feld?.an;
    if (!Array.isArray(liste) || liste.length === 0 || liste.length > grenzen.empfaengerJeAblegen) {
      return fehler('unlesbar', herkunft);
    }
    const stuecke: { geraet: string; inhalt: Buffer }[] = [];
    for (const eintrag of liste) {
      const e = objektMit(eintrag, ['geraet', 'inhalt']);
      const inhalt = base64urlLesen(e?.inhalt, grenzen.nachrichtBytes);
      if (!e || typeof e.geraet !== 'string' || !GERAET.test(e.geraet) || !inhalt) {
        return fehler('unlesbar', herkunft);
      }
      if (inhalt.length === 0 || e.geraet === z.geraet) return fehler('unlesbar', herkunft);
      if (stuecke.some((s) => s.geraet === e.geraet)) return fehler('unlesbar', herkunft);
      stuecke.push({ geraet: e.geraet, inhalt });
    }
    const ergebnisse = stuecke.map(({ geraet, inhalt }) => {
      const r = postfach.ablegen(z.scope, z.geraet, geraet, inhalt, taktMs);
      if (!r.ok) {
        zaehlen(gezaehlt.fehler, r.art);
        return { geraet, ok: false, art: r.art, fehler: ABLEGEN_FEHLER[r.art] };
      }
      const anwesend = postfach.anwesend(z.scope, [geraet], taktMs).length === 1;
      return { geraet, ok: true, anwesend };
    });
    return antwort(200, { ergebnisse }, herkunft);
  }

  function abholenBehandeln(roh: unknown, z: Ich, herkunft: string, taktMs: number): Antwort {
    const feld = objektMit(roh, ['anwesend']);
    if (!feld) return fehler('unlesbar', herkunft);
    const gefragt =
      feld.anwesend === undefined ? [] : geraeteListe(feld.anwesend, grenzen.anwesendFragen);
    if (!gefragt) return fehler('unlesbar', herkunft);
    postfach.anwesendMerken(z.scope, z.geraet, taktMs);
    const { nachrichten, mehr } = postfach.abholen(z.scope, z.geraet, taktMs);
    return antwort(
      200,
      {
        nachrichten: nachrichten.map((n) => ({
          von: n.von,
          inhalt: base64url(n.inhalt),
          alterMs: taktMs - n.abgelegtMs,
        })),
        anwesend: postfach.anwesend(
          z.scope,
          gefragt.filter((g) => g !== z.geraet),
          taktMs,
        ),
        mehr,
      },
      herkunft,
    );
  }

  async function klingelnBehandeln(
    roh: unknown,
    z: Ich,
    herkunft: string,
    taktMs: number,
  ): Promise<Antwort> {
    const a = klingelAnfrageLesen(roh);
    if (!a) return fehler('klingeln-ungueltig', herkunft);
    if (!klingeln.erlaubt(`${z.app}|${z.geraet}`, taktMs))
      return fehler('klingeln-zu-oft', herkunft);
    const start = takt();
    let dienst: number;
    try {
      dienst = await u.senden(a);
    } catch {
      return fehler('push-dienst', herkunft);
    }
    if (!Number.isInteger(dienst) || dienst < 100 || dienst > 599) {
      return fehler('push-dienst', herkunft);
    }
    return antwort(200, { dienst, ms: Math.max(0, takt() - start) }, herkunft);
  }

  /** The access (`z1`, old) or the certificate (`c1`, new) from the header, judged without counting
   * anything. The proof of possession of a certificate is checked with the body (`behandeln`). */
  function zugangAusKopf(
    a: Kopfteil,
    herkunft: string,
  ): { z: Ich; app: AppEinstellung } | { art: Fehlerart; herkunft?: string } {
    const auth = a.kopf['authorization'];
    if (!auth?.startsWith('Bearer ')) return { art: 'zugang-fehlt', herkunft };
    const text = auth.slice('Bearer '.length);
    // The app the access names, before its MAC is checked: from an origin of another app every
    // answer is the same opaque refusal, valid access or not.
    const genannt = appImText(text);
    const genannteApp = genannt === undefined ? undefined : u.apps.get(genannt);
    if (genannteApp && !genannteApp.herkuenfte.includes(herkunft)) return { art: 'herkunft' };
    const jetztS = Math.floor(wandJetzt() / 1000);
    let ich: Ich;
    if (text.startsWith('c1.')) {
      const c = ring((k) => zertifikatPruefen(k, text, jetztS), 'zugang-ungueltig');
      if ('fehler' in c) return { art: c.fehler, herkunft };
      ich = {
        app: c.app,
        mandant: c.mandant,
        scope: scopeVon(c.app, c.mandant),
        geraet: c.geraet,
        bis: c.bis,
        verfahren: 'neu',
        rolle: c.rolle,
        zertifikat: c,
        zertifikatText: text,
      };
    } else {
      const z = ring((k) => zugangPruefen(k, text, jetztS), 'zugang-ungueltig');
      if ('fehler' in z) return { art: z.fehler, herkunft };
      const scope = scopeVon(z.app, ALT_MANDANT);
      ich = {
        app: z.app,
        mandant: ALT_MANDANT,
        scope,
        geraet: z.geraet,
        bis: z.bis,
        verfahren: 'alt',
        rolle: register.get(scope)?.get(z.geraet)?.rolle ?? 'ohne',
      };
    }
    const app = u.apps.get(ich.app);
    if (!app) return { art: 'app-unbekannt', herkunft };
    if (!app.herkuenfte.includes(herkunft)) return { art: 'herkunft' };
    // Blocked is not expired and not „new version needed“: the app tells them apart.
    if (istGesperrt(app, ich.scope, ich.geraet)) return { art: 'gesperrt', herkunft };
    if (ich.verfahren === 'alt' && app.streng.has(ich.mandant)) {
      return { art: 'neue-fassung-noetig', herkunft };
    }
    return { z: ich, app };
  }

  const appVon = (herkunft: string): AppEinstellung | undefined =>
    [...u.apps.values()].find((a) => a.herkuenfte.includes(herkunft));

  function kopfPruefen(a: Kopfteil): KopfErgebnis {
    if (a.pfad === '/gesund') {
      if (a.methode !== 'GET') return { art: 'methode' };
      // The page of an app may read it (CORS for a known origin): an app finds out what the Treffpunkt serves and
      // prefers before it enrols — for its own app and the first tenant (`1`), otherwise what the code serves at all.
      const herkunft = bekannt(a.kopf['origin']);
      const app = herkunft === undefined ? undefined : appVon(herkunft);
      const daten = {
        ok: true,
        stand,
        ...faehigFuer(app, ALT_MANDANT),
        ...(app ? { app: app.id, altAbgeschaltet: app.streng.has(ALT_MANDANT) } : {}),
      };
      return { fertig: antwort(200, daten, herkunft) };
    }
    const endpunkt = ENDPUNKTE.find((e) => a.pfad === `/v1/${e}`);
    if (!endpunkt) return { art: 'unbekannt' };
    const herkunft = bekannt(a.kopf['origin']);
    // The evaluation comes from the developer's tool, which has no page and so no origin.
    const ohneHerkunftOk = endpunkt === 'auswertung' && a.kopf['origin'] === undefined;
    if (a.methode === 'OPTIONS') {
      return { fertig: vorab(herkunft, a.kopf['access-control-request-method']) };
    }
    if (a.methode !== 'POST') return { art: 'methode', ...(herkunft ? { herkunft } : {}) };
    if (!herkunft && !ohneHerkunftOk) return { art: 'herkunft', zaehlbar: endpunkt };
    const typ = (a.kopf['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (typ !== 'application/json')
      return { art: 'typ', ...(herkunft ? { herkunft } : {}), zaehlbar: endpunkt };
    const hoechstens =
      endpunkt === 'ablegen'
        ? KOERPER_BYTES.ablegen
        : endpunkt === 'klingeln'
          ? KOERPER_BYTES.klingeln
          : KOERPER_BYTES.klein;
    if (endpunkt === 'einschreiben' || endpunkt === 'auswertung') {
      return { endpunkt, herkunft: herkunft ?? '', hoechstens };
    }
    if (!herkunft) return { art: 'herkunft', zaehlbar: endpunkt };
    const zugang = zugangAusKopf(a, herkunft);
    if ('art' in zugang) return { ...zugang, zaehlbar: endpunkt };
    return { endpunkt, herkunft, hoechstens, zugang };
  }

  /** The row of a device in the tenant's register (made if the device is new to this run, within
   * twice the limit so a flood of old accesses cannot grow it without end). */
  function gesehen(z: Ich, p: number | undefined, jetztMs: number, taktMs: number): void {
    let karte = register.get(z.scope);
    if (!karte) {
      karte = new Map();
      register.set(z.scope, karte);
    }
    let e = karte.get(z.geraet);
    if (!e) {
      if (karte.size >= grenzen.geraeteJeMandant * 2) return;
      e = {
        rolle: z.rolle,
        von: 'alt',
        seitMs: jetztMs,
        zuletztMs: jetztMs,
        zuletztTakt: taktMs,
        verfahren: z.verfahren,
        p,
      };
      karte.set(z.geraet, e);
    }
    e.zuletztMs = jetztMs;
    e.zuletztTakt = taktMs;
    e.verfahren = z.verfahren;
    // The role of a device with a certificate is the one it was issued; an old access has none.
    if (z.verfahren === 'neu') e.rolle = z.rolle;
    e.p = p;
    if (z.verfahren === 'alt') altZuletzt.set(z.scope, taktMs);
  }

  function geraeteBehandeln(z: Ich, herkunft: string, jetztMs: number): Antwort {
    // Who sees which devices: the office all of its tenant, a `lb:<id>` device its own, others
    // only themselves.
    const karte = register.get(z.scope) ?? new Map<string, Eintrag>();
    const liste = [...karte]
      .filter(
        ([g, e]) =>
          g === z.geraet ||
          z.rolle === 'buero' ||
          (z.rolle.startsWith('lb:') && e.rolle === z.rolle),
      )
      .map(([g, e]) => ({
        geraet: g,
        rolle: e.rolle,
        von: e.von,
        seit: new Date(e.seitMs).toISOString(),
        zuletzt: new Date(e.zuletztMs).toISOString(),
        verfahren: e.verfahren,
        ...(e.p === undefined ? {} : { p: e.p }),
      }));
    void jetztMs;
    return antwort(200, { geraete: liste, hoechstens: grenzen.geraeteJeMandant }, herkunft);
  }

  function sperrenBehandeln(roh: unknown, z: Ich, herkunft: string, taktMs: number): Antwort {
    const feld = objektMit(roh, ['geraet']);
    const ziel = feld?.['geraet'];
    if (typeof ziel !== 'string' || !GERAET.test(ziel)) return fehler('unlesbar', herkunft);
    const bekanntes = register.get(z.scope)?.get(ziel);
    const selbst = ziel === z.geraet;
    if (!darfSperren(z.rolle, bekanntes, selbst)) {
      // A device of another role (or unknown to the register after a restart) is not the business of
      // a `lb:<id>` device: it learns only that it may not, nothing about other devices.
      return fehler('rolle-nicht-erlaubt', herkunft);
    }
    if (!sperren.erlaubt(`${z.app}|${z.geraet}`, taktMs))
      return fehler('zu-viele-einladungen', herkunft);
    const liste = sperrenFuer(z.scope);
    if (!liste.has(ziel) && liste.size >= grenzen.sperrlisteJeMandant) {
      return fehler('sperrliste-voll', herkunft);
    }
    // Held as long as an access or certificate of the device could still be valid.
    liste.set(ziel, untergrenze() + BIS_TAGE_MS);
    return antwort(200, { geraet: ziel, gesperrt: true }, herkunft);
  }

  async function mitZugang(
    endpunkt: Exclude<Endpunkt, 'einschreiben' | 'auswertung'>,
    roh: unknown,
    zugang: { readonly z: Ich; readonly app: AppEinstellung },
    herkunft: string,
    taktMs: number,
    jetztMs: number,
    angekuendigt: boolean,
  ): Promise<Antwort> {
    const { z, app } = zugang;
    const jetztS = Math.floor(wandJetzt() / 1000);
    switch (endpunkt) {
      case 'ping':
        if (!objektMit(roh, [])) return fehler('unlesbar', herkunft);
        return antwort(
          200,
          {
            geraet: z.geraet,
            app: z.app,
            bis: isoTag(z.bis),
            ...(z.verfahren === 'neu' ? { mandant: z.mandant, rolle: z.rolle } : {}),
            // an app that announces its protocol version (`X-Treffpunkt-P`) learns the Fassung and the techniques; an
            // old app sends no such header and gets the answer it always got
            ...(z.verfahren === 'neu' || angekuendigt ? faehigFuer(app, z.mandant) : {}),
          },
          herkunft,
        );
      case 'erneuern': {
        const feld = objektMit(roh, ['geraetSchluessel', 'rolle']);
        if (!feld) return fehler('unlesbar', herkunft);
        if (z.zertifikat) {
          // A certificate renews itself, same key, tenant and role: nothing to claim.
          if (Object.keys(feld).length > 0) return fehler('unlesbar', herkunft);
          const c = zertifikatAusstellen(u.schluessel, z.zertifikat, jetztS);
          return antwort(
            200,
            { zertifikat: c.zertifikat, bis: isoTag(c.bis), ...faehigFuer(app, z.mandant) },
            herkunft,
          );
        }
        const neu = zugangAusstellen(u.schluessel, z.app, z.geraet, jetztS);
        const schluessel = geraetSchluessel(feld['geraetSchluessel']);
        const rolleGenannt = feld['rolle'];
        if (
          schluessel === null ||
          (rolleGenannt !== undefined &&
            (typeof rolleGenannt !== 'string' || !ROLLE.test(rolleGenannt))) ||
          (rolleGenannt !== undefined && schluessel === undefined)
        ) {
          return fehler('unlesbar', herkunft);
        }
        const daten: Record<string, unknown> = { zugang: neu.zugang, bis: isoTag(neu.bis) };
        if (schluessel !== undefined) {
          // The old access becomes a certificate: one more step of the migration (phase 1). The role
          // is what the device says (nobody else knows it); the old procedure ends with `streng`.
          const rolle = typeof rolleGenannt === 'string' ? rolleGenannt : z.rolle;
          const c = zertifikatAusstellen(
            u.schluessel,
            { app: z.app, mandant: z.mandant, geraet: z.geraet, rolle, schluessel },
            jetztS,
          );
          daten['zertifikat'] = c.zertifikat;
          daten['mandant'] = z.mandant;
          daten['rolle'] = rolle;
          const e = register.get(z.scope)?.get(z.geraet);
          if (e) e.rolle = rolle;
          Object.assign(daten, faehigFuer(app, z.mandant));
        }
        return antwort(200, daten, herkunft);
      }
      case 'einladen': {
        const feld = objektMit(roh, ['rolle']);
        if (!feld) return fehler('unlesbar', herkunft);
        if (!app.einladen) return fehler('einladen-aus', herkunft);
        const gewollt = feld['rolle'];
        if (gewollt !== undefined && (typeof gewollt !== 'string' || !ROLLE.test(gewollt))) {
          return fehler('unlesbar', herkunft);
        }
        if (z.verfahren === 'alt') {
          // The old way: `{}` only, an invitation without tenant or role (tenant `1`).
          if (gewollt !== undefined) return fehler('unlesbar', herkunft);
        } else {
          const fuer = gewollt ?? (z.rolle === 'buero' ? 'ohne' : z.rolle);
          if (!darfEinladen(z.rolle, fuer)) return fehler('rolle-nicht-erlaubt', herkunft);
        }
        if (!einladen.erlaubt(`${z.app}|${z.geraet}`, taktMs)) {
          return fehler('zu-viele-einladungen', herkunft);
        }
        // Made by the floor and judged by the floor (in einschreiben): its 10 minutes hold whatever
        // the wall clock does.
        const jetztEinladungS = Math.floor(untergrenze() / 1000);
        if (z.verfahren === 'alt') {
          const e = einladungAusstellen(u.schluessel, z.app, jetztEinladungS, zufall);
          return antwort(201, { einladung: e.einladung, gueltigS: EINLADUNG_S }, herkunft);
        }
        // The invitation hands on the tenant of whoever invites, and cannot change it.
        const fuer = gewollt ?? (z.rolle === 'buero' ? 'ohne' : z.rolle);
        const e = einladungNeuAusstellen(
          u.schluessel,
          { app: z.app, mandant: z.mandant, von: z.geraet, rolle: fuer },
          jetztEinladungS,
          EINLADUNG_S,
          zufall,
        );
        return antwort(201, { einladung: e.einladung, gueltigS: EINLADUNG_S }, herkunft);
      }
      case 'geraete':
        if (!objektMit(roh, [])) return fehler('unlesbar', herkunft);
        // Only a device with a certificate may look at or block devices: the old access is a bearer
        // value anybody could have taken.
        if (z.verfahren !== 'neu') return fehler('rolle-nicht-erlaubt', herkunft);
        return geraeteBehandeln(z, herkunft, jetztMs);
      case 'sperren':
        if (z.verfahren !== 'neu') return fehler('rolle-nicht-erlaubt', herkunft);
        return sperrenBehandeln(roh, z, herkunft, taktMs);
      case 'ablegen':
        return ablegenBehandeln(roh, z, herkunft, taktMs);
      case 'abholen':
        return abholenBehandeln(roh, z, herkunft, taktMs);
      case 'klingeln':
        return klingelnBehandeln(roh, z, herkunft, taktMs);
    }
  }

  /** The evaluation for the developer alone (a ticket signed with his key, 5 minutes, once):
   * per tenant how many devices use which procedure, and when the old one was last seen. */
  function auswertungBehandeln(roh: unknown, herkunft: string, jetztMs: number, taktMs: number) {
    const feld = objektMit(roh, ['ticket']);
    if (!feld || typeof feld['ticket'] !== 'string') return fehler('unlesbar', herkunft);
    if (!einschreiben.erlaubt('*auswertung', taktMs))
      return fehler('zu-viele-einschreibungen', herkunft);
    const t = auswertungPruefen(entwickler.schluessel, feld['ticket'], Math.floor(jetztMs / 1000));
    if ('fehler' in t) return fehler(t.fehler, herkunft);
    const marke = `a:${t.n}`;
    if (verbraucht.has(marke)) return fehler('verbraucht', herkunft);
    verbraucht.set(marke, t.bis * 1000);
    const mandanten = [...register].map(([scope, karte]) => {
      const [app = '', mandant = ''] = scope.split(':');
      const einstellung = u.apps.get(app);
      const letzte = altZuletzt.get(scope);
      let neu = 0;
      for (const e of karte.values()) if (e.verfahren === 'neu') neu += 1;
      return {
        app,
        mandant,
        geraete: karte.size,
        neu,
        alt: karte.size - neu,
        gesperrt: gesperrtListe.get(scope)?.size ?? 0,
        altLetzteVorS:
          letzte === undefined ? null : Math.max(0, Math.round((taktMs - letzte) / 1000)),
        streng: einstellung?.streng.has(mandant) ?? false,
      };
    });
    // Only what this run has seen: after a restart the counts start again, so „nothing old since
    // the start“ proves nothing beyond `laufzeitS`.
    return antwort(
      200,
      { laufzeitS: Math.round((taktMs - laeuftSeit) / 1000), mandanten },
      herkunft,
    );
  }

  /** The final answer of a head that may not go on, counted once. */
  function abschliessen(r: Exclude<KopfErgebnis, Kopfurteil>): Antwort {
    if (r.zaehlbar) zaehlen(gezaehlt.anfragen, r.zaehlbar);
    return 'fertig' in r ? r.fertig : fehler(r.art, r.herkunft);
  }

  /** Room for the body before it is read: the device's requests per minute (counted here, so an
   * unreadable, too large or too slow body counts too), its bodies on the way, and the bytes of all
   * bodies on the way — without an access, with one, and per app. */
  function platzNehmen(
    r: Kopfurteil,
    angesagt: string | undefined,
  ): { readonly art: Fehlerart } | { readonly freigeben: () => void } {
    const geraet = r.zugang ? `${r.zugang.z.app}|${r.zugang.z.geraet}` : undefined;
    const app = r.zugang?.z.app;
    if (geraet !== undefined && !anfragen.erlaubt(geraet, takt())) {
      return { art: 'zu-viele-anfragen' };
    }
    const laenge = Number(angesagt);
    // Too large is too large, however full the pots are: 413, never „gleich noch einmal“.
    // Any number counts, also one beyond the safe integers (Node passes digits only).
    if (angesagt !== undefined && Number.isFinite(laenge) && laenge > r.hoechstens) {
      return { art: 'zu-gross' };
    }
    if (
      geraet !== undefined &&
      (imFlugJeGeraet.get(geraet) ?? 0) >= grenzen.koerperJeGeraetImFlug
    ) {
      return { art: 'zu-viele-anfragen' };
    }
    const bytes =
      angesagt !== undefined && Number.isSafeInteger(laenge) && laenge >= 0
        ? Math.min(laenge, r.hoechstens)
        : r.hoechstens;
    // The bytes of the minute, for large bodies only (small ones are bounded by the requests per
    // minute, and collecting must always go on): over the device's own, it waits (429); over its
    // app's, the app's large bodies wait a moment (503), while the other apps go on. They are booked
    // only once a body was read (in `behandeln`): one announced and broken off costs nothing.
    if (bytes > KOERPER_BYTES.klein) {
      const minute = takt();
      if (geraet !== undefined && bytesJeGeraet.voll(geraet, minute, bytes)) {
        return { art: 'zu-viele-anfragen' };
      }
      if (app !== undefined && bytesJeApp.voll(app, minute, bytes)) return { art: 'beschaeftigt' };
    }
    const topf = geraet === undefined ? 'ohne' : 'mit';
    // A large body leaves the reserve to the small ones; large is what is announced (or, without a
    // length, what the endpoint takes), so a small drop may use the reserve too.
    const reserve = bytes > KOERPER_BYTES.klein ? grenzen.koerperKleinReserveBytes : 0;
    const deckel =
      topf === 'mit' ? grenzen.koerperImFlugBytes : grenzen.koerperOhneZugangImFlugBytes;
    if (imFlugBytes[topf] + bytes > deckel - reserve) return { art: 'beschaeftigt' };
    if (
      app !== undefined &&
      (imFlugJeApp.get(app) ?? 0) + bytes > grenzen.koerperJeAppImFlugBytes - reserve
    ) {
      return { art: 'beschaeftigt' };
    }
    imFlugBytes[topf] += bytes;
    if (app !== undefined) imFlugJeApp.set(app, (imFlugJeApp.get(app) ?? 0) + bytes);
    if (geraet !== undefined) imFlugJeGeraet.set(geraet, (imFlugJeGeraet.get(geraet) ?? 0) + 1);
    let frei = false;
    return {
      freigeben: () => {
        if (frei) return;
        frei = true;
        imFlugBytes[topf] -= bytes;
        if (app !== undefined) {
          const appRest = (imFlugJeApp.get(app) ?? bytes) - bytes;
          if (appRest <= 0) imFlugJeApp.delete(app);
          else imFlugJeApp.set(app, appRest);
        }
        if (geraet === undefined) return;
        const rest = (imFlugJeGeraet.get(geraet) ?? 1) - 1;
        if (rest <= 0) imFlugJeGeraet.delete(geraet);
        else imFlugJeGeraet.set(geraet, rest);
      },
    };
  }

  return {
    vorpruefen(a) {
      const r = kopfPruefen(a);
      if (!('endpunkt' in r)) return { antwort: abschliessen(r) };
      const platz = platzNehmen(r, a.kopf['content-length']);
      if ('art' in platz) {
        return {
          antwort: abschliessen({ art: platz.art, herkunft: r.herkunft, zaehlbar: r.endpunkt }),
        };
      }
      // Counted here, once: whatever happens to the body later (408, 413, an abort, an answer).
      zaehlen(gezaehlt.anfragen, r.endpunkt);
      return { hoechstens: r.hoechstens, freigeben: platz.freigeben };
    },

    async behandeln(a) {
      const taktMs = takt();
      const r = kopfPruefen(a);
      if (!('endpunkt' in r)) return abschliessen(r);
      const { endpunkt, herkunft, hoechstens } = r;
      if (a.koerper.length > hoechstens) return fehler('zu-gross', herkunft);
      // A large body read is booked in the minute of its device and app before it is parsed.
      if (r.zugang && a.koerper.length > KOERPER_BYTES.klein) {
        const { app, geraet } = r.zugang.z;
        bytesJeGeraet.buchen(`${app}|${geraet}`, taktMs, a.koerper.length);
        bytesJeApp.buchen(app, taktMs, a.koerper.length);
      }
      // The proof of possession: a certificate alone is worth nothing. Judged with the body (it is
      // signed), and a signature is taken once within its time.
      if (r.zugang?.z.zertifikat && r.zugang.z.zertifikatText !== undefined) {
        const jetztS = Math.floor(wandJetzt() / 1000);
        const b = besitzPruefen(
          r.zugang.z.zertifikat,
          r.zugang.z.zertifikatText,
          a.kopf['x-treffpunkt-signatur'],
          a.methode,
          a.pfad,
          a.koerper,
          jetztS,
        );
        if ('fehler' in b) return fehler(b.fehler, herkunft);
        const merke = `${r.zugang.z.geraet}|${b.signatur}`;
        if (besitzGesehen.has(merke)) return fehler('besitz-ungueltig', herkunft);
        besitzGesehen.set(merke, (b.t + BESITZ_SPIELRAUM_S + 1) * 1000);
      }
      const roh = jsonLesen(a.koerper);
      if (roh === undefined) return fehler('unlesbar', herkunft);
      if (endpunkt === 'einschreiben') {
        return einschreibenBehandeln(roh, herkunft, wandJetzt(), taktMs);
      }
      if (endpunkt === 'auswertung') return auswertungBehandeln(roh, herkunft, wandJetzt(), taktMs);
      if (!r.zugang) return fehler('zugang-fehlt', herkunft);
      const pKopf = a.kopf['x-treffpunkt-p'];
      const p = pKopf !== undefined && P_KOPF.test(pKopf) ? Number(pKopf) : undefined;
      gesehen(r.zugang.z, p, wandJetzt(), taktMs);
      return mitZugang(endpunkt, roh, r.zugang, herkunft, taktMs, wandJetzt(), p !== undefined);
    },

    ablehnen(art, origin) {
      return fehler(art, bekannt(origin));
    },

    aufraeumen() {
      const taktMs = takt();
      postfach.aufraeumen(taktMs);
      for (const z of [
        anfragen,
        klingeln,
        einladen,
        einschreiben,
        eingeladen,
        bytesJeGeraet,
        bytesJeApp,
        passwortVersuche,
        sperren,
      ])
        z.aufraeumen(taktMs);
      // A used mark goes only once its `bis` is behind the floor, which never goes back: a proof is
      // judged by max(wall clock, floor), so a mark gone can never be taken again — not after the
      // clock is set back, nor after a clock that ran ahead is set right.
      const boden = untergrenze();
      for (const [marke, bis] of verbraucht) if (bis <= boden) verbraucht.delete(marke);
      for (const [marke, bis] of besitzGesehen) if (bis <= boden) besitzGesehen.delete(marke);
      for (const [scope, liste] of gesperrtListe) {
        for (const [g, bis] of liste) if (bis <= boden) liste.delete(g);
        if (liste.size === 0) gesperrtListe.delete(scope);
      }
      // A device nobody has heard from for as long as an access lives has none valid any more.
      for (const [scope, karte] of register) {
        for (const [g, e] of karte) if (taktMs - e.zuletztTakt > BIS_TAGE_MS) karte.delete(g);
        if (karte.size === 0) register.delete(scope);
      }
    },

    zaehlstand() {
      const stand = postfach.stand();
      const ergebnis: Zaehlstand = {
        anfragen: Object.fromEntries(gezaehlt.anfragen),
        fehler: Object.fromEntries(gezaehlt.fehler),
        wartend: stand.wartend,
        bytes: stand.bytes,
        marken: verbraucht.size,
        zaehlerSchluessel: [
          anfragen,
          klingeln,
          einladen,
          einschreiben,
          eingeladen,
          bytesJeGeraet,
          bytesJeApp,
          passwortVersuche,
          sperren,
        ].reduce((summe, z) => summe + z.groesse, 0),
        anwesend: stand.anwesend,
        postfaecher: stand.postfaecher,
        absender: stand.absender,
        unterwegs: imFlugJeGeraet.size,
        uhrRueckstandS: Math.max(0, Math.round((untergrenze() - u.jetzt()) / 1000)),
        geraete: [...register.values()].reduce((summe, k) => summe + k.size, 0),
        gesperrt: [...gesperrtListe.values()].reduce((summe, k) => summe + k.size, 0),
      };
      gezaehlt = { anfragen: new Map(), fehler: new Map() };
      return ergebnis;
    },
  };
}
