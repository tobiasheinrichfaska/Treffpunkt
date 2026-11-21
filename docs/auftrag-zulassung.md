# Auftrag für die Cloud-Sitzung: Treffpunkt-Zulassung statt Tester-Login

> Übergabe 2026-11-21 (Tobias, lokale Sitzung am Verwaltungs-PC). **Dieses Repo bekommt den Treffpunkt-Teil** (Teil A, B, C,
> D und die Tests des Treffpunkts). Die Kopie mit dem App-Teil liegt im Repo `Arbeitszeitplaner`:
> `docs/auftrag-treffpunkt-zulassung.md` (Stand und Änderungen dort zuerst nachsehen; bei Abweichung gilt die neuere
> Fassung). Der App-Teil (Einschreiben mit Zertifikat/Ticket, Karte „Treffpunkt“, Gründen, Testpunkte MT-22.8) gehört
> in eine Sitzung im Arbeitszeitplaner-Repo, **nach** Phase 1 des Treffpunkts. Rollout über die Freigabe, nicht aus der Cloud.

**Umsetzung im Treffpunkt (Cloud-Sitzung 2026-11-21): Phase 1 und Teil B gebaut, noch nicht ausgerollt.**
Schnittstelle: `docs/schnittstelle.md` („Zulassung, Mandanten, Sperren“); Bedrohungen und Grenzen:
`docs/sicherheit.md`; Handhabung: `docs/bereitstellen.md`. Wo die Umsetzung vom Auftrag abweicht:

- **Teil C übernommen** (Zertifikat + Besitznachweis, wie empfohlen); „Liste“ ist nur das Anzeigeregister.
- **Mandant `1` im Zertifikat statt neuem Ticket `z2`:** Das alte Ticket `z1` bedeutet immer Mandant `1`;
  wer sich mit Schlüssel meldet, bekommt ein Zertifikat mit dem Mandanten darin. Ein Stichtag ist nicht
  nötig, `streng` ersetzt ihn. Ein anderer Mandant bekommt nie ein `z1`.
- **Rollen auf dem alten Weg sind Selbstangaben** (Nachweis, `e1`, Erneuern mit altem Ticket): der Treffpunkt
  kann sie nicht prüfen. Mit altem Ticket darf so ein Gerät weder sperren noch Geräte ansehen; im Mandanten `1`
  wird das erst mit `streng` sicher.
- **Sperrliste, Register und Passwortzähler sind nur im Arbeitsspeicher** (Auftrag Teil B 3, „zu prüfen“,
  und Offen 7): nach einem Neustart muss die App Sperren erneut schicken. **Offen für Tobias:** dauerhafter Speicher
  (bunny-Volume o. Ä.) oder `gesperrt` in `apps.json` für Dauerhaftes.
- **Die 30-Tage-Vorbedingung für `streng`** prüft der Treffpunkt nicht selbst (er kennt nur die Zeit seit dem
  Start); die Auswertung liefert `laufzeitS`/`altLetzteVorS`, die Entscheidung bleibt bei Tobias.
- **Entwicklerschlüssel und Passwort-Hashes** stehen in Umgebungsvariablen (`TREFFPUNKT_ENTWICKLER_SCHLUESSEL`,
  `TREFFPUNKT_ENTWICKLER_PASSWOERTER`), nicht in `apps.json`; das Werkzeug liegt in `scripts/entwickler.ts`
  (statt `werkzeuge/gruenderticket`). Die Passwort-Auswertung zeigt Zahlen, nie Kennungen.
- **Einladungen je Gerät und Stunde: 10** (bestätigt, vorher 20).
- **Sperren dauerhaft (Tobias 2026-11-21): Befristung statt Schlüsselwechsel am Treffpunkt.** Zertifikat 60 Tage
  (erneuern ab Tag 30); das Büro meldet eine Sperre einmal und danach **täglich**, 60 Tage lang (90 bei Geräten mit
  altem Ticket), und merkt sich dafür je Gerät den Tag der Sperre. Dazu der Schlüsselring
  `TREFFPUNKT_SCHLUESSEL_ALT` (`<wert>@<Datum>`, endet von selbst) für einen regelmäßigen Wechsel des Geheimwerts ohne Neueinschreiben.
