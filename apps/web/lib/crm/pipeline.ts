/**
 * Eine Zeile der Pipeline, wie sie die RPC pipeline_rows (Migration 0061)
 * liefert.
 *
 * Bewusst flach statt verschachtelt: die Felder kommen aus vier Tabellen
 * (contacts, businesses, searches und den Aggregaten ueber activities/messages),
 * und eine nachgebaute Verschachtelung wuerde nur so tun, als gaebe es sie.
 * Board und Liste teilen sich diesen einen Typ -- vorher hatte das Board seine
 * eigene, kleinere Form, und jede neue Angabe haette an zwei Stellen gepflegt
 * werden muessen.
 */
export type PipelineRow = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  /** Die drei Kontaktwege. Liegen laengst in contacts, wurden in der Pipeline nur nie gezeigt. */
  email: string | null;
  /** Durchwahl des Kontakts, sonst die Firmennummer (Migration 0063). */
  phone: string | null;
  /** true = es ist die Zentrale, nicht die Durchwahl. Wer eine Zentrale anruft,
   *  meldet sich anders -- deshalb steht das an der Nummer dran. */
  phone_is_company: boolean;
  linkedin: string | null;
  outreach_status: string;
  business_id: string;
  created_at: string;
  company_name: string | null;
  company_website: string | null;
  /** Lead-Liste (= Suche), aus der der Kontakt stammt. Null nur bei endgueltig geloeschter Suche. */
  list_id: string | null;
  list_name: string | null;
  list_location: string | null;
  list_source: string | null;
  /** Letzte eigene Kontaktaufnahme -- Anruf, Nachricht oder ausgehende Mail. */
  last_touch_at: string | null;
  last_touch_channel: string | null;
  /** Wann der Kontakt zuletzt geantwortet hat. Getrennt gefuehrt: "ich habe geschrieben"
   *  und "er hat geantwortet" sind beim Abarbeiten zwei verschiedene Dinge. */
  last_reply_at: string | null;
  /** Naechster offener Termin -- exakt die Zeile, die auch unter /calls steht. */
  next_due_at: string | null;
  next_due_subject: string | null;
  next_due_channel: string | null;
  next_due_type: string | null;
  /** Seit wann steht der Kontakt auf dieser Stufe (Migration 0063). Grundlage
   *  fuer die Stagnations-Anzeige -- Pipedrives "rotting deals". */
  stage_since: string | null;
};

/**
 * Ab wann gilt ein Kontakt als liegengeblieben?
 *
 * Pipedrive laesst die Schwelle je Phase einstellen. Das waere hier
 * verfrueht -- erst muss sich zeigen, ob die Anzeige ueberhaupt genutzt wird.
 * 14 Tage sind bei Kaltakquise eine vertretbare Vorgabe: kuerzer waere bei
 * einer Sequenz mit mehreren Schritten reines Rauschen, laenger merkt man den
 * Stillstand erst, wenn der Lead ohnehin kalt ist.
 *
 * Gilt bewusst NICHT fuer Endzustaende: ein Kunde oder eine Absage darf
 * beliebig lange so stehen, das ist kein Stillstand, sondern das Ergebnis.
 */
export const STALE_AFTER_DAYS = 14;

const FINAL_STAGES = new Set(["customer", "not_interested"]);

export function daysInStage(row: PipelineRow, now = new Date()): number | null {
  if (!row.stage_since) return null;
  const ms = now.getTime() - new Date(row.stage_since).getTime();
  return Math.floor(ms / 86_400_000);
}

export function isStale(row: PipelineRow, now = new Date()): boolean {
  if (FINAL_STAGES.has(row.outreach_status)) return false;
  const days = daysInStage(row, now);
  return days !== null && days >= STALE_AFTER_DAYS;
}

/** Kein geplanter naechster Schritt -- Pipedrives zentraler Reflex. */
export function hasNoNextStep(row: PipelineRow): boolean {
  if (FINAL_STAGES.has(row.outreach_status)) return false;
  return !row.next_due_at;
}

/** Anzeigename mit Rueckfall, damit nie eine leere Zeile entsteht. */
export function displayName(row: PipelineRow, fallback: string): string {
  return (
    row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || fallback
  );
}
