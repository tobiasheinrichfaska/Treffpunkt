# Sicherheit und Datensparsamkeit des Treffpunkts

Stand 15.11.2026, Fassung 1 der Schnittstelle (`docs/schnittstelle.md`). Vorbild:
`docs/sicherheitspruefung.md` im TKD-Trainerbuch. Testphase: nur erfundene Daten, eigene Testgeräte.

## Was der Treffpunkt sieht

Offen gesagt, damit niemand mehr erwartet:

| Was | Wer sieht es | Wie lange |
|---|---|---|
| IP-Adresse des Geräts | bunnys Rand; im Container als `X-Forwarded-For` (der Treffpunkt liest es nicht) | Pull-Zone: Protokolle aus (Soll). Magic Containers zeigt HTTP-Protokolle mit Client-IP 3 Tage — ob abschaltbar, ist offen |
| Zeitpunkt jeder Anfrage | Treffpunkt | im RAM: Anwesenheit 30 s, Zähler bis 1 Stunde |
| Gerätekennung von Absender und Empfänger | Treffpunkt | im RAM, solange die Nachricht wartet (≤ 30 s) |
| Gerätekennung des anfragenden Geräts, mit Zeitpunkten | Treffpunkt, in den Zählern | 60 s nach seiner letzten Anfrage; nach Klingeln oder Einladen bis 1 Stunde. Nur Zeitpunkte, für große Körper (über 16 KB) auch deren Größe (60 s); kein Ziel, kein Inhalt |
| App des Geräts | Treffpunkt (steht im Zugang) | — |
| Größe einer Nachricht | Treffpunkt | ≤ 30 s |
| Inhalt | **niemand**: Ende-zu-Ende verschlüsselt von der App | ≤ 30 s im RAM, beim Abholen gelöscht |
| Push-Endpunkt beim Klingeln | Treffpunkt, Apple/Google/Mozilla/Microsoft | nur für die Weitergabe; gezählt wird nur der Zeitpunkt, nie das Ziel |

**Nichts auf der Platte.** Kein Volume, keine Datei, keine Datenbank. Ein Neustart verliert alles
Wartende (gewollt).

**Die Ausgabe des Containers** enthält nur: Start mit App-Namen und Port, alle 5 Minuten Zählwerte je
Endpunkt und je Art der Ablehnung sowie die Größen dessen, was der Treffpunkt kurz behält (Marken,
Zählerschlüssel, Anwesende, Postfächer, Absender, Geräte mit einem Körper unterwegs), Ende, und bei einem
inneren Fehler nur dessen Art. Nie eine
IP-Adresse, Kennung, einen Zugang, Nachweis oder Inhalt (Test „the counts name endpoints and kinds of
refusal, never an id or content“, „an internal error answers 500 and logs only its kind“).

## Was zu schützen ist

| Wert | Wo | Wer ihn hat |
|---|---|---|
| `TREFFPUNKT_SCHLUESSEL` | Umgebungsvariable bei bunny | Tobias; jeder mit Zugang zum bunny-Konto kann ihn dort vermutlich lesen (kein Secret-Typ bei Magic Containers dokumentiert) |
| Privater Nachweis-Schlüssel | Secret der Login-Skripte bei bunny | Tobias |
| Zugang eines Geräts | auf dem Gerät | das Gerät |
| Nachrichten | 30 s im RAM | verschlüsselt, nur der Empfänger kann sie lesen |

## Angreifer und was sie können

### 1. Fremde im Internet (ohne Zugang)

- Erreichen nur `/gesund`, Vorabanfragen und Ablehnungen (401/403).
- Zum Einschreiben brauchen sie einen frischen Nachweis (Tester-Login der Testzone) oder eine
  Einladung (QR eines eingeschriebenen Geräts).
- **Erst der Kopf:** Adresse, Methode, Herkunft, `Content-Type` und Zugang werden entschieden, bevor
  ein Byte des Körpers gelesen wird. Ohne Zugang hält der Treffpunkt also höchstens die 16 KB eines
  Einschreibens je Verbindung im Speicher, nie die 6 MB von `ablegen`. Ein Körper, der nicht in 14 s
  ankommt, bekommt 408. Kopfzeilen, die nicht in 10 s da sind, beendet Node (es sieht jede Sekunde
  nach); die ganze Anfrage darf höchstens 30 s dauern.
- **Grenzen:** feste Körpergrößen je Endpunkt, schon beim Lesen (16 KB, `klingeln` 8 KB, `ablegen`
  6 MB; darüber sofort 413, auch ohne `Content-Length`), Adressen mit `?` abgelehnt, Einschreiben je App 120 je Stunde mit Nachweis und 60 je
  Stunde mit Einladung, gezählt erst, wenn alles andere geprüft ist (Müll, ein schon benutzter
  Nachweis oder eine fremde Herkunft verbrauchen das Kontingent nicht).
- **Rest:** Eine Flut ohne Zugang bremst der Treffpunkt nicht je IP (er liest keine IPs). Dafür gibt
  es bunnys Schutz am Rand.

### 2. Eine fremde Webseite im Browser eines Testers

- CORS nur für die Herkünfte der App; ohne passende Herkunft keine lesbare Antwort. Auch die Seite
  einer **anderen App** bekommt für einen Zugang, eine Einladung oder einen Nachweis, der nicht ihre
  App nennt, immer dieselbe undurchsichtige Ablehnung: Ob er gültig, abgelaufen oder gefälscht ist,
  erfährt sie nicht (die genannte App wird vor der Unterschrift geprüft).
