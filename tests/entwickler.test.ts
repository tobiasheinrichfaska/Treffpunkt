// The developer's tool: the key stays out of every repo, its tickets are what the Treffpunkt takes,
// the password entry holds a hash only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gruenderticket, imRepo, passwortEintrag, schluesselHolen } from '../scripts/entwickler.ts';
import { entwicklerLesen } from '../src/konfiguration.ts';
import { auswertungAusstellen, gruenderPruefen, passwortPasst } from '../src/zulassung.ts';

const ordner = () => mkdtempSync(join(tmpdir(), 'entwickler-'));

test('the key is made once, mode 600, and read again; never inside a git working tree', () => {
  const datei = join(ordner(), 'schluessel', 'entwickler.pem');
  const paar = schluesselHolen(datei, true);
  assert.equal(statSync(datei).mode & 0o777, 0o600);
  assert.match(paar.roh, /^[A-Za-z0-9_-]{87}$/);
  assert.equal(schluesselHolen(datei, true).roh, paar.roh, 'the same key the second time');
  assert.equal(readFileSync(datei, 'utf8').includes('PRIVATE KEY'), true);
  assert.throws(() => schluesselHolen(join(ordner(), 'neu.pem'), false), /zuerst/);
  // This repo's own folder is a working tree: the key refuses to go there.
  assert.equal(imRepo(join(import.meta.dirname, '..', 'entwickler.pem')), true);
  assert.throws(
    () => schluesselHolen(join(import.meta.dirname, '..', 'entwickler.pem'), true),
    /Repo/,
  );
});

test('a founder ticket of the tool is what the Treffpunkt takes — and only for the named app and tenant', () => {
  const paar = schluesselHolen(join(ordner(), 'k.pem'), true);
  const { schluessel } = entwicklerLesen(paar.roh, undefined);
  const t = gruenderticket(paar, 'tkd', 'schule-2', 30, 1_800_000_000);
  const g = gruenderPruefen(schluessel, t, 1_800_000_000);
  assert.ok(!('fehler' in g));
  assert.equal(g.app, 'tkd');
  assert.equal(g.mandant, 'schule-2');
  assert.equal(g.bis, 1_800_000_000 + 1800);
  assert.throws(() => gruenderticket(paar, 'TKD', '2', 30, 0), /App/);
  assert.throws(() => gruenderticket(paar, 'tkd', 'standard', 30, 0), /Mandant/);
  assert.throws(() => gruenderticket(paar, 'tkd', '2', 61, 0), /Minuten/);
  assert.equal(
    'fehler' in gruenderPruefen(schluessel, t.replace('schule-2', 'schule-3'), 1_800_000_000),
    true,
  );
  assert.equal(typeof auswertungAusstellen(paar.privat, 1), 'string');
});

test('the password entry holds the hash, the end and the count — never the text — and the Treffpunkt reads it', () => {
  const p = passwortEintrag('tkd', 'vorfuehrung', 7, 3, false, 1_800_000_000, 'invented');
  assert.equal(JSON.stringify(p.eintrag).includes('invented'), false);
  assert.equal(p.eintrag['bis'], 1_800_000_000 + 7 * 86_400);
  assert.equal(passwortPasst('invented', p.eintrag['hash'] as string), true);
  const e = entwicklerLesen(undefined, JSON.stringify([p.eintrag]));
  assert.equal(e.passwoerter[0]?.hoechstens, 3);
  const frisch = passwortEintrag('tkd', 'vorfuehrung', 7, 3, true, 0);
  assert.match(frisch.passwort, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(frisch.eintrag['auchMitGeraeten'], true);
  assert.throws(() => passwortEintrag('tkd', 'x', 0, 3, false, 0), /Tage/);
  assert.throws(() => passwortEintrag('tkd', 'x', 91, 3, false, 0), /Tage/);
  assert.throws(() => passwortEintrag('tkd', 'x', 7, 0, false, 0), /Höchstens/);
  assert.throws(() => passwortEintrag('tkd', 'standard', 7, 3, false, 0), /Mandant/);
});
