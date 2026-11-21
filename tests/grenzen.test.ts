// The limits: the sliding-window counter, and the table in docs/schnittstelle.md says exactly what
// src/grenzen.ts holds (CLAUDE.md: change both together).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { GRENZEN, zaehlerAnlegen } from '../src/grenzen.ts';

test('the counter allows so many per window and key; tidying up keeps what is in the window', () => {
  const z = zaehlerAnlegen(2, 60_000);
  assert.equal(z.erlaubt('a', 0), true);
  assert.equal(z.erlaubt('a', 1000), true);
  assert.equal(z.erlaubt('b', 1000), true);
  z.aufraeumen(2000);
  assert.equal(z.erlaubt('a', 3000), false);
  assert.equal(z.groesse, 2);
  assert.equal(z.erlaubt('a', 60_000), true);
  z.aufraeumen(200_000);
  assert.equal(z.groesse, 0);
});

test('a counter costs the same per call, however many events its window holds', () => {
  // One app's minute with 50 000 requests in it: then 20 000 more calls of voll + erlaubt. Scanning
  // the window each time would be 2·10⁹ steps (seconds); with a running sum it is milliseconds.
  const z = zaehlerAnlegen(Number.MAX_SAFE_INTEGER, 60_000);
  for (let i = 0; i < 50_000; i++) z.buchen('app', i / 10, 2);
  const beginn = performance.now();
  for (let i = 0; i < 20_000; i++) {
    z.voll('app', 5000 + i / 10, 2);
    z.erlaubt('app', 5000 + i / 10, 2);
  }
  const dauer = performance.now() - beginn;
  assert.ok(dauer < 1000, `${Math.round(dauer)} ms`);
  // The running sum is right after the old events left: a minute after the last, none counts.
  const w = zaehlerAnlegen(10, 60_000);
  for (let i = 0; i < 2000; i++) w.buchen('a', i, 1);
  assert.equal(w.voll('a', 61_000, 10), true);
  assert.equal(w.voll('a', 62_000, 10), false);
  assert.equal(w.voll('a', 62_000, 11), true);
  assert.equal(w.erlaubt('a', 62_000, 10), true);
  assert.equal(w.erlaubt('a', 62_001, 1), false);
});

test('a counter of bytes: the weight of the window, up to its edge; asking counts nothing', () => {
  const z = zaehlerAnlegen(10, 60_000);
  assert.equal(z.voll('a', 0, 10), false);
  assert.equal(z.voll('a', 0, 11), true);
  assert.equal(z.erlaubt('a', 0, 6), true);
  assert.equal(z.voll('a', 1000, 4), false);
  assert.equal(z.erlaubt('a', 1000, 5), false);
  assert.equal(z.erlaubt('a', 1000, 4), true);
  assert.equal(z.erlaubt('a', 2000, 1), false);
  // The first 6 leave the window: room for 6 again, not 7.
  assert.equal(z.erlaubt('a', 60_000, 7), false);
  assert.equal(z.erlaubt('a', 60_000, 6), true);
});

const MB = 1_048_576;

