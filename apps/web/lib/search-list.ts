/**
 * Filterregeln der Suchliste.
 *
 * Als eigene Funktion und nicht inline in der Komponente, weil hier die
 * Kleinigkeiten sitzen, die man beim Ansehen nicht bemerkt: dass "laeuft"
 * drei verschiedene Status meint, dass der Ordnerreiter "Ohne Ordner" etwas
 * anderes ist als "Alle", und dass die Textsuche auch den Ort trifft (wer
 * "Niederlande" tippt, meint die niederlaendische Liste, nicht eine Liste mit
 * dem Wort im Namen).
 */

export type SearchListRow = {
  id: string;
  name: string;
  query: string;
  location: string;
  source: string;
  status: string;
  error: string | null;
  note: string | null;
  schedule: string;
  max_results: number;
  target_email_count: number | null;
  created_at: string;
  archived_at: string | null;
  folder_id: string | null;
  businesses: number;
  businesses_done: number;
  contacts: number;
  with_email: number;
  /**
   * Gebuendelte Mehrfach-Suche (Migration 0096). Die vier Felder kommen aus
   * search_overview: bei einer Einzelsuche ist is_search_group false und die
   * Zaehler stehen auf 0, bei einer Gruppe sind alle Zahlen oben bereits die
   * Summe ihrer Teilsuchen.
   */
  is_search_group: boolean;
  child_count: number;
  children_done: number;
  children_failed: number;
};

export const FILTER_ALL = "__alle__";
export const FILTER_NO_FOLDER = "__ohne__";

export type SearchFilter = {
  q: string;
  quelle: string;
  status: string;
  ordner: string;
};

/** Trifft der Text Name, Suchbegriff oder Ort? Gross-/Kleinschreibung egal. */
function trifftText(row: SearchListRow, q: string): boolean {
  const suche = q.trim().toLowerCase();
  if (!suche) return true;
  return [row.name, row.query, row.location].some((feld) =>
    (feld ?? "").toLowerCase().includes(suche)
  );
}

/**
 * "running" fasst zusammen, was fuer den Nutzer dasselbe ist: die Suche ist
 * noch nicht fertig. In der Datenbank sind das pending und running — eine
 * Unterscheidung, die nur den Worker interessiert.
 */
function trifftStatus(row: SearchListRow, status: string): boolean {
  if (!status) return true;
  if (status === "running") return row.status === "pending" || row.status === "running";
  return row.status === status;
}

function trifftOrdner(row: SearchListRow, ordner: string): boolean {
  if (ordner === FILTER_ALL) return true;
  if (ordner === FILTER_NO_FOLDER) return row.folder_id === null;
  return row.folder_id === ordner;
}

export function matchesSearchFilter(row: SearchListRow, filter: SearchFilter): boolean {
  return (
    trifftText(row, filter.q) &&
    (!filter.quelle || row.source === filter.quelle) &&
    trifftStatus(row, filter.status) &&
    trifftOrdner(row, filter.ordner)
  );
}
