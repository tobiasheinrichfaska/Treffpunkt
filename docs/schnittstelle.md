# Schnittstelle des Treffpunkts, Fassung 1 (mit Zulassung, Stand 21.11.2026)

Stand 15.11.2026, ergänzt am 21.11.2026 um die Zulassung (unten, „Zulassung, Mandanten, Sperren“; Auftrag: `docs/auftrag-zulassung.md`). Alles Alte gilt unverändert weiter (Phase 1: beide Verfahren). Danach richten sich die Apps (zuerst TKD-Trainerbuch, dann Arbeitszeitplaner).
Gebaut in `src/`, jede Regel hat einen Test in `tests/`. Entscheidungen und Gründe: `docs/plan.md`.

## Grundsätze

- **Adresse:** `https://<Treffpunkt-Host>/v1/<endpunkt>`. In der Adresse stehen nie Kennungen,
  Zugänge oder Inhalte, und eine Adresse mit `?` wird abgelehnt: Die Pull-Zone protokolliert Adressen.
- **Nur `POST` mit JSON** (`Content-Type: application/json`), dazu die Vorabanfrage `OPTIONS` des
  Browsers. Einzige Ausnahme: `GET /gesund` für die Gesundheitsprüfung bei bunny.
- **Herkunft:** Jede Anfrage braucht den Kopf `Origin` einer erlaubten Herkunft ihrer App
  (`konfiguration/apps.json`). Die Antwort trägt dann `Access-Control-Allow-Origin` mit genau dieser
  Herkunft. Ohne oder mit fremder Herkunft: 403, ohne CORS-Kopf. Das gilt auch für die Herkunft einer
  anderen App: Ein Zugang, eine Einladung oder ein Nachweis, der `tkd` nennt, geschickt von
  `https://azptest.b-cdn.net`, bekommt 403 `herkunft` ohne CORS-Kopf – gültig oder nicht, abgelaufen
  oder nicht. Geprüft wird die App, die der Text nennt, vor seiner Unterschrift; so erfährt die Seite
  einer anderen App nichts über ihn.
- **Anmeldung:** `Authorization: Bearer <zugang>` (altes Ticket `z1`) oder `Bearer <zertifikat>` mit
  `X-Treffpunkt-Signatur` (Zulassung, unten). Keine Cookies; die App schickt `credentials: 'omit'`.
- **Erst der Kopf, dann der Körper:** Adresse, Methode, Herkunft, `Content-Type` und Zugang werden
  entschieden, bevor ein Byte des Körpers gelesen wird. Was dort scheitert, wird abgelehnt, ohne den
  Körper zu lesen. Danach gilt beim Lesen die Grenze des Endpunkts (16 KB, `klingeln` 8 KB, `ablegen`
  6 MB); wer darüber kommt, bekommt sofort 413, auch ohne `Content-Length`.
- **Jede Antwort** trägt `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` und
  `Vary: Origin` und ist JSON, außer der leeren Vorabanfrage (204). Das gilt auch für die Ablehnungen
  der HTTP-Schicht: Adresse mit `?` (400 `unlesbar`), Körper zu groß (413 `zu-gross`), Körper nicht in
  14 s angekommen (408 `zu-langsam`) und ein innerer Fehler (500 `intern`). Bei einer erlaubten
  Herkunft tragen auch sie `Access-Control-Allow-Origin`, damit die App `art` lesen kann.
- **Ausnahmen ohne lesbare Antwort:** Bricht das Gerät mitten im Körper ab, antwortet niemand (es ist ja
  weg). Kommen schon die Kopfzeilen nicht in 10 s an, antwortet Node selbst (es sieht jede Sekunde
  nach) mit einem leeren 408 ohne CORS-Kopf; die App behandelt das wie einen Netzfehler. Die ganze
  Anfrage darf höchstens 30 s dauern, also länger als Kopf und Körper zusammen: Ein zu langsamer
  Körper bekommt immer das lesbare 408 `zu-langsam`. Eine Verbindung ohne Anfrage bleibt 65 s offen
  (Nodes Vorgabe wären 5 s), damit Node keine schließt, die die Pull Zone gerade wieder benutzt.