- Jede Anfrage mit Zugang braucht `Authorization: Bearer …`. Den hat eine fremde Seite nicht; Cookies
  gibt es nicht. Kein CSRF.

### 3. Ein eingeschriebenes Gerät, das sich schlecht benimmt (oder ein gestohlener Zugang)

- **Lesen:** nur das eigene Postfach. Absender ist immer die Kennung aus dem Zugang, fälschen geht
  nicht.
- **Zuschütten:** Grenzen je Absender (4 MB), je Empfänger (100 Nachrichten, 2 MB), je App (32 MB),
  gesamt (64 MB), 300 Anfragen je Minute und Gerät (ein Gerät darüber bekommt 429, bevor sein Körper
  gelesen wird; gezählt wird jede Anfrage mit Zugang am Kopf, auch eine mit unlesbarem Körper).
  Unterwegs sein dürfen je Gerät zwei Körper, je App 32 MB, von allen Geräten mit Zugang zusammen
  64 MB, ohne Zugang 8 MB (darüber 503 `beschaeftigt`): Auch ein gestohlener Zugang lässt den Speicher
  nicht mit parallelen 6-MB-Körpern volllaufen, und die Geräte einer App halten die anderen nicht auf.
  Von den Töpfen mit Zugang bleibt 1 MB den kleinen Körpern (angesagt höchstens 16 KB): Große,
  langsame Ablagen halten Abholen, Ping, Erneuern, Klingeln und kleine Ablagen nicht auf. **Rest:** Drei Geräte einer App können mit langsamen großen
  Ablagen die großen Ablagen der übrigen Geräte dieser App für die Zeit aufhalten (503, „gleich noch
  einmal“); Nachrichten abholen und kleine Ablagen gehen weiter.
  Der Platz ist nur fürs Lesen; ist der Körper da, ist er frei. Lesen und Auswerten eines Körpers laufen
  aber auf dem einen Faden, den alle Apps teilen: Darum darf ein Gerät je Minute große Körper (über
  16 KB) von zusammen 32 MB schicken (darüber 429), die Geräte einer App 64 MB (darüber 503), am Kopf
  geprüft; gezählt wird erst der gelesene Körper, kleine zählen nicht und gehen immer weiter. **Rest:**
  Ein Gerät mit Zugang (und die Geräte, die es einlädt) kann mit echten großen Ablagen von zusammen
  64 MB die großen Ablagen seiner App bis zum Ende der Minute aufhalten (503); Abholen, Ping, kleine
  Ablagen und die anderen Apps gehen weiter. **Rest:** Ein
  Körper aus lauter kleinen JSON-Bausteinen kostet beim Auswerten bis etwa 0,7 s je 6 MB (gemessen
  16./18.11.2026 im Container einer Cloud-Sitzung); mit dem Budget sind das höchstens etwa 4 s je Gerät
  und Minute und 8 s je App und Minute, in denen andere Anfragen kurz warten. Jede Nachricht zählt dabei mindestens 1 KB, und
  sie bekommt beim Ablegen einen eigenen Puffer (sonst hielte eine kleine Nachricht 8 KB aus Nodes
  gemeinsamem Vorrat fest). So viel kostet
  ihr Platz im Arbeitsspeicher etwa: Winzige Nachrichten an frische Kennungen füllen den Speicher also
  nicht unbemerkt (höchstens 4096 wartende je Absender, 65 536 insgesamt). Abgelehnt mit Grund, nie
  gekürzt.
- **Uhr:** Wartezeit, Anwesenheit und Zähler laufen auf einer Uhr, die nie zurückspringt. Stellt
  jemand die Uhr des Rechners zurück, wartet trotzdem nichts länger als 30 s.
- **Anwesenheit:** nur zu Kennungen, die es selbst nennt. Kennungen sind 128 Zufallsbits, erraten
  geht nicht. Wer eine Kennung kennt (ein bekanntes Gerät), sieht, wann es abholt.
- **Klingeln:** nur an die vier Push-Dienste, 60 je Stunde, nur der Status kommt zurück. Kein offener
  Weiterleiter.
- **Einladen:** 20 je Gerät und Stunde. Eine Kette eingeladener Geräte ist möglich; ob sie in der App
  etwas sehen, entscheidet deren Vertrauen (beim Trainerbuch: Scan in der Halle oder „Zugriff
  gewähren“). Eine solche Kette verbraucht höchstens die 60 Einschreibungen mit Einladung je App und
  Stunde; die 120 mit Nachweis bleiben den Testern.
- **Sperren:** Kennung in `gesperrt` (`konfiguration/apps.json`, neu ausrollen) oder Geheimwert
  wechseln. Ohne Erneuern endet ein Zugang nach 90 Tagen.

### 4. Ein Gerät einer anderen App

- Postfächer und Anwesenheit sind je App getrennt. Ein AZP-Gerät, das eine Trainerbuch-Kennung kennt,
  legt in das AZP-Postfach dieser Kennung; kein Trainerbuch-Gerät holt dort ab. Es verbraucht nur die
  Grenzen der eigenen App – auch beim Platz für Körper unterwegs (32 MB je App) und bei den Bytes je
  Minute (64 MB je App). Geteilt sind nur die Deckel über alle Apps (64 MB wartend, 64 MB unterwegs),
  die je App höchstens zur Hälfte füllt, und die Rechenzeit des einen Fadens (siehe § 3, „Rest“).