- **Für den App-Teil (Arbeitszeitplaner) festzuschreiben:** Die Sperre am Treffpunkt schneidet nur den Transport ab.
  Die Vertraulichkeit sichert die App: (1) beim Entfernen eines Geräts wechselt die Gruppe ihren Gruppenschlüssel und
  versiegelt nichts mehr für das entfernte Gerät; (2) Absender werden gegen die signierte Geräteliste geprüft, nicht
  gegen die Kennung allein; (3) das neue Zertifikat und der neue Gruppenschlüssel gehen als **ein** Paket je Gerät
  (versiegelt, mit Quittung) an alle übrigen Geräte, wenn das Gerät gerade anwesend ist; Klingeln weckt schlafende
  Geräte, das Paket wird wiederholt, bis quittiert (Treffpunkt hält nur 30 s, höchstens 60 Klingeln je Gerät und
  Stunde); Geräte können Pakete für andere aufbewahren und weitergeben; ein anderes Büro-Gerät übernimmt, wenn das
  sperrende ausfällt (Stand „wer hat schon“ in der App); wer nach Zeitraum X nicht quittiert hat, wird nicht
  mehr beliefert und braucht eine neue Einladung. (4) Erkennt die App auf `gesperrt` (403) das eigene Gerät als
  gesperrt, löscht sie Zertifikat und Geräteschlüssel und zeigt den Hinweis.
- Noch nicht gebaut: der App-Teil (anderes Repo), der Rollout (Freigabe, nicht die Cloud).

Stand 2026-11-21 · Auftrag · Grundlage: `docs/treffpunkt-absicherung.md` (Entwurf) und Tobias' Ergänzung
vom selben Tag (Einladung = Zugang zum Treffpunkt; Entwicklerzugang für Erstgeräte).

## Ziel in einem Satz

