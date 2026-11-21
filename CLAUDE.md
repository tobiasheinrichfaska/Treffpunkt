# CLAUDE.md — Treffpunkt

## Project overview

Created 2026-11-15 on request of a Claude Code on the web session: „Leg bitte ein privates Repo an,
zum Beispiel tobiasheinrichfaska/Treffpunkt“. Public on GitHub as `tobiasheinrichfaska/Treffpunkt` since 2026-11-21 (the earlier private repo, with its history, is archived as `Treffpunkt-archiv`).

**Edited in Claude Code on the web.**

Licence: AGPL-3.0 plus commercial licence, as in Tobias' other public repos (`LICENSE`, `LICENSE_COMMERCIAL.md`).

**Purpose:** one general Treffpunkt (relay) for several of Tobias' apps, first the TKD-Trainerbuch
(`tkd`), later the Arbeitszeitplaner (`azp`). It hands end-to-end encrypted messages from device to
device and passes a finished, content-free push on to a push service when a device rings another.
It runs as a Node process in a **bunny Magic Container** (one EU region, exactly one instance) behind
a pull zone of its own, in Tobias' private bunny account. Test phase: invented data, own test devices
only. Plan and every decision: `docs/plan.md` (German).

**Decided (Tobias 2026-11-15)**, details and reasons in `docs/plan.md` § 2:
- protocol „Weg A“: short requests only (drop, collect); a message waits at most ~30 s, **in RAM
  only**, and is deleted when collected; the same protocol must also fit plain PHP hosting later;
- one instance for all apps, separated inside: every device gets its app at enrolment, messages only
  between devices of the same app, no directory, limits and allowed origins per app;