### 5. bunny und wer das bunny-Konto bedienen kann

- Sieht IP-Adressen, Zeiten, Größen, verschlüsselte Inhalte.
- **Mit `TREFFPUNKT_SCHLUESSEL`** lassen sich Zugänge für jede Kennung ausstellen: Postfächer leeren
  (nur Chiffrat, ≤ 30 s) und als jede Kennung ablegen. Die Inhalte bleiben geschützt, weil die Apps
  Ende-zu-Ende verschlüsseln und unterschreiben (Trainerbuch: E2–E3). Deshalb 2FA am bunny-Konto.
- **Das Image** kommt nach Tag aus dem privaten Paket auf ghcr.io. Ein Tag lässt sich überschreiben:
  Wer in das Paket schreiben kann, könnte unter dem Tag eines grünen Commits anderen Code ablegen.
  Schreiben dürfen Tobias selbst und Läufe der Workflows dieses Repos. In `tests.yml` hat nur der Job
  `Image` das Recht dazu, und er läuft nur für einen Push auf `main` (ein Test hält das fest). Ein Pull
  Request dieses Repos könnte die Workflow-Datei aber selbst ändern und so doch schreiben: Die Regel
  schützt vor Versehen, nicht vor einem böswilligen Pull Request. Freigabe rollt nur ein Tag aus, dessen
  Commit auf `main` liegt und dort grüne `Tests` und `Image` aus einem Push auf `main` hat (ältere
  Commits haben ein grünes `Image` aus ihrem Pull Request, das nichts geschoben hat); einen Digest
  prüft Freigabe nicht. Ob das neue Image läuft, sieht Freigabe an `/gesund` (`"stand"`).
  Ob bunny auf den Digest festgelegt werden kann (`imageDigest`), ist offen.
- **Das Registry-Token bei bunny** (klassisch, `read:packages`, `read:org`) kann alle privaten Pakete
  von Tobias' Konto lesen, aber nichts schreiben und kein Repo lesen. Wer es aus dem bunny-Konto holt,
  sieht den Code des Treffpunkts — die Sicherheit hängt nicht daran, dass er geheim ist. Abhilfe:
  Token auf GitHub widerrufen und neu anlegen. Es läuft nie ab (Tobias, 15.11.2026): Gelangt es nach
  außen, gilt es, bis es widerrufen ist.

### 6. Ein durchgesickerter Nachweis-Schlüssel

- Erlaubt, Geräte einzuschreiben. Daten sieht so ein Gerät erst, wenn die App ihm vertraut. Abhilfe:
  neues Schlüsselpaar, alten öffentlichen Schlüssel aus `apps.json` nehmen, neu ausrollen.

### 7. Wiederholte Nachweise und Einladungen

- Jeder Nachweis und jede Einladung gilt einmal (Liste im RAM bis zu ihrem Ende). **Nachweise** misst
  der Treffpunkt an der Uhr des Rechners, aber nie früher als an der Startzeit plus der seitdem
  vergangenen Zeit: Wird die Uhr zurückgestellt, nachdem die Marke eines Nachweises schon gelöscht ist,
  gilt er trotzdem nicht wieder. **Einladungen** stellt und prüft er allein nach Start plus vergangener
  Zeit: Sie gelten ihre 10 Minuten, was die Uhr des Rechners auch tut. Marken gehen erst, wenn ihr Ende hinter Start plus vergangener Zeit liegt: Auch eine Uhr,
  die nach dem Start vorging und dann richtig gestellt wird, bringt keinen benutzten Nachweis zurück,
  und sie sperrt niemanden aus.
- **Rest:** Ging die Uhr **schon beim Start** vor, misst der Treffpunkt bis zu einem Neustart zu spät:
  Frische Nachweise gelten dann als abgelaufen. Er kann das nicht von einer später zurückgestellten Uhr
  unterscheiden. Die Zählwerte zeigen es als `uhrRueckstandS`; Abhilfe ist ein Neustart der App bei
  bunny.
- **Rest:** Nach einem Neustart ist diese Liste leer. Ein Nachweis (≤ 6 min) oder eine Einladung (10
  min) könnte innerhalb seiner Frist noch einmal genommen werden — aber nur von dem, der ihn hat.

## Regeln und ihre Tests

