# Plan: Treffpunkt

Stand 15.11.2026. Für die Sitzungen in Claude Code im Web, die hier bauen.

Grundlage ist das Briefing `docs/briefing-treffpunkt.md` im Repo TKD-Trainerbuch (Zweig
`claude/tkd-trainerbuch-begleitrepo-okfkoa`, Commit `c3d304e`). Sein Inhalt steht jetzt hier; ab hier
gilt dieser Plan, das Briefing wird nicht mehr fortgeschrieben.

## 1. Ziel

Ein **allgemeiner Treffpunkt** für mehrere Apps von Tobias:

- Er reicht Ende-zu-Ende-verschlüsselte Nachrichten zwischen Geräten weiter.
- Beim Anklingeln gibt er einen fertigen Push an den Push-Dienst weiter.
- Er läuft als **Node-Prozess in einem bunny Magic Container** mit einer eigenen Pull-Zone davor, in
  Tobias' privatem bunny-Konto.
- Die erste App ist das TKD-Trainerbuch (`tkd`), weitere folgen, etwa der Arbeitszeitplaner (`azp`).
- Bis auf Weiteres gilt: **nur erfundene Daten**, nur eigene Testgeräte.

## 2. Entschieden

### Tobias, 15.11.2026 (Sitzung „TKD Trainerbuch“)

- **bunny, als Magic Container.** Diese Teile von bunny passen nicht:
  - **Storage-Zone:** Dateien liegen dort auf der Platte und werden verteilt. Der Treffpunkt legt aber
    nie Chiffrat auf die Platte (Trainerbuch, `docs/plan.md` § 4a, „Weg A“). Zum Schreiben bräuchte
    der Browser außerdem einen geheimen Schlüssel.
  - **Pull-Zone mit Edge Script:** Die Instanzen teilen keinen Arbeitsspeicher. Eine abgelegte
    Nachricht wäre beim Abholen oft nicht da (Trainerbuch, `docs/recherche-treffpunkt-eu.md`).
- **Container:** eine Region in der EU, genau eine Instanz (mindestens 1, höchstens 1). Davor eine
  **eigene Pull-Zone** mit eigenem Hostnamen. Die Testzone der App (mit Storage und
  Login-Skript) bleibt unverändert.
- **Node**, nur mit den Bordmitteln (`node:http`, `node:crypto`), ohne Framework.
- **Eine Instanz für alle Apps.** Begründung von Tobias:
  - Keine App eines anderen Kontos nutzt einen Treffpunkt.
  - Ein Gerät findet nur Kennungen, die es kennt. Ein AZP-Gerät kennt keine Kennung aus dem
    Trainerbuch und findet deshalb nichts von dort.

  Getrennt wird innerhalb der einen Instanz:
  - Jedes Gerät bekommt beim Einschreiben seine App (`tkd`, `azp` …). Nachrichten gehen nur an Geräte
    derselben App.
  - Es gibt kein Verzeichnis und keine Liste, wer gerade da ist. Auskunft gibt es nur zu Kennungen, die
    das fragende Gerät selbst nennt.
  - Grenzen gelten je App und je Gerät. Die erlaubten Herkünfte (CORS) stehen je App fest.
- **Protokoll „Weg A“:** nur kurze Anfragen, keine gehaltenen Verbindungen.
  - **Ablegen:** eine Nachricht für ein Gerät hinterlegen.
  - **Abholen:** die eigenen Nachrichten holen. Dabei meldet der Treffpunkt mit, welche der genannten
    Geräte gerade da waren.
  - Eine Nachricht wartet höchstens etwa 30 s, **nur im Arbeitsspeicher**, und wird beim Abholen
    gelöscht.
  - Dasselbe Protokoll soll später auch auf einem einfachen PHP-Hosting laufen können. So bleiben die
    Apps unabhängig vom Anbieter.
- **Anklingeln** bleibt ohne Inhalt. Der Treffpunkt prüft so streng wie heute
  `php/hub/treffpunkt.php` im Trainerbuch:
  - nur bekannte Push-Dienste: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, jede
    Subdomain von `push.apple.com` und von `notify.windows.com`;
  - nur https, ohne Port und ohne Login in der Adresse, keine Weiterleitungen, TLS geprüft;
  - VAPID-Kopf nach Muster, TTL, Dringlichkeit, Körper höchstens 4096 Byte;
  - höchstens 60 Klingeln je Gerät und Stunde. Gezählt werden nur Zeitpunkte, nie das Ziel.
  - Zurück geht nur der Status des Push-Dienstes.