- **Zeiten:** `alterMs` und `ms` sind ganze Millisekunden einer Uhr, die nie zurückspringt. Wird die
  Uhr des Rechners verstellt, ändert das weder sie noch die Wartezeit. Zugänge und Nachweise
  misst der Treffpunkt an der Uhr des Rechners, aber nie früher als an seiner Startzeit plus
  der seitdem vergangenen Zeit: Die Uhr zurückstellen macht nichts Abgelaufenes oder schon Benutztes
  wieder gültig. Geht die Uhr nach dem Start vor, zählt das nur, solange sie vorgeht; danach ist
  niemand ausgesperrt, und auch eine Marke, die währenddessen gelöscht wurde, bringt nichts zurück
  (Marken gehen erst nach Start plus vergangener Zeit). **Einladungen** stellt und prüft der Treffpunkt
  ganz nach seiner eigenen Uhr (Start plus vergangene Zeit): Eine Einladung gilt ihre 10 Minuten, ob die
  Uhr des Rechners vorgeht, nachgeht oder zwischendurch gestellt wird. **Ging die Uhr schon beim Start vor**, kann
  der Treffpunkt das nicht von einer später zurückgestellten Uhr unterscheiden: Bis zu einem Neustart
  misst er dann zu spät, und frische Nachweise gelten als abgelaufen. Die Zählwerte zeigen das als
  `uhrRueckstandS` (Sekunden); ist der Wert mehr als ein paar, hilft ein Neustart.
- **Ablehnung:** `{ "fehler": "<kurzer Grund auf Deutsch>", "art": "<Kennwort>" }` mit passendem
  Status. Die App entscheidet nach `art` und zeigt `fehler`.
- **Streng:** Unbekannte Felder, falsche Typen und zu Großes werden abgelehnt, nie gekürzt oder
  ergänzt.

## Kennungen und Werte

| Wert | Form | Herkunft |
|---|---|---|
| App | `tkd`, `azp` (`^[a-z][a-z0-9]{1,15}$`) | `konfiguration/apps.json` |
| Gerätekennung | `geraet-` + 32 Hex-Zeichen (128 Zufallsbits) | vergibt der Treffpunkt beim Einschreiben |
| Zugang | `z1.<app>.<geraet>.<bis>.<mac>` | beim Einschreiben und Erneuern, 90 Tage gültig |
| Einladung | `e1.<app>.<bis>.<zufall>.<mac>` | `einladen` für ein altes Ticket, 10 Minuten, einmal (altes Verfahren) |
| Zertifikat | `c1.<app>.<mandant>.<geraet>.<rolle>.<schluessel>.<bis>.<mac>` | beim Einschreiben und Erneuern mit Geräteschlüssel, **60 Tage** (erneuern ab Tag 30) |
| Einladung (neu) | `e2.<app>.<mandant>.<einlader>.<rolle>.<bis>.<zufall>.<mac>` | `einladen` für ein Zertifikat, 10 Minuten, einmal |
| Gründerticket | `g1.<app>.<mandant>.<bis>.<zufall>.<signatur>` | nur der Entwickler, höchstens 1 Stunde, einmal |
| Mandant | `^[a-z0-9-]{1,20}$`, nie `standard`; die bisherigen Geräte gehören zu `1` | Zertifikat, Einladung, Gründerticket |
| Rolle | `buero`, `lb:<kennung>` oder `ohne` | Zertifikat |
| Nachweis | `n1.<nutzlast>.<signatur>` | Login-Skript der Testzone, höchstens 5 Minuten, einmal |
| Inhalt | base64url ohne `=`, höchstens 64 KB nach dem Dekodieren (das Chiffrat, so wie die App es schickt; der Treffpunkt entschlüsselt nie) | die App, schon Ende-zu-Ende verschlüsselt |

`mac` ist HMAC-SHA-256 mit dem Geheimwert des Treffpunkts (`TREFFPUNKT_SCHLUESSEL`), über
`zugang:<kopf>` bzw. `einladung:<kopf>`. Der Treffpunkt braucht dadurch keine Geräteliste. Ein neuer
Geheimwert macht alle Zugänge und Einladungen auf einmal ungültig: Alle Geräte schreiben sich neu ein.

## Endpunkte

### `GET /gesund`

`200 {"ok":true,"stand":"<commit>","v":2,"faehigkeiten":[…],"verfahren":{…}}`. Ohne Zugang, für bunny und für
Freigabe: `stand` ist der Commit, aus dem das Image gebaut wurde (beim Bau in `stand.txt` geschrieben, nie aus
einer Umgebungsvariable), sonst `"unbekannt"`. Daran sieht man von außen, welches Image läuft. `v`,
`faehigkeiten` und `verfahren` sagen, was dieser Treffpunkt bedient und bevorzugt (siehe „Zulassung“,
„Verfahren“).

