# Treffpunkt

Ein allgemeiner Treffpunkt für mehrere Apps von Tobias, zuerst das TKD-Trainerbuch, später der
Arbeitszeitplaner. Er reicht Ende-zu-Ende-verschlüsselte Nachrichten zwischen Geräten weiter und gibt
beim Anklingeln einen fertigen Push an den Push-Dienst weiter. Nachrichten liegen nur im
Arbeitsspeicher, höchstens etwa 30 Sekunden; gespeichert wird nichts.

Er läuft als Node-Prozess in einem Magic Container bei bunny, in einem eigenen Konto von Tobias. Bis auf
Weiteres gehen nur erfundene Daten von eigenen Testgeräten durch.

Angelegt am 15.11.2026, bearbeitet in Claude Code im Web. Plan und Entscheidungen:
[`docs/plan.md`](docs/plan.md), Schnittstelle: [`docs/schnittstelle.md`](docs/schnittstelle.md).

Stand 15.11.2026: Der Treffpunkt läuft unter `https://mc-itbuvuow8h.bunny.run` (bunny, Frankfurt,
eine Instanz); die Probe ohne Einladung ist grün. Einschreiben mit einem Nachweis geht erst, wenn bei
bunny das Image mit dem öffentlichen Nachweis-Schlüssel läuft und die Login-Skripte den privaten
Schlüssel haben. Wie eine Änderung online geht und was du dafür von Hand tust:
[`docs/bereitstellen.md`](docs/bereitstellen.md).

Geräte kommen auf zwei Wegen dazu: mit einem Nachweis aus der Testzone (für angemeldete Tester) oder
per QR von einem schon eingeschriebenen Gerät (beim Trainerbuch ein Trainergerät, beim
Arbeitszeitplaner ein Bürogerät).

Online geht es über das Repo **Freigabe**, von Tobias von Hand gestartet, ohne Testbereich.

## License

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

This project is licensed under the **GNU Affero General Public License v3.0** (AGPLv3).
You are free to use, modify, and distribute this software under the terms of the AGPLv3.
If you use this software to provide a network service, you must make the full source code
of your modifications available to users of that service.

**Commercial License:** If you wish to use this software in a closed-source or proprietary
product, a commercial license is available. Contact: tobias.a.w.heinrich@gmail.com

See [LICENSE](LICENSE) for the full AGPLv3 text.
See [LICENSE_COMMERCIAL.md](LICENSE_COMMERCIAL.md) for commercial licensing terms.
