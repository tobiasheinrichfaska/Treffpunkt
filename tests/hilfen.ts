// Shared test helpers: a Treffpunkt with a clock the test moves, two apps, a login-script key pair
// and a stand-in push service. Invented data only.
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { KlingelAnfrage } from '../src/klingeln.ts';
import { appsLesen, entwicklerLesen, type Apps, type Entwickler } from '../src/konfiguration.ts';
import { besitzText } from '../src/zulassung.ts';
import { GRENZEN, type Grenzen } from '../src/grenzen.ts';
import { treffpunktAnlegen, type Antwort, type Treffpunkt } from '../src/treffpunkt.ts';

export const TKD = 'https://tkdtest.b-cdn.net';
export const AZP = 'https://azptest.b-cdn.net';
export const FREMD = 'https://boese.example';

export interface Paar {
  readonly privat: KeyObject;
  readonly roh: string;
}

export function schluesselpaar(): Paar {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const roh = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? '', 'base64url'),
    Buffer.from(jwk.y ?? '', 'base64url'),
  ]).toString('base64url');
  return { privat: privateKey, roh };
}

export function nachweis(
  paar: Paar,
  inhalt: Record<string, unknown>,
  signieren = (daten: Buffer) =>
    sign('sha256', daten, { key: paar.privat, dsaEncoding: 'ieee-p1363' }),
): string {
  const nutzlast = Buffer.from(JSON.stringify(inhalt)).toString('base64url');
  return `n1.${nutzlast}.${signieren(Buffer.from(`n1.${nutzlast}`)).toString('base64url')}`;
}

export function zufallN(): string {
  return randomBytes(16).toString('base64url');
}

export interface Aufbau {
  readonly t: Treffpunkt;
  /** `ms` moves both clocks; `wand` sets only the wall clock off (an NTP step, a host move). */
  readonly uhr: { ms: number; wand: number };
  readonly paar: Paar;
  readonly schluessel: Buffer;
  readonly apps: Apps;
  readonly gesendet: KlingelAnfrage[];
  dienst: number | Error;
}

export function aufbauen(
  optionen: {
    grenzen?: Partial<Grenzen>;
    einladenAzp?: boolean;
    gesperrt?: readonly string[];
    ohneNachweisTkd?: boolean;
    /** The monotonic clock from `uhr.ms`; by default its own epoch (as `performance.now()` has). */
    takt?: (ms: number) => number;
    stand?: string;
    /** The wall clock off by this much when the Treffpunkt starts (`uhr.wand` at the start). */
    wandStart?: number;
    /** The stand-in push service answers after this long. */
    sendenMs?: number;
    /** Tenants per app for which only the new procedure holds. */
    streng?: { tkd?: string[]; azp?: string[] };
    /** The developer's public keys and password entries (as the environment holds them). */
    entwickler?: { schluessel?: string[]; passwoerter?: unknown[] };
  } = {},
): Aufbau {
  const paar = schluesselpaar();
  const apps = appsLesen(
    JSON.stringify({
      apps: {
        tkd: {
          name: 'TKD-Trainerbuch',
          herkuenfte: [TKD],
          nachweisSchluessel: optionen.ohneNachweisTkd ? [] : [paar.roh],
          einladen: true,
          gesperrt: optionen.gesperrt ?? [],
          streng: optionen.streng?.tkd ?? [],
        },
        azp: {
          name: 'Arbeitszeitplaner',
          herkuenfte: [AZP],
          nachweisSchluessel: [paar.roh],
          einladen: optionen.einladenAzp ?? true,
          gesperrt: [],
          streng: optionen.streng?.azp ?? [],
        },
      },
    }),
  );
  const schluessel = randomBytes(32);
  const start = Date.UTC(2026, 10, 15, 12, 0, 0);
  const uhr = { ms: start, wand: optionen.wandStart ?? 0 };
  // Not the wall clock's epoch: a mix-up of the two clocks in the code shows in the tests.
  const takt = optionen.takt ?? ((ms: number) => ms - start + 5000);
  const aufbau: Aufbau = {
    paar,
    schluessel,
    apps,
    uhr,
    gesendet: [],
    dienst: 201,
    t: undefined as unknown as Treffpunkt,
  };
  const t = treffpunktAnlegen({
    schluessel,
    apps,
    jetzt: () => uhr.ms + uhr.wand,
    takt: () => takt(uhr.ms),
    ...(optionen.stand === undefined ? {} : { stand: optionen.stand }),
    grenzen: { ...GRENZEN, ...optionen.grenzen },
    entwickler: entwicklerLesen(
      optionen.entwickler?.schluessel?.join(','),
      optionen.entwickler?.passwoerter
        ? JSON.stringify(optionen.entwickler.passwoerter)
        : undefined,
    ),
    senden: async (a) => {
      aufbau.gesendet.push(a);
      if (optionen.sendenMs) await new Promise((weiter) => setTimeout(weiter, optionen.sendenMs));
      if (aufbau.dienst instanceof Error) throw aufbau.dienst;
      return aufbau.dienst;
    },
  });
  return Object.assign(aufbau, { t });
}