- **STUN** bleibt bei Cloudflare (`stun:stun.cloudflare.com:3478`). Ob UDP über bunny geht, ist nicht
  bestätigt.
- **Der IONOS-Treffpunkt läuft nicht weiter.** Abschalten macht der Verwaltungs-PC oder Tobias im
  IONOS-Dateimanager, nicht eine Cloud-Sitzung.
- **Bereitstellen über das Repo `Freigabe`**, von Tobias von Hand gestartet, ohne Testbereich (siehe
  `CLAUDE.md`, „Deployment“).

### Tobias, 15.11.2026 (diese Sitzung, Fragen 1–4 des Briefings)

1. **Geräte werden neu eingeschrieben.** Keine Kennung zieht von IONOS um.
   - Folge: `geraete.json` auf IONOS muss nicht gesichert werden; IONOS kann jederzeit aus.
   - Folge: Nach dem Umzug scannen sich die Testgeräte des Trainerbuchs einmal neu in der Halle (neue
     Kennung heißt neue Schlüssel, Trainerbuch `CLAUDE.md`, Known Limitations, „Encryption“).
   - Bis der neue Treffpunkt läuft, gleichen die Testgeräte nur per QR in der Halle und per Datei ab.
     Hintergrund-Abgleich, Einladungen und Anklingeln fallen so lange aus.
2. **Nachweis beim Einschreiben kommt vom Login-Skript** im Repo `Testumgebung`.
   - Ein angemeldeter Tester holt in der Testzone seiner App (gleiche Herkunft, mit dem Cookie
     `__Secure-Zugang`) einen kurz gültigen, **signierten Einschreibe-Nachweis**.
   - Der Treffpunkt prüft ihn mit einem **öffentlichen Schlüssel**. Ein gemeinsames Geheimnis zwischen
     Login-Skript und Treffpunkt gibt es nicht.
   - Die App im Nachweis setzt das Login-Skript aus `zugang/bereiche.json` (`app`), nicht das Gerät.
   - Folge für `Testumgebung`: eine neue Route unter `/_zugang/`, ein neuer geheimer Schlüssel je
     Login-Skript der privaten Bereiche (Secret bei bunny, Tobias trägt ihn ein) und danach „Login
     ausrollen“. Das ist eine Änderung an einer Sicherheitsgrenze (dortige `CLAUDE.md`, „Rules“).
   - Freigabes Positivliste bleibt gültig: Signieren geht mit Web Crypto, ohne neuen Import und ohne
     neuen Host. Ob bunnys Edge Scripts ECDSA signieren können, ist noch nicht erprobt.
3. **Das Container-Image bleibt privat** in der GitHub Container Registry. Geändert von Tobias am
   15.11.2026, nachdem er erst „öffentlich“ gewählt hatte: Der Code soll nicht für jeden lesbar
   sein, und ein öffentlich gemachtes Paket lässt sich nicht wieder privat stellen.
   - bunny holt das Image mit einem **klassischen GitHub-Token** nur mit `read:packages` und
     `read:org` (so verlangt es bunnys Doku), als Image-Registry „GitHub“ in Magic Containers.
     Tobias legt es an und trägt es selbst ein; es steht nie im Repo oder im Chat.
   - Preis: ein Geheimnis mehr. Das Token kann alle privaten Pakete von Tobias' Konto lesen.
   - **Es läuft nie ab** (Tobias, 15.11.2026, beim Anlegen „No expiration“ gewählt). Damit kann der
     Container nie wegen eines abgelaufenen Tokens hängen bleiben; dafür gilt ein Token, das nach
     außen gelangt, bis Tobias es auf GitHub widerruft. Der Eintrag T1 der Wochenprüfung greift nur,
     wenn es später doch ein Ablaufdatum bekommt.
   - Freigabe braucht dieses Token nicht (`docs/freigabe-auftrag.md`).
4. **Das Trainerbuch ist in dieser Sitzung**, mit Schreibrecht. Die App-Seite kommt als eigener Pull
   Request dort.

### Tobias, 15.11.2026 (diese Sitzung, danach)

