/** Anzeige-Namen der Lead-Quellen einer Suche (searches.source).
 *
 *  Vorher stand an drei Stellen dieselbe Inline-Bedingung
 *  (`s.source === "corporate" ? "Corporate" : "Maps"`) -- mit Apollo als
 *  dritter Quelle waere daraus an jeder Stelle eine verschachtelte Kette
 *  geworden, die beim naechsten Anbieter erneut angefasst werden muesste.
 *  Farben unterscheiden sich bewusst: die Quelle entscheidet, ob eine Suche
 *  Apollo-Credits oder Google-Places-Kontingent verbraucht -- das soll man in
 *  der Liste erkennen, ohne die Suche zu oeffnen. */
// Bewusst der ANBIETER statt des Suchwegs ("Firmen"/"Entscheider"): in der
// Suchliste ist die Frage nicht, wonach gesucht wurde, sondern welches
// Kontingent die Suche verbraucht hat. "Corporate" nannte den Anbieter nicht
// und war damit an dieser Stelle die unbrauchbarste der drei Bezeichnungen.
export const SEARCH_SOURCE_LABELS: Record<string, string> = {
  maps: "Maps",
  corporate: "Hunter",
  apollo: "Apollo",
};

export function searchSourceLabel(source: string | null | undefined): string {
  return SEARCH_SOURCE_LABELS[source ?? ""] ?? (source || "—");
}

const NEUTRAL = "border-edge2 bg-chip text-soft";

/** Farbe je Anbieter, angelehnt an dessen Markenfarbe: Hunter orange, Apollo
 *  gelb, Google Maps blau. Das macht die Quelle in einer langen Liste ohne
 *  Lesen erkennbar.
 *
 *  Der Farbton sitzt bewusst nur in Rahmen und Flaeche, der Text bleibt eine
 *  dunkle Stufe derselben Farbe. Apollos echtes Markengelb (#FFDD00) hat auf
 *  Weiss rund 1,3:1 und waere als Textfarbe unlesbar -- yellow-700 kommt auf
 *  ~5,4:1 und traegt denselben Farbeindruck. Aus demselben Grund steht die
 *  Farbe nie allein: daneben steht immer der Anbietername.
 *
 *  Im Dunkelmodus kehrt sich das um (helle Textstufe auf transparenter
 *  Flaeche), wie bei den uebrigen Chips der App. */
export function searchSourceBadgeClass(source: string | null | undefined): string {
  if (source === "apollo") {
    return "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300";
  }
  if (source === "corporate") {
    return "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300";
  }
  if (source === "maps") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
  return NEUTRAL;
}

/** Dasselbe fuer die Quelle eines einzelnen KONTAKTS (contacts.source). Die
 *  Werte sind andere als bei einer Suche: ai_websearch, hunter, apollo, manual.
 *
 *  Bewusst nur die beiden Anbieter eingefaerbt, deren Abfrage Credits kostet.
 *  Bekaeme jeder Wert eine eigene Farbe, waere die Spalte bunt und die Farbe
 *  saegte nichts mehr aus -- gerade in einer Tabelle mit hunderten Zeilen. */
export function contactSourceBadgeClass(source: string | null | undefined): string {
  if (source === "apollo") {
    return "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300";
  }
  if (source === "hunter") {
    return "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300";
  }
  return NEUTRAL;
}
