// All limits in one place (plan § 4: limits in RAM — total, per app, per receiver, per sender —
// and how often a device may ask). Exceeded means refused with a reason, never cut silently.

export interface Grenzen {
  /** A message waits at most this long, then it is gone (plan § 2, „Weg A“: about 30 s). */
  readonly wartezeitMs: number;
  /** A device counts as present this long after its last collect. */
  readonly anwesendMs: number;
  readonly nachrichtBytes: number;
  /** Every message counts at least this much in the byte limits below: its keeping in RAM (map
   * entry, buffer, list place) costs about that, whatever its content — without it, tiny messages to
   * fresh ids would fill the memory while the byte counts stayed small. */
  readonly nachrichtMindestBytes: number;
  readonly empfaengerJeAblegen: number;
  readonly jeEmpfaengerAnzahl: number;
  readonly jeEmpfaengerBytes: number;
  readonly jeAbsenderBytes: number;
  readonly jeAppBytes: number;
  readonly gesamtBytes: number;
  /** What one collect hands out at most; the rest stays and `mehr` says so. */
  readonly abholenBytes: number;
  readonly anwesendFragen: number;
  /** Requests per device in `minuteMs` (one collect a second during a sync is 60). */
  readonly anfragenJeMinute: number;
  /** The windows of the counters: „je Minute“ and „je Stunde“. */
  readonly minuteMs: number;
  readonly stundeMs: number;
  readonly klingelnJeStunde: number;
  readonly einladenJeStunde: number;
  /** Enrolments with a proof per app and hour. */
  readonly einschreibenJeStunde: number;
  /** Enrolments with an invitation per app and hour, counted apart: a chain of invited devices must
   * not use up what testers with a fresh proof need. */
  readonly einschreibenEinladungJeStunde: number;
  /** Devices one tenant (app + school) may have at most (kept in RAM: after a restart it fills again
   * as devices ask). */
  readonly geraeteJeMandant: number;
  /** Devices of all apps and tenants together; at it no new device is taken (`treffpunkt-voll`). */
  readonly geraeteGesamt: number;
  /** Blocks one device may make per hour. */
  readonly sperrenJeStunde: number;
  /** Blocked ids one tenant's list holds at most. */
  readonly sperrlisteJeMandant: number;
  /** Developer password tries per app and hour (a password costs about 50 ms of the one thread). */
  readonly passwortVersucheJeStunde: number;
  /** Bodies one device may have on the way at once (each up to its endpoint's limit). */
  readonly koerperJeGeraetImFlug: number;
  /** Bytes of bodies on the way at once, from devices with an access, all apps together … */
  readonly koerperImFlugBytes: number;
  /** … and per app, so the devices of one app cannot stall the others. */
  readonly koerperJeAppImFlugBytes: number;
  /** Of both: kept for small bodies (announced at most `KOERPER_BYTES.klein`; a body without a
   * length counts as its endpoint's limit), so large slow bodies cannot hold up collecting,
   * pinging, renewing, ringing and small drops. */
  readonly koerperKleinReserveBytes: number;
  /** … and without one (enrolments), apart, so strangers cannot use up what devices need. */
  readonly koerperOhneZugangImFlugBytes: number;
  /** Bytes of bodies one device may send in `minuteMs` (announced, or without a length its
   * endpoint's limit): reading and parsing them runs on the one thread every app shares … */
  readonly koerperBytesJeGeraetMinute: number;
  /** … and all devices of one app together, so one app cannot keep the others waiting. */
  readonly koerperBytesJeAppMinute: number;
}

export const GRENZEN: Grenzen = {
  wartezeitMs: 30_000,
  anwesendMs: 30_000,
  nachrichtBytes: 65_536,
  nachrichtMindestBytes: 1024,
  empfaengerJeAblegen: 50,
  jeEmpfaengerAnzahl: 100,
  jeEmpfaengerBytes: 2 * 1_048_576,
  jeAbsenderBytes: 4 * 1_048_576,
  jeAppBytes: 32 * 1_048_576,
  gesamtBytes: 64 * 1_048_576,
  abholenBytes: 2 * 1_048_576,
  anwesendFragen: 200,
  anfragenJeMinute: 300,
  minuteMs: 60_000,
  stundeMs: 3_600_000,
  klingelnJeStunde: 60,
  einladenJeStunde: 10,
  einschreibenJeStunde: 120,
  einschreibenEinladungJeStunde: 60,
  geraeteJeMandant: 50,
  geraeteGesamt: 300,
  sperrenJeStunde: 30,
  sperrlisteJeMandant: 500,
  passwortVersucheJeStunde: 20,
  koerperJeGeraetImFlug: 2,
  koerperImFlugBytes: 64 * 1_048_576,
  koerperJeAppImFlugBytes: 32 * 1_048_576,
  koerperKleinReserveBytes: 1_048_576,
  koerperOhneZugangImFlugBytes: 8 * 1_048_576,
  koerperBytesJeGeraetMinute: 32 * 1_048_576,
  koerperBytesJeAppMinute: 64 * 1_048_576,
};

