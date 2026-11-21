// `npm run entwickler -- <befehl>`: the developer's own tool (Tobias, on his PC — never in a cloud
// session, never in a repo). It holds the private signing key; the Treffpunkt knows only the public
// part (TREFFPUNKT_ENTWICKLER_SCHLUESSEL at bunny).
//
//   schluessel                      makes the key pair once (a file outside every repo), prints the
//                                   public part for bunny
//   gruenderticket --app tkd --mandant 2 [--minuten 60]
//                                   a one-time ticket for a first device (office role)
//   passwort --app tkd --mandant 2 --tage 7 --hoechstens 3 [--auch-mit-geraeten]
//                                   makes a password and the entry for TREFFPUNKT_ENTWICKLER_PASSWOERTER
//                                   (only the hash goes to bunny; the text is shown once, here)
//   auswertung --host https://…     asks the evaluation: devices per app and tenant, old or new
//
// The key file is `--datei` or `TREFFPUNKT_ENTWICKLER_DATEI`, else `~/.treffpunkt/entwickler.pem`.
import { createPrivateKey, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, MANDANT } from '../src/eingabe.ts';
import { auswertungAusstellen, gruenderAusstellen, passwortHash } from '../src/zulassung.ts';

export interface Schluesselpaar {
  readonly privat: KeyObject;
  /** The public key, raw (87 characters base64url): what the Treffpunkt is given. */
  readonly roh: string;
}

function rohAus(privat: KeyObject): string {
  const jwk = privat.export({ format: 'jwk' });
  return Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? '', 'base64url'),
    Buffer.from(jwk.y ?? '', 'base64url'),
  ]).toString('base64url');
}

/** Whether `pfad` lies in a git working tree (a `.git` in it or above): the key must not. */
export function imRepo(pfad: string): boolean {
  let ordner = dirname(resolve(pfad));
  for (;;) {
    if (existsSync(join(ordner, '.git'))) return true;
    const oben = dirname(ordner);
    if (oben === ordner) return false;
    ordner = oben;
  }
}

/** Reads the key file, or makes it (mode 600) when it is not there yet. */
export function schluesselHolen(pfad: string, erzeugen: boolean): Schluesselpaar {
  if (imRepo(pfad)) throw new Error('Der Schlüssel gehört nicht in ein Repo: andere Datei wählen.');
  if (!existsSync(pfad)) {
    if (!erzeugen) throw new Error('Noch kein Schlüssel: zuerst „schluessel“ aufrufen.');
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    chmodSync(pfad, 0o600);
  }
  const privat = createPrivateKey(readFileSync(pfad, 'utf8'));
  return { privat, roh: rohAus(privat) };
}

export function gruenderticket(
  paar: Schluesselpaar,
  app: string,
  mandant: string,
  minuten: number,
  jetztS: number,
): string {
  if (!APP.test(app)) throw new Error('App ungültig');
  if (!MANDANT.test(mandant)) throw new Error('Mandant ungültig (a–z, 0–9, -, nicht „standard“)');
  if (!Number.isInteger(minuten) || minuten < 1 || minuten > 60) {
    throw new Error('Minuten: 1 bis 60');
  }
  return gruenderAusstellen(paar.privat, { app, mandant, bis: jetztS + minuten * 60 });
}

export function passwortEintrag(
  app: string,
  mandant: string,
  tage: number,
  hoechstens: number,
  auchMitGeraeten: boolean,
  jetztS: number,
  passwort = randomBytes(12).toString('base64url'),
): { readonly passwort: string; readonly eintrag: Record<string, unknown> } {
  if (!APP.test(app) || !MANDANT.test(mandant)) throw new Error('App oder Mandant ungültig');
  if (!Number.isInteger(tage) || tage < 1 || tage > 90) throw new Error('Tage: 1 bis 90');
  if (!Number.isInteger(hoechstens) || hoechstens < 1 || hoechstens > 1000) {
    throw new Error('Höchstens: 1 bis 1000');
  }
  return {
    passwort,
    eintrag: {
      app,
      mandant,
      hash: passwortHash(passwort),
      bis: jetztS + tage * 86_400,
      hoechstens,
      ...(auchMitGeraeten ? { auchMitGeraeten: true } : {}),
    },
  };
}

function optionen(argv: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a?.startsWith('--')) throw new Error(`Unbekannt: ${a}`);
    const naechste = argv[i + 1];
    if (naechste === undefined || naechste.startsWith('--')) m.set(a.slice(2), 'ja');
    else {
      m.set(a.slice(2), naechste);
      i += 1;
    }
  }
  return m;
}

async function main(): Promise<void> {
  const [befehl, ...rest] = process.argv.slice(2);
  const o = optionen(rest);
  const datei =
    o.get('datei') ??
    process.env['TREFFPUNKT_ENTWICKLER_DATEI'] ??
    join(homedir(), '.treffpunkt', 'entwickler.pem');
  const jetztS = Math.floor(Date.now() / 1000);
  const zahl = (name: string, vorgabe: number) => Number(o.get(name) ?? vorgabe);
  if (befehl === 'schluessel') {
    const paar = schluesselHolen(datei, true);
    console.log(
      `Schlüsseldatei: ${datei} (nur auf diesem PC, nie in ein Repo, nie in eine Sitzung)`,
    );
    console.log('Öffentlicher Teil, bei bunny eintragen und ausrollen:');
    console.log(`TREFFPUNKT_ENTWICKLER_SCHLUESSEL=${paar.roh}`);
  } else if (befehl === 'gruenderticket') {
    const paar = schluesselHolen(datei, false);
    const t = gruenderticket(
      paar,
      o.get('app') ?? '',
      o.get('mandant') ?? '',
      zahl('minuten', 60),
      jetztS,
    );
    console.log(t);
  } else if (befehl === 'passwort') {
    const p = passwortEintrag(
      o.get('app') ?? '',
      o.get('mandant') ?? '',
      zahl('tage', 7),
      zahl('hoechstens', 3),
      o.has('auch-mit-geraeten'),
      jetztS,
      o.get('text'),
    );
    console.log(`Passwort (nur hier zu sehen, weitergeben): ${p.passwort}`);
    console.log(
      'Eintrag für TREFFPUNKT_ENTWICKLER_PASSWOERTER (eine Liste, alle Einträge zusammen):',
    );
    console.log(JSON.stringify([p.eintrag]));
  } else if (befehl === 'auswertung') {
    const host = o.get('host');
    if (!host?.startsWith('https://') && !host?.startsWith('http://127.0.0.1')) {
      throw new Error('--host https://… fehlt');
    }
    const paar = schluesselHolen(datei, false);
    const antwort = await fetch(`${host}/v1/auswertung`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: auswertungAusstellen(paar.privat, jetztS + 300) }),
    });
    console.log(JSON.stringify(await antwort.json(), null, 2));
  } else {
    console.log('npm run entwickler -- schluessel | gruenderticket | passwort | auswertung');
    process.exitCode = befehl === undefined ? 0 : 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : 'Fehler');
    process.exitCode = 1;
  });
}