Kommt die Anfrage mit `Origin` einer erlaubten Seite einer App, darf diese Seite die Antwort lesen
(`Access-Control-Allow-Origin`), und die Antwort nennt zusätzlich `app` und `altAbgeschaltet`
(`true`: das alte Ticket ist für den Mandanten `1` dieser App abgeschaltet, `streng`), und `verfahren` gilt für
diese App und ihren Mandanten `1`. So erfährt eine App **vor dem Einschreiben**, was sie benutzen soll. Ohne
oder mit fremder Herkunft: kein CORS-Kopf, `verfahren` nennt, was der Code überhaupt bedient. Nichts davon
ist geheim.

### `POST /v1/einschreiben` — ein neues Gerät

Ohne Zugang. Körper: **genau eines** von

- `{"nachweis": "n1.…"}` — vom Login-Skript der Testzone, für angemeldete Tester (unten);
- `{"einladung": "e1.…"}` — vom QR eines schon eingeschriebenen Geräts derselben App (Tobias
  15.11.2026: beim Trainerbuch ein Trainergerät, beim Arbeitszeitplaner ein Bürogerät).

Antwort `201`:

```json
{ "geraet": "geraet-3f2a…", "zugang": "z1.tkd.geraet-3f2a….1802476800.…", "bis": "2027-02-13" }
```

Der Zugang wird nur hier gezeigt; die App bewahrt ihn auf dem Gerät auf. Die App des Geräts kommt aus
dem Nachweis bzw. der Einladung, nie vom Gerät. Die Herkunft muss zu dieser App gehören.

Ablehnungen: `nachweis-ungueltig` (400), `nachweis-unterschrift`, `nachweis-abgelaufen`,
`nachweis-nicht-eingerichtet`, `einladung-ungueltig`, `einladung-abgelaufen`, `einladen-aus`,
`app-unbekannt`, `herkunft` (403), `verbraucht` (409: dieser Nachweis oder diese Einladung wurde
schon benutzt), `zu-viele-einschreibungen` (429: mehr als 120 je App und Stunde mit Nachweis oder 60
mit Einladung; gezählt wird nur, was alle Prüfungen bestanden hat).

### `POST /v1/ping`

Körper `{}`. Antwort `200 {"geraet": "…", "app": "tkd", "bis": "2027-02-13"}`. Eine App, die ihre
Protokollversion im Kopf `X-Treffpunkt-P` ankündigt (und jedes Gerät mit Zertifikat), bekommt zusätzlich `v`,
`faehigkeiten` und `verfahren` für ihren Mandanten; eine alte App sendet den Kopf nicht und bekommt die Antwort
wie immer.

### `POST /v1/erneuern`

Körper `{}`. Antwort `200 {"zugang": "z1.…", "bis": "…"}`: ein neuer Zugang, wieder 90 Tage. Die App
erneuert, wenn weniger als 30 Tage bleiben. Der alte Zugang gilt bis zu seinem Ende weiter.

### `POST /v1/einladen` — QR für ein neues Gerät

Körper `{}`. Antwort `201 {"einladung": "e1.…", "gueltigS": 600}`. Die App zeigt die Einladung als
QR, am besten im selben Code wie ihre eigene Einladung (beim Trainerbuch: Link `#neu=…`, plan § 5
dort). Wer einladen darf, entscheidet die App (Trainer- oder Bürogerät); der Treffpunkt lässt jedes
eingeschriebene Gerät der App einladen, wenn `einladen` für die App an ist.

Ablehnungen: `einladen-aus` (403), `zu-viele-einladungen` (429: mehr als 10 je Gerät und Stunde).

### `POST /v1/ablegen` — Nachrichten hinterlegen

```json
{ "an": [ { "geraet": "geraet-…", "inhalt": "<base64url>" }, … ] }
```

- 1 bis 50 Empfänger, jeder höchstens einmal, nicht das Gerät selbst; je Empfänger eine eigene, für
  ihn verschlüsselte Nachricht bis 64 KB. Ist ein Eintrag unlesbar, wird die ganze Anfrage mit 400
  abgelehnt.
- Die Nachricht wartet höchstens **30 Sekunden**, nur im Arbeitsspeicher, und wird beim Abholen
  gelöscht.
