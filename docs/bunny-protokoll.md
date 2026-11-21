# Protokoll: was bei bunny wann gesetzt wurde

Grundregel (Tobias, 15.11.2026): Jeder Bericht von Claude in Chrome und jede rein lesende Prüfung im
Dashboard kommt gekürzt hierher: Datum, was gesetzt wurde, was schon da war, was abwich. Danach wird
`docs/bunny-einrichtung.md` angeglichen. Nie hierher: Schlüssel, Passwörter, Tokens, Tester-Namen.

| Datum | Wer | Was | Ergebnis |
|---|---|---|---|
| 15.11.2026 | Cloud-Sitzung | Soll-Zustand geschrieben (`docs/bunny-einrichtung.md`) | noch nichts gesetzt |
| 15.11.2026 | Cloud-Sitzung | Entscheidung 3 geändert: Image privat, klassisches Token als Image-Registry | noch nichts gesetzt |
| 15.11.2026 | Tobias | Registry „GitHub“ (`tobiasheinrichfaska`), App `treffpunkt` angelegt, `TREFFPUNKT_SCHLUESSEL` eingetragen | App läuft (Bericht unten) |
| 15.11.2026 | Claude in Chrome, nur lesen | Prüfauftrag aus `docs/bunny-einrichtung.md` | Bericht unten; nichts geändert |
| 15.11.2026 | Cloud-Sitzung | `npm run probe -- --host https://mc-itbuvuow8h.bunny.run` (ohne Einladung) | alles wie erwartet bis auf `Cache-Control`: bunny schreibt `no-store` in `no-cache` um, der Rand cacht trotzdem nichts (`cdn-cache: MISS`); Probe angepasst. `http://` antwortet 200 → Force SSL einschalten |

## Ist-Zustand nach dem Bericht vom 15.11.2026 (Claude in Chrome, nur lesen)

- **App:** `treffpunkt`, App-ID (steht im Dashboard), Status „Active“, 1 Instanz in Frankfurt (DE-a),
  Restart policy „Always“, ~54 MB RAM. Container: Name `treffpunkt`; die Adresse im Dashboard lautet
  `…/magic-containers/apps/<App-ID>/container-settings?containerId=treffpunkt` (Tobias,
  15.11.2026). Freigabe sucht die API-ID beim Namen (`docs/freigabe-auftrag.md`).
- **Image:** Registry `tobiasheinrichfaska@GitHub`, `ghcr.io/tobiasheinrichfaska/treffpunkt`, Tag
  `b1ce36a595d7f0f00c2439549ac09123c3ed65ec`, gezogen als Digest
  `sha256:b4428eb319d87f00f9f6d2f02b468c5d3be8fdb4d3699123e2284cece77381b4`.
- **Registry:** Eintrag „GitHub“, Username `tobiasheinrichfaska`, Schlüssel maskiert, kein Fehler.
- **Regionen und Skalierung:** min 1, max 1, „Limit number of active regions“ an mit 1, nur
  Frankfurt. ✓
- **Endpoint:** CDN, Name `http-alt`, Port 8080, Hostname `mc-itbuvuow8h.bunny.run`, keine
  Anycast-IP. ✓
- **Gesundheitsprüfung:** Startup und Liveness HTTP GET `/gesund` auf 8080, alle 10 s; Readiness aus.
  ✓
- **Umgebungsvariablen (nur Namen):** `NODE_ENV`, `PORT`, `TREFFPUNKT_SCHLUESSEL`. Die ersten beiden
  hat bunny aus dem Image übernommen; Soll angeglichen.
- **Pull-Policy:** im Dashboard nicht einstellbar (Reiter „Advanced“ hat keine).
- **Protokoll des Containers:** zwei Starts (22:26 und 22:28 UTC, beides Ausrollen durch bunny, kein
  Absturz), danach Zählwerte; einmal `"fehler":{"unbekannt":3}` (Aufrufe außerhalb von `/v1/…`, etwa
  vom Browser). Keine Kennungen, keine IP-Adressen. ✓
- **Pull-Zone** des Endpoints:
  - Hostnamen `mc-itbuvuow8h.b-cdn.net` (System) und `mc-itbuvuow8h.bunny.run` (Managed), SSL an,
    **Force SSL aus** → ABWEICHUNG (Soll: an).
  - **Logging an**, IPs gekürzt („Remove one octet“) → ABWEICHUNG (Soll: aus). Log Forwarding und
    Permanent Log Storage aus. ✓
  - Cache „Respect origin Cache-Control“, Smart Cache an → angenommen (siehe Soll).
  - Origin Retries „Do not retry“, „Origin 5xx Response“ nicht gewählt. ✓
  - CORS an, nur für Dateiendungen → angenommen (siehe Soll).
  - **TLS 1.0 und 1.1 an** („Legacy“) → ABWEICHUNG (Soll: aus).
  - **Bandbreiten-Limit 0 (unbegrenzt)** → ABWEICHUNG (Soll: 50 GB).