Jede Regel hat einen Test, der ohne sie fehlschlägt. Geprüft am 15.11.2026 durch Herausnehmen der
Regel (12 Regeln, jede ließ mindestens einen Test fehlschlagen; die eine Lücke — Einladung nach dem
Abschalten von `einladen` — hat seitdem ihren Test). Nach der ersten Qualitätsprüfung (15.11.2026)
noch einmal für 11 Regeln, die bis dahin ohne fehlschlagenden Test herausnehmbar waren (Aufräumen von
Marken und Zählern, Reihenfolge der Zählung, entfernte App, Anwesenheit, Grenzwerte, Körpergrenze im
Strom): jede fällt jetzt mindestens einen Test. Nach der zweiten Prüfung (16.11.2026) noch einmal 14
Regeln (Uhren nicht verwechselt, je Gerät, nichts vor dem Kopf gelesen, Zeitgrenze, eigener Puffer,
genannte App, späteste Uhrzeit, ganze Millisekunden, Stand): jede fällt mindestens einen Test. Nach
der dritten Prüfung (16.11.2026) noch einmal 22 Regeln (Uhr ohne Einrasten, kein Wiederaufleben,
`Connection: close`, Körper unterwegs, Freigeben, Deckel, Rate vor dem Körper, jede Zählung und jedes
Ausstellen an der richtigen Uhr, strenge Körper, Aufräumen, Probe): jede fällt mindestens einen Test.
Nach der vierten Prüfung (16.11.2026) noch einmal 13 Regeln (Topf je App, Marken nach der Untergrenze,
Uhrrückstand, Zählung am Kopf, Prüfabstand von Node, Platz nur fürs Lesen, `Math.min`, beide
Einladungszähler, leere Postfächer, Abbruch, zwei Schreibweisen im Workflow): jede fällt mindestens
einen Test. Nach der fünften Prüfung (16.11.2026) noch einmal 13 Regeln (413 vor den Töpfen,
einmaliges Freigeben, drei Zeitgrenzen, CORS der HTTP-Schicht, fünf strenge Werte, zwei Regeln des
Workflow-Lesers): jede fällt mindestens einen Test. Nach der sechsten Prüfung (16.11.2026) noch einmal
6 Regeln (Einladung ab der Untergrenze, Zählung am Kopf, Zählung bei abgelehntem Platz, Absender
vergessen, Abbruch, Rechte-Zeilen): jede fällt mindestens einen Test. Nach der siebten Prüfung (16.11.2026) noch einmal die
neuen Regeln (Einladung nach der Untergrenze geprüft, Fenster je Zähler, Start-Teile, schlichte
Job-Schlüssel, Klingeln über der Grenze, Ausstellen bei nachgehender Uhr): jede fällt mindestens einen
Test. Nach der achten Prüfung (16.11.2026) noch einmal 7 Regeln (Reserve, drei Freigaben im Postfach,
Körperzeit, Fortsetzung eines Werts und Anführung im Workflow): jede fällt mindestens einen Test. Nach
der neunten Prüfung (16.11.2026) noch einmal die neuen Regeln (Reserve nach der angesagten Länge, beide
Töpfe genau bis zur Kante, Frist und Leerlauf beim Push-Dienst, TLS-Prüfung, keine Weiterleitung,
CORS beim 500, Abbruch ohne Antwort und Zählung, Klingel-Grenzen im Text): jede fällt mindestens einen
Test. Nach der zehnten Prüfung (16.11.2026) noch einmal 12 Änderungen (Marken bis zum Ende, Sender des
Containers und seine Frist, jede Grenze an ihrer Kante, riesige angesagte Länge, gezählte Ablehnung je
Empfänger): jede fällt mindestens einen Test. Nach der elften Prüfung (18.11.2026) noch einmal die neuen Regeln (Bytes je Gerät und je App und
Minute, die AZP-Seite beim Ablegen, Einladen und Erneuern, dieselbe Kennung nach dem Erneuern, Geräte mit
einem Körper unterwegs, Leerlauf und Prüfabstand, das Kontingent für Einladungen bei vorgehender Uhr):
jede fällt mindestens einen Test. Nach der zwölften Prüfung (18.11.2026, Kontroll-Audit) noch einmal 9 Änderungen
(Bytes je Minute nur für große Körper und erst nach dem Lesen gebucht, ein Zähler mit laufender Summe,
Zählung bei Herkunft und Typ, die Obergrenze von PORT, die Einladung als Link in der Probe): jede fällt
mindestens einen Test.