- Antwort `200`, je Empfänger ein Ergebnis in derselben Reihenfolge:

```json
{ "ergebnisse": [
  { "geraet": "geraet-…", "ok": true, "anwesend": true },
  { "geraet": "geraet-…", "ok": false, "art": "empfaenger-voll", "fehler": "Postfach des Empfängers voll – erst abholen lassen" }
] }
```

- `anwesend`: Der Empfänger hat in den letzten 30 s abgeholt.
- Gründe je Empfänger: `voll` (der ganze Treffpunkt), `app-voll`, `absender-voll`,
  `empfaenger-voll`. Abgelehnt heißt: nicht hinterlegt. Die App versucht es später noch einmal oder
  klingelt.
- **Apps sind getrennt:** Eine Nachricht liegt im Postfach der App des Absenders. Ein Gerät einer
  anderen App bekommt sie nie, auch wenn der Absender dessen Kennung kennt.

### `POST /v1/abholen` — eigene Nachrichten holen

```json
{ "anwesend": [ "geraet-…", … ] }
```

`anwesend` ist freiwillig: höchstens 200 Kennungen, nach deren Anwesenheit das Gerät fragt. Antwort
`200`:

```json
{ "nachrichten": [ { "von": "geraet-…", "inhalt": "<base64url>", "alterMs": 1500 } ],
  "anwesend": [ "geraet-…" ],
  "mehr": false }
```

- Nachrichten in der Reihenfolge des Ablegens, höchstens 2 MB je Abholen. Ist `mehr` wahr, sofort
  noch einmal abholen.
- `anwesend` nennt nur Kennungen aus der Frage, die in den letzten 30 s abgeholt haben, nie das
  fragende Gerät. Es gibt kein Verzeichnis und keine Liste aller Geräte.
- Jedes Abholen zählt als „anwesend“. Die App fragt etwa jede Sekunde, solange ein Abgleich läuft,
  sonst höchstens alle 10 s, und nur im Vordergrund (Trainerbuch-Plan § 4a).

### `POST /v1/klingeln` — fertigen Push weiterreichen

Wie heute im Trainerbuch (`parseKlingelAnfrage`, `php/hub/treffpunkt.php`):

```json
{ "endpunkt": "https://fcm.googleapis.com/…", "vapid": "vapid t=…, k=…", "ttl": 900,
  "dringlichkeit": "high", "inhalt": "<base64url, höchstens 4096 Byte>" }
```

- `endpunkt`: höchstens 900 Zeichen, nur an Apple (`*.push.apple.com`), Google
  (`fcm.googleapis.com`), Mozilla (`updates.push.services.mozilla.com`) und Microsoft
  (`*.notify.windows.com`); https, ohne Port, ohne Login in der Adresse, ohne Weiterleitungen, TLS
  geprüft.
- `vapid`: der fertige Kopf `Authorization` des Pushs, `vapid t=<JWT>, k=<87 Zeichen base64url>`,
  höchstens 1024 Zeichen.
- `ttl`: ganze Sekunden von 0 bis 86 400.
- `dringlichkeit`: `very-low`, `low`, `normal` oder `high`.
- `inhalt`: der verschlüsselte Push, 1 bis 4096 Byte.
- Antwort `200 {"dienst": 201, "ms": 140}`: nur der Status des Push-Dienstes. Der Kopf seiner Antwort
  muss binnen 10 s da sein, sonst gilt er als nicht erreicht.
- Ablehnungen: `klingeln-ungueltig` (400: eine Angabe oben passt nicht), `klingeln-zu-oft` (429: mehr
  als 60 je Gerät und Stunde; gezählt werden nur Zeitpunkte, nie das Ziel), `push-dienst` (502: nicht
  erreicht).

## Zulassung, Mandanten, Sperren (Fassung 2)

Sie kommt **neben** das alte Verfahren (Ticket `z1`, Nachweis der Testzone, Einladung `e1`), das
unverändert weiter gilt, bis Tobias es je App und Mandant mit `streng` abschaltet.

**Fähigkeiten.** `GET /gesund`, `ping` (mit Zertifikat oder angekündigter Version) und die Antworten auf
Einschreiben/Erneuern mit Geräteschlüssel nennen `"v": 2` und `"faehigkeiten": [...]`. Eine App, die nichts
davon sieht, spricht mit einem älteren Treffpunkt und bleibt beim alten Verfahren.

