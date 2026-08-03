/**
 * Rechenlogik des Deal-Boards.
 *
 * Getrennt von der Darstellung, weil hier Geld gerechnet wird: Spaltensummen,
 * gewichteter Forecast und die Frage, ab wann ein Deal als liegengeblieben
 * gilt. Solche Zahlen gehoeren geprueft und nicht in eine Komponente.
 *
 * Das Gegenstueck zu lib/crm/pipeline.ts, die dasselbe fuer das Kontakt-Board
 * tut. Beide Boards leben nebeneinander und beantworten verschiedene Fragen:
 *
 *   Kontakt-Board  "wen spreche ich an"      -> contacts.outreach_status
 *   Deal-Board     "was kommt davon zurueck" -> public.deals mit Wert
 */
import { DEAL_STAGE_IDS, type DealStage } from "./deals";

/** Eine Zeile aus der RPC deal_board_rows (Migration 0065). */
export type DealBoardRow = {
  id: string;
  title: string;
  /** numeric(12,2) kommt als String aus PostgREST -- siehe dealValue(). */
  value: number | string;
  currency: string;
  stage: DealStage;
  probability: number;
  expected_close_date: string | null;
  created_at: string;
  updated_at: string;
  business_id: string;
  contact_id: string | null;
  company_name: string | null;
  company_website: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  /** Naechster offener Termin an Kontakt oder Firma -- traegt den Kreis auf der Karte. */
  next_due_at: string | null;
  next_due_subject: string | null;
  /** Tage seit der letzten Aenderung am Deal. */
  days_idle: number | null;
};

/**
 * numeric aus Postgres kommt ueber PostgREST als String an, nicht als Zahl.
 * Ungeprueft addiert ergaebe das eine Zeichenkette ("1000" + "2000" = "10002000")
 * -- und eine Spaltensumme, die auf den ersten Blick plausibel aussieht.
 */
export function dealValue(row: Pick<DealBoardRow, "value">): number {
  const n = typeof row.value === "number" ? row.value : Number(row.value);
  return Number.isFinite(n) ? n : 0;
}

/** Summe der Deal-Werte, wie sie bei Pipedrive im Spaltenkopf steht. */
export function stageTotal(rows: Pick<DealBoardRow, "value">[]): number {
  return rows.reduce((sum, r) => sum + dealValue(r), 0);
}

/**
 * Gewichtete Summe: Wert mal Abschlusswahrscheinlichkeit.
 *
 * Die ehrlichere Zahl fuer eine Prognose -- vier Deals zu 10.000 in der
 * Erstqualifizierung sind eben nicht 40.000, sondern bei 20 Prozent
 * Wahrscheinlichkeit 8.000.
 */
export function stageWeighted(rows: Pick<DealBoardRow, "value" | "probability">[]): number {
  return rows.reduce((sum, r) => sum + dealValue(r) * (r.probability / 100), 0);
}

/** Deals nach Stufe, in der Reihenfolge der Spalten. Leere Stufen bleiben enthalten. */
export function groupByStage<T extends Pick<DealBoardRow, "stage">>(
  rows: T[]
): Record<DealStage, T[]> {
  const groups = Object.fromEntries(DEAL_STAGE_IDS.map((s) => [s, [] as T[]])) as Record<
    DealStage,
    T[]
  >;
  for (const row of rows) {
    // Unbekannte Stufen landen in der ersten, statt lautlos vom Board zu
    // verschwinden -- gleiche Regel wie im Kontakt-Board.
    (groups[row.stage] ?? groups[DEAL_STAGE_IDS[0]]).push(row);
  }
  return groups;
}

/**
 * Ab wann gilt ein Deal als liegengeblieben?
 *
 * Kuerzer als beim Kontakt (dort 14 Tage): ein Deal ist bereits ein Gespraech,
 * das laeuft. Eine Woche ohne jede Bewegung ist dort ein Warnzeichen, waehrend
 * ein unberuehrter Kontakt in einer Sequenz voellig normal ist.
 */
export const DEAL_STALE_AFTER_DAYS = 7;

export function isDealStale(row: Pick<DealBoardRow, "days_idle">): boolean {
  return (row.days_idle ?? 0) >= DEAL_STALE_AFTER_DAYS;
}

/** Abschlussdatum verstrichen, Deal aber noch offen. */
export function isOverdue(row: Pick<DealBoardRow, "expected_close_date">, now = new Date()): boolean {
  if (!row.expected_close_date) return false;
  // Datumsvergleich auf Tagesebene: ein Deal, der heute schliessen soll, ist
  // heute nicht ueberfaellig.
  const due = new Date(row.expected_close_date + "T23:59:59");
  return due.getTime() < now.getTime();
}

/** Anzeigename des zugeordneten Kontakts, sonst die Firma. */
export function dealSubtitle(row: DealBoardRow): string {
  const person =
    row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || null;
  return [row.company_name, person].filter(Boolean).join(" · ");
}
