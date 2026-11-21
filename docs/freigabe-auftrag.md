# Auftrag für das Repo Freigabe: den Treffpunkt ausrollen

Entschieden von Tobias am 15.11.2026 (`CLAUDE.md`, „Deployment“): Der Treffpunkt wird über Freigabe
ausgerollt, von Hand gestartet, ohne Testbereich. Für Claude Code am Verwaltungs-PC, im Repo Freigabe. Diese
Datei ist `docs/freigabe-auftrag.md` im Repo Treffpunkt.

## Was anders ist als bei den anderen Apps

- Freigabe rollt heute Dateien in Speicherzonen und Edge Scripts aus. Der Treffpunkt ist **keins von
  beiden**, sondern ein **Container-Image** für einen bunny Magic Container.
- Gebaut wird das Image nicht in Freigabe, sondern von der GitHub-Prüfung „Tests“ im Repo Treffpunkt.
  Auf `main` schiebt sie es nach `ghcr.io/tobiasheinrichfaska/treffpunkt`, mit dem Commit als Tag.
  Das Paket ist privat (Tobias, 15.11.2026). bunny holt es mit einem eigenen Token, das Tobias dort
  eingetragen hat. **Freigabe braucht keinen Zugang zur Registry.**
- Freigabe sagt bunny nur: „Nimm jetzt das Image mit diesem Tag.“ Kein Code aus dem Repo Treffpunkt
  läuft in Freigabe.

## Zuerst lesen, nicht raten

- wie Freigabe heute ausrollt, besonders „Login ausrollen“ und den Plan aus
  `Testumgebung/docs/freigabe-auftrag.md` (Trennung „nachsehen / bauen / ausrollen“, `stand.json`);
- `werkzeuge\secrets-setzen.ps1`;
- in Treffpunkt: `docs/bunny-einrichtung.md` (Soll-Zustand), `docs/bunny-protokoll.md` (App-ID und
  Container-ID, sobald Claude in Chrome sie gemeldet hat), `.github/workflows/tests.yml`.

Was dort funktioniert, bleibt. Widerspricht etwas hier dem, was du vorfindest, frag Tobias, bevor du
baust.

## Was zu bauen ist

### Ein Workflow „Treffpunkt ausrollen“

- Eine eigene Datei, nur `workflow_dispatch`, Eingabe `commit` (leer = der neueste Commit auf `main`
  von Treffpunkt). Kein Zeitplan: Der Treffpunkt ist live, und live bleibt Handarbeit.
- `concurrency` mit fester Gruppe, ohne Abbruch.

### Ablauf

1. **Commit bestimmen** über die GitHub-API (fein abgestuftes Lese-Token, nur „Contents: read“ und
   „Actions: read“ für
   Treffpunkt).
2. **Der Commit liegt auf `main` und ist nicht älter als `c59ac2d`:** Vergleich
   `GET /repos/…/Treffpunkt/compare/main...<commit>`, der Status ist `identical` oder `behind`. Ein
   Commit nur aus einem Pull Request wird nie ausgerollt: Sein Image wurde nie geschoben. Dazu
   `GET /repos/…/Treffpunkt/compare/c59ac2dd6b8317c68266681da620e5bdfa462a14...<commit>`, der Status ist
   `identical` oder `ahead`: Erst seit `c59ac2d` nennt `/gesund` den Commit, und ohne ihn können die
   Schritte 4 und 6 nicht entscheiden. Ein älterer Commit wird rot abgelehnt, bevor bunny etwas
   bekommt (mit diesem Grund); so ein Image stellt Tobias von Hand ein (Auftrag für Chrome in
   `docs/bereitstellen.md`).