5. **Geräte kommen auch per QR von einem eingeschriebenen Gerät dazu:** beim Trainerbuch von einem
   Trainergerät, beim Arbeitszeitplaner von einem Bürogerät. Gebaut als Endpunkt `einladen`: Das
   Gerät holt eine Einladung (10 Minuten, einmal) und zeigt sie als QR; das neue Gerät schreibt sich
   damit ein, ohne Tester-Login. Wer einladen darf, entscheidet die App; der Treffpunkt erlaubt es je
   App (`einladen` in `konfiguration/apps.json`). Der Nachweis vom Login-Skript bleibt der Weg für
   das erste Gerät.

### Tobias, 21.11.2026: PHP-Variante nicht jetzt

Geprüft, ob der Treffpunkt eine PHP-Variante bekommen soll. **Entschieden: jetzt nicht.** „Dasselbe
Protokoll soll später auch auf einem einfachen PHP-Hosting laufen können“ (oben) bleibt eine Anforderung
an das Protokoll, kein Bauauftrag.

- **Gründe:**
  - Der Treffpunkt hält seinen Zustand im Arbeitsspeicher eines Prozesses: wartende Nachrichten,
    Geräteregister, Sperrliste, Zähler je App, Einladungen, benutzte Nachweise. Klassisches PHP hat je
    Anfrage einen frischen Prozess. Es blieben APCu (Verfügbarkeit beim Hosting nicht geprüft) oder
    Dateien mit Sperren; dann läge Chiffrat kurz auf der Platte und „Nichts auf der Platte“
    (`docs/sicherheit.md`) gälte nicht mehr.
  - Eine zweite Umsetzung derselben Sicherheitsgrenze (Nachweis, Einladung, Grenzen, Anklingeln) hieße,
    jede Korrektur doppelt zu machen und zu prüfen.
  - Es gibt keinen Anlass: Der frühere IONOS-Treffpunkt wurde bewusst abgelöst, keine App und kein
    Nutzer verlangt PHP.
- **Was bleibt:** `docs/schnittstelle.md` ist der Vertrag. Je vollständiger er ist und je mehr davon
  Tests über HTTP prüfen, desto billiger wird eine zweite Umsetzung.
- **Auslöser für einen Neubau:** bunny fällt weg oder wird zu teuer, oder jemand will den Treffpunkt auf
  eigenem einfachem Hosting betreiben.
- **Dann:** eine abgespeckte Variante nur für Ablegen, Abholen und Einschreiben; das Anklingeln ginge in
  PHP mit `curl`. Zuerst klären, ob das Hosting APCu hat und ob Chiffrat für höchstens 30 s auf der
  Platte vertretbar ist.

### Vorgaben dieser Sitzung (gelten, solange Tobias nichts anderes sagt)

- **Hostname:** der Name, den bunny dem CDN-Endpoint gibt (`mc-….bunny.run`, oder `….b-cdn.net`,
  wenn seine Pull-Zone einen hat), keine eigene Domain. Geändert nach der Recherche vom 15.11.2026:
  Der CDN-Endpoint legt seine Pull-Zone selbst an; eine zweite davor hieße zweimal Protokolle.
- **Node 24** (LTS), wie die GitHub-Prüfung des Trainerbuchs. TypeScript läuft ohne Übersetzen
  (Type Stripping).
- **Keine Anycast-IP:** Der CDN-Endpoint ist schon eine Pull-Zone (bunny-Doku, 15.11.2026).
- **Region Frankfurt.**

## 3. Grundregel: alles steht im Repo

Tobias, 15.11.2026: Alles muss im Repo dokumentiert sein, auch wenn ein Skript oder eine Einstellung
mit Claude in Chrome eingerichtet wird.

- **Soll-Zustand zuerst:** Jede Einstellung bei bunny steht in `docs/bunny-einrichtung.md`, bevor sie
  gesetzt wird: Container, Region, Anzahl der Instanzen, Port, Gesundheitsprüfung, Pull-Zone, Cache,
  Protokolle, CORS, Hostname und die Namen der Umgebungsvariablen. Dazu je ein Satz, warum.
- **Claude in Chrome arbeitet nur nach dieser Datei.** Die Schritte stehen als Liste mit genauen
  Werten. Es setzt nur, was dort steht. Weicht der Ist-Zustand ab, ändert es nichts und meldet die
  Abweichung.
- **Das Ergebnis kommt ins Repo:** Den Bericht von Claude in Chrome legt die Cloud-Sitzung gekürzt in
  `docs/bunny-protokoll.md` ab: Datum, was gesetzt wurde, was schon da war, was abwich. Danach wird der
  Soll-Zustand angeglichen, wenn nötig.