Wer den Treffpunkt nutzen darf, entscheidet **eine Zulassungsliste im Treffpunkt**, nicht mehr der Login der Testzone.
Ein Gerät kommt auf zwei Wegen hinein: (1) durch die **Einladung** eines schon zugelassenen Büro-Geräts, (2) durch ein
**Gründerticket des Entwicklers** für ein erstes Gerät (eine andere Anwendung, eine andere Schule, Wiederherstellung).
Danach kann die Testzone den Login ausschalten (Issue #1 des Arbeitszeitplaner-Repos).

## Ausgangslage (kurz)

- Der Treffpunkt ist ein allgemeines Relais mehrerer Apps (Repo `Treffpunkt`, Container bei bunny, privates Konto,
  nur live). Nachrichten sind pro Empfänger versiegelt; er sieht nur Geräte-IDs, Zeitpunkte, Größen.
- Heute schreibt sich ein Gerät mit dem **Nachweis der Testzone** ein (Cookie des Tester-Logins,
  `/_zugang/treffpunkt-nachweis`, App-Seite: `treffpunktAnschluss.js`, `lib/hosted.js` `NACHWEIS_ADRESSE`).
- Der Endpunkt `einladen` gibt es schon: eine Einladung des Treffpunkts für die App, 10 Minuten, einmalig.
- Der Einladungslink der App (`#neu=…`) trägt die Treffpunkt-ID des Büros bereits (`lib/abgleich/einladung.js`).
- Nicht verifiziert: wie der Treffpunkt heute Mengen begrenzt und wie die Endpunkte genau heißen. Das steht im Repo
  `Treffpunkt`, **zuerst dort nachlesen**, dann bauen.

## Teil A — Zulassungsliste und Einladung (aus dem Entwurf)

1. **Zulassungsliste je App** (`azp`, später weitere): Geräte-ID, zugelassen am, eingeführt von, Zustand
   (`zugelassen` | `gesperrt`), zuletzt gesehen.
2. **Alles außer Einschreiben** (ablegen, abholen, ping, erneuern) verlangt ein Zugangsticket eines **zugelassenen**
   Geräts. Gesperrte bekommen beim Erneuern und Abholen eine Ablehnung, die sich von „abgelaufen“ unterscheidet
   (die App kennt `zugangVerloren`).
3. **Einladung = Zugang:** Ein zugelassenes Gerät holt über `einladen` ein einmaliges Ticket und legt es in den
   Einladungslink der App (`#neu=…`). Das neue Gerät löst das Ticket beim Einschreiben ein; der Treffpunkt trägt es
   mit „eingeführt von“ ein. Es braucht **kein Cookie und keinen Tester-Login**. Das Ticket ist an die App gebunden,
   einmalig, kurz gültig (10 Minuten); an ein bestimmtes Gerät gebunden wird es nicht (die Geräte-ID des Neuen ist
   vorher unbekannt).
4. **Sperren:** Büro-Geräte dürfen jedes Gerät sperren. **Ein LB-Gerät darf seine eigenen Zweitgeräte sperren**
   (Tobias 2026-11-21): alle Geräte mit derselben Rolle `lb:<id>`, nie ein Büro-Gerät und nie das Gerät einer anderen
   Person; sich selbst zu sperren ist erlaubt (z. B. beim Verlust). Der Treffpunkt prüft das an seiner eigenen
   Rollenangabe je Gerät (`buero` oder `lb:<id>`), die nur ein schon als „Büro“ eingetragenes Gerät setzen kann. Die Prüfung, wer wirklich Büro ist, bleibt in der App
   (signierte Geräteliste). „Gerät entfernen“ im Abgleich schickt die Sperre an den Treffpunkt. Auch ein LB sieht auf
   seiner Karte „Treffpunkt“ die eigenen Geräte mit „Sperren“, nicht die der anderen.
5. **Begrenzungen:** Höchstzahl Geräte je App (z. B. 50), Tickets pro Stunde je Gerät, Größenlimit je Nachricht
   (gibt es), Postfachgrenze je Empfänger.
6. **Verwaltung in der App:** Karte „Treffpunkt“ zeigt die zugelassenen Geräte (Name aus der Geräteliste, ID gekürzt,
   eingeführt von, zuletzt gesehen) mit „Sperren“; Hinweis auf dem Gerät, wenn es gesperrt wurde.

## Teil B — Entwicklerzugang: ein Erstgerät einschleusen

Entschieden von Tobias am 2026-11-21: Gründerticket mit Signaturschlüssel **und zusätzlich** ein einfaches,
zeitlich begrenztes Entwicklerpasswort (Punkt 7). Mandanten werden eingeführt (Punkt 3).

Wozu: Eine **andere Anwendung** (z. B. TKD-Trainerbuch, Sportabzeichen) oder eine **andere Schule** braucht ein erstes
Gerät im Treffpunkt, obwohl es noch kein zugelassenes gibt. Ebenso die **Wiederherstellung**, wenn das Gründergerät
weg ist und kein anderes zugelassen ist (offene Frage des Entwurfs).

Vorschlag (zu prüfen und zu entscheiden, bevor es gebaut wird):

1. **Gründerticket**, nur vom Entwickler ausstellbar: ein signiertes Ticket
   `{ app, mandant?, gueltigBis, einmal-ID }`, signiert mit einem **privaten Entwicklerschlüssel**, den nur Tobias
   hat (auf dem Verwaltungs-PC, DPAPI-geschützt wie die Passwörter des Freigabe-Repos; **nie im Repo, nie in einer
   Cloud-Sitzung**). Der Treffpunkt kennt nur den **öffentlichen** Schlüssel (Konfiguration des Containers).
2. **Einlösen:** Ein Gerät schreibt sich mit dem Gründerticket ein. Der Treffpunkt prüft Signatur, Gültigkeit
   (kurz, z. B. 1 Stunde), Einmaligkeit und `app`; er legt das Gerät als erstes zugelassenes Gerät dieser `app`
   (und dieses `mandant`) an, Rolle „Büro“, „eingeführt von: Entwickler“.
3. **Mandanten (Schulen), eingeführt:** Liste, Postfächer und Zulassungen gelten je `(app, mandant)`. Ein Mandant ist
   ein Name (Kleinbuchstaben, Ziffern, `-`); Geräte verschiedener Mandanten sehen einander nie. Der Mandant steht
   **im vom Treffpunkt signierten Zugangsnachweis** (nie als Angabe des Geräts) und kann nur vom Treffpunkt bei
   Einschreiben oder Erneuern gesetzt werden.
   **Kein stilles „Standard“ (Tobias 2026-11-21: Verwechslungsgefahr zwischen Schulen):** Die bisherige Schule
   bekommt die ausdrückliche Kennung **`1`**, weitere Schulen `2`, `3` … (oder ein eigener Name, nie `standard`).
   **Überführung der bisherigen Geräte:** Nur einmalig und nur für Zugangstickets, die der Treffpunkt **vor** dem
   Update ausgegeben hat (sie tragen keinen Mandanten), gilt „gehört zu `1`“. Beim nächsten Erneuern stellt der
   Treffpunkt ein neues Ticket mit `mandant: 1` aus; danach kennt kein Pfad mehr einen Standard. Jedes Ticket,
   das nach dem Update ausgegeben wird, trägt den Mandanten, und ein Ticket ohne Mandanten wird nach dem Stichtag
   abgelehnt. Ein neuer Mandant entsteht nur über ein Gründerticket oder das Passwort mit ausdrücklichem
   `mandant`, nie über eine Einladung eines anderen Mandanten (eine Einladung vererbt den Mandanten des Einladenden
   und lässt sich nicht ändern). Wer bis zum Ablauf nicht erneuert, braucht eine neue Einladung.
   (Gilt nur bis zum Schalter `streng`, siehe Teil D.) **Zu prüfen im Repo `Treffpunkt`:** Der Treffpunkt hält Nachrichten nur im Arbeitsspeicher. Was nach einem
   Neustart noch gelten muss (Sperrliste, Zähler), braucht dauerhaften Speicher oder muss sich aus signierten
   Nachweisen ergeben (siehe Teil C). Sonst wären nach jedem Rollout gesperrte Geräte wieder drin.
4. **Werkzeug:** Ein kleines Skript im Repo `Treffpunkt` (`werkzeuge/gruenderticket`), das nur mit dem Schlüssel auf
   dem PC läuft und das Ticket als Text oder als Link-Fragment ausgibt. Der Schlüssel wird beim ersten Lauf erzeugt;
   der öffentliche Teil kommt in die Container-Konfiguration (Rollout über die Freigabe „Treffpunkt ausrollen“).
5. **Sicherheitsregeln:** Das Ticket ist nicht wiederverwendbar; abgelaufene oder doppelt benutzte werden abgelehnt;
   jeder Lauf wird im Treffpunkt ohne Inhalte protokolliert (Zeit, App, Ergebnis). Ein verlorener Schlüssel heißt:
   neuen Schlüssel erzeugen, öffentlichen Teil ersetzen, ausrollen.
6. **Einfaches Entwicklerpasswort** (Tobias: „hochladen, für einen begrenzten Zeitraum“): Zusätzlich zum
   Signaturschlüssel kann Tobias ein Passwort in die Container-Konfiguration legen (nur der **Hash**, nie Klartext), mit
   Ablaufdatum, `app`/`mandant` und höchstens N Einlösungen. Es wirkt wie ein Gründerticket: ein Gerät schreibt sich
   mit Passwort ein und wird erstes zugelassenes Gerät, solange die Liste von `(app, mandant)` leer ist (oder nur mit
   Passwort, wenn Tobias das ausdrücklich zulässt). Nach Ablauf oder erreichter Anzahl lehnt der Treffpunkt es ab.
   „Hochladen“ heißt: Tobias legt es über den Rollout („Treffpunkt ausrollen“) ab; die Sitzung kennt es nie.
   Gedacht für Vorführungen und schnelle Tests, nicht für den Dauerbetrieb; im Log (ohne Inhalte) steht jede Nutzung.
7. **In der App:** Der Einladungsweg „Gründen“ der App (`dienst.gruenden`) nimmt statt des Testzonen-Nachweises das
   Gründerticket oder das Entwicklerpasswort entgegen (Link-Fragment oder Eingabefeld), solange die Liste der App leer ist.

## Teil D — Rückwärtskompatibel umstellen (Tobias 2026-11-21: erst streng, wenn alle auf dem neuen Stand sind)

**Grundsatz:** Der Treffpunkt spricht zuerst **beide Verfahren**: das alte (Nachweis der Testzone beim Einschreiben,
Zugangsticket `z1.azp.…` als Bearer) und das neue (Zertifikat + Besitznachweis, Einladungs- und Gründerticket,
Mandant, Sperren). **Streng nur das neue** gilt erst, wenn für diese App alle Beteiligten auf dem neuen Stand sind, und
nur **nach ausdrücklicher Umstellung durch Tobias**, nie automatisch.

1. **Phase 1 — beide Wege (der erste Rollout):**
   - Der Treffpunkt nimmt alte Anfragen weiter an (Bearer-Ticket, Einschreiben mit dem Nachweis) und stellt bei jedem
     Einschreiben und Erneuern **zusätzlich** ein Zertifikat aus. Alte Apps ignorieren es, neue Apps benutzen es.
   - Jede Antwort nennt, was der Treffpunkt kann (`v`/Fähigkeiten). Eine **neue App gegenüber einem alten
     Treffpunkt** fällt auf das alte Verfahren zurück (Reihenfolge der Auslieferung darf egal sein).
   - Einladungslinks: neue tragen das Einladungsticket, alte (ohne) gehen weiter über den Nachweis. Einladungsticket
     und Gründerticket sind neu und brauchen deshalb keine Rückwärtskompatibilität.
   - Ein Gerät ohne Mandantenangabe gilt in dieser Phase als Mandant `1` (Teil B 3, nur für Tickets von vor dem Update).
   - Sperren wirkt, soweit der Treffpunkt das Gerät am Ticket erkennt (die Geräte-ID steht im Ticket; **zu prüfen**);
     ein gesperrtes Gerät bekommt weder Erneuerung noch Zertifikat.
2. **Phase 2 — messen, nichts abschalten:** Der Treffpunkt zählt **ohne Inhalte**, je `(app, mandant)` und je
   Gerät, welches Verfahren die letzten Anfragen benutzt haben und mit welchem Stand der App (Protokollversion `p` in
   jeder Anfrage). Eine Auswertung nur für Tobias (Entwicklerzugang, nicht öffentlich) zeigt: Geräte gesamt, davon neu,
   davon alt, zuletzt gesehen. Die App zeigt auf der Karte „Treffpunkt“ je Gerät, ob es das neue Verfahren benutzt.
3. **Phase 3 — streng, je App und Mandant, von Hand:** Ein Schalter in der Treffpunkt-Konfiguration (`streng` je
   `(app, mandant)`; Rollout über die Freigabe „Treffpunkt ausrollen“) lässt für diese App nur noch das neue Verfahren zu. **Vorbedingung,
   die der Treffpunkt selbst prüft und die Auswertung vorher zeigt:** In den letzten 30 Tagen (= Lebensdauer eines
   alten Tickets) kam **keine** Anfrage mit dem alten Verfahren, und jedes bekannte Gerät hat ein Zertifikat benutzt.
   Gilt es für **mehrere Apps** (Arbeitszeitplaner, TKD-Trainerbuch, …), schaltet jede **einzeln** um; eine App, die
   noch nicht aktualisiert ist, blockiert die anderen nicht.
4. **Erst nach Phase 3** (für den Arbeitszeitplaner): den Tester-Login der Testzone ausschalten und den Nachweis-Pfad im
   Treffpunkt entfernen. Bis dahin bleibt der Login ein gültiger Weg.
5. **Zurück:** Der Schalter `streng` lässt sich im Notfall wieder abstellen (Rollout); Zertifikate und Sperrliste
   bleiben bestehen.

Tests: Der Treffpunkt wird gegen **alte Clients** getestet (ein Testclient im alten Verfahren muss in Phase 1
unverändert funktionieren) und gegen **neue Clients** in Phase 1 und 3; die App gegen einen alten und einen neuen
Treffpunkt (Fähigkeiten). Ein Testfall: `streng` an, ein alter Client wird mit einer klaren Ablehnung abgewiesen, die
die App als „Neue Fassung nötig“ anzeigt (nicht als „gesperrt“).

## Reihenfolge

1. Repo `Treffpunkt`: Phase 1 (beide Wege): Mandanten, Zertifikat und Besitznachweis (Teil C), Einladungsticket,
   Zulassung/Sperren, Begrenzungen. Der alte Weg bleibt unverändert nutzbar.
2. Repo `Treffpunkt`: Gründerticket und Entwicklerpasswort (Teil B), Entwicklerschlüssel, Werkzeug, Auswertung (Phase 2).
3. App (dieses Repo): Einschreiben mit Zertifikat/Ticket, Verwaltung, Gründen (Teil A 6, Teil B 7), Fähigkeiten und
   Rückfall auf das alte Verfahren, Anzeige der Verfahren je Gerät; Testpunkte in `manual_tests/22_testseite.md`
   (MT-22.8 erweitern: Einladen, Einlösen, Sperren, abgelaufenes und doppelt benutztes Ticket, gesperrtes Gerät,
   Gründerticket gültig/abgelaufen/doppelt, **altes Gerät gegen neuen Treffpunkt**).
4. Rollout des Treffpunkts über die Freigabe; Apps ausliefern; **messen (Phase 2)**; erst dann nach Tobias' Entscheidung
   `streng` je App schalten (Phase 3) und danach den Login ausschalten (Punkt D 4).

## Was die Cloud-Sitzung wissen muss

- **Echte Daten gibt es dort nicht.** Nur erfundene Geräte und Tickets. Der Entwicklerschlüssel entsteht auf dem
  Verwaltungs-PC, nie in der Cloud, und kommt nie in ein Repo.
- **Der Treffpunkt wird nicht von der Cloud-Sitzung ausgerollt.** Der Rollout läuft über die Freigabe „Treffpunkt
  ausrollen“ von Tobias (Schlüssel des ganzen privaten Kontos); die Sitzung baut Code und Tests, mehr nicht.
- **Testumfang:** Logik des Treffpunkts mit Unit-Tests (Tickets: gültig, abgelaufen, doppelt, falsche App, gesperrt,
  Listenlimit, Rate-Limit; Gründerticket: Signatur falsch, anderer Schlüssel, abgelaufen); App-Teil mit Unit-Tests
  der Leser (`lib/abgleich/treffpunkt.js`) und einem Browser-Smoke gegen eine lokale Kopie des Treffpunkts.
  Vorbild: `treffpunkt.test.js` und der Smoke vom 2026-11-18.
- **Handtest auf dem Gerät:** Einladen eines echten zweiten Geräts bleibt Tobias' Aufgabe (MT-22.8).

## Teil C — Gerätenachweis statt Bearer-Ticket (Vorschlag von Tobias, zu bewerten)

Idee (Tobias): Der Treffpunkt tauscht mit jedem Gerät Schlüssel aus; er spricht nur mit Geräten, die ihm so bekannt
gemacht wurden. Auswertung für die Cloud-Sitzung:

- **Heute:** Das Cookie der Testzone wird **nur beim Einschreiben** als Nachweis gebraucht. Danach weist sich das
  Gerät mit dem **Zugangsticket** (`z1.azp.…`) aus, das jeder mit Besitz benutzen kann (Bearer). Gestohlen heißt
  benutzt, bis es abläuft; sperren geht nicht.
- **Vorschlag:** Beim Einschreiben meldet das Gerät seinen **öffentlichen Geräteschlüssel** (die App hat solche
  Schlüssel schon, `lib/abgleich/schluessel.js`, ECDSA P-256). Der Treffpunkt stellt ein **signiertes Zertifikat**
  `{ app, mandant, geraetSchluessel, rolle, gueltigBis }` aus. Jede Anfrage trägt ein Zertifikat **und** eine Signatur
  des Geräts über die Anfrage (Besitznachweis, mit Zeitstempel/Zähler gegen Wiederholung). Ein unbekanntes oder
  nicht beglaubigtes Gerät kann daher gar nicht mit dem Treffpunkt sprechen (Tobias' Nebeneffekt trifft zu).
- **Vorteile:** gestohlenes Zertifikat ohne Geräteschlüssel nutzlos; Prüfung ohne Liste (zustandslos, übersteht
  Neustarts); der Mandant steht im Zertifikat. Nötig bleiben nur die **Sperrliste** (Geräteschlüssel-Fingerabdrücke bis
  zum Ablauf des Zertifikats) und der Zähler der Geräte je `(app, mandant)`.
- **Verschlüsselung der Leitung:** Der Verkehr läuft schon über HTTPS; eine zweite, eigene Verschlüsselung zwischen Gerät
  und Treffpunkt brächte wenig zusätzlich (Nachrichten sind ohnehin Ende-zu-Ende versiegelt). Der Gewinn liegt in der
  **Authentifizierung**, nicht in der Geheimhaltung.
- **Empfehlung:** So bauen (Zertifikat + Besitznachweis), statt eine Zulassungsliste als Hauptmechanismus zu führen.
  Die „Liste“ ist dann nur Sperrliste und Zähler. Falls der Treffpunkt eine Liste führt, dient sie der Anzeige in der
  App („zuletzt gesehen“), nicht der Prüfung.

## Entschieden (Tobias 2026-11-21) und was noch offen ist

1. Gründerticket mit Signaturschlüssel: **ja**, dazu ein einfaches, zeitlich begrenztes Entwicklerpasswort (Teil B 6).
2. Mandanten: **werden eingeführt**; Überführung der bisherigen Geräte siehe Teil B 3.
3. Wiederherstellung: Ein verlorenes Gerät ist **kein Notfall, solange ein anderes Büro-Gerät zugelassen ist**: dieses
   spricht neue Einladungen aus. Nur wenn **kein** Büro-Gerät mehr zugelassen ist (z. B. das einzige Gerät verloren),
   hilft ein neues Gründerticket oder das Passwort. Ein ausgedruckter Wiederherstellungscode ist darum nicht nötig.
4. Höchstzahl Geräte je `(app, mandant)`: **50**. „Tickets“ sind die Einladungstickets, die ein Gerät über `einladen`
   holt (nicht die Zugangstickets zum Abholen). Begrenzung je Gerät und Stunde: **10** (bestätigt).
5. Mandant der bisherigen Schule: **`1`**, kein stilles „Standard“ (Teil B 3).
6. Rückwärtskompatibel: **ja** (Teil D) — zuerst beide Verfahren, streng erst nach ausdrücklicher Umstellung je App und
   Mandant, wenn alle Beteiligten auf dem neuen Stand sind.
7. Offen: Teil C (Zertifikat statt Bearer-Ticket) bewerten und ggf. übernehmen; wie Sperrliste und Zähler einen Neustart überstehen.