**Verfahren: was der Treffpunkt bedient und bevorzugt.** Dasselbe Feld `verfahren`:

```json
{ "angeboten": ["zugang", "zertifikat"], "bevorzugt": "zertifikat",
  "einschreiben": ["nachweis", "einladung", "einladung2", "gruender", "passwort"] }
```

- `angeboten`: die Techniken der Anmeldung. `zugang` = das alte Ticket `z1` (Inhaber-Wert, nur Mandant `1`),
  `zertifikat` = Zertifikat mit Besitznachweis. Wo `streng` das alte abgeschaltet hat und in jedem Mandanten
  außer `1`: nur `["zertifikat"]`.
- `bevorzugt`: immer `zertifikat`. Eine App nimmt das Zertifikat, wenn sie es kann, und das andere nur, wo es
  `angeboten` ist.
- `einschreiben`: die Wege, ein Gerät aufzunehmen. Alt: `nachweis` (Login-Skript der Testzone), `einladung`
  (`e1`); neu: `einladung2` (`e2`), `gruender`, `passwort`. Wo das alte abgeschaltet ist, nur die neuen.
- Das Feld gilt für den Mandanten der Antwort (bei `ping` und den Antworten mit Schlüssel der Mandant des
  Geräts, bei `/gesund` der Mandant `1` der App der Herkunft).

**Mandant** (Schule). Postfächer, Anwesenheit, Geräte und Sperren gelten je `(app, mandant)`. Geräte
verschiedener Mandanten erreichen einander nie. Der Mandant steht im Zertifikat, in der Einladung
und im Gründerticket, nie als Angabe des Geräts. Der alte Weg kennt nur Mandant `1`; ein Ticket `z1`
bedeutet `1`. Es gibt kein stilles „Standard“. Einen neuen Mandanten gibt es nur über ein
Gründerticket oder das Entwicklerpasswort.

**Zertifikat und Besitznachweis.** Das Gerät schickt beim Einschreiben und beim Erneuern eines alten
Tickets seinen öffentlichen Schlüssel (`geraetSchluessel`, ECDSA P-256 roh, 87 Zeichen). Der Treffpunkt
antwortet zusätzlich mit `zertifikat`, `mandant`, `rolle`. Jede Anfrage trägt dann

```
Authorization: Bearer c1.…
X-Treffpunkt-Signatur: <t>.<signatur>
X-Treffpunkt-P: <Protokollversion der App, 1–3 Ziffern, freiwillig>
```

`t` sind Sekunden (höchstens 120 s von der Uhr des Treffpunkts entfernt); `signatur` ist ECDSA
P-256/SHA-256 (IEEE P1363, base64url, 86 Zeichen) über den Text
`v1\n<Methode>\n<Pfad>\n<t>\n<SHA-256 des Körpers, base64url>\n<Zertifikat>`. Dieselbe Signatur gilt nur
einmal innerhalb ihrer Zeit. Ablehnungen: `besitz-fehlt`, `besitz-ungueltig` (auch Wiederholung oder
anderer Körper), `besitz-zeit`. Ohne Geräteschlüssel ist ein Zertifikat wertlos.

**Einschreiben**, Körper: **genau eines** von `nachweis`, `einladung` (`e1` oder `e2`), `gruender`,
`passwort`, dazu freiwillig `geraetSchluessel`; mit `passwort` zusätzlich `app` und `mandant`.

- Im Mandanten `1` kommt ohne Schlüssel wie bisher nur `zugang`, mit Schlüssel auch `zertifikat`.
  In jedem anderen Mandanten und wo `streng` gilt, ist der Schlüssel Pflicht (sonst `unlesbar`) und es
  gibt kein `z1`.
- `nachweis` und `e1` (alter Weg) dürfen `rolle` nennen (Standard `ohne`): der Treffpunkt kann sie nicht
  prüfen. Bei `e2`, `gruender` und `passwort` kommt die Rolle von der Einladung (vom Einlader gesetzt),
  `buero` für die letzten beiden; ein Feld `rolle` dort ist `unlesbar`.
- `gruender`: vom Entwickler signiert (`npm run entwickler -- gruenderticket`), erstes Gerät, Rolle `buero`,
  „eingeführt von: entwickler“. Fehler: `entwickler-nicht-eingerichtet`, `entwickler-ungueltig`,
  `entwickler-abgelaufen`, `verbraucht`.