3. **„Tests“ und „Image“ grün für genau diesen Commit, aus einem Push auf `main`:** Es zählen nur die
   Jobs `Tests` und `Image` mit `conclusion: success` aus einem Lauf des Workflows
   `.github/workflows/tests.yml`, dessen Ereignis `push` und dessen `head_branch` `main` ist. Über die
   Actions-API (mit „Actions: read“; fein abgestufte Tokens kennen kein Recht „Checks“, die Checks-API
   ist ihnen versperrt):
   `GET /repos/…/actions/runs?head_sha=<commit>&event=push&branch=main`, davon nur Läufe mit `path`
   `.github/workflows/tests.yml`, dann `GET /repos/…/actions/runs/<id>/jobs`: Die Jobs mit `name`
   `Tests` und `Image` haben `conclusion: success`. Ein Lauf eines Pull Requests hat das Ereignis
   `pull_request` und den Zweig des Pull Requests, nie `push` auf `main`. Seit Commit `2678b19` läuft der Job `Image` nur bei einem Push
   auf `main` (Job-Bedingung in `.github/workflows/tests.yml`, ein Test im Repo Treffpunkt hält sie
   fest); bei einem Pull Request steht er als `skipped` da, und gebaut wird in `Image-Probe`, ohne zu
   schieben. **Vorsicht bei älteren Commits:** Bis `e0ccc57` lief `Image` auch für Pull Requests und
   wurde dort grün, ohne zu schieben. Ein solcher Commit (etwa `2bc8ae1`) liegt auf `main`, hat ein
   grünes `Image` – aber aus einer Suite eines Pull Requests, und sein Tag gibt es nicht. Deshalb
   zählt allein die Suite eines Pushes auf `main`. Sonst wird nichts ausgerollt und der Lauf wird rot.
   - **Image da?** Das sagen die Schritte 2 und 3: Ist `Image` für diesen Commit auf `main`
     `success`, liegt `…/treffpunkt:<commit>` in der Registry. Das Paket ist privat, deshalb holt
     Freigabe kein Manifest (dafür bräuchte es ein klassisches Token mit Lesezugriff auf alle Pakete
     — das soll Freigabe nicht haben). Freigabe prüft also **keinen Digest**: Ein Tag ließe sich
     überschreiben (`docs/sicherheit.md`, § 5).
4. **Nur was sich geändert hat – gemessen an bunny, nicht an `stand.json`:** Freigabe liest mit
   `GET https://api.bunny.net/mc/apps/<app-id>` das `imageTag` des Containers `treffpunkt` und
   fragt `GET https://<hostname>/gesund`. Nur wenn beide diesen Commit nennen (`/gesund` antwortet
   `{"ok":true,"stand":"<commit>"}`), endet der Lauf grün ohne Ausrollen. Sonst wird ausgerollt, auch
   wenn `stand.json` den Commit schon nennt: So kommt ein Zurückrollen nach einem roten Lauf immer bei
   bunny an, und ein halb ausgerollter Commit wird beim nächsten Lauf fertig.
5. **Ausrollen:** `PATCH https://api.bunny.net/mc/apps/<app-id>/containers/<container-id>` mit Kopf
   `AccessKey: <BUNNY_API_SCHLUESSEL_PRIVAT>` und Körper `{"imageTag": "<commit>"}`.
   - In Freigabes Konfiguration stehen die App-ID (steht im Dashboard) und Container-Name `treffpunkt`
     (keine Geheimnisse; `docs/bunny-protokoll.md`). Die Container-ID für die Adresse holt Freigabe
     vor dem Ausrollen mit `GET https://api.bunny.net/mc/apps/<app-id>` aus der Liste der
     Container, beim Namen `treffpunkt`, so wie bunnys Action `container-update-image` es macht. Im
     Dashboard steht in der Adresse `containerId=treffpunkt`; ob die API denselben Wert erwartet, zeigt
     der erste Lauf.
   - **Nicht** `PATCH /mc/apps/<id>` benutzen: Dort werden Listen ersetzt, und was fehlt, wird
     gelöscht (Container, Endpoints).
   - So macht es auch bunnys eigene Action `BunnyWay/actions/container-update-image`.
6. **Warten und prüfen:** bis zu 5 Minuten alle 10 s `GET https://<hostname>/gesund`, bis es 200 mit
   `"stand":"<commit>"` antwortet – also der **neue** Pod antwortet. Während eines Rolling Updates
   antwortet der alte Pod weiter mit seinem alten Commit; ein 200 allein sagt deshalb nichts. Kommt
   der Commit nach 5 Minuten nicht, ist der Lauf rot (das Image wurde vielleicht nicht gezogen, oder
   der neue Pod startet nicht). Dann die rein lesenden Prüfungen ohne Zugang, selbst gebaut in
   Freigabe, nicht `scripts/probe.ts` aus Treffpunkt (fremder Code nie neben Schlüsseln):
   - `OPTIONS /v1/ping` mit `Origin: https://tkdtest.b-cdn.net` und
     `Access-Control-Request-Method: POST` → 204, `Access-Control-Allow-Origin` ist genau diese
     Herkunft;
   - `POST /v1/ping` mit `Origin: https://tkdtest.b-cdn.net`, `Content-Type: application/json` und dem
     Körper `{}` → 401 mit `"art":"zugang-fehlt"`, und `Cache-Control` ist `no-store` **oder**
     `no-cache` (bunny schreibt `no-store` für den Browser in `no-cache` um, `docs/bunny-protokoll.md`).
     Ohne `Origin` käme 403, ohne `Content-Type: application/json` 415; ohne Körper ebenfalls 401
     (der Kopf wird vor dem Körper geprüft). Nichts davon wäre ein Fehler im Treffpunkt.
   - Ein Test in Freigabe lässt diese Prüfung gegen einen Stellvertreter laufen, der `no-cache`
     antwortet; er muss grün sein.
