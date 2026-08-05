/**
 * Welche API-Keys braucht ein Suchweg, damit er ueberhaupt durchlaufen kann?
 *
 * Grund fuer diese Datei: Bis dahin liess die App Suchen starten, die nie
 * funktionieren konnten. In den Jobs standen am 2026-08-03 dreiundzwanzig
 * Fehlschlaege der Form "Kein API-Key fuer Provider 'google_maps' hinterlegt"
 * bzw. "'hunter'" -- verteilt ueber acht Tage, also immer wieder. Der Nutzer
 * startete eine Suche, sah "laeuft", und bekam nie ein Ergebnis oder eine
 * Erklaerung.
 *
 * Die Zuordnung ist aus den Pipelines abgelesen, nicht geraten:
 *
 *   maps       get_businesses -> google_maps            (get_businesses.py:364)
 *              Adressen per KI-Websuche -> openai       (find_decisionmaker.py:193)
 *   corporate  get_businesses -> hunter                 (get_businesses.py:132)
 *              Adressen von derselben Quelle -> hunter  (hunt_persons.py:100)
 *   apollo     get_businesses -> apollo                 (get_businesses.py:197)
 *              Adressen liefert Apollo selbst mit
 *   prospeo    get_businesses -> prospeo                (run_prospeo)
 *              Adressen aus bulk-enrich-person, ebenfalls derselbe Anbieter
 *
 * openai steht ueberall, weil personalize in allen drei Wegen eingereiht wird
 * (get_businesses.py:435/475) und dort den Schluessel zieht
 * (personalize.py:330).
 *
 * Wer die Verzweigung in get_businesses aendert (use_hunter, welcher Job je
 * Quelle eingereiht wird), muss diese Tabelle mitziehen -- sonst blockiert die
 * Vorpruefung entweder zu viel oder zu wenig.
 */

export type SearchMode = "maps" | "apollo" | "corporate" | "prospeo";
export type Provider = "google_maps" | "apollo" | "hunter" | "openai" | "prospeo";

const REQUIREMENTS: Record<SearchMode, Provider[]> = {
  maps: ["google_maps", "openai"],
  corporate: ["hunter", "openai"],
  apollo: ["apollo", "openai"],
  // prospeo liefert Person UND Firma in einem Lauf, wie Apollo. openai steht
  // auch hier, weil personalize in allen Wegen eingereiht wird.
  prospeo: ["prospeo", "openai"],
};

export function requiredProviders(mode: SearchMode): Provider[] {
  return REQUIREMENTS[mode];
}

/**
 * Welche der noetigen Keys fehlen?
 *
 * Reihenfolge bleibt die aus REQUIREMENTS, damit die Meldung immer gleich
 * aufgebaut ist -- der wichtigere Schluessel (die Firmensuche) steht vorn.
 */
export function missingProviders(mode: SearchMode, present: readonly string[]): Provider[] {
  const have = new Set(present);
  return requiredProviders(mode).filter((p) => !have.has(p));
}