test('the table of limits in docs/schnittstelle.md is what src/grenzen.ts holds', () => {
  const text = readFileSync(new URL('../docs/schnittstelle.md', import.meta.url), 'utf8');
  const abschnitt = text.split('## Grenzen im Arbeitsspeicher')[1]?.split('\n## ')[0] ?? '';
  const tabelle = new Map<string, string>();
  for (const zeile of abschnitt.split('\n')) {
    const m = /^\| ([^|]+) \| ([^|]+) \|$/.exec(zeile);
    if (m?.[1] && m[2] && m[1] !== 'Grenze' && !m[1].startsWith('---')) {
      tabelle.set(m[1].trim(), m[2].trim());
    }
  }
  const g = GRENZEN;
  const je = (ms: number) => (ms === 60_000 ? 'Minute' : ms === 3_600_000 ? 'Stunde' : `${ms} ms`);
  // Every limit of GRENZEN has its row: a new limit without a row fails here.
  const zeilen: Record<keyof typeof GRENZEN, [string, string]> = {
    wartezeitMs: ['Wartezeit einer Nachricht', `${g.wartezeitMs / 1000} s`],
    anwesendMs: ['Anwesend nach dem letzten Abholen', `${g.anwesendMs / 1000} s`],
    nachrichtBytes: ['Nachricht', `${g.nachrichtBytes / 1024} KB`],
    nachrichtMindestBytes: [
      'Jede Nachricht zählt mindestens',
      `${g.nachrichtMindestBytes / 1024} KB`,
    ],
    empfaengerJeAblegen: ['Empfänger je Ablegen', `${g.empfaengerJeAblegen}`],
    jeEmpfaengerAnzahl: [
      'Postfach je Empfänger',
      `${g.jeEmpfaengerAnzahl} Nachrichten, ${g.jeEmpfaengerBytes / MB} MB`,
    ],
    jeEmpfaengerBytes: [
      'Postfach je Empfänger',
      `${g.jeEmpfaengerAnzahl} Nachrichten, ${g.jeEmpfaengerBytes / MB} MB`,
    ],
    jeAbsenderBytes: ['Wartendes je Absender', `${g.jeAbsenderBytes / MB} MB`],
    jeAppBytes: ['Wartendes je App', `${g.jeAppBytes / MB} MB`],
    gesamtBytes: ['Wartendes gesamt', `${g.gesamtBytes / MB} MB`],
    abholenBytes: ['Je Abholen', `${g.abholenBytes / MB} MB`],
    anwesendFragen: ['Anwesenheit fragen', `${g.anwesendFragen} Kennungen`],
    anfragenJeMinute: ['Anfragen je Gerät', `${g.anfragenJeMinute} je ${je(g.minuteMs)}`],
    // The windows are named by the rows that use them.
    minuteMs: ['Anfragen je Gerät', `${g.anfragenJeMinute} je ${je(g.minuteMs)}`],
    stundeMs: ['Klingeln je Gerät', `${g.klingelnJeStunde} je ${je(g.stundeMs)}`],
    klingelnJeStunde: ['Klingeln je Gerät', `${g.klingelnJeStunde} je ${je(g.stundeMs)}`],
    einladenJeStunde: ['Einladungen je Gerät', `${g.einladenJeStunde} je ${je(g.stundeMs)}`],
    einschreibenJeStunde: [
      'Einschreiben je App mit Nachweis',
      `${g.einschreibenJeStunde} je ${je(g.stundeMs)}`,
    ],
    einschreibenEinladungJeStunde: [
      'Einschreiben je App mit Einladung',
      `${g.einschreibenEinladungJeStunde} je ${je(g.stundeMs)}`,
    ],
    geraeteJeMandant: ['Geräte je App und Mandant', `${g.geraeteJeMandant}`],
    geraeteGesamt: ['Geräte gesamt', `${g.geraeteGesamt}`],
    sperrenJeStunde: ['Sperren je Gerät', `${g.sperrenJeStunde} je ${je(g.stundeMs)}`],
    sperrlisteJeMandant: ['Sperrliste je App und Mandant', `${g.sperrlisteJeMandant}`],
    passwortVersucheJeStunde: [
      'Entwicklerpasswort-Versuche je App',
      `${g.passwortVersucheJeStunde} je ${je(g.stundeMs)}`,
    ],
    koerperJeGeraetImFlug: ['Körper unterwegs je Gerät', `${g.koerperJeGeraetImFlug}`],
    koerperImFlugBytes: ['Körper unterwegs mit Zugang', `${g.koerperImFlugBytes / MB} MB`],
    koerperJeAppImFlugBytes: ['Körper unterwegs je App', `${g.koerperJeAppImFlugBytes / MB} MB`],
    koerperKleinReserveBytes: [
      'Davon frei für kleine Körper',
      `${g.koerperKleinReserveBytes / MB} MB`,
    ],
    koerperOhneZugangImFlugBytes: [
      'Körper unterwegs ohne Zugang',
      `${g.koerperOhneZugangImFlugBytes / MB} MB`,
    ],
    koerperBytesJeGeraetMinute: [
      'Körper je Gerät',
      `${g.koerperBytesJeGeraetMinute / MB} MB je ${je(g.minuteMs)}`,
    ],
    koerperBytesJeAppMinute: [
      'Körper je App',
      `${g.koerperBytesJeAppMinute / MB} MB je ${je(g.minuteMs)}`,
    ],
  };
  assert.deepEqual(Object.keys(zeilen).sort(), Object.keys(GRENZEN).sort());
  assert.deepEqual(Object.fromEntries(tabelle), Object.fromEntries(Object.values(zeilen)));
});
