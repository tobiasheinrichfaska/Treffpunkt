# Handtests: Betrieb bei bunny

Nur, was kein automatischer Test kann: der echte Container bei bunny und echte Handys. Ergebnisse
gekürzt nach `docs/bunny-protokoll.md`.

## MT-01 · Der Treffpunkt läuft bei bunny

**Wann:** nach der Einrichtung (`docs/bunny-einrichtung.md`) und nach jedem Ausrollen.

1. Im Browser `https://<hostname>/gesund` öffnen, oder von einem Rechner mit dem Repo
   `npm run probe -- --host https://<hostname> --stand <commit>` (der Commit darf kurz sein, ab 7
   Zeichen).
2. Erwartet: `{"ok":true,"stand":"<der ausgerollte Commit, 40 Zeichen>"}`. Steht dort ein anderer
   Commit, läuft noch das alte Image (das Ausrollen ist nicht fertig oder ist gescheitert); fehlt
   `stand`, ist das Image älter als `c59ac2d`.
3. Im bunny-Dashboard, App `treffpunkt` → Logging → Application: Es gibt eine Zeile `"ereignis":"start"`
   mit `"apps":["tkd","azp"]`. Keine Zeile enthält eine Gerätekennung (`geraet-…`) oder eine
   IP-Adresse.

## MT-02 · Probe von außen

**Wann:** nach dem ersten Ausrollen (eine Cloud-Sitzung führt sie aus).

1. `npm run probe -- --host https://<hostname>`.
2. Erwartet: alle Zeilen ✓. Besonders: die Vorabanfrage kommt durch die Pull-Zone (204), Antworten
   tragen `Cache-Control: no-store` oder (von bunnys Pull-Zone umgeschrieben) `no-cache`, und der
   Rand liefert nie aus dem Cache (`cdn-cache` nie `HIT`).
3. Mit einer Einladung von einem eingeschriebenen Testgerät (Trainerbuch: „Meine Daten“ → „Neues
   Gerät für mich“ → „Neues Gerät einrichten“, den Link kopieren; die Probe verbraucht die Einladung):
   `npm run probe -- --host https://<hostname> --einladung '<link>'`. Erwartet: alles ✓, beim Klingeln
   antworten Google und Apple mit einem 4xx (erfundenes Abo). Die Zeile „Ein Ablegen mit 4.2 MB kommt
   durch die Pull-Zone“ zeigt, ob bunnys Rand so große Anfragen durchlässt; ist sie ✓, dürfen die
   Apps mehr als 1 MB je Anfrage senden (`docs/bunny-einrichtung.md`, „Offen“, angleichen).

## MT-03 · Einschreiben auf dem Handy mit dem Nachweis der Testzone

**Wann:** wenn Testumgebung den Nachweis ausgerollt hat und das Trainerbuch den neuen Treffpunkt kennt.

1. Auf dem Handy die Testzone `tkdtest.b-cdn.net` öffnen und anmelden.
2. In der App das Gerät beim Treffpunkt einschreiben.
3. Erwartet: Die App zeigt eine neue Gerätekennung und „eingeschrieben bis …“ (90 Tage).

## MT-04 · Neues Gerät per QR von einem Trainergerät

1. Auf einem eingeschriebenen Trainergerät „Neues Gerät“ / Einladung zeigen.
2. Das neue Handy scannt den QR (ohne Tester-Login).
3. Erwartet: Es ist eingeschrieben. Derselbe QR ein zweites Mal: „schon benutzt“. Nach 10 Minuten:
   „abgelaufen“.

## MT-05 · Abgleich zweier Handys über den Treffpunkt

1. Zwei eingeschriebene, in der Halle bekannt gemachte Handys, beide App offen, verschiedene Netze
   (eines im WLAN, eines im Mobilnetz).
2. Auf dem einen eine Änderung machen.
3. Erwartet: Das andere hat sie nach wenigen Sekunden. Nach dem Schließen einer App gilt das Gerät nach
   spätestens 30 s nicht mehr als anwesend.

## MT-06 · Anklingeln über den neuen Treffpunkt

Wie MT-120–126 im Trainerbuch, nur über den neuen Treffpunkt. Erwartet: Das angeklingelte Handy zeigt
„<Name> bittet um Abgleich“.