- `passwort`: Hash und Grenzen stehen in `TREFFPUNKT_ENTWICKLER_PASSWOERTER` (App, Mandant, Ablauf,
  höchstens N, `auchMitGeraeten`). Nur solange der Mandant keine Geräte hat, außer es ist erlaubt
  (`entwickler-belegt`); 20 Versuche je App und Stunde.
- `geraete-voll` (409): 50 Geräte je App und Mandant. `neue-fassung-noetig` (426): der Mandant ist
  `streng`, der alte Weg gilt dort nicht mehr.

**`erneuern`**, Körper `{}` bei einem Zertifikat (gleicher Schlüssel, Mandant, Rolle, nichts zu nennen);
bei einem alten Ticket freiwillig `{"geraetSchluessel": …, "rolle": …}` (beides zusammen oder nichts):
dann auch ein Zertifikat.

**`einladen`**, Körper `{}` oder `{"rolle": …}`. Mit Zertifikat: `e2`, der Mandant des Einladers, die Rolle
gesetzt vom Einlader — das Büro jede (Standard `ohne`), ein `lb:<id>`-Gerät nur die eigene (Standard),
ein Gerät `ohne` keine (`rolle-nicht-erlaubt`). Mit altem Ticket wie bisher `e1`, ohne Rolle. Wird der
Einlader gesperrt, gilt seine Einladung nicht mehr (`einladung-ungueltig`).

**`geraete`**, Körper `{}`, nur mit Zertifikat: `{"geraete": [{"geraet", "rolle", "von", "seit", "zuletzt",
"verfahren": "neu"|"alt", "p"?}], "hoechstens": 50}`. Das Büro sieht alle Geräte seines Mandanten, ein
`lb:<id>`-Gerät die mit derselben Rolle, ein anderes nur sich. Es gilt, was der Treffpunkt seit seinem
Start sah.

**`sperren`**, Körper `{"geraet": "geraet-…"}`, nur mit Zertifikat: das Büro sperrt jedes Gerät seines
Mandanten, ein `lb:<id>`-Gerät seine eigenen (auch sich), jedes Gerät sich selbst (sonst
`rolle-nicht-erlaubt`). Antwort `{"geraet", "gesperrt": true}`. Ein gesperrtes Gerät bekommt bei **jeder**
Anfrage 403 `gesperrt` (anders als `zugang-abgelaufen` und `neue-fassung-noetig`); es gilt für das
Zertifikat und für ein altes Ticket. Gehalten 90 Tage (so lange kann ein altes Ticket gelten; ein Zertifikat höchstens 60), nur im Arbeitsspeicher; 30 Sperren je Gerät und
Stunde, 500 je Mandant (`sperrliste-voll`).

**`auswertung`**, Körper `{"ticket": "a1.…"}`, vom Entwickler signiert (5 Minuten, einmal), ohne
`Origin` erlaubt (sein Werkzeug hat keine Seite): `{"laufzeitS", "mandanten": [{"app", "mandant", "geraete",
"neu", "alt", "gesperrt", "altLetzteVorS", "streng"}]}`. Nur Zahlen, nie eine Kennung.

**`streng`** je App und Mandant steht in `konfiguration/apps.json` (Liste von Mandanten; neues Image):
Dort gilt nur noch das neue Verfahren — kein `z1`, kein Nachweis, kein `e1`, Antwort 426
`neue-fassung-noetig`. Von Hand, nie automatisch; zurück durch Streichen und Ausrollen.

**Befristung statt Dauer-Sperre.** Ein Zertifikat gilt 60 Tage, ein gesperrtes Gerät kann nicht erneuern
und fällt nach spätestens 60 Tagen von selbst heraus. Das Büro muss eine Sperre darum nur so lange
melden, sonst nicht: **einmal beim Sperren, danach täglich** (bei jedem Start der App und einmal am Tag),
60 Tage lang, bei einem Gerät mit altem Ticket 90. Nach einem Neustart des Treffpunkts steht die Sperre so
am nächsten Tag wieder.

**Nicht überlebt ein Neustart:** Geräteregister, Sperrliste, Passwortzähler, benutzte Marken
(`docs/sicherheit.md`).

## Ablehnungen bei jeder Anfrage mit Zugang