export interface Ergebnis {
  readonly status: number;
  readonly kopf: Readonly<Record<string, string>>;
  readonly daten: Record<string, unknown>;
}

function lesen(a: Antwort): Ergebnis {
  return {
    status: a.status,
    kopf: a.kopf,
    daten: a.koerper === '' ? {} : (JSON.parse(a.koerper) as Record<string, unknown>),
  };
}

export async function post(
  a: Aufbau,
  endpunkt: string,
  daten: unknown,
  optionen: {
    zugang?: string | undefined;
    herkunft?: string | null;
    typ?: string;
    roh?: Buffer;
    /** Send no Content-Length (as a chunked body): the head then counts the endpoint's limit. */
    ohneLaenge?: boolean;
  } = {},
): Promise<Ergebnis> {
  const koerper = optionen.roh ?? Buffer.from(JSON.stringify(daten));
  const kopf: Record<string, string | undefined> = {
    'content-type': optionen.typ ?? 'application/json',
  };
  // As a browser's fetch does for a known body.
  if (!optionen.ohneLaenge) kopf['content-length'] = String(koerper.length);
  if (optionen.herkunft !== null) kopf['origin'] = optionen.herkunft ?? TKD;
  if (optionen.zugang) kopf['authorization'] = `Bearer ${optionen.zugang}`;
  // As the HTTP layer does: the head first (it counts the request per minute), then the body.
  const kopfteil = { methode: 'POST', pfad: `/v1/${endpunkt}`, kopf };
  const vor = a.t.vorpruefen(kopfteil);
  if ('antwort' in vor) return lesen(vor.antwort);
  try {
    return lesen(await a.t.behandeln({ ...kopfteil, koerper }));
  } finally {
    vor.freigeben();
  }
}

export interface Geraet {
  readonly geraet: string;
  readonly zugang: string;
  readonly herkunft: string;
}

/** Enrols one device of `app` with a fresh proof. */
export async function einschreiben(a: Aufbau, app = 'tkd'): Promise<Geraet> {
  const herkunft = app === 'tkd' ? TKD : AZP;
  const r = await post(
    a,
    'einschreiben',
    {
      nachweis: nachweis(a.paar, {
        v: 1,
        app,
        bis: Math.floor((a.uhr.ms + a.uhr.wand) / 1000) + 300,
        n: zufallN(),
      }),
    },
    { herkunft },
  );
  if (r.status !== 201) throw new Error(`Einschreiben: ${r.status} ${JSON.stringify(r.daten)}`);
  return { geraet: r.daten['geraet'] as string, zugang: r.daten['zugang'] as string, herkunft };
}

export function inhalt(text: string): string {
  return Buffer.from(text).toString('base64url');
}

/** DER: tag, length, content. */
function der(tag: number, ...teile: Buffer[]): Buffer {
  const inhalt = Buffer.concat(teile);
  const n = inhalt.length;
  const laenge =
    n < 128
      ? Buffer.from([n])
      : n < 256
        ? Buffer.from([0x81, n])
        : Buffer.from([0x82, n >> 8, n & 255]);
  return Buffer.concat([Buffer.from([tag]), laenge, inhalt]);
}

/** A self-signed certificate (ECDSA P-256) for the names given, made here so no key lies in the
 * repo; by default for 127.0.0.1. */
export function zertifikatSelbst(
  namen: { readonly dns?: readonly string[]; readonly ip?: readonly (readonly number[])[] } = {
    ip: [[127, 0, 0, 1]],
  },
): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const seq = (...t: Buffer[]) => der(0x30, ...t);
  const ecdsaSha256 = seq(der(0x06, Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])));
  const name = seq(
    der(
      0x31,
      seq(der(0x06, Buffer.from([0x55, 0x04, 0x03])), der(0x0c, Buffer.from('treffpunkt'))),
    ),
  );
  const zeit = (t: string) => der(0x17, Buffer.from(t));
  const san = seq(
    der(0x06, Buffer.from([0x55, 0x1d, 0x11])),
    der(
      0x04,
      seq(
        ...(namen.dns ?? []).map((d) => der(0x82, Buffer.from(d))),
        ...(namen.ip ?? []).map((ip) => der(0x87, Buffer.from(ip))),
      ),
    ),
  );
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.from([1])),
    ecdsaSha256,
    name,
    seq(zeit('250101000000Z'), zeit('491231235959Z')),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    der(0xa3, seq(san)),
  );
  const unterschrift = sign('sha256', tbs, privateKey);
  const zert = seq(tbs, ecdsaSha256, der(0x03, Buffer.from([0]), unterschrift));
  const zeilen = zert.toString('base64').match(/.{1,64}/g) ?? [];
  const cert = `-----BEGIN CERTIFICATE-----\n${zeilen.join('\n')}\n-----END CERTIFICATE-----\n`;
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), cert };
}