| Regel | Test (`tests/`) |
|---|---|
| Nachweis und Einladung nur einmal, auch über das Aufräumen bis zu ihrem Ende | `treffpunkt.test.ts` „enrolment with a proof…“, „invitation by QR…“, „a proof and an invitation stay used across tidying up…“ (auch in ihrer letzten Sekunde) |
| Herkunft muss zur App des Geräts gehören; die Herkunft einer anderen App bekommt keinen CORS-Kopf, gültig oder nicht | „access: missing, changed, expired, blocked, other app’s origin“, „an origin of another app gets its refusal without a CORS header“, „from an origin of another app every credential gets the same opaque refusal“ |
| Erst der Kopf, dann der Körper; Grenze je Endpunkt schon beim Lesen; 408 bei zu langsamem Körper | `treffpunkt.test.ts` „the head is judged before the body…“, „a request judged by its head is counted once…“; `server.test.ts` „the head is judged before the body…“, „an announced length over the endpoint’s limit…“, „a body without a length…“, „a body that arrives too slowly…“ |
| Uhr zurück macht keinen benutzten Nachweis oder keine Einladung wieder gültig | „the wall clock set back brings no used proof or invitation back“ |
| Uhr vor löscht keine Grenze; Anwesenheit endet nach 30 s | „the wall clock set forward wipes no limit…“ |
| Ganze Millisekunden in `alterMs` und `ms` | „ages and durations are whole milliseconds…“ |
| Eine kleine Nachricht hält keinen geteilten Puffer fest | `postfach.test.ts` „a kept message has a buffer of its own…“ |
| `/gesund` nennt den Commit des Images | „GET /gesund answers for the health check with the commit…“, `server.test.ts` „health check with the commit…“ |
| Je Gerät: Anfragen und Klingeln | „requests per device and minute are limited, each device on its own“, „ringing: …“ |
| Ein abgelehntes Ablegen nimmt nichts, auch nicht die lesbaren Einträge davor | „drop refused as a whole…“ |
| Abgewiesenes wird nicht gelesen (`Connection: close`) | `server.test.ts` „the head is judged before the body…“ und die 413/408-Tests |
| Körper unterwegs: zwei je Gerät, Deckel mit und ohne Zugang, wieder frei nach Ende oder Abbruch; Anfragen der Minute schon vor dem Körper | `treffpunkt.test.ts` „bodies on the way…“, „a device over its requests per minute…“; `server.test.ts` „two bodies per device on the way…“ |
| Eine vorgehende Uhr sperrt nach dem Richtigstellen niemanden aus | „a wall clock that ran ahead and is set right…“ |
| Abgelaufene Zugänge bleiben abgelaufen, wenn die Uhr zurückgeht; Neues wird richtig ausgestellt | „an expired access stays expired…“ |
| Alle Kontingente überstehen eine um das ganze Fenster vorgestellte Uhr | „the wall clock set forward by the whole window…“ |
| Strenge Körper ohne fremde Felder an jedem Endpunkt; VAPID höchstens 1024; `bis` ganzzahlig | „strict bodies…“, `klingeln.test.ts` „a ring request is read strictly“, `nachweis.test.ts` „strict payload…“ |
| Aufräumen vergisst, was zu Ende ist (Marken, Zähler, Anwesenheit) | „tidying up forgets what ended…“ |
| Die Probe nimmt einen kurzen Commit | `probe.test.ts` |
| Körper unterwegs je App | „bodies on the way are kept per app…“ |
| Marken nur nach Start plus vergangener Zeit gelöscht | „a wall clock that ran ahead and is set right brings no used proof back“ |
| Uhr schon beim Start vor: Nachweise abgelehnt, `uhrRueckstandS` zeigt es | „a wall clock ahead at the start…“ |
| Jede Anfrage mit Zugang zählt am Kopf, auch mit unlesbarem Körper | „every request with an access counts per minute…“ |
| Angesagte Länge über jedem Deckel: 413, nie 503, auch jenseits der sicheren Ganzzahlen | `server.test.ts` „an announced length over the endpoint’s limit…“, `treffpunkt.test.ts` „too large stays 413…“ |
| Jede Grenze gilt genau an ihrer Kante (50 Empfänger, 200 Kennungen, 16 KB / 8 KB / 6 MB) | „only JSON, only up to the size per endpoint…“, „presence is asked only for named ids…“, „drop refused as a whole…“; `server.test.ts` „a body exactly at its limit…“ |
| Ablehnungen je Empfänger werden gezählt (`fehler` in den Zählwerten) | „drop to several receivers at once…“ |
| Bytes je Gerät und je App und Minute nur für große Körper, am Kopf geprüft; Abholen, Ping und kleine Ablagen gehen weiter, die andere App auch; zu groß bleibt 413 | „bytes per minute: large bodies of a device and an app…“, `grenzen.test.ts` „a counter of bytes…“ |
| Gebucht wird erst der gelesene Körper: angesagt und abgebrochen kostet nichts, ein unlesbarer zählt | „bytes per minute are booked only for a body read…“ |
| Ein Zähler kostet je Aufruf gleich viel, wie viel sein Fenster auch hält | `grenzen.test.ts` „a counter costs the same per call…“ |
| Auch Ablehnungen wegen Herkunft oder Typ zählen für ihren Endpunkt | „a request judged by its head is counted once…“ |
| PORT nur 1–65 535 | `start.test.ts` „settings: read strictly…“ |
| Die Probe nimmt eine Einladung oder den Link des Trainerbuchs, nichts anderes | `probe.test.ts` „the probe takes an invitation…“ |
| Erneuern gibt dieselbe Kennung | „renewing gives a new access with a new end…“ |
| Die Kennung eines Geräts mit Körper unterwegs geht, sobald der Körper gelesen oder abgebrochen ist (`unterwegs` in den Zählwerten) | „bodies on the way: two per device…“, `server.test.ts` „a client that goes away mid-body…“ |
| Jedes Kontingent übersteht eine um das Fenster vorgestellte Uhr, auch Einschreiben mit Einladung | „the wall clock set forward by the whole window wipes no quota“ |
| Kopfzeilen-Frist wirkt nach Sekunden, nicht nach 30 s | `server.test.ts` „headers that do not come in time…“ |
| Platz nur fürs Lesen, ein wartendes Klingeln hält keinen | `server.test.ts` „the room is for reading the body…“ |
| Ein Abbruch zählt nicht als innerer Fehler | `server.test.ts` „a client that goes away mid-body…“ (die Regeln sehen den halben Körper nicht, keine Ablehnung gezählt) |
| Aufräumen vergisst auch leere Postfächer und beide Einladungszähler | „tidying up forgets what ended…“, `postfach.test.ts` „a message waits at most 30 s“ |
| Zu groß bleibt 413, auch bei vollem Topf oder zwei Körpern des Geräts | „too large stays 413 when the pots are busy…“ |
| Doppelt freigegeben zählt einmal | „bodies on the way…“ (Töpfe danach genau wieder voll belegbar) |
| Zeitgrenzen 10 s / 14 s / 30 s, Leerlauf 65 s, Prüfabstand 1 s, wie in der Schnittstelle | `server.test.ts` „the time limits are those of the interface…“ |
| Ablehnungen der HTTP-Schicht ohne CORS für fremde Herkunft, mit CORS für die eigene (auch der 500) | `server.test.ts` „an address with a query…“, „an internal error…“ |
| Strenge Werte: Anwesenheits-Kennungen, kanonisches base64url, Status des Push-Dienstes, Form des Content-Type | „strict values…“ |
| Eine Einladung gilt 10 Minuten nach der eigenen Uhr des Treffpunkts, ob die Uhr des Rechners vorgeht, nachgeht oder gestellt wird | „an invitation shown while the wall clock ran ahead…“, „a wall clock behind at the start and set right later…“ |
| Jeder Zähler hält sein ganzes Fenster (Minute, Stunde) und lässt danach los | „every counter holds for its whole window…“, `grenzen.test.ts` (Fenster in der Tabelle) |
| Ein Klingeln über der Grenze verlässt den Treffpunkt nicht | „ringing: unknown push service refused…“ |
| Erneuerte und neue Zugänge bei nachgehender Uhr richtig ausgestellt | „with the wall clock behind, renewed and new accesses…“ |
| Start: Einstellungen streng, monotone Uhr, Aufräumen jede Sekunde, Zählwerte alle 5 Minuten | `start.test.ts` |
| Reserve für kleine Körper (angesagt höchstens 16 KB) in beiden Töpfen mit Zugang, auch für kleine Ablagen | „large slow bodies leave room for the small ones…“ (Töpfe genau bis zur Kante gefüllt) |
| Der Push-Dienst muss binnen 10 s antworten, auch wenn er tröpfelt; TLS geprüft; keine Weiterleitung; der Container nutzt genau diesen Sender | `klingeln.test.ts` „the push service is reached over TLS only…“, „a push service that is silent…“; `start.test.ts` „the start rings through the real sender…“ |
| Klingel-Grenzen wie in der Schnittstelle (Adresse 900, VAPID 1024, TTL 0–86 400, Dringlichkeiten, Inhalt, 10 s) | `klingeln.test.ts` „the ringing limits are those of the interface“ |
| Grenzen je App und je Empfänger werden beim Abholen und Verfallen wieder frei | `postfach.test.ts` „the limits per app and per receiver are freed too…“ |
| Der Server nutzt die Körperzeit der Schnittstelle (14 s) | `server.test.ts` „the time limits are those of the interface…“ |
| Jede Anfrage zählt ihren Endpunkt einmal, auch wenn ihr Körper abgelehnt wird | „a request judged by its head is counted once…“, `server.test.ts` „a body refused while it is read…“ |
| Die Kennung eines Absenders geht mit seiner letzten Nachricht | `postfach.test.ts` (`absender` in `stand()`) |
| Rechte eines Jobs nur als schlichter Block | `workflow.test.ts` |
| Zugang oder Einladung einer entfernten App | „an access or invitation of an app no longer configured…“ |
| Gesperrte Kennung | „access: missing, changed, expired, blocked, other app’s origin“ |
| Nicht an sich selbst, keine Doppel, nichts Leeres, ≤ 64 KB | „drop refused as a whole when unreadable…“ |
| Einladen je App abschaltbar, auch für schon ausgestellte | „invitation: expires…“, „an invitation made before einladen was switched off…“ |
| Postfächer je App, auch von der AZP-Seite: Ablegen, Einladen und Erneuern bleiben in der eigenen App | `postfach.test.ts` „mailboxes are per app…“, `treffpunkt.test.ts` „apps are separate…“, „apps are separate the other way too…“ |
| 30 s Wartezeit, auch wenn die Uhr zurückgestellt wird | `postfach.test.ts` „a message waits at most 30 s“, `treffpunkt.test.ts` dito, „the wall clock set back…“ |
| Grenzen je Empfänger, Absender, App, gesamt; jede Nachricht zählt mindestens 1 KB | `postfach.test.ts` „limits…“, „every message counts at least 1 KB…“ |
| Grenzwerte wie in `docs/schnittstelle.md` | `grenzen.test.ts` „the table of limits…“ |
| Zähler behalten beim Aufräumen, was im Fenster liegt | `grenzen.test.ts` „the counter…“, `treffpunkt.test.ts` „every limit survives tidying up…“, „invitations per device and enrolments by invitation…“ |
| Anwesenheit beim Ablegen und über das Aufräumen | „presence: a drop says the receiver is present…“ |
| Nur bekannte Push-Dienste, keine Doppelgänger | `klingeln.test.ts` „look-alikes, http, ports and logins are refused“ |
| Klingeln je Stunde begrenzt; eine abgelehnte Anfrage verbraucht nichts | `treffpunkt.test.ts` „ringing: unknown push service refused…“ (der Wert 60: `grenzen.test.ts`) |
| Einschreiben: eigenes Kontingent für Einladungen; Abgelehntes verbraucht nichts | „an invitation chain does not use up…“, „refused enrolments use up no quota…“ |
| Nachweis höchstens 5 min (+1) gültig | `nachweis.test.ts` „expired, or valid for longer…“ |
| Einladung höchstens 10 min | `zugang.test.ts` „an invitation made for longer than 10 minutes…“ |
| Keine Adresse mit Abfrage | `server.test.ts` „an address with a query is refused…“ |
| Körper über 6 MB: 413, ohne ihn ganz zu lesen, auch ohne `Content-Length`; die Ablehnungen der HTTP-Schicht mit denselben Köpfen wie jede Antwort | `server.test.ts` „a body over the largest limit…“, „an announced length…“, „a body without a length…“ |
| Ein Abbruch des Geräts mitten im Körper ist kein innerer Fehler | `server.test.ts` „a client that goes away mid-body…“ |
| Nur der Job „Image“ auf `main` darf das Paket schreiben (der Leser schlägt bei jedem Wert von `packages` außer `read`/`none` an und verlangt die Bedingung wörtlich); Actions per Commit | `workflow.test.ts` (mit Änderungen, die fallen müssen, und harmlosen, die bestehen müssen) |
| Zugang, Einladung, Nachweis nicht verwechselbar und nicht änderbar | `zugang.test.ts`, `nachweis.test.ts` |
| Ausgabe ohne Kennungen und Inhalte | `treffpunkt.test.ts` „the counts…“, `server.test.ts` „an internal error…“ |
| Konfiguration falsch → kein Start | `konfiguration.test.ts` |
| Zertifikat nicht änderbar, ohne Besitznachweis wertlos (fehlt, falscher Schlüssel, falsche Uhrzeit, anderer Körper, Wiederholung) | `zulassung.test.ts` „a certificate is signed…“, „…proof of possession“, „the signature covers the body“, „…replay“ |
| Mandanten getrennt (Postfächer, Anwesenheit); Einladung vererbt den Mandanten, Rolle kommt aus der Einladung | `zulassung.test.ts` „old and new devices of tenant 1…“, „an invitation hands on the tenant…“, „invitation of a device…“ |
| Wer wen einladen und sperren darf (Büro alle, `lb:<id>` die eigenen, sonst nur sich selbst; ein altes Ticket nie) | `zulassung.test.ts` „who may invite whom“, „blocking: a `lb:<id>` device…“, „a device that said it is the office on the old access…“ |
| Sperre wirkt auf Zertifikat und altes Ticket, ist nicht „abgelaufen“; Einladung eines Gesperrten gilt nicht; Sperrliste und Sperren je Stunde begrenzt | `zulassung.test.ts` „blocking: the office blocks…“, „blocking reaches a device with the old access“, „the list of blocked devices…“ |
| Zertifikat 60 Tage; Sperre hält, ohne dass das Gerät erneuern kann; Schlüsselring prüft alt, stellt nur neu aus | `zulassung.test.ts` „a certificate lives 60 days…“, „a block is not renewed away…“, „the ring of secrets…“, `start.test.ts` |
| Höchstzahl Geräte je Mandant; Register räumt nach 90 Tagen auf | `zulassung.test.ts` „a tenant holds at most 50 devices“, „a device nobody has heard from…“ |
| Gründerticket und Auswertung: nur mit dem Entwicklerschlüssel, höchstens eine Stunde bzw. 5 Minuten, einmal | `zulassung.test.ts` „founder ticket…“, „the evaluation…“ |
| Entwicklerpasswort: nur der Hash, Ablauf, Anzahl, nur solange der Mandant leer ist, Versuche begrenzt | `zulassung.test.ts` „developer password…“, `konfiguration.test.ts` |
| `streng`: nur das neue Verfahren, „Neue Fassung nötig“ statt „gesperrt“ | `zulassung.test.ts` „`streng` for a tenant…“ |
| Schlüssel des Entwicklers nie in einem Repo | `entwickler.test.ts` |