- **Konto:** den Zahlungsweg richtet Tobias selbst ein. Im Testzeitraum ist nur eine Magic-Containers-App erlaubt.

**Nacharbeiten erledigt** (Bericht unten): Force SSL an, Logging aus, TLS 1.0/1.1 aus,
Bandbreiten-Limit 50 GB.

**Entschieden von Tobias am 15.11.2026:** Das Registry-Token läuft nie ab.

## Nacharbeiten vom 15.11.2026 (Claude in Chrome, Auftrag „Nacharbeiten“)

| Punkt | Ergebnis |
|---|---|
| Force SSL `mc-itbuvuow8h.b-cdn.net` | gesetzt („Force SSL for a hostname enabled“) |
| Force SSL `mc-itbuvuow8h.bunny.run` | gesetzt |
| „Enable Logging“ aus | gesetzt („Pull Zone configuration was updated.“) |
| TLS 1.0 und 1.1 aus | gesetzt („TLS support updated“, zweimal). Die Stufe „Legacy“ blieb; laut bunny wirken die Häkchen nur dort |
| Bandbreiten-Limit 50 GB im Monat | gesetzt („Pull Zone Network limits“); die übrigen Network limits blieben 0 |
| `https://mc-itbuvuow8h.bunny.run/gesund` | `ok: true` |

Danach, von einer Cloud-Sitzung aus (15.11.2026):

- `curl -sI http://mc-itbuvuow8h.bunny.run/gesund` → `301`, `location: https://mc-itbuvuow8h.bunny.run/gesund`;
  dasselbe für `mc-itbuvuow8h.b-cdn.net`. ✓
- `npm run probe -- --host https://mc-itbuvuow8h.bunny.run` → alles ✓.
- Ein absichtlich falscher Nachweis für `tkd` → `nachweis-nicht-eingerichtet`: bunny fährt noch das
  Image `b1ce36a…` ohne Nachweis-Schlüssel. Mit einem Image ab `102c252…` muss die Antwort
  `nachweis-unterschrift` lauten; ab `c59ac2d…` nennt `/gesund` außerdem den Commit (das ist das Tag,
  das Tobias von Hand einstellen soll).
- **Offen:** ob TLS 1.0/1.1 wirklich abgelehnt werden. Von der Cloud-Sitzung aus nicht prüfbar (ihr
  Netz geht über einen Proxy, der TLS selbst aushandelt). Prüfbar von Tobias' PC, etwa mit
  `openssl s_client -connect mc-itbuvuow8h.bunny.run:443 -tls1_1` (erwartet: Abbruch).
- **Folge des Bandbreiten-Limits:** Sind die 50 GB eines Monats erreicht, schaltet bunny die Zone ab,
  und der Treffpunkt ist bis zum Monatswechsel nicht erreichbar.

## Prüfung von außen am 16.11.2026 (Cloud-Sitzung, 04:26 UTC)

Tobias meldete, das Feld „Image“ der App zeige `ghcr.io/tobiasheinrichfaska/treffpunkt:102c252…`.
Von außen:

- `/gesund` → `{"ok":true}`, ohne Commit.
- Sechsmal ein richtig gebauter, aber falsch unterschriebener Nachweis für `tkd` →
  `nachweis-nicht-eingerichtet` (403). Das Image `102c252…` hat den öffentlichen Schlüssel in
  `apps.json` und würde `nachweis-unterschrift` antworten.
- Das Image `102c252…` liegt in der Registry (Job „Image“ vom 15.11., 23:09, grün).

**Ergebnis:** Es läuft weiter das Image ohne Nachweis-Schlüssel (`b1ce36a…`). Der neue Tag steht nur
im Feld, ist nicht ausgerollt, oder bunny konnte ihn nicht holen und lässt den alten Container
laufen. **Offen:** Tag auf das neueste grüne Image von `main` setzen (ab `c59ac2d…`, `/gesund` nennt
dann den Commit), speichern und ausrollen, im Deploy- oder Ereignis-Log von bunny auf einen Fehler beim
Holen achten; danach wieder von außen prüfen.

## Registry-Token

| Name | Rechte | Angelegt | Läuft ab |
|---|---|---|---|
| bunny Treffpunkt lesen | `read:packages`, `read:org` | 15.11.2026 | nie |