/** A device with a key pair of its own, as the app holds one (`lib/abgleich/schluessel.js`). */
export interface Neugeraet {
  readonly paar: Paar;
  /** What the device sends and signs with: set after enrolling. */
  geraet?: string | undefined;
  zertifikat?: string | undefined;
  zugang?: string | undefined;
  mandant?: string | undefined;
  rolle?: string | undefined;
}

export function neuesGeraet(): Neugeraet {
  return { paar: schluesselpaar() };
}

export interface NeuOptionen {
  readonly herkunft?: string | null;
  /** Sign with another key, a stale time or leave out the signature. */
  readonly signatur?: 'keine' | 'fremd' | { t: number };
  readonly p?: number;
  readonly roh?: Buffer;
}

/** A request of a device with a certificate: the header carries the certificate (`Bearer c1.…`) and
 * the signature over method, path, time, body and certificate. */
export async function postNeu(
  a: Aufbau,
  g: Neugeraet,
  endpunkt: string,
  daten: unknown,
  o: NeuOptionen = {},
): Promise<Ergebnis> {
  const koerper = o.roh ?? Buffer.from(JSON.stringify(daten));
  const pfad = `/v1/${endpunkt}`;
  const zert = g.zertifikat ?? '';
  const t =
    typeof o.signatur === 'object' ? o.signatur.t : Math.floor((a.uhr.ms + a.uhr.wand) / 1000);
  const kopf: Record<string, string | undefined> = {
    'content-type': 'application/json',
    'content-length': String(koerper.length),
    authorization: `Bearer ${zert}`,
  };
  if (o.herkunft !== null) kopf['origin'] = o.herkunft ?? TKD;
  if (o.p !== undefined) kopf['x-treffpunkt-p'] = String(o.p);
  if (o.signatur !== 'keine') {
    const key = o.signatur === 'fremd' ? schluesselpaar().privat : g.paar.privat;
    const sig = sign('sha256', Buffer.from(besitzText('POST', pfad, t, koerper, zert)), {
      key,
      dsaEncoding: 'ieee-p1363',
    });
    kopf['x-treffpunkt-signatur'] = `${t}.${sig.toString('base64url')}`;
  }
  const kopfteil = { methode: 'POST', pfad, kopf };
  const vor = a.t.vorpruefen(kopfteil);
  if ('antwort' in vor) return lesen(vor.antwort);
  try {
    return lesen(await a.t.behandeln({ ...kopfteil, koerper }));
  } finally {
    vor.freigeben();
  }
}

/** Enrols `g` with a proof of the login script (legacy trust) and asks for a certificate. */
export async function einschreibenMitSchluessel(
  a: Aufbau,
  g: Neugeraet,
  zusatz: Record<string, unknown> = {},
  app = 'tkd',
): Promise<Ergebnis> {
  const herkunft = app === 'tkd' ? TKD : AZP;
  const r = await post(
    a,
    'einschreiben',
    {
      nachweis: nachweis(a.paar, {
        v: 1,
        app,
        bis: Math.floor((a.uhr.ms + a.uhr.wand) / 1000) + 300,
        n: zufallN(),
      }),
      geraetSchluessel: g.paar.roh,
      ...zusatz,
    },
    { herkunft },
  );
  merken(g, r);
  return r;
}

/** Writes what an enrolment answered into the device. */
export function merken(g: Neugeraet, r: Ergebnis): void {
  if (r.status !== 201) return;
  g.geraet = r.daten['geraet'] as string;
  g.zertifikat = r.daten['zertifikat'] as string | undefined;
  g.zugang = r.daten['zugang'] as string | undefined;
  g.mandant = r.daten['mandant'] as string | undefined;
  g.rolle = r.daten['rolle'] as string | undefined;
}

/** A developer: a key pair whose public part the Treffpunkt knows. */
export function entwicklerPaar(): Paar {
  return schluesselpaar();
}

export type { Entwickler };
