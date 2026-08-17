/**
 * Warmup-Zustand eines Postfachs, aus Instantlys Rohdaten.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DAS EINE EIGENE DATEI MIT TESTS IST
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Zwei Zahlen aus Instantlys Antwort tragen aehnliche Namen und bedeuten
 * voellig Verschiedenes:
 *
 *   status         Verbindung des Postfachs (1 = laeuft)
 *   warmup_status  Aufwaermen (1 = laeuft, 0 = pausiert, -1 = von Instantly
 *                  gesperrt, weil das Konto den Warmup-Pool belastet hat)
 *
 * Die Oberflaeche zeigte bisher NUR status an. Am 2026-08-09 stand deshalb
 * bei allen 50 Postfaechern des Kunden "Aktiv", auch bei dem einen, dessen
 * Warmup Instantly gesperrt hatte (g.berat@retaiyn.de, warmup_status = -1).
 * In Instantlys eigener Oberflaeche war es an der roten Flamme sofort zu
 * sehen, bei uns gar nicht.
 */

/** Empfohlene Mindestdauer, bevor ueber ein Postfach kalt versendet wird.
 *  Dieselbe Zahl nennt die Anleitung der App und die Website. */
export const WARMUP_TARGET_DAYS = 14;

export type WarmupState =
  /** Instantly hat das Aufwaermen gesperrt; braucht einen Reaktivierungscode. */
  | "blocked"
  /** Laeuft, aber die empfohlenen Tage sind noch nicht voll. */
  | "warming"
  /** Laeuft und ist lange genug gelaufen. */
  | "ready"
  /** Vom Nutzer pausiert. */
  | "paused"
  /** Laeuft, aber Instantly nennt keinen Startzeitpunkt, Dauer unbekannt. */
  | "unknown";

export type WarmupInfo = {
  state: WarmupState;
  /** Volle Tage seit dem Start, oder null wenn kein Startzeitpunkt vorliegt. */
  days: number | null;
  /** Wie viele noch fehlen (0 wenn erreicht), oder null. */
  remaining: number | null;
  /** 0..100 fuer den Balken. */
  percent: number;
};

/**
 * Volle Tage zwischen Start und jetzt.
 *
 * Bewusst auf ganze Tage abgerundet und ab Tag 1 gezaehlt: "Tag 1 von 14"
 * ist fuer den Nutzer der erste Tag, nicht "Tag 0". Ein Postfach, das vor
 * einer Stunde gestartet ist, steht damit bei Tag 1, und nicht bei einer
 * Null, die aussieht, als sei nichts passiert.
 */
export function warmupDays(start: string | null | undefined, now: Date = new Date()): number | null {
  if (!start) return null;
  const began = new Date(start);
  if (Number.isNaN(began.getTime())) return null;
  const elapsedMs = now.getTime() - began.getTime();
  if (elapsedMs < 0) return 1; // Startzeit in der Zukunft: Uhren-Abweichung, nicht negativ zeigen
  return Math.floor(elapsedMs / 86_400_000) + 1;
}

export function warmupInfo(
  account: { warmup_status: number; timestamp_warmup_start?: string | null },
  now: Date = new Date()
): WarmupInfo {
  const days = warmupDays(account.timestamp_warmup_start, now);

  // Die Sperre steht ueber allem: ein gesperrtes Postfach waermt nicht auf,
  // egal wie lange es schon dabei ist. Wuerde hier zuerst auf die Tage
  // geschaut, meldete die Oberflaeche nach zwei Wochen "bereit" fuer ein
  // Postfach, das gar nichts tut.
  if (account.warmup_status === -1) {
    return { state: "blocked", days, remaining: null, percent: 0 };
  }
  if (account.warmup_status !== 1) {
    return { state: "paused", days, remaining: null, percent: 0 };
  }
  if (days === null) {
    return { state: "unknown", days: null, remaining: null, percent: 0 };
  }
  const remaining = Math.max(0, WARMUP_TARGET_DAYS - days);
  const percent = Math.min(100, Math.round((days / WARMUP_TARGET_DAYS) * 100));
  return { state: remaining === 0 ? "ready" : "warming", days, remaining, percent };
}

/**
 * Wann das zuletzt gestartete Postfach die empfohlenen Tage voll hat.
 *
 * Die eigentliche Frage des Nutzers lautet nicht "wie steht Postfach 37?",
 * sondern "ab wann kann ich senden?". Bei 50 Postfaechern ist das sonst eine
 * Rechenaufgabe ueber 50 Zeilen.
 *
 * Gesperrte und pausierte bleiben aussen vor: sie haben kein Datum, auf das
 * man warten koennte, und wuerden das Ergebnis ins Unendliche schieben.
 */
export function readyDate(
  accounts: { warmup_status: number; timestamp_warmup_start?: string | null }[],
  now: Date = new Date()
): Date | null {
  const starts = accounts
    .filter((a) => a.warmup_status === 1 && a.timestamp_warmup_start)
    .map((a) => new Date(a.timestamp_warmup_start as string).getTime())
    .filter((t) => !Number.isNaN(t));
  if (starts.length === 0) return null;
  const latest = Math.max(...starts);
  const done = new Date(latest + (WARMUP_TARGET_DAYS - 1) * 86_400_000);
  return done.getTime() <= now.getTime() ? null : done;
}