## Zulassung, Mandanten und Sperren (21.11.2026, `docs/auftrag-zulassung.md`)

**Was der Treffpunkt dazu weiß** — nur im Arbeitsspeicher: je App und Mandant die Geräte (Kennung,
Rolle, wer eingeladen hat, erster und letzter Zeitpunkt, welches Verfahren, Protokollversion) und die
Sperrliste. Beides taucht nie im Protokoll auf (nur Zahlen: `geraete`, `gesperrt`). Rollen und
Einladender stammen vom Treffpunkt, nie vom neuen Gerät, außer beim alten Weg (unten).

**Was gelöst ist:** Ein gestohlenes Zertifikat nützt ohne den Geräteschlüssel nichts (Besitznachweis
je Anfrage, mit Körper und Zeit, einmal). Ein Gerät eines Mandanten erreicht nie eines eines anderen.
Ein LB-Gerät sperrt nur die eigenen. Eine Einladung hängt am Einlader: Wird er gesperrt, gilt sie
nicht mehr.

**Was bleibt, und warum es hinnehmbar ist (Testphase, erfundene Daten):**

- **Der alte Weg (Phase 1) bleibt Träger.** Ein Gerät mit altem Ticket `z1` oder Nachweis der Testzone
  ist ein Inhaber-Wert; es darf beim Erneuern und Einschreiben seine **Rolle selbst nennen**
  (der Treffpunkt kann sie nicht prüfen). Ein Tester kann sich so zum Büro machen — mit dem
  alten Ticket aber weder sperren noch Geräte ansehen. Mit dem Zertifikat kann er es; im Mandanten `1`
  darum erst nach `streng` wirklich sicher. Das Ende des alten Wegs ist Tobias' Schalter, nicht
  eine Frist.
