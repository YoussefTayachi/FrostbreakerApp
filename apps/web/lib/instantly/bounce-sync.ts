/**
 * Gebouncte Adressen aus Instantly zurueckholen, damit sie nie wieder in einer
 * Kampagne landen (kostenloser Ersatz fuer eine Vorab-Pruefung, Youssef am
 * 2026-10-01).
 *
 * GEMESSEN AM 2026-10-01, retaiyn-Kampagne 49e30115 (201 Leads, 2 Bounces):
 *   POST /api/v2/leads/list {filter: "FILTER_VAL_BOUNCED"}  -> genau die 2,
 *     beide mit status -1
 *   {filter: "FILTER_LEAD_BOUNCED"}                         -> 100 Leads
 *     gemischt: ein unbekannter Filter wird STILL IGNORIERT, nicht abgelehnt.
 * Deshalb wird unten zusaetzlich auf status -1 gefiltert: schreibt jemand den
 * Filternamen falsch, wird nicht die ganze Kampagne als ungueltig markiert.
 */

export const BOUNCED_FILTER = "FILTER_VAL_BOUNCED";

/** Instantlys Lead-Status fuer einen Bounce (seit 2026-08-04 gemessen, siehe
 *  app/api/instantly/campaigns/[id]/leads/route.ts). */
export const LEAD_STATUS_BOUNCED = -1;

/** Nur nachfragen, wenn die Kampagne seit dem letzten Abgleich neue Bounces
 *  meldet. Die Zahl kommt aus der Analytics-Abfrage, die ohnehin laeuft. */
export function needsBounceSync(bouncedCount: number | null | undefined, syncedCount: number | null | undefined): boolean {
  return (bouncedCount ?? 0) > (syncedCount ?? 0);
}

/** Adressen der gebouncten Leads, kleingeschrieben und ohne Doppelte. */
export function bouncedEmails(items: { email?: string | null; status?: number | null }[]): string[] {
  const out = new Set<string>();
  for (const i of items) {
    const email = i.email?.trim().toLowerCase();
    if (email && i.status === LEAD_STATUS_BOUNCED) out.add(email);
  }
  return [...out];
}