- **Rein lesende Prüfungen** im Dashboard kommen ebenfalls ins Protokoll.
- **Code, der bei bunny läuft**, entsteht nur aus Dateien im Repo. Nie im Code-Editor des Dashboards
  schreiben. Wird etwas von Hand eingefügt, steht im Protokoll, aus welchem Commit es stammt.
- **Nie ins Repo und nie in einen Bericht:** API-Schlüssel, Passwörter, Tokens, der Geheimwert des
  Treffpunkts, private Schlüssel, Tester-Namen. Ins Repo kommen nur ihre Namen und wo sie hinterlegt
  sind. Öffentliche Schlüssel dürfen ins Repo.
- **Bereitstellen** steht als Ablauf in `docs/bereitstellen.md`, samt dem, was Tobias von Hand tut:
  Zugänge anlegen, Benachrichtigungen zum Guthaben, das Token für die Registry anlegen.

## 4. Schnittstelle, erste Fassung

Ein Entwurf. Festgelegt wird sie in `docs/schnittstelle.md`; die App passt sich danach an.

- **Adresse:** `https://<Treffpunkt-Host>/v1/…`. Kennungen, Geheimnisse und Inhalte stehen nie in der
  Adresse, denn die Pull-Zone protokolliert Adressen.
- **Anmeldung je Anfrage:** `Authorization: Bearer <Gerätezugang>`. Keine Cookies; die App schickt
  mit `credentials: 'omit'`.
- **CORS:** Antwort nur an die erlaubten Herkünfte der App des Geräts, mit Vorabanfrage.
- **Endpunkte:**
  - `ping`;
  - `einschreiben`: Nachweis vom Login-Skript rein, Gerätekennung und Zugang raus; der Zugang wird
    nur einmal gezeigt;
  - `ablegen`: an wen, Nachricht bis 64 KB. Eine Anfrage darf **mehrere Empfänger** tragen, je mit
    einer eigenen, für ihn verschlüsselten Nachricht (Gespräch mit Tobias, 15.11.2026: eine
    Mitteilung an 40 Eltern-Geräte wären sonst 40 Anfragen). Jeder Empfänger zählt einzeln gegen die
    Grenzen; wird einer abgelehnt, sagt die Antwort, welcher und warum;
  - `abholen`: optional die Kennungen, deren Anwesenheit interessiert. Raus kommen die wartenden
    Nachrichten mit Absender und die Anwesenden aus der genannten Liste;
  - `klingeln`.
- **Grenzen im Arbeitsspeicher:** gesamt, je App, je Empfänger und je Absender. Wird eine Grenze
  überschritten, wird das Ablegen mit Grund abgelehnt, nie stillschweigend gekürzt.
- **Ein Neustart des Containers** verliert nur Wartendes (höchstens 30 s) und die Zähler. Das ist
  gewollt.
- **Gerätezugänge ohne Geräteliste:** Der Zugang ist ein signierter Wert aus App, Gerätekennung und
  Ablaufdatum, geprüft mit einem Geheimwert des Treffpunkts (HMAC-SHA-256). Damit braucht der
  Treffpunkt keine Geräteliste auf der Platte.
  - Für einzelne gesperrte Geräte reicht eine kurze Sperrliste.
  - Der Geheimwert liegt als Umgebungsvariable bei bunny, nie im Repo.
  - Zu beschreiben ist der Wechsel des Geheimwerts: Danach gelten alle Zugänge nicht mehr.
- **Einschreibe-Nachweis (Entscheidung 2):** signiert mit ECDSA P-256 (Web Crypto, überall
  vorhanden), mit App, Ablaufzeit (wenige Minuten) und einer Zufallszahl, die der Treffpunkt nur
  einmal annimmt. Ob er ein Pseudonym des Testers trägt, etwa für eine Grenze je Tester wie heute
  (`MAX_JE_TESTER = 20`), legt `docs/schnittstelle.md` fest. Tester-Namen sieht der Treffpunkt nie.
