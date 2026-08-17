/**
 * Gebuendelte Mehrfach-Suchen: Eltern, Kinder und wer wen vertritt.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WORUM ES GEHT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Eine Maps-Suche mit mehreren Nischen und/oder Orten legt pro Kombination
 * eine eigene searches-Zeile an — das ist Absicht, jede laeuft als eigener
 * get_businesses-Job mit eigenem Retry und eigener Stornierung (siehe
 * Migration 0096, Abschnitt "WARUM GRUPPIERUNG"). Sichtbar sein soll davon
 * aber genau EIN Eintrag: die Gruppen-Huelle mit parent_search_id = null und
 * is_search_group = true.
 *
 * Die Suchen-Seite bekommt diese Zusammenfassung fertig aus search_overview.
 * Ueberall sonst, wo Listen angeboten oder bearbeitet werden, muss die
 * Uebersetzung zwischen "eine Gruppe" und "ihre Teilsuchen" von Hand
 * passieren — die Firmen haengen an den Kindern, nie an der Huelle. Diese
 * Datei ist diese Uebersetzung, an einer Stelle und testbar.
 */

/** Das Minimum, mit dem sich die Verwandtschaft aufloesen laesst. */
export type SearchGroupLink = {
  id: string;
  parent_search_id: string | null;
  /** Nur dort noetig, wo eine Huelle von einer gewoehnlichen Suche zu
   *  unterscheiden ist — siehe groupPickerOptions. */
  is_search_group?: boolean | null;
};

/**
 * Die uebergebenen IDs plus alle Teilsuchen, die daran haengen.
 *
 * Fuer Sammelaktionen, die tatsaechlich Zeilen anfassen muessen (Firmen einer
 * Liste endgueltig loeschen). Wer nur searches selbst aktualisiert, kommt
 * ohne diese Funktion aus: dort genuegt ein
 * .or("id.in.(…),parent_search_id.in.(…)") in einer einzigen Abfrage.
 *
 * Reihenfolge: erst die uebergebenen IDs, dann die Kinder. Doppelte fallen
 * weg — eine ID darf gefahrlos zweimal hereingereicht werden.
 */
export function withChildIds(ids: string[], links: SearchGroupLink[]): string[] {
  const gesucht = new Set(ids);
  const kinder = links
    .filter((l) => l.parent_search_id !== null && gesucht.has(l.parent_search_id))
    .map((l) => l.id);
  return Array.from(new Set([...ids, ...kinder]));
}

/**
 * PostgREST-Filter "diese Zeilen und alles, was daran haengt".
 *
 * Fuer Sammelaktionen auf searches selbst (archivieren, in den Papierkorb,
 * Ordner wechseln): eine einzige Abfrage, ohne die Kinder vorher zu laden.
 * Ohne diesen Zusatz liefen die Teilsuchen unsichtbar weiter, nachdem die
 * Gruppenzeile im Papierkorb liegt — inklusive ihrer Abos und der Credits,
 * die die kosten.
 *
 * Immer zusammen mit .eq("workspace_id", …) verwenden: die or-Gruppe steht
 * neben den uebrigen Bedingungen, nicht statt ihrer.
 *
 * Erwartet mindestens eine ID — eine leere Liste ergaebe "id.in.()", was
 * PostgREST als Syntaxfehler zurueckweist. Alle Aufrufer brechen vorher ab.
 */
export function groupScopeFilter(ids: string[]): string {
  const liste = ids.join(",");
  return `id.in.(${liste}),parent_search_id.in.(${liste})`;
}

/**
 * Karte Kind -> Elternteil.
 *
 * Gebraucht dort, wo eine Information an einer Kind-ID haengt, aber an der
 * Gruppe angezeigt werden muss: der Fehlgrund einer fehlgeschlagenen Suche
 * steht in jobs.last_error und der Job kennt nur die Teilsuche
 * (payload->>'search_id'). Ohne diese Zuordnung bliebe die Gruppenzeile
 * kommentarlos rot.
 */
export function parentByChild(links: SearchGroupLink[]): Record<string, string> {
  const karte: Record<string, string> = {};
  for (const l of links) {
    if (l.parent_search_id) karte[l.id] = l.parent_search_id;
  }
  return karte;
}

/**
 * Auswahlliste fuer alles, was Leads AUS Listen zieht (Kampagnen-Formular).
 *
 * Eine Gruppe steht dabei fuer ihre Kinder und nicht fuer sich selbst: ihre
 * eigene ID wuerde null Kontakte liefern, weil an der Huelle keine Firmen
 * haengen. Wer die Gruppe anhakt, waehlt in Wahrheit ihre Teilsuchen aus --
 * und alles dahinter (Vorschau, Anlegen, campaign_searches) arbeitet
 * unveraendert mit echten Such-IDs weiter.
 *
 * Eine Gruppe ohne Kinder faellt heraus. Sie anzubieten hiesse, eine leere
 * Auswahl als Liste auszugeben.
 */
export function groupPickerOptions<T extends SearchGroupLink>(
  rows: T[]
): { row: T; searchIds: string[] }[] {
  const kinderVon: Record<string, string[]> = {};
  for (const r of rows) {
    if (r.parent_search_id) (kinderVon[r.parent_search_id] ??= []).push(r.id);
  }
  return rows
    .filter((r) => r.parent_search_id === null)
    .map((r) => ({ row: r, searchIds: r.is_search_group ? (kinderVon[r.id] ?? []) : [r.id] }))
    .filter((o) => o.searchIds.length > 0);
}