- ringing checked as strictly as `php/hub/treffpunkt.php` of the Trainerbuch (known push services
  only, ≤ 60 per device and hour, only the push service's status goes back);
- devices are **enrolled anew** (nothing moves over from the IONOS Treffpunkt, which is switched
  off);
- the enrolment proof is a short-lived **signed proof from the login script** of the repo
  `Testumgebung` (ECDSA, the Treffpunkt holds only the public key);
- the container image stays **private** in the GitHub Container Registry (Tobias changed this on
  2026-11-15 from „public“): bunny pulls it with a classic GitHub token (`read:packages`,
  `read:org` only), entered by Tobias at bunny as an image registry; it never expires (Tobias
  2026-11-15);
- a device may also be enrolled by **QR from an enrolled device** (Trainerbuch: a trainer's device,
  Arbeitszeitplaner: an office device) — endpoint `einladen`, 10 minutes, once;
- Node only with its built-in modules, no framework; Node 24; region Frankfurt; a CDN endpoint (it is
  a pull zone already), no Anycast IP; hostname = what bunny gives the endpoint (defaults of this
  session, valid until Tobias says otherwise).

**Rule (Tobias 2026-11-15): everything is documented in this repo**, also what Claude in Chrome sets
up at bunny: the target state in `docs/bunny-einrichtung.md` first, Chrome sets only what is written
there, its report goes shortened into `docs/bunny-protokoll.md`. Code that runs at bunny comes only
from files of this repo.

## Deployment: through the repo `Freigabe`

Tobias decided on 2026-11-15:
- the project is deployed through `Freigabe`, started by hand;
- it has **no test area**, so there is a live target only.

`Freigabe` is never attached to a cloud session. The administration PC adds the entry once this section says:

| Needed by `Freigabe` | Fill in |
|---|---|
| What goes to bunny: static files into a storage zone, an Edge Script (like the login of `Testumgebung`), or both | **Neither: a container image for a bunny Magic Container** (one EU region, exactly one instance, its own pull zone). Freigabe has to learn this kind; the brief for the administration PC: `docs/freigabe-auftrag.md` |
| Which bunny account: the one with the zones of other projects, or a separate one | Separate (not the account in which other projects' zones live) |
| Build: npm script and the files it produces (paths in this repo) | No npm build: the GitHub check „Tests“ (`.github/workflows/tests.yml`, job „Tests“ then job „Image“, which runs only for a push to `main`; on a PR „Image-Probe“ builds without pushing) builds the image from `Dockerfile` (`package.json`, `src/`, `konfiguration/`) and, on `main`, pushes `ghcr.io/tobiasheinrichfaska/treffpunkt:<commit>`. Freigabe sets that tag at bunny: `docs/freigabe-auftrag.md` |
| Node version | 24 |
| Data or config from a private companion repo that the build needs | None. The Treffpunkt's secret (token key) is an environment variable at bunny, never in a repo |

Rules for every app in `Freigabe`, so plan for them from the start:
- **A GitHub check named „Tests“**: `.github/workflows/tests.yml` with `name: Tests`, on every push to
  main and on pull requests. The upload waits until it is green for exactly that commit.
- **No secrets in this repo.** Keys and passwords live only as secrets of `Freigabe` or at bunny.
- **Only what changed is uploaded.** The run lists the files with their SHA-256; a file that keeps
  its name and content is not sent again.

## Status / next tasks for cloud sessions (2026-11-16)

**Live since 2026-11-15** at `https://mc-itbuvuow8h.bunny.run` (bunny app `treffpunkt`; Freigabe cannot
roll out containers yet). The running image is still `b1ce36a…` (checked from outside 2026-11-16:
`/gesund` without a commit, a proof → `nachweis-nicht-eingerichtet`), although the image field at
bunny shows `102c252…` — set but not rolled out, or not pulled (`docs/bunny-protokoll.md`, 16.11).
When the protocol changes, update this line in the same pull request. The probe without an
invitation passes (`docs/bunny-protokoll.md`). Force SSL (http → 301), logging off, TLS 1.0/1.1 off
and the 50 GB bandwidth limit are set. App id: see the dashboard; container `treffpunkt`. The login
scripts' public proof key is in `apps.json` (2026-11-15); it takes effect once the image with it runs
at bunny and Testumgebung's login scripts carry the private key (MT-08 there). Docker Hub refuses
this cloud environment (429), so the image is built only by GitHub.

Next, in this order (`docs/plan.md` § 7):
1. **Tobias:** set the image tag at bunny to the newest merge commit on `main` whose „Image“ (push
   to `main`) is green — `c59ac2d` or later: it carries the public proof key, and `/gesund` names the
   commit (`npm run probe -- --host … --stand <commit>`, a short commit is fine). Freigabe rolls out
   only `c59ac2d` and later. Until then a proof is answered `nachweis-nicht-eingerichtet`. By hand
   (Chrome prompt in `docs/bereitstellen.md`) until Freigabe can.
2. **Tobias:** the private proof key as secret `TREFFPUNKT_NACHWEIS_SCHLUESSEL` in `zugang-tkdtest`
   and `zugang-azptest`, „Login ausrollen“, MT-08 in Testumgebung.
3. **Administration PC:** `docs/freigabe-auftrag.md` in Freigabe.
4. **Cloud session:** the probe with an invitation (MT-02 step 3) once a device can enrol.
5. **Trainerbuch:** the app side is built and merged (2026-11-16, PR #4 there); left: `TREFFPUNKT_HOST` in
   `src/build/profiles.ts` there set to `https://mc-itbuvuow8h.bunny.run` once step 1 runs
   (`docs/auftrag-treffpunkt-bunny.md` there, „Reihenfolge“).
6. **Zulassung statt Tester-Login** (2026-11-21, Tobias): `docs/auftrag-zulassung.md` — **Treffpunkt-Teil gebaut** (Phase 1 beide Wege, Zertifikat + Besitznachweis, Mandanten, Einladung `e2`, Sperren, Geräteliste, Gründerticket, Entwicklerpasswort, Auswertung, `streng`; Abweichungen im Auftrag oben), **nicht ausgerollt**. Offen: Tobias legt `TREFFPUNKT_ENTWICKLER_SCHLUESSEL` an (`docs/bereitstellen.md`), entscheidet über dauerhaften Speicher für Sperren, schaltet später `streng`; dann der App-Teil im Arbeitszeitplaner-Repo. Zertifikat 60 Tage, Sperre einmal + täglich melden, Schlüsselring `TREFFPUNKT_SCHLUESSEL_ALT` (`<wert>@<Datum>`, läuft von selbst ab). Mit dem nächsten Rollout `c59ac2d`-Nachfolger gilt das Image mit Zulassung.
7. **Quality loop** (rule below) over all of it.

## Rules

- Product text (README, plan, docs, manual tests) German; code, comments, commits English.
- Changes only by pull request from a `claude/` branch. A session merges its own PR once „Tests“ is
  green (Tobias 2026-11-15: „merge du vorerst eigenständig“); a change to `docs/wochenpruefung.md`
  only when Tobias says so for that change.
- Never in this repo or a report: API keys, passwords, tokens, the Treffpunkt's secret, private keys,
  tester names. Only their names and where they are stored. Public keys may be committed.
- Nothing about content is stored or logged: the container's output holds counts and error kinds
  only, no IP addresses, device ids or message contents (a test checks it).
- **The server imports only `node:` modules and its own files** (ESLint rule); no package reaches the
  image. Dev tools (TypeScript, ESLint, Prettier) only for the checks.
- TypeScript runs unbuilt (type stripping): erasable syntax only (`erasableSyntaxOnly`), imports with
  `.ts`.
- Every rule gets a test that fails without it; check new rules by taking them out once
  (`docs/sicherheit.md`, „Regeln und ihre Tests“).
- Limits: memory, count and window limits live in `src/grenzen.ts`; time limits of the HTTP layer in
  `src/http.ts`, validities in `src/zugang.ts` / `src/nachweis.ts`, ringing limits in `src/klingeln.ts`.
  `docs/schnittstelle.md` lists them all — change both together (tests tie the table to `GRENZEN`, and
  the time limits and the ringing limits to the text).
- **Quality loop (Tobias 2026-11-15):** every round of fixes is followed by a new round of quality
  audit → refutation agents (each finding is handed to an agent that tries to disprove it against the
  code; only findings that survive count) → fixes with a test that fails before, until an audit comes
  back clean. Merge regularly: each round that is green on „Tests“ is merged (Tobias 2026-11-15:
  „merge du vorerst eigenständig“; this includes `docs/wochenpruefung.md` only when Tobias says so
  for that change).

## Project Directory

| File/Folder | Purpose |
|---|---|
| `README.md` | For Tobias (German): what this is, how it goes live |
| `docs/plan.md` | Plan (German): goal, every decision with date and reason, interface draft, security, steps, open points, what „done“ means |
| `docs/schnittstelle.md` | The interface, version 1 (German): endpoints, values, refusals, enrolment proof, limits, what the apps change |
| `docs/sicherheit.md` | Threat model and data minimisation (German): what the Treffpunkt sees, attackers, rules ↔ tests, open |
| `docs/bunny-einrichtung.md` | Target state at bunny and the prompt for Claude in Chrome (German); open points from the docs |
| `docs/bunny-protokoll.md` | What was set at bunny when (German) |
| `docs/bereitstellen.md` | How a change goes live, what Tobias does by hand, changing the secret, blocking, probe, costs (German) |
| `docs/auftrag-image-von-hand.md` | Aufträge (German) für Claude Code am PC (Image aus einem Commit bauen und nach ghcr.io schieben, solange GitHub keine Actions-Minuten hat), Claude in Chrome (Tag bei bunny umstellen), Cloud-Sitzung (von außen prüfen) |
| `docs/freigabe-auftrag.md` | Brief for Claude Code in Freigabe (German): roll out the container image after a green „Tests“ |
| `docs/wochenpruefung.md` | Weekly review list (German): bunny docs/prices, open bunny points, Node 24, push service hosts |
| `konfiguration/apps.json` | The apps served: name, allowed origins (CORS), public keys of the login scripts, `einladen`, blocked ids — no secrets |
| `src/server.ts` | Container start: puts the parts of `src/start.ts` together, listens, SIGTERM |
| `src/start.ts` | The start in testable parts: `einstellungenLesen` (fail closed), `uhrenAnlegen`, `treffpunktFuer`, `zeitgeberStarten` (tidy up every second, counts every 5 minutes) |
| `src/http.ts` | HTTP around the rules: the head is judged first (`vorpruefen`), then the body up to the endpoint's limit within 14 s; no query in the address; refusals with the usual headers; internal errors without text |
| `src/treffpunkt.ts` | The rules without HTTP: `treffpunktAnlegen` → `vorpruefen` (the head: path, method, origin, type, access, body limit), `behandeln` (all endpoints, CORS, refusals `FEHLER`), `ablehnen`, `aufraeumen`, `zaehlstand`; two clocks (`takt` monotonic for waiting/presence/counters; tokens judged by max(wall clock, start + monotonic time), invitations made and judged by start + monotonic time alone) |
| `src/postfach.ts` | Mailboxes in RAM per app and device, 30 s, limits, presence |
| `src/zugang.ts` | Device ids; access `z1.…` and invitation `e1.…` (HMAC-SHA-256 with the secret) |
| `src/zulassung.ts` | Zulassung: Zertifikat `c1.…` + Besitznachweis (Signatur über jede Anfrage), Einladung `e2.…`, Gründerticket `g1.…` und Auswertungsticket `a1.…` (ECDSA, Entwicklerschlüssel), Entwicklerpasswort (scrypt), Rollenregeln |
| `src/nachweis.ts` | Checking the login script's enrolment proof `n1.…` (ECDSA P-256, P1363) |
| `src/klingeln.ts` | Ringing: push services `PUSH_DIENSTE` (same as the Trainerbuch), strict request, `httpsSenden` |
| `src/konfiguration.ts` | Reading `apps.json` and `TREFFPUNKT_SCHLUESSEL` strictly |
| `src/grenzen.ts` | Every limit (`GRENZEN`, `KOERPER_BYTES`) and the sliding-window counter (by count, or by bytes for the bodies per minute) |
| `src/eingabe.ts` | Strict input: base64url, objects with fixed fields, ids |
| `src/protokoll.ts` | The only output: one JSON line per event, counts only |
| `tests/` | Node's test runner: `treffpunkt` (endpoints end to end), `postfach`, `zugang`, `nachweis`, `klingeln` (also the real way out against local servers: TLS, no redirect, deadline), `verfahren` (what the Treffpunkt serves and prefers: `/gesund` with CORS for a known origin, `ping` with `X-Treffpunkt-P`), `zulassung` (certificate + proof of possession, tenants, invitation `e2`, blocking, founder ticket, developer password, evaluation, `streng`, the old way beside it), `entwickler` (the tool), `konfiguration`, `grenzen` (counter; every limit of `GRENZEN` has its row in `docs/schnittstelle.md`), `server` (real HTTP: head before body, `Connection: close`, 413 with and without length, 408, bodies on the way, aborts), `workflow` (only „Image“ on `main` writes the package in any notation, actions pinned; must-fail and must-pass edits), `probe` (short commit), `start` (settings, clocks, timers, the container's own sender end to end with its 10 s deadline); `hilfen.ts` (wall clock and monotonic clock with their own epochs, key pair, stand-in push service, a self-signed certificate made in the test) |
| `scripts/entwickler.ts` | `npm run entwickler -- schluessel\|gruenderticket\|passwort\|auswertung`: Tobias' Werkzeug am eigenen PC (Schlüssel nie im Repo) |
| `scripts/schluessel.ts` | `npm run schluessel`: makes `TREFFPUNKT_SCHLUESSEL` (Tobias, on his PC) |
| `scripts/stand.ts` | `standPasst`: does the running commit fit a given one (7–40 characters) — for the probe, tested |
| `scripts/einladung.ts` | `einladungAus`: what the probe takes for `--einladung` — an `e1.…` invitation or the Trainerbuch's `#neu=` link carrying one (field `tp`), tested |
| `scripts/probe.ts` | `npm run probe -- --host … [--stand <commit>] [--einladung …]`: checks a running Treffpunkt from outside (which image runs, CORS, cache, refusals; with an invitation drop/collect, presence, a 4 MB drop, ringing) |
| `Dockerfile`, `.dockerignore` | The image: `node:24-alpine`, only `package.json`, `src/`, `konfiguration/`, `stand.txt` (the commit, build-arg `STAND`, answered by `/gesund`), user `node`, port 8080 |
| `.github/workflows/tests.yml` | Check „Tests“ (types, lint, format, tests), then „Image“ (only for a push to `main`: build, start, `/gesund`, push to ghcr.io; the only job that may write the package) or, on a PR, „Image-Probe“ (build, start, no push) |
| `manual_tests/` | Human-tester instructions (German) |

## Tests

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test            # 176 tests on 2026-11-21
```

Local end-to-end: start `TREFFPUNKT_SCHLUESSEL=… PORT=18080 node src/server.ts`, make an invitation
with that key (`einladungAusstellen` in `src/zugang.ts`), then
`node scripts/probe.ts --host http://127.0.0.1:18080 --einladung …`.

## Manual tests

`manual_tests/` (German), only what automated tests cannot cover: MT-01–06 in `01_betrieb.md`.

## Known Limitations

- **The image is built only by GitHub** (Docker Hub refuses this cloud environment).
- **bunny rewrites `Cache-Control: no-store` to `no-cache`** for the browser; the edge itself never
  serves from its cache (checked 2026-11-15, the probe checks `cdn-cache`).
- **Unproven at bunny:** a rolling update with max = 1 (maybe two instances for seconds: what waits
  is lost, drop and collect may meet different instances); whether the dashboard hides
  `TREFFPUNKT_SCHLUESSEL`; whether Magic Containers' HTTP logs (client IP, 3 days) can be switched
  off; the pull zone's largest body (the probe with an invitation sends about 4 MB; until it passed
  at bunny the apps send at most 1 MB per request); ECDSA signing in an Edge Script (for the proof).
  See `docs/bunny-einrichtung.md`, „Offen“.
- **Image tags can be overwritten:** only the job „Image“ (push to `main`) has `packages: write`, but a
  PR of this repo could edit the workflow and push a tag; Freigabe checks no digest
  (`docs/sicherheit.md`, § 5).
- **Single use of proofs and invitations is kept in RAM:** after a restart one could be taken again
  within its time (≤ 6 / 10 minutes).
- **No limit per IP** (the Treffpunkt reads no IPs); floods without access are left to bunny's edge.
- **Parsing runs on the one thread every app shares:** the bytes per minute of large bodies (32 MB per
  device, 64 MB per app, booked once read) bound it, but a body of many tiny JSON tokens still costs
  up to about 0.7 s per 6 MB — at most about 4 s per device and 8 s per app and minute in which other
  requests wait. One access (and the devices it invites) can use up its app's 64 MB with real large
  drops and hold up that app's large drops until the minute ends; collecting, small drops and the
  other apps go on (`docs/sicherheit.md` § 3).
- **One proof key for both apps:** `tkd` and `azp` share the login scripts' key pair (one per
  bunny account, Testumgebung). A proof says which app it is for; a leaked private key would let
  someone enrol devices for both (they still see no data without the app's own trust).
- **Blocking a device** needs a new image (`gesperrt` in `apps.json`) or a new secret (everyone
  enrols again).
- **A request whose headers take over 10 s** gets Node's bare 408 without CORS (the app treats it as a
  network error; Node checks every second); a body over 14 s gets a readable 408 `zu-langsam`; the
  whole request may take 30 s.