- **Sperrliste, Geräteregister und Passwortzähler überstehen einen Neustart nicht** (der Treffpunkt hat
  keinen dauerhaften Speicher, `docs/plan.md` § 2). Nach einem Neustart sind Gesperrte wieder drin,
  bis die App die Sperre noch einmal schickt (ihr Geräteverzeichnis bleibt bei ihr: „Gerät entfernen“
  schickt sie erneut); ein Passwort mit „höchstens N“ gilt wieder N-mal und für einen leeren
  Mandanten. Das Zertifikat selbst gilt weiter (es ist zustandslos). Dauerhaft wäre die Sperre nur über
  `gesperrt` in `apps.json` (neues Image) oder einen Speicher — **Entscheidung für Tobias**.
- **Befristung statt Dauer-Sperre (Tobias 2026-11-21):** Ein Zertifikat gilt 60 Tage; wer gesperrt ist, kann
  nicht erneuern. Das Büro meldet eine Sperre einmal und danach täglich, 60 Tage lang (90 bei altem Ticket).
  Ein Schlüsselwechsel mit Quittungen am Treffpunkt entfällt. Die Vertraulichkeit der Gruppe sichert die App
  (neuer Gruppenschlüssel, Absender gegen die signierte Geräteliste; `docs/auftrag-zulassung.md`), nicht
  die Sperre. Geräte, die länger als 60 Tage nichts vom Treffpunkt hören, brauchen eine neue Einladung.
