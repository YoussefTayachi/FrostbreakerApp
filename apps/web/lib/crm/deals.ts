import type { Lang } from "@/lib/i18n/lang";

/**
 * Deal-Stufen und ihre Standard-Abschlusswahrscheinlichkeiten.
 *
 * Einzige Quelle der Wahrheit: die DB speichert deals.probability als Zahl und
 * berechnet sie NICHT aus der Stufe (siehe Kommentar in Migration 0034). Beim
 * Anlegen und Umstufen setzt der Client den Wert von hier -- dadurch kann der
 * Vertriebler eine Wahrscheinlichkeit im Einzelfall uebersteuern, ohne dass eine
 * Stufen-Aenderung sie stillschweigend wieder wegrechnet.
 *
 * Reihenfolge = Reihenfolge der Spalten im Deal-Board. Muss synchron bleiben mit
 * dem CHECK-Constraint auf deals.stage in Migration 0034.
 */
export const DEAL_STAGES = [
  { id: "qualified", probability: 20 },
  { id: "meeting", probability: 40 },
  { id: "proposal", probability: 60 },
  { id: "negotiation", probability: 80 },
] as const;

export type DealStage = (typeof DEAL_STAGES)[number]["id"];
export type DealStatus = "open" | "won" | "lost";

export const DEAL_STAGE_IDS = DEAL_STAGES.map((s) => s.id) as readonly DealStage[];

export function defaultProbability(stage: DealStage): number {
  return DEAL_STAGES.find((s) => s.id === stage)?.probability ?? 20;
}

export function isDealStage(value: string): value is DealStage {
  return (DEAL_STAGE_IDS as readonly string[]).includes(value);
}

export type Deal = {
  id: string;
  business_id: string;
  contact_id: string | null;
  title: string;
  value: number;
  currency: string;
  stage: DealStage;
  probability: number;
  status: DealStatus;
  expected_close_date: string | null;
  closed_at: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
};

/** Gewichteter Forecast: Wert x Wahrscheinlichkeit, nur offene Deals. */
export function weightedValue(deals: Pick<Deal, "value" | "probability" | "status">[]): number {
  return deals
    .filter((d) => d.status === "open")
    .reduce((sum, d) => sum + (Number(d.value) || 0) * (d.probability / 100), 0);
}

const MONEY_LOCALE: Record<Lang, string> = { de: "de-DE", en: "en-US" };

export function formatMoney(value: number, currency: string, lang: Lang): string {
  try {
    return new Intl.NumberFormat(MONEY_LOCALE[lang], {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // Ungueltiger Waehrungscode aus der DB soll die Ansicht nicht zerlegen
    return `${Math.round(value)} ${currency}`;
  }
}

/**
 * Vorgegebene Verlustgruende.
 *
 * Vorher fragte ein window.prompt nach Freitext. Das laesst sich nicht
 * auswerten: "zu teuer", "Preis", "price too high" sind drei verschiedene
 * Zeilen in jeder Statistik, obwohl sie dasselbe meinen. Pipedrive gibt die
 * Gruende deshalb vor -- und genau diese Auswertung ("woran verlieren wir
 * eigentlich") ist der einzige Bericht, den Vertriebler wirklich lesen.
 *
 * Bewusst kurz gehalten. Eine lange Liste wird nicht gelesen, sondern es wird
 * der erste Eintrag geklickt.
 */
export const DEAL_LOST_REASONS = [
  "price",
  "timing",
  "competitor",
  "no_budget",
  "no_need",
  "no_response",
] as const;

export type DealLostReason = (typeof DEAL_LOST_REASONS)[number];