7. **`stand.json`** um `treffpunkt` ergänzen: Commit und Zeit, nur nach einem grünen Schritt 6.
   Committen mit einer Nachricht, die den Commit nennt. `stand.json` ist das Protokoll der Läufe;
   entschieden wird in Schritt 4 nach dem, was bei bunny läuft.
8. **Zusammenfassung** des Laufs: Commit, Vergleichslink zum vorigen Commit, Ergebnis der Prüfungen.
   Den Digest nennt die Zusammenfassung des Jobs `Image` in Treffpunkt.

### Geheimnisse

- `BUNNY_API_SCHLUESSEL_PRIVAT`: der API-Schlüssel des **privaten** bunny-Kontos. Laut Doku gibt es
  dafür nur den vollen Konto-Schlüssel (kein eingeschränkter bekannt), und Unterkonten gehen nicht.
  Er kann also alles im privaten Konto. Tobias legt ihn selbst als Secret an, nur in Freigabe.
- Das Lese-Token für Treffpunkt.
- **Nicht** `TREFFPUNKT_SCHLUESSEL`: Den trägt Tobias nur bei bunny ein, Freigabe kennt ihn nie.

### Tests in Freigabe

- Die Workflow-Datei nennt nur die zwei Geheimnisse oben (ein Test liest die Datei).
- Ein Lauf mit einem Commit ohne grüne „Tests“ rollt nichts aus.
- Ein Lauf mit einem Commit, der nur in einem Pull Request liegt (grüne „Tests“, aber kein „Image“
  auf `main`), rollt nichts aus.
- Ein Lauf mit einem Commit auf `main`, dessen grünes „Image“ aus der Suite eines Pull Requests
  stammt, rollt nichts aus. Der Stellvertreter antwortet wie die Actions-API: Für `event=push` und
  `branch=main` gibt es keinen Lauf (nur einen mit `event` `pull_request`, `head_branch` `claude/…`);
  Vergleich `behind`.
- bunny und `/gesund` nennen schon diesen Commit → kein PATCH bei bunny (nur das lesende GET aus
  Schritt 4 und `/gesund`; der Stellvertreter der API zählt die PATCH-Anfragen).
- Ein Commit vor `c59ac2d` (etwa `2678b19`) → rot mit Grund, kein PATCH.
- `stand.json` nennt den Commit P, bunny meldet das Tag N, ein Lauf mit P → PATCH auf P (das
  Zurückrollen kommt an).
- `/gesund` antwortet 200, aber mit dem alten Commit → der Lauf wird rot, `stand.json` bleibt.

## Wenn es schiefgeht

- Nennt `/gesund` nach 5 Minuten nicht den neuen Commit: Lauf rot, Tobias Bescheid geben. Zurück geht
  es mit einem zweiten Lauf und dem vorigen Commit als Eingabe (`stand.json` nennt den letzten, der
  grün war); Schritt 4 rollt ihn aus, weil bunny noch das neue Tag hat. Ist der vorige Commit älter
  als `c59ac2d` (das gilt nur für das erste Ausrollen über Freigabe), stellt Tobias ihn von Hand ein
  (Auftrag für Chrome in `docs/bereitstellen.md`); Freigabe lehnt ihn in Schritt 2 ab.
- Laut bunny startet ein Rolling Update erst den neuen Pod und nimmt dann den alten weg. Was gerade im
  Treffpunkt wartet (höchstens 30 s), geht dabei verloren. Das ist gewollt.

## Fertig, wenn

1. Ein Lauf mit dem neuesten Commit auf `main` rollt aus, `/gesund` nennt ihn, `stand.json` hat den
   Eintrag.
2. Ein zweiter Lauf mit demselben Commit endet ohne PATCH bei bunny.
3. Ein Lauf mit einem Commit ohne grüne „Tests“ wird rot und rollt nichts aus.
4. Tobias weiß, was er noch tun muss (API-Schlüssel, Lese-Token).
5. Danach sagt Tobias einer Cloud-Sitzung im Treffpunkt Bescheid; sie ergänzt `docs/bereitstellen.md`
   und `CLAUDE.md`.

## Regeln

- Kein Passwort, kein Schlüssel und kein Token in einem Chat oder im Repo. Tobias trägt jedes Secret
  selbst ein; du nennst ihm nur Name und Zweck.
- Actions per Commit-SHA pinnen.