/** Largest body per endpoint; `ablegen` carries up to 50 messages in base64url. */
export const KOERPER_BYTES = {
  klein: 16_384,
  klingeln: 8_192,
  ablegen: 6 * 1_048_576,
} as const;

/** Counts events per key in a sliding window: only times (and, for bytes, sizes) are kept, nothing
 * about content. Each event weighs `gewicht` (1 unless bytes are counted); the window holds at most
 * `hoechstens` in weight. The times come from a clock that never goes back, so each key's events
 * stay in order: the old ones leave from the front and a running sum is kept — every call costs
 * the same, however many events the window holds. */
export interface Zaehler {
  /** Counts the event if the window has room for it; says whether it had. */
  erlaubt(schluessel: string, jetztMs: number, gewicht?: number): boolean;
  /** Whether `erlaubt` would refuse now, without counting anything. */
  voll(schluessel: string, jetztMs: number, gewicht?: number): boolean;
  /** Counts the event whatever the window holds (what has happened anyway, such as a body read). */
  buchen(schluessel: string, jetztMs: number, gewicht?: number): void;
  aufraeumen(jetztMs: number): void;
  readonly groesse: number;
}

interface Fenster {
  zeiten: number[];
  gewichte: number[];
  /** Index of the first event still in the window. */
  vorne: number;
  summe: number;
}

export function zaehlerAnlegen(hoechstens: number, fensterMs: number): Zaehler {
  const fenster = new Map<string, Fenster>();
  /** The key's window as of `jetztMs`, with what has left it dropped from the front. */
  const aktuell = (schluessel: string, jetztMs: number): Fenster | undefined => {
    const f = fenster.get(schluessel);
    if (!f) return undefined;
    const grenze = jetztMs - fensterMs;
    while (f.vorne < f.zeiten.length && (f.zeiten[f.vorne] ?? 0) <= grenze) {
      f.summe -= f.gewichte[f.vorne] ?? 0;
      f.vorne += 1;
    }
    if (f.vorne === f.zeiten.length) {
      fenster.delete(schluessel);
      return undefined;
    }
    // Give back the room of what has left, now and then (amortised over the events it held).
    if (f.vorne > 1024 && f.vorne * 2 > f.zeiten.length) {
      f.zeiten = f.zeiten.slice(f.vorne);
      f.gewichte = f.gewichte.slice(f.vorne);
      f.vorne = 0;
    }
    return f;
  };
  const buchen = (schluessel: string, jetztMs: number, gewicht: number): void => {
    const f = aktuell(schluessel, jetztMs) ?? { zeiten: [], gewichte: [], vorne: 0, summe: 0 };
    f.zeiten.push(jetztMs);
    f.gewichte.push(gewicht);
    f.summe += gewicht;
    fenster.set(schluessel, f);
  };
  const voll = (schluessel: string, jetztMs: number, gewicht: number): boolean =>
    (aktuell(schluessel, jetztMs)?.summe ?? 0) + gewicht > hoechstens;
  return {
    erlaubt(schluessel, jetztMs, gewicht = 1) {
      if (voll(schluessel, jetztMs, gewicht)) return false;
      buchen(schluessel, jetztMs, gewicht);
      return true;
    },
    voll(schluessel, jetztMs, gewicht = 1) {
      return voll(schluessel, jetztMs, gewicht);
    },
    buchen(schluessel, jetztMs, gewicht = 1) {
      buchen(schluessel, jetztMs, gewicht);
    },
    aufraeumen(jetztMs) {
      for (const schluessel of [...fenster.keys()]) aktuell(schluessel, jetztMs);
    },
    get groesse() {
      return fenster.size;
    },
  };
}