- **Schlüsselring:** `TREFFPUNKT_SCHLUESSEL_ALT` (`<wert>@<JJJJ-MM-TT>`) lässt einen alten Geheimwert bis zu diesem Datum weiter prüfen (nie unterschreiben, danach von selbst wirkungslos),
  damit ein regelmäßiger Wechsel nicht alle Geräte hinauswirft (`docs/bereitstellen.md`).
- **Die Höchstzahl 50 gilt nach einem Neustart erst wieder, wenn die Geräte sich melden.**
- **Ein Gerät mit altem Ticket kann beim Erneuern einen eigenen Schlüssel einsetzen** und bekommt dafür
  ein Zertifikat unter seiner Kennung; wer ein altes Ticket stiehlt, kann das auch. Danach gelten
  beide, bis das alte abläuft. Erst `streng` schließt das.
- **Die 30-Tage-Vorbedingung für `streng` kann der Treffpunkt nicht selbst prüfen**: Er weiß nur,
  was seit seinem Start geschah. Die Auswertung nennt darum `laufzeitS` und `altLetzteVorS`; die
  Entscheidung bleibt bei Tobias.
- **Entwicklerschlüssel:** Wer ihn hat, kann Mandanten gründen. Er liegt nur auf Tobias' PC
  (`npm run entwickler -- schluessel`), nie im Repo (das Werkzeug weigert sich) und nie in einer
  Sitzung. Verloren: neuen erzeugen, öffentlichen Teil ersetzen, ausrollen. Das Passwort steht nur als
  scrypt-Hash in der Umgebung; Versuche sind auf 20 je App und Stunde begrenzt.

## Was `/gesund` verrät (21.11.2026)

`GET /gesund` ist ohne Anmeldung lesbar und nennt den Commit, die Fassung, die Fähigkeiten und die bedienten
Verfahren; für die Seite einer bekannten App (CORS) zusätzlich ihre App-Kennung und ob das alte Ticket abgeschaltet
ist. Das sind Betriebsangaben, kein Geheimnis (die Fähigkeiten stehen in `docs/schnittstelle.md`). Mandanten
nennt es nie. Getestet: `verfahren.test.ts`, `server.test.ts`.

## Aufnahme neuer Gruppen und Geräte (21.11.2026)

Der Treffpunkt ist „geschlossen“: Gruppen (Mandanten) entstehen nur durch ein Gründerticket, ein Passwort oder die
Einladung eines Büro-Geräts, und zusätzlich begrenzt `mandanten` in `apps.json` (und `TREFFPUNKT_MANDANTEN`), wie
viele Gruppen eine App haben darf (heute `azp` 1, `tkd` 0), und höchstens 300 Geräte insgesamt (`GRENZEN`). Beides ist
ein Schutz gegen ein falsch ausgestelltes Ticket oder Passwort, gegen den Missbrauch eines gestohlenen und gegen ein
Anlegen ohne Ende; es ist kein offenes Anlegen. **Grenze:** Gezählt wird, was seit dem Start gesehen wurde (der
Treffpunkt speichert nichts): nach einem Neustart ist die Zahl kurz kleiner, bis sich die Geräte melden. Die Zeitspanne
nutzt nur, wer ein gültiges Ticket hat. Getestet: `aufnahme.test.ts`, `konfiguration.test.ts`.

## Offen

- HTTP-Protokolle von Magic Containers (Client-IP, 3 Tage): abschaltbar? (`docs/bunny-einrichtung.md`)
- Sieht das Dashboard die Umgebungsvariable im Klartext?
- Digest-Festlegung bei bunny (`imageDigest`).
- Größter Request-Körper der Pull-Zone (prüft die Probe mit Einladung); Vorabanfragen unverändert
  durch (prüft die Probe ohne Einladung, grün seit 15.11.2026).
- **Vor echten Daten:** Auftragsverarbeitung, wenn der Treffpunkt in Tobias' privatem Konto bleibt
  (`docs/plan.md` § 8).