- **Heute (IONOS) im Vergleich**, damit nichts verloren geht:
  - Kopf `X-Modus` mit `ping`, `lauschen`, `senden`, `klingeln`;
  - Nachrichten bis 64 KB;
  - ein Testkanal, in dem jedes lauschende Gerät alles hört. Der neue Treffpunkt stellt nur noch an
    eine Kennung zu.
  - Quellen im Trainerbuch: `php/hub/treffpunkt.php`, `php/hub/einschreiben.php`,
    `src/logic/hub/hub.ts`, `src/logic/klingeln/klingeln.ts` (`parseKlingelAnfrage`),
    `src/logic/push/webpush.ts` (`PUSH_SERVICES`).

## 5. Sicherheit und Datensparsamkeit

- **Kleine Angriffsfläche:**
  - Jede Eingabe wird streng gelesen, mit fester Größe, festem Muster und festen Feldern.
  - Unbekanntes wird abgelehnt.
  - Der Treffpunkt ist kein offener Weiterleiter: Klingeln geht nur an die Push-Dienste aus § 2.
- **Nichts Inhaltliches wird gespeichert oder protokolliert.** Die Ausgabe des Containers enthält
  keine IP-Adressen, keine Kennungen und keine Inhalte, nur Zählwerte und Fehlerarten.
- **Protokolle der Pull-Zone:** abschalten oder die IP-Adressen kürzen lassen. Was bunny dazu anbietet,
  steht nach Prüfung der Doku in `docs/bunny-einrichtung.md`.
- **Bedrohungsmodell in `docs/sicherheit.md`**, nach dem Vorbild von `docs/sicherheitspruefung.md` im
  Trainerbuch. Was der Treffpunkt sieht, steht dort offen: IP-Adresse, Zeitpunkte, Kennungen von
  Absender und Empfänger, Größe.
- **Jede Regel bekommt einen Test, der ohne sie fehlschlägt**, auch für Fehlerfälle: zu groß, falsche
  App, abgelaufener Zugang, fremde Herkunft, Grenze erreicht, gefälschter oder wiederverwendeter
  Nachweis.

## 6. Arbeitsweise

- **Grundgerüst** wie in den anderen Repos von Tobias: `CLAUDE.md` auf Englisch; `README.md`, dieser
  Plan und die Produkttexte auf Deutsch; Commit-Nachrichten auf Englisch; `manual_tests/` für Prüfungen,
  die kein automatischer Test kann.
- **GitHub-Prüfung `Tests`** (`.github/workflows/tests.yml`, `name: Tests`, bei jedem Push auf `main`
  und bei Pull Requests): Typen, Lint, Format, Tests, Image bauen. Auf `main` schiebt sie das Image in
  die GitHub Container Registry, markiert mit dem Commit. Freigabe rollt nur ein Image aus, dessen
  Commit grüne `Tests` hat.
- **Änderungen nur per Pull Request auf einem `claude/`-Zweig.** Ist „Tests“ grün, mergt die
  Cloud-Sitzung selbst (Tobias, 15.11.2026: „merge du vorerst eigenständig“), außer
  `docs/wochenpruefung.md` (unten).
- **Wochenprüfung:** `docs/wochenpruefung.md` nach dem Vorbild des Trainerbuchs. Mögliche Einträge:
  Preise und Doku von bunny Magic Containers; Laufzeitende von Node 24; die Hosts der Push-Dienste
  (übernimmt der Treffpunkt diese Liste, verweist Eintrag P1 im Trainerbuch auf ihn). Änderungen an
  dieser Datei mergt nur Tobias. Was `aufgaben/wochenpruefung.md` im Repo `Pruefvorgaenge` schon für
  alle Repos prüft, kommt nicht doppelt hinein.

## 7. Schritte

1. **Plan und Gerüst** (diese Datei, `CLAUDE.md`, `README.md`). Erledigt 15.11.2026.
2. **Schnittstelle und Sicherheit** festlegen: `docs/schnittstelle.md`, `docs/sicherheit.md`.
   Erledigt 15.11.2026.
3. **Server bauen**, mit Tests zu jeder Regel; `Dockerfile`; GitHub-Prüfung `Tests` mit Image.
   Gebaut 15.11.2026 (`src/`, `tests/`), lokal mit `scripts/probe.ts` geprüft.
4. **Nachweis im Login-Skript** (Pull Request in `Testumgebung`): Route, Signatur, Tests, gebaute
   Skripte. Tobias erzeugt das Schlüsselpaar am PC, trägt den privaten Schlüssel bei bunny ein und
   startet „Login ausrollen“; der öffentliche Schlüssel kommt hierher. Gebaut 15.11.2026; der
   öffentliche Schlüssel steht seit 15.11.2026 in `konfiguration/apps.json` (`2bc8ae1`). Offen: der
   private Schlüssel bei bunny, „Login ausrollen“ und MT-08 in `Testumgebung`.