| art | Status | Bedeutung |
|---|---|---|
| `zugang-fehlt` / `zugang-ungueltig` | 401 | kein oder ein falscher Zugang |
| `zugang-abgelaufen` | 401 | nach 90 Tagen ohne Erneuern: neu einschreiben |
| `herkunft` | 403 | die Seite gehört nicht zur App des Geräts |
| `gesperrt` | 403 | Kennung steht in `gesperrt` der App oder wurde gesperrt (`sperren`) |
| `neue-fassung-noetig` | 426 | der Mandant ist `streng`: das alte Verfahren gilt dort nicht mehr (kein „gesperrt“) |
| `app-unbekannt` | 403 | die App wurde aus `apps.json` genommen |
| `zu-viele-anfragen` | 429 | mehr als 300 Anfragen je Gerät und Minute, mehr als 32 MB große Körper je Gerät und Minute, oder schon zwei Körper dieses Geräts unterwegs |
| `beschaeftigt` | 503 | gerade zu viele Körper unterwegs (die Geräte dieser App zusammen oder alle Geräte zusammen), oder die Geräte dieser App haben in der letzten Minute 64 MB große Körper geschickt (kleine gehen weiter): gleich noch einmal |
| `typ` / `zu-gross` / `unlesbar` | 415 / 413 / 400 | kein JSON, zu groß, nicht lesbar |
| `zu-langsam` | 408 | der Körper kam nicht in 14 s an (langsames Netz): kleiner aufteilen oder noch einmal |
| `unbekannt` / `methode` | 404 / 405 | falscher Endpunkt oder falsche Methode |

## Der Einschreibe-Nachweis

Das Login-Skript der Testzone (Repo `Testumgebung`, `zugang/`) stellt angemeldeten Testern unter
`POST /_zugang/treffpunkt-nachweis` (gleiche Herkunft, mit dem Login-Cookie) einen Nachweis aus.

- **Nutzlast:** base64url von genau `{"v":1,"app":"tkd","bis":<Sekunden>,"n":"<16 Zufallsbytes,
  base64url>"}`. Die App setzt das Login-Skript aus `zugang/bereiche.json`, nicht das Gerät. Kein
  Tester-Name: Der Treffpunkt sieht nie, wer sich angemeldet hat.
- **Signatur:** ECDSA P-256 mit SHA-256 im Format von Web Crypto (IEEE P1363, 64 Byte) über den Text
  `n1.<nutzlast>`.
- **Gültig:** höchstens 5 Minuten (plus 1 Minute für abweichende Uhren), einmal.
- **Schlüssel:** Den privaten Schlüssel hat nur das Login-Skript (Secret bei bunny). Der öffentliche
  steht roh (65 Byte, base64url) in `nachweisSchluessel` der App in `konfiguration/apps.json`. Solange
  er fehlt, wird jeder Nachweis abgelehnt (`nachweis-nicht-eingerichtet`).

## Grenzen im Arbeitsspeicher

`src/grenzen.ts`, in einer Datei:

| Grenze | Wert |
|---|---|
| Wartezeit einer Nachricht | 30 s |
| Anwesend nach dem letzten Abholen | 30 s |
| Nachricht | 64 KB |
| Jede Nachricht zählt mindestens | 1 KB |
| Empfänger je Ablegen | 50 |
| Postfach je Empfänger | 100 Nachrichten, 2 MB |
| Wartendes je Absender | 4 MB |
| Wartendes je App | 32 MB |
| Wartendes gesamt | 64 MB |
| Je Abholen | 2 MB |
| Anwesenheit fragen | 200 Kennungen |
| Anfragen je Gerät | 300 je Minute |
| Klingeln je Gerät | 60 je Stunde |
| Einladungen je Gerät | 10 je Stunde |
| Einschreiben je App mit Nachweis | 120 je Stunde |
| Einschreiben je App mit Einladung | 60 je Stunde |
| Geräte je App und Mandant | 50 |
| Sperren je Gerät | 30 je Stunde |
| Sperrliste je App und Mandant | 500 |
| Entwicklerpasswort-Versuche je App | 20 je Stunde |
| Körper unterwegs je Gerät | 2 |
| Körper unterwegs mit Zugang | 64 MB |
| Körper unterwegs je App | 32 MB |
| Davon frei für kleine Körper | 1 MB |
| Körper unterwegs ohne Zugang | 8 MB |
| Körper je Gerät | 32 MB je Minute |
| Körper je App | 64 MB je Minute |

