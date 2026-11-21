# Wochenprüfung Treffpunkt

Die geplante Aufgabe „Wochenprüfung“ arbeitet diese Liste ab. Sie liest die Datei bei jedem Lauf vom
Hauptzweig. Prüfungen über alle Projekte (npm audit, CI, Zugangsdaten, private Dateien, die
Cloud-Umgebung, neue Projekte) stehen in `aufgaben/wochenpruefung.md` im privaten Repo
`tobiasheinrichfaska/Pruefvorgaenge`, nicht hier.

Hier steht nur, was sich für den Treffpunkt **von außen** ändern kann. **Erweitern** heißt, hier
einen Eintrag ergänzen.

## Regeln für jeden Lauf

- Nur Primärquellen: bunnys Doku (bunny.net/docs), Preis- und Changelog-Seiten von bunny; nodejs.org
  (Release-Plan); die Entwickler-Dokumentation von Apple, Google, Mozilla und Microsoft zu Web Push;
  Docker Hub für das Basis-Image `node`.
- Nicht raten. Was sich nicht klären lässt, wird als „offen“ gemeldet, mit der Quelle, die fehlt.
- Eine Änderung wird als PR umgesetzt, mit einem Test, der vorher fehlschlägt. PRs dieser Liste
  werden **nicht** gemergt; Tobias entscheidet. Auch eine Änderung an dieser Datei mergt nur Tobias.
- Nie ausrollen, nie etwas bei bunny ändern. Keine echten Daten.

## Einträge

### B1 · bunny Magic Containers: Doku und Preise

- **Prüfen:** Stimmen die Angaben in `docs/bunny-einrichtung.md` und `docs/bereitstellen.md` noch?
  Besonders: Endpoint-Arten (CDN ohne Anycast), Region Frankfurt, min/max-Instanzen, Rolling Update,
  Umgebungsvariablen (gibt es inzwischen einen Secret-Typ?), Protokolle und Anonymisierung, Preise
  (CPU, RAM, Verkehr, Minimum), der API-Aufruf zum Ausrollen
  (`PATCH /mc/apps/{appId}/containers/{containerId}`), eingeschränkte API-Schlüssel.
- **Dann:** Abweichungen per PR in diese beiden Dateien und in `docs/freigabe-auftrag.md`; ändert sich
  der API-Aufruf, Tobias sofort melden (Freigabe muss mit).
- **Ende:** dauerhaft.

### B2 · Offene Punkte zu bunny

- **Prüfen:** Ist einer der Punkte unter „Offen“ in `docs/bunny-einrichtung.md` inzwischen in der
  Doku geklärt?
- **Dann:** Punkt per PR streichen oder umsetzen.
- **Ende:** wenn die Liste leer ist.

### N1 · Node 24

- **Prüfen:** Laufzeitende von Node 24 laut nodejs.org; gibt es für `node:24-alpine` eine
  Sicherheitsmeldung?
- **Dann:** weniger als 6 Monate bis zum Ende → PR auf die nächste LTS-Fassung (Dockerfile,
  `.github/workflows/tests.yml`, `CLAUDE.md`).
- **Ende:** dauerhaft.

### T1 · Ablauf des Registry-Tokens

- **Prüfen:** das Ablaufdatum des Tokens „bunny Treffpunkt lesen“ in `docs/bunny-protokoll.md`.
- **Dann:** weniger als 30 Tage bis zum Ablauf → Tobias melden: Token erneuern
  (`docs/bunny-einrichtung.md`, „Token für die Registry“, „Erneuern“). Steht kein Datum im Protokoll,
  obwohl die App bei bunny eingerichtet ist: „offen“ melden.
- **Ende:** dauerhaft, solange das Paket privat ist.

### P1 · Adressen der Push-Dienste

- **Prüfen:** Klingeln geht nur an `PUSH_DIENSTE` in `src/klingeln.ts`: `*.push.apple.com`,
  `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`. Nennen Apple,
  Google, Mozilla oder Microsoft neue oder andere Hosts für Web Push?
- **Dann:** PR hier **und** im Trainerbuch (`PUSH_SERVICES` in `src/logic/push/webpush.ts`); beide
  Listen bleiben gleich. Eintrag P1 im Trainerbuch verweist auf diesen.
- **Ende:** dauerhaft.