- **A wall clock that is ahead when the container starts** cannot be told apart from one set back
  later: tokens are then judged late until a restart (fresh proofs look expired). The counts show it
  as `uhrRueckstandS`; the remedy is restarting the app at bunny.
- **The probe's ringing** uses an invented subscription: it shows the ring reached the push service
  (4xx), not that a phone rings (MT-06).

_Last updated: 2026-11-21 — Zulassung gebaut (`docs/auftrag-zulassung.md`, Phase 1 + Teil B, nicht ausgerollt); 2026-11-18 — control audit round 12 (11 findings, 8 distinct, fixed: the bytes per minute only for large bodies and booked once read — round 11 had let two devices block collecting for their whole app; the counter keeps a running sum, so its cost no longer grows with the app's rate; counting of origin and type refusals and the PORT bound tested; the probe takes the Trainerbuch's invitation link; privacy table, probe instructions and next tasks brought up to date); quality audit round 11 (7 findings fixed: bytes of bodies per device and per app and minute, counted at the head; the AZP side of dropping, inviting and renewing tested; the same id after renewing; devices with a body on the way in the counts; keep-alive 65 s and the 1 s check tied to the interface; the invitation quota with the clock ahead; plan § 7 brought up to date); 2026-11-16 — quality audit round 10 (7 findings fixed: marks tested up to their end, the container's sender and its 10 s deadline end to end, every limit tested at its edge, a length beyond the safe integers gets 413, the per-receiver refusals counted, the reserve comment, this status); quality audit round 9 (10 findings, 6 distinct, fixed: the reserve by announced size, so small drops go on; reserve tests filled to the edge; ringing limits in the interface and tied to it; the push sender tested against local servers with a deadline; CORS on the 500; abort test strict; outside check of the image tag in the protocol); quality audit round 8 (10 findings fixed: a reserve for small bodies, Freigabe via the Actions API (fine-grained tokens have no Checks permission), freeing in the mailbox tested, the server's body time readable, workflow reader on continued values and quoted keys; docs on the invitation clock); quality audit round 7 (10 findings fixed: invitations judged by the floor, counter windows in GRENZEN, start in testable parts, bare job keys, secret change with restart; docs); quality audit round 6 (9 findings fixed: invitations from the floor, endpoint counted at the head, sender count, strict permissions block, abort test waits for the server; docs: 64 KB ciphertext, bunny open points); quality audit round 5 (10 findings fixed: 413 before the pots, tests for freeing once, the three time limits, CORS of HTTP-layer refusals, strict values, a fail-closed workflow reader; Freigabe step 3 via the check-suites call; retention of device ids in the counters); quality audit round 4 (15 findings fixed: bodies on the way per app, room only for reading, requests counted at the head, marks by the monotonic floor, clock lag in the counts, Node's timeouts checked every second; Freigabe by head_branch; by-hand roll-out from c59ac2d); quality audit round 3 (16 findings fixed: wall time without latch, bodies on the way bounded, rate before the body, tests for every clock and quota, strict bodies, tidy-up, workflow reader; Freigabe from c59ac2d); quality audit round 2 (16 findings fixed: head judged before the body, per-endpoint limit while reading, 408, own buffer per message, claimed-app CORS, latest wall time, `/gesund` names the commit, Freigabe steps 3/4/6); 2026-11-15 — quality audit round 1 (26 findings fixed: memory weight per message, monotonic clock, own quota for invitations, HTTP-layer refusals, image job only on main, docs); before: server, tests, image, check „Tests“, probe; interface, security, bunny target state, deploying, brief for Freigabe, weekly review, manual tests; enrolment by QR from an enrolled device._
