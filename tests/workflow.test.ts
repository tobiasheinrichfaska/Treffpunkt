// The rules of the check „Tests“ (.github/workflows/tests.yml), read as text (no YAML parser among
// Node's modules): only a job that runs for a push to main may write the package, Freigabe finds the
// check runs „Tests“ and „Image“, and every action is pinned by its commit. The reader is checked
// against edits that must fail and edits that must pass.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const DATEI = readFileSync(new URL('../.github/workflows/tests.yml', import.meta.url), 'utf8');
/** The only conditions under which a job may write the package, written exactly so. */
const NUR_MAIN = [
  "github.event_name == 'push' && github.ref == 'refs/heads/main'",
  "github.ref == 'refs/heads/main' && github.event_name == 'push'",
];

/** A line without its comment (a `#` at the start or after a space) and without quotes, so that
 * `packages: 'write'` reads like `packages: write` and `name: "Image"` like `name: Image`. */
const normal = (zeile: string): string =>
  zeile
    .replace(/(^|\s)#.*$/, '')
    .replace(/["']/g, '')
    .trimEnd();

/** A line without its comment only, quotes kept (for the exact condition). */
const ohneKommentar = (zeile: string): string => zeile.replace(/(^|\s)#.*$/, '').trimEnd();

function zeilen(text: string, roh = false): string[] {
  return text
    .split('\n')
    .map(roh ? ohneKommentar : normal)
    .filter((z) => z.trim() !== '');
}

function jobs(text: string, roh = false): Map<string, string[]> {
  const alle = zeilen(text, roh);
  const start = alle.indexOf('jobs:');
  const ergebnis = new Map<string, string[]>();
  if (start < 0) return ergebnis;
  let aktuell: string[] | undefined;
  for (const zeile of alle.slice(start + 1)) {
    const kopf = /^ {2}["']?([A-Za-z0-9_-]+)["']?:$/.exec(zeile);
    if (kopf?.[1]) {
      aktuell = [];
      ergebnis.set(kopf[1], aktuell);
    } else if (/^\S/.test(zeile)) {
      break;
    } else {
      aktuell?.push(zeile);
    }
  }
  return ergebnis;
}

/** The value of a key of the job itself (four spaces in), not of one of its steps. */
const wert = (job: readonly string[], schluessel: string): string | undefined =>
  job
    .find((z) => z.startsWith(`    ${schluessel}:`))
    ?.slice(`    ${schluessel}:`.length)
    .trim();

/** Fail closed: `write-all`, or `packages` with any value but plain `read` or `none` (a value on
 * the next line, a block scalar, a tag, an escape — whatever YAML might turn into „write“). */
const schreibt = (z: readonly string[]): boolean =>
  z.some(
    (zeile) =>
      /\bwrite-all\b/.test(zeile) ||
      [...zeile.matchAll(/\bpackages\s*:\s*([^,}]*)/g)].some(
        (m) => !['read', 'none'].includes((m[1] ?? '').trim()),
      ),
  );

/** The job's condition exactly as allowed (quotes kept), optionally in `${{ }}`. */
function nurMain(rohJob: readonly string[]): boolean {
  const bedingung = wert(rohJob, 'if')?.replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1');
  return bedingung !== undefined && NUR_MAIN.includes(bedingung);
}

/** What breaks the rules; empty when the file is fine. */
function verstoesse(text: string): string[] {
  const fehler: string[] = [];
  const alle = zeilen(text);
  const oben = alle.indexOf('permissions:');
  const obenBlock: string[] = [];
  if (oben >= 0) {
    for (const z of alle.slice(oben + 1)) {
      if (/^\S/.test(z)) break;
      obenBlock.push(z.trim());
    }
  }
  if (JSON.stringify(obenBlock) !== JSON.stringify(['contents: read'])) {
    fehler.push('oben: permissions nicht genau contents: read');
  }
  if (alle.some((z) => /^permissions:\s*\S/.test(z))) fehler.push('oben: permissions als Wert');
  const alleJobs = jobs(text);
  const roheJobs = jobs(text, true);
  let schreibende = 0;
  const namen = new Map<string, { job: string[]; roh: string[] }>();
  for (const [name, job] of alleJobs) {
    const roh = roheJobs.get(name) ?? [];
    const anzeige = wert(job, 'name');
    if (anzeige) namen.set(anzeige, { job, roh });
    if (!schreibt(job)) continue;
    schreibende += 1;
    if (!nurMain(roh)) fehler.push(`${name}: darf schreiben, läuft aber nicht nur für main`);
  }
  if (schreibende !== 1) fehler.push(`${schreibende} Jobs dürfen das Paket schreiben`);
  if (!namen.has('Tests')) fehler.push('kein Check-Run „Tests“');
  const imageEintrag = namen.get('Image');
  const image = imageEintrag?.job;
  if (!imageEintrag || !nurMain(imageEintrag.roh) || !schreibt(imageEintrag.job))
    fehler.push('„Image“ fehlt oder nicht nur main');
  if (image && wert(image, 'needs')?.replace(/[[\]\s]/g, '') !== 'pruefen') {
    fehler.push('„Image“ wartet nicht auf „Tests“');
  }
  for (const z of text.split('\n').filter((x) => /\buses\s*:/.test(normal(x)))) {
    if (!/^\s*-?\s*uses: [\w./-]+@[0-9a-f]{40} # v/.test(z)) {
      fehler.push(`nicht gepinnt: ${z.trim()}`);
    }
  }
  // A `#` in a job's condition could hide the rest of it from this reader: not allowed.
  for (const z of text.split('\n')) {
    if (/^ {4}if:/.test(z) && z.includes('#')) fehler.push(`# in einer Bedingung: ${z.trim()}`);
  }
  // A job's rights only in the plain block form: every line `key: read|write|none`, the key a bare
  // word (no quotes, escapes, explicit `?` keys or inline maps the reader might misread).
  for (const [name, roh] of roheJobs) {
    // Every key of the job itself a bare word: a quoted or escaped `permissions` would slip past.
    for (const z of roh.filter((x) => /^ {4}\S/.test(x))) {
      if (!/^ {4}[a-z-]+:( |$)/.test(z)) fehler.push(`${name}: Schlüssel ${z.trim()}`);
    }
    // A value on the key's own line ends there: a continued `if` would hide its second half.
    roh.forEach((z, i) => {
      const naechste = roh[i + 1];
      if (/^ {4}[a-z-]+:\s*\S/.test(z) && naechste !== undefined && /^ {5,}/.test(naechste)) {
        fehler.push(`${name}: Wert geht weiter nach ${z.trim()}`);
      }
    });
    const start = roh.findIndex((z) => /^ {4}permissions:/.test(z));
    if (start < 0) continue;
    if (roh[start]?.trim() !== 'permissions:') {
      fehler.push(`${name}: permissions nicht als Block`);
      continue;
    }
    for (const z of roh.slice(start + 1)) {
      if (!/^ {6}/.test(z)) break;
      if (!/^ {6}[a-z-]+: (read|write|none)$/.test(z))
        fehler.push(`${name}: Rechte-Zeile ${z.trim()}`);
    }
  }
  // No key anywhere under `jobs:` quoted or escaped (a step's `uses` too).
  for (const z of zeilen(text, true).slice(zeilen(text, true).indexOf('jobs:') + 1)) {
    if (/^\s*(-\s+)?["'][^"']*["']\s*:/.test(z) || /^\s*(-\s+)?[^\s:]*\\[^\s:]*\s*:/.test(z)) {
      fehler.push(`Schlüssel mit Anführung oder Escape: ${z.trim()}`);
    }
  }
  // Only plain forms under `jobs:`: every job a bare key of its own, no anchors or aliases (they
  // could hand one job's rights to another unseen), no flow mappings for jobs.
  const unterJobs = alle.slice(alle.indexOf('jobs:') + 1);
  for (const z of unterJobs) {
    if (/^ {2}\S/.test(z) && !/^ {2}[A-Za-z0-9_-]+:$/.test(z)) fehler.push(`Job-Form: ${z.trim()}`);
    if (/(^|[\s:,[{-])[&*][A-Za-z0-9_-]/.test(z) || /<<\s*:/.test(z)) {
      fehler.push(`Anker oder Verweis: ${z.trim()}`);
    }
  }
  return fehler;
}

function geaendert(alt: string, neu: string): string {
  assert.equal(DATEI.split(alt).length, 2, `nicht genau einmal: ${alt}`);
  return DATEI.replace(alt, neu);
}

const PROBE_RECHTE =
  '    permissions:\n      contents: read\n    env:\n      IMAGE: treffpunkt-probe';

test('the check „Tests“ keeps its rules: only „Image“ on main writes the package', () => {
  assert.deepEqual(verstoesse(DATEI), []);
});

test('the rules catch every way to let a pull-request job write the package', () => {
  for (const falsch of [
    geaendert(PROBE_RECHTE, '    permissions: write-all\n    env:\n      IMAGE: treffpunkt-probe'),
    geaendert(
      PROBE_RECHTE,
      '    permissions: { contents: read, packages: write }\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      contents: read\n      packages: write # Cache\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert(
      PROBE_RECHTE,
      '# Rechte\n    permissions:\n      packages: write\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert('permissions:\n  contents: read\n', 'permissions: write-all\n'),
    geaendert(
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      "    if: github.event_name == 'push' || github.ref == 'refs/heads/main'",
    ),
    geaendert(
      '    needs: pruefen\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    permissions:\n      contents: read\n      packages: write',
      '    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    permissions:\n      contents: read\n      packages: write',
    ),
    geaendert(
      PROBE_RECHTE,
      `    permissions:\n      packages: 'write'\n    env:\n      IMAGE: treffpunkt-probe`,
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      packages: "write"\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert(
      '    permissions:\n      contents: read\n      packages: write',
      '    permissions: &rechte\n      contents: read\n      packages: write',
    ) +
      "  boese:\n    if: github.event_name == 'pull_request'\n    runs-on: ubuntu-latest\n    permissions: *rechte\n    steps:\n      - run: echo\n",
    DATEI +
      '  "boese":\n    if: github.event_name == \'pull_request\'\n    runs-on: ubuntu-latest\n    permissions:\n      packages: write\n    steps:\n      - run: echo\n',
    DATEI +
      '  boese: { if: "github.event_name == \'pull_request\'", runs-on: ubuntu-latest, permissions: write-all, steps: [{ run: echo }] }\n',
    geaendert(
      '    env:\n      IMAGE: treffpunkt-probe\n    steps:\n',
      '    env:\n      IMAGE: treffpunkt-probe\n    steps:\n      - { uses: actions/cache@v4 }\n',
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      contents: read\n      packages:\n        write\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert(
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      `    if: "github.event_name == 'push' && github.ref == 'refs/heads/main' && ' #' || github.event_name == 'pull_request'"`,
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      packages: >-\n        write\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      packages: |-\n        write\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      packages: !!str write\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      packages: "wr\\x69te"\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert(
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      `    if: "'github.event_name == push && github.ref == refs/heads/main'"`,
    ),
    geaendert(
      '    env:\n      IMAGE: treffpunkt-probe\n    steps:\n',
      '    env:\n      IMAGE: treffpunkt-probe\n    steps:\n      - uses : actions/cache@v4\n',
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      contents: read\n      "pack\\x61ges": write\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      contents: read\n      ? packages\n      : write\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      "packages": write\n    env:\n      IMAGE: treffpunkt-probe',
    ),
    DATEI +
      '  boese:\n    runs-on: ubuntu-latest\n    \'permissions\':\n      "pack\\x61ges": write\n    steps:\n      - run: echo\n',
    DATEI +
      '  boese:\n    runs-on: ubuntu-latest\n    \'permissions\': "write-\\x61ll"\n    steps:\n      - run: echo\n',
    DATEI +
      '  boese:\n    runs-on: ubuntu-latest\n    "perm\\x69ssions":\n      packages: write\n    steps:\n      - run: echo\n',
    geaendert(
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n",
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n      || github.event_name == 'pull_request'\n",
    ),
    geaendert(
      '    env:\n      IMAGE: treffpunkt-probe\n    steps:\n',
      '    env:\n      IMAGE: treffpunkt-probe\n    steps:\n      - "u\\x73es": actions/cache@v4\n',
    ),
  ]) {
    assert.notDeepEqual(verstoesse(falsch), [], falsch);
  }
});

test('harmless edits keep the rules: comments, the order of the condition', () => {
  for (const harmlos of [
    geaendert('      packages: write\n', '      packages: write # ghcr.io\n'),
    geaendert(
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      "    if: github.ref == 'refs/heads/main' && github.event_name == 'push'",
    ),
    geaendert('permissions:\n  contents: read\n', 'permissions:\n  contents: read # nur lesen\n'),
    geaendert(
      '    needs: pruefen\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    permissions:\n      contents: read\n      packages: write',
      '    needs: [pruefen]\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    permissions:\n      contents: read\n      packages: write',
    ),
    geaendert('    name: Image\n', "    name: 'Image'\n"),
    geaendert('    name: Tests\n', '    name: "Tests"\n'),
    geaendert(
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      "    if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
    ),
    geaendert(
      PROBE_RECHTE,
      '    permissions:\n      contents: read\n      packages: none\n    env:\n      IMAGE: treffpunkt-probe',
    ),
  ]) {
    assert.deepEqual(verstoesse(harmlos), [], harmlos);
  }
});
