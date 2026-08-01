/** Anzeige-Namen der Lead-Quellen einer Suche (searches.source).
 *
 *  Vorher stand an drei Stellen dieselbe Inline-Bedingung
 *  (`s.source === "corporate" ? "Corporate" : "Maps"`) -- mit Apollo als
 *  dritter Quelle waere daraus an jeder Stelle eine verschachtelte Kette
 *  geworden, die beim naechsten Anbieter erneut angefasst werden muesste.
 *  Farben unterscheiden sich bewusst: die Quelle entscheidet, ob eine Suche
 *  Apollo-Credits oder Google-Places-Kontingent verbraucht -- das soll man in
 *  der Liste erkennen, ohne die Suche zu oeffnen. */
export const SEARCH_SOURCE_LABELS: Record<string, string> = {
  maps: "Maps",
  corporate: "Corporate",
  apollo: "Apollo",
};

export function searchSourceLabel(source: string | null | undefined): string {
  return SEARCH_SOURCE_LABELS[source ?? ""] ?? (source || "—");
}

const NEUTRAL = "border-edge2 bg-chip text-soft";

export function searchSourceBadgeClass(source: string | null | undefined): string {
  if (source === "apollo") {
    return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
  }
  if (source === "corporate") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
  return NEUTRAL;
}
