// The mailboxes, in RAM only (plan § 2, „Weg A“): a message for a device waits at most
// `wartezeitMs` and is deleted when collected. Mailboxes are kept per app: a message put by a device
// of app A lands in A's box for that id, and only a device of A collects there — so devices of two
// apps never reach each other, even if one learns the other's id. Nothing is ever written to disk.
import type { Grenzen } from './grenzen.ts';

export interface Nachricht {
  readonly von: string;
  readonly inhalt: Buffer;
  readonly abgelegtMs: number;
}

interface Eintrag extends Nachricht {
  readonly app: string;
  /** What it counts in the byte limits: its content, but at least `nachrichtMindestBytes`. */
  readonly gewicht: number;
}

interface Kasten {
  readonly nachrichten: Eintrag[];
  bytes: number;
}

export type AblegenFehler = 'voll' | 'app-voll' | 'absender-voll' | 'empfaenger-voll';

export interface Postfach {
  ablegen(
    app: string,
    von: string,
    an: string,
    inhalt: Buffer,
    jetztMs: number,
  ): { readonly ok: true } | { readonly ok: false; readonly art: AblegenFehler };
  abholen(
    app: string,
    geraet: string,
    jetztMs: number,
  ): { readonly nachrichten: readonly Nachricht[]; readonly mehr: boolean };
  anwesendMerken(app: string, geraet: string, jetztMs: number): void;
  /** Which of the named devices collected within `anwesendMs` — only ids the asker names. */
  anwesend(app: string, geraete: readonly string[], jetztMs: number): string[];
  aufraeumen(jetztMs: number): void;
  /** Messages waiting and what they count in the byte limits (at least 1 KB each). */
  stand(): {
    readonly wartend: number;
    readonly bytes: number;
    readonly anwesend: number;
    readonly postfaecher: number;
    readonly absender: number;
  };
}

/** A buffer of its own: a small decoded value is a slice of Node's shared 8 KB pool, and keeping it
 * would keep the whole slab — eight times what the message counts. */
function eigen(inhalt: Buffer): Buffer {
  if (inhalt.byteOffset === 0 && inhalt.buffer.byteLength === inhalt.length) return inhalt;
  const kopie = Buffer.allocUnsafeSlow(inhalt.length);
  inhalt.copy(kopie);
  return kopie;
}

export function postfachAnlegen(grenzen: Grenzen): Postfach {
  const kaesten = new Map<string, Kasten>();
  const absenderBytes = new Map<string, number>();
  const appBytes = new Map<string, number>();
  const zuletzt = new Map<string, number>();
  let gesamt = 0;
  let wartend = 0;

  const kennung = (app: string, geraet: string): string => `${app}|${geraet}`;

  function erhoehen(karte: Map<string, number>, schluessel: string, um: number): void {
    const neu = (karte.get(schluessel) ?? 0) + um;
    if (neu <= 0) karte.delete(schluessel);
    else karte.set(schluessel, neu);
  }

  function entfernen(e: Eintrag): void {
    gesamt -= e.gewicht;
    wartend -= 1;
    erhoehen(appBytes, e.app, -e.gewicht);
    erhoehen(absenderBytes, kennung(e.app, e.von), -e.gewicht);
  }

  function abgelaufen(e: Eintrag, jetztMs: number): boolean {
    return e.abgelegtMs <= jetztMs - grenzen.wartezeitMs;
  }

  function kastenAufraeumen(schluessel: string, kasten: Kasten, jetztMs: number): void {
    // Every message waits equally long, so the expired ones are at the front.
    while (kasten.nachrichten.length > 0 && abgelaufen(kasten.nachrichten[0] as Eintrag, jetztMs)) {
      const e = kasten.nachrichten.shift() as Eintrag;
      kasten.bytes -= e.gewicht;
      entfernen(e);
    }
    if (kasten.nachrichten.length === 0) kaesten.delete(schluessel);
  }

  return {
    ablegen(app, von, an, inhalt, jetztMs) {
      const schluessel = kennung(app, an);
      const vorhanden = kaesten.get(schluessel);
      if (vorhanden) kastenAufraeumen(schluessel, vorhanden, jetztMs);
      const kasten = kaesten.get(schluessel) ?? { nachrichten: [], bytes: 0 };
      const groesse = Math.max(inhalt.length, grenzen.nachrichtMindestBytes);
      if (gesamt + groesse > grenzen.gesamtBytes) return { ok: false, art: 'voll' };
      if ((appBytes.get(app) ?? 0) + groesse > grenzen.jeAppBytes) {
        return { ok: false, art: 'app-voll' };
      }
      if ((absenderBytes.get(kennung(app, von)) ?? 0) + groesse > grenzen.jeAbsenderBytes) {
        return { ok: false, art: 'absender-voll' };
      }
      if (
        kasten.nachrichten.length + 1 > grenzen.jeEmpfaengerAnzahl ||
        kasten.bytes + groesse > grenzen.jeEmpfaengerBytes
      ) {
        return { ok: false, art: 'empfaenger-voll' };
      }
      kasten.nachrichten.push({
        app,
        von,
        inhalt: eigen(inhalt),
        abgelegtMs: jetztMs,
        gewicht: groesse,
      });
      kasten.bytes += groesse;
      kaesten.set(schluessel, kasten);
      gesamt += groesse;
      wartend += 1;
      erhoehen(appBytes, app, groesse);
      erhoehen(absenderBytes, kennung(app, von), groesse);
      return { ok: true };
    },

    abholen(app, geraet, jetztMs) {
      const schluessel = kennung(app, geraet);
      const kasten = kaesten.get(schluessel);
      if (!kasten) return { nachrichten: [], mehr: false };
      kastenAufraeumen(schluessel, kasten, jetztMs);
      const raus: Nachricht[] = [];
      let bytes = 0;
      while (kasten.nachrichten.length > 0) {
        const e = kasten.nachrichten[0] as Eintrag;
        if (raus.length > 0 && bytes + e.inhalt.length > grenzen.abholenBytes) break;
        kasten.nachrichten.shift();
        kasten.bytes -= e.gewicht;
        bytes += e.inhalt.length;
        entfernen(e);
        raus.push({ von: e.von, inhalt: e.inhalt, abgelegtMs: e.abgelegtMs });
      }
      const mehr = kasten.nachrichten.length > 0;
      if (!mehr) kaesten.delete(schluessel);
      return { nachrichten: raus, mehr };
    },

    anwesendMerken(app, geraet, jetztMs) {
      zuletzt.set(kennung(app, geraet), jetztMs);
    },

    anwesend(app, geraete, jetztMs) {
      return geraete.filter((g) => {
        const t = zuletzt.get(kennung(app, g));
        return t !== undefined && t > jetztMs - grenzen.anwesendMs;
      });
    },

    aufraeumen(jetztMs) {
      for (const [schluessel, kasten] of kaesten) kastenAufraeumen(schluessel, kasten, jetztMs);
      for (const [schluessel, t] of zuletzt) {
        if (t <= jetztMs - grenzen.anwesendMs) zuletzt.delete(schluessel);
      }
    },

    stand() {
      return {
        wartend,
        bytes: gesamt,
        anwesend: zuletzt.size,
        postfaecher: kaesten.size,
        absender: absenderBytes.size,
      };
    },
  };
}