„Zählt mindestens 1 KB“: In den Grenzen je Empfänger, Absender, App und gesamt zählt jede Nachricht so
viel, wie ihr Platz im Arbeitsspeicher etwa kostet, auch wenn ihr Inhalt kleiner ist. Sonst füllten
winzige Nachrichten an frische Kennungen den Speicher, während die gezählten Bytes klein blieben.
„Körper unterwegs“: Wie viele Körper gerade gelesen werden – vom Kopf bis der Körper da ist; danach
ist der Platz frei, auch wenn die Antwort noch dauert (etwa beim Klingeln, das auf den Push-Dienst
wartet). Ein Gerät darf zwei zugleich schicken (sonst 429 `zu-viele-anfragen`), die Geräte einer App
zusammen 32 MB, alle Geräte mit Zugang zusammen 64 MB, Anfragen ohne Zugang (Einschreiben) zusammen
8 MB (sonst 503 `beschaeftigt`). So halten die Geräte einer App die anderen Apps nicht auf. Von den
Töpfen mit Zugang bleibt 1 MB den kleinen Körpern (angesagt höchstens 16 KB; ohne angesagte Länge
zählt eine Ablage als groß): Große, langsame Ablagen halten Abholen, Ping, Erneuern, Klingeln und
kleine Ablagen nicht auf. Gezählt
wird die angesagte Länge, höchstens die Grenze des Endpunkts (eine angesagte Länge darüber bekommt
413, nie 503). „Körper je Gerät/App“: Lesen und Auswerten eines Körpers läuft auf dem einen Faden,
den alle Apps teilen. Darum darf ein Gerät je Minute große Körper (über 16 KB) von zusammen 32 MB
schicken (darüber 429 `zu-viele-anfragen`), die Geräte einer App zusammen 64 MB (darüber 503
`beschaeftigt`). Geprüft wird am Kopf, mit der angesagten Länge (ohne sie zählt eine Ablage als groß);
gezählt wird erst der gelesene Körper — ein angesagter und abgebrochener kostet nichts. Kleine Körper
(Abholen, Ping, Erneuern, Einladen, Klingeln, kleine Ablagen) zählen nicht mit und gehen immer weiter;
sie begrenzen schon die 300 Anfragen je Minute. Die Anfragen je Minute zählt der Treffpunkt am Kopf, jede mit Zugang, auch eine mit
unlesbarem, zu großem oder zu langsamem Körper; ist das Kontingent verbraucht, kommt das 429, bevor
der Körper gelesen wird. Einschreiben mit Einladung hat ein eigenes Kontingent: Eine Kette eingeladener Geräte verbraucht nicht,
was Tester mit einem frischen Nachweis brauchen. Gezählt wird erst, wenn alles andere geprüft ist; ein
abgelehnter Versuch verbraucht nichts. Wartezeit, Anwesenheit und Zähler laufen auf einer Uhr, die nie
zurückspringt: Wird die Uhr des Rechners zurückgestellt, wartet trotzdem nichts länger als 30 s.

Ein Neustart des Containers verliert nur, was gerade wartet (höchstens 30 s), die Zähler und die Liste
der benutzten Nachweise und Einladungen. Ein Nachweis (5 min) oder eine Einladung (10 min) könnte nach
einem Neustart innerhalb ihrer Frist ein zweites Mal genommen werden; das steht in
`docs/sicherheit.md`.

## Was die Apps ändern (Trainerbuch)

Gegenüber dem IONOS-Treffpunkt (`X-Modus` mit `ping`, `lauschen`, `senden`, `klingeln`):

- feste Adresse des Treffpunkts statt der relativen Pfade in `HUB`, dazu `connect-src` in der CSP;
- `abholen` statt `lauschen` (keine gehaltene Verbindung mehr), Anwesenheit über `abholen`;
- `ablegen` an Kennungen statt `senden` an alle Lauschenden: Was heute an alle geht (`abgleich-da`,
  `test-bereit`, `direkt-angebot` ohne `an`), geht künftig an die bekannten Geräte des Kanals
  (`docs/plan.md` § 7, Schritt 8, „Verteilung von Änderungen“);
- Einschreiben mit dem Nachweis der Testzone oder der Einladung eines Trainergeräts statt
  `einschreiben.php` mit Tester-Login; neue Gerätekennungen, die Testgeräte scannen sich einmal neu;
- `klingeln` unverändert im Inhalt, nur als `POST /v1/klingeln`.