5. **Freigabe:** ein Auftrag `docs/freigabe-auftrag.md` für den Verwaltungs-PC. Freigabe kann heute nur
   Storage-Zonen und Edge Scripts; der Treffpunkt braucht eine neue Art des Ausrollens: einem Magic
   Container eine neue Image-Fassung geben, nachdem `Tests` für genau diesen Commit grün ist.
   Auftrag geschrieben 15.11.2026; umsetzen muss ihn der Verwaltungs-PC.
6. **Einrichtung bei bunny:** `docs/bunny-einrichtung.md` (Soll-Zustand, Schritte für Claude in
   Chrome), `docs/bereitstellen.md`; danach das Protokoll in `docs/bunny-protokoll.md`. Gesetzt
   15.11.2026 (`docs/bunny-protokoll.md`). Offen: das Image-Tag ab `c59ac2d` ausrollen — laut Prüfung
   von außen am 16.11.2026 läuft noch `b1ce36a…`.
7. **Probe** von einer Cloud-Sitzung aus, mit erfundenen Daten (siehe § 9). Ohne Einladung grün seit
   15.11.2026; mit Einladung offen, bis sich ein Gerät einschreiben kann.
8. **App-Seite im Trainerbuch** (eigener Pull Request dort). Gebaut und gemergt 16.11.2026 (PR #4 dort);
   offen: `TREFFPUNKT_HOST` im Testbau setzen, sobald Schritt 6 ganz erledigt ist:
   - feste Treffpunkt-Adresse statt der relativen Pfade in `HUB`;
   - `connect-src` in der CSP (`src/build/csp.ts`);
   - Abholen statt Lauschen, Anwesenheit über das Abholen;
   - Einschreiben mit dem Nachweis aus der Testzone oder der Einladung eines Trainergeräts (QR)
     statt `einschreiben.php`;
   - was heute an alle Lauschenden geht (etwa `abgleich-da`, `test-bereit`, `direkt-angebot` ohne
     `an`), geht künftig an bekannte Kennungen;
   - die Verteilung von Änderungen, Entwurf unten.

   **Verteilung von Änderungen (Entwurf, Gespräch mit Tobias am 15.11.2026).** Gehört in den Plan
   des Trainerbuchs, sobald dessen Pull Request für die App-Seite kommt.
   - **An alle bekannten Geräte, je Kanal** (Trainerbuch-Plan § 4a): im Trainer-Kanal an jedes
     Trainer-Gerät, Weitergeben über einen Umweg ist gewollt; in der Familie nur an deren Mitglieder;
     in der Gruppe verteilen nur die Trainer, Eltern geben nichts an andere Eltern weiter.
   - **Keine Liste „kennen es schon“ im Paket.** Sie würde in der Gruppe verraten, welche anderen
     Eltern-Geräte es gibt, sie verhindert Doppeltes nicht sicher (zwei senden gleichzeitig), und sie
     wächst mit jedem Gerät.
   - **Jedes Gerät merkt sich den Stand jedes Partners:** je Partner eine Zeile mit der höchsten
     Nummer je schreibendem Gerät. Das gibt es schon für die Häkchen ✓✓ und den Abgleich per Datei
     (Trainerbuch `src/io/geraeteStand.ts`); es lernt aus jedem Abgleich nebenbei. Neu ist, dass die
     Tabelle entscheidet, **wen** ein Gerät anspricht: nur Partner, denen laut Tabelle etwas fehlt.
   - **Angebot mit Stand:** Ein Gerät schickt seinen Stand und, wenn es wenig ist (bis zu einem Stück,
     12 KB), gleich das, was dem Partner laut Tabelle fehlt. Der Partner nimmt, was passt, und meldet
     seinen Stand zurück. Steht er tiefer als gedacht (Angebot bis 18, er hat 16), bekommt er den Rest
     in der nächsten Runde. So kostet nur eine echte Lücke eine weitere Runde, und über den
     Treffpunkt wartet jede Runde auf das nächste Abholen.
   - **Die Tabelle kann zu niedrig sein, kaum zu hoch.** Unter derselben Kennung sinkt ein Stand
     nicht: „Neu beginnen“ und „Gerät zurücksetzen“ geben eine neue Kennung, „Sicherung einspielen“
     führt nur zusammen. Zu niedrig kostet höchstens ein überflüssiges Angebot.
   - **Wer etwas Besonderes erlebt hat, meldet sich selbst** (Tobias): Nach dem Einspielen einer
     Sicherung, oder wenn ein Gerät merkt, dass ihm Daten fehlen, die es schon hatte, schickt es seinen
     Stand an alle Partner. Die anderen müssen nicht bei jedem Öffnen nachfragen.
   - **Schlimmster Fall** (Tobias: hinnehmbar): Ein Gerät wird ausgelassen, bis die nächste Änderung
     im Kanal kommt. Dann spricht man es wieder an, und es meldet seinen wahren Stand.
9. **Wochenprüfung** (`docs/wochenpruefung.md`). Geschrieben 15.11.2026.

## 8. Offen

1. **Kosten:** bunny hat keinen harten Deckel. Bezahlt wird nach Verbrauch; ein kleiner, meist wartender
   Container liegt nahe am Mindestbetrag (`docs/bereitstellen.md`, „Kosten“). Eine Anycast-IP ist nicht
   gebucht. Das Bandbreiten-Limit der Pull-Zone (50 GB im Monat) deckelt den Verkehr. Den Zahlungsweg
   richtet Tobias selbst ein.
2. **Später, vor echten Daten:** Bleibt der Treffpunkt in Tobias' privatem Konto, verarbeitet Tobias
   für den Verein Daten in dessen Auftrag (IP-Adressen, Zeiten, Kennungen). Dann braucht es eine
   Vereinbarung zur Auftragsverarbeitung, mit bunny als Unterauftragnehmer. Bisher sagt der Plan des
   Trainerbuchs: vor dem ersten echten Kind alles in ein Konto des Vereins (dort Schritt 8).

## 9. Fertig heißt

- **Das Repo hat:** `CLAUDE.md`, `README.md`, diesen Plan; `docs/schnittstelle.md`,
  `docs/sicherheit.md`; `docs/bunny-einrichtung.md` (Soll-Zustand) und `docs/bunny-protokoll.md` (was
  wann gesetzt wurde); `docs/bereitstellen.md`, `docs/freigabe-auftrag.md`, `docs/wochenpruefung.md`,
  `manual_tests/`.
- **Die GitHub-Prüfung `Tests` ist grün:** Typen, Lint, Format, Tests und das gebaute Image.
- **Der Container läuft bei bunny:** eine Region in der EU, genau eine Instanz, hinter der eigenen
  Pull-Zone. Jede Einstellung steht im Soll-Zustand und im Protokoll.
- **Probe von einer Cloud-Sitzung aus, mit erfundenen Daten**, Ergebnisse im Protokoll:
  - `ping`, Einschreiben, Ablegen und Abholen zwischen zwei Test-Clients;
  - abgelehnt werden: fremde App, fremde Herkunft, zu groß, Grenze erreicht;
  - `klingeln` mit erfundenen Endpunkten. Google sollte 410 zurückgeben, Apple 400, wie bei der Probe
    vom 13.11.
- **Für das Trainerbuch** steht fest, was sich auf seiner Seite ändert (Pull Request dort).

## 10. Zuerst lesen

- **Im Trainerbuch:** `CLAUDE.md` (Abschnitte „Treffpunkt / hub“, „Ringing“, Known Limitations);
  `docs/plan.md` § 4a („Weg A“), § 5 und § 6.3; `docs/recherche-treffpunkt-eu.md`,
  `docs/recherche-hosting.md`, `docs/sicherheitspruefung.md`; `php/hub/`, `src/logic/hub/hub.ts`,
  `src/io/hub.ts`, `tests/build/hub.test.ts`.
- **In `Testumgebung`:** `CLAUDE.md`, `docs/plan.md`, `zugang/` (Login-Skript), `docs/freigabe-auftrag.md`
  (Vorbild für den Auftrag an Freigabe).
- **Im Repo `Pruefvorgaenge`:** `aufgaben/wochenpruefung.md`.
- **Bei bunny:** Doku zu Magic Containers (Endpunkte, Preise, Regionen, eine Instanz) und zu den
  Protokollen der Pull-Zone. Nur Primärquellen; was sich nicht klären lässt, als „offen“ notieren.
