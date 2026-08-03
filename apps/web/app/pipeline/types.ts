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
  phone: string | null;
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
};

/** Anzeigename mit Rueckfall, damit nie eine leere Zeile entsteht. */
export function displayName(row: PipelineRow, fallback: string): string {
  return (
    row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || fallback
  );
}
