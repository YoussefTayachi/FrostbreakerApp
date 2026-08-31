/**
 * Entscheidet, wie viele Worker-Repliken laufen sollen.
 *
 * Reine Logik ohne Netz, damit sie testbar ist; die Cron-Route
 * (app/api/cron/worker-ops) misst die Queue und setzt das Ergebnis per
 * Railway-API um.
 *
 * Warum ueberhaupt atmen statt Dauerbetrieb: Railway rechnet pro Minute
 * tatsaechlicher Nutzung ab. Dieselbe Arbeit kostet dasselbe, ob 2 Repliken
 * 4 Stunden brauchen oder 6 Repliken eine, nur der Leerlauf dazwischen
 * kostet extra. Gemessen am 2026-08-31: der Workload ist stossweise (ein
 * Batch 1 bis 2 Stunden, danach viele Stunden nichts), Dauerbetrieb von 6
 * Repliken kostete 40 bis 60 USD im Monat, atmend bleibt derselbe Durchsatz
 * innerhalb der 20 USD, die im Railway-Pro-Abo enthalten sind.
 */

export type ScaleInput = {
  /** Faellige Jobs (status pending, run_at erreicht). Zurueckgestellte
   *  personalize-Jobs zaehlen NICHT: sie sind bewusst geparkt und sollen
   *  keine sechs Repliken wecken. */
  faellig: number;
  /** Gerade laufende Jobs. */
  laufend: number;
  /** Minuten seit dem letzten Lebenszeichen der Queue (juengstes locked_at
   *  oder created_at). Verhindert Flattern: runter auf die Ruhebesetzung
   *  erst, wenn wirklich Ruhe ist, nicht in der Luecke zwischen zwei Jobs. */
  minutenSeitLetzterAktivitaet: number;
};

export type ScaleLimits = {
  /** Obergrenze im Burst. Voreinstellung 6: mit WORKER_CONCURRENCY=4 sind
   *  das 24 parallele Jobs, mehr traegt die gemessene Pipeline nicht, bevor
   *  Google/OpenAI zum Engpass werden. */
  max: number;
  /** Ruhebesetzung. Mindestens 1, sonst holt niemand mehr Jobs ab und auch
   *  der naechste Batch startet nicht. */
  ruhe: number;
  /** Ab wie vielen faelligen Jobs voll hochgefahren wird. */
  burstAb: number;
};

export const SCALE_DEFAULTS: ScaleLimits = { max: 6, ruhe: 1, burstAb: 50 };

/** Minuten Stille, bevor auf die Ruhebesetzung zurueckgefahren wird. Jede
 *  Aenderung der Replikzahl loest bei Railway ein Redeploy aus; im
 *  Minutentakt hoch und runter waere teurer als das bisschen Leerlauf. */
export const RUHE_NACH_MINUTEN = 5;

export function desiredReplicas(input: ScaleInput, limits: ScaleLimits = SCALE_DEFAULTS): number {
  const max = Math.max(1, limits.max);
  const ruhe = Math.min(Math.max(1, limits.ruhe), max);
  if (input.faellig >= limits.burstAb) return max;
  if (input.faellig > 0 || input.laufend > 0) {
    // Kleiner Rueckstand: eine Zwischenstufe statt Vollgas, sonst starten
    // fuer drei Nachzuegler-Jobs sechs Chromiums.
    return Math.min(2, max);
  }
  if (input.minutenSeitLetzterAktivitaet < RUHE_NACH_MINUTEN) {
    // Gerade erst still geworden: Besetzung halten, das kann die Luecke
    // zwischen zwei Wellen desselben Batches sein (Recherche fertig,
    // Befundsaetze noch nicht eingereiht).
    return Math.min(2, max);
  }
  return ruhe;
}
