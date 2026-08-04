/**
 * Was tatsaechlich Antworten bringt.
 *
 * DIE EINE REGEL, DIE DIESE DATEI TRAEGT
 *
 * Eine Quote aus wenigen Sendungen ist keine Erkenntnis, sondern eine
 * Einladung zum Irrtum. Bei 12 Mails an einem Dienstag und einer Antwort
 * steht da "8,3 Prozent" -- eine Zahl, die praezise aussieht und nichts
 * bedeutet. Wer daraufhin nur noch dienstags sendet, hat eine Muenze geworfen
 * und es Strategie genannt.
 *
 * Deshalb traegt JEDE Kennzahl hier ihre Grundlage mit sich, und alles unter
 * MIN_SAMPLE wird ausdruecklich als "zu wenig" markiert statt als Prozentwert
 * ausgegeben. Die Oberflaeche darf so eine Zeile grau darstellen -- was sie
 * nicht darf, ist sie wie ein Ergebnis aussehen zu lassen.
 *
 * Gemessen wird an KONTAKTEN, nicht an Mails: eine Sequenz schickt drei bis
 * vier Mails an dieselbe Person, und die eine Antwort darauf gehoert nicht
 * durch vier geteilt. Die Frage lautet "wie viele der Angeschriebenen haben
 * geantwortet", und die Antwort ist eine Person, kein Sendevorgang.
 */

export type OutboundRow = {
  contactId: string | null;
  sentAt: string | null;
  /** Lead-Liste, ueber die der Kontakt in die Kampagne kam. */
  searchId: string | null;
  searchName: string | null;
};

/** Kontakte, von denen mindestens eine Antwort kam. */
export type ReplySet = Set<string>;

export type Bucket = {
  key: string;
  label: string;
  /** Angeschriebene Kontakte, nicht versendete Mails. */
  contacts: number;
  replies: number;
  /** Null, solange die Grundlage zu duenn ist -- siehe MIN_SAMPLE. */
  rate: number | null;
};

/**
 * Unter dieser Zahl angeschriebener Kontakte wird keine Quote ausgewiesen.
 *
 * 30 ist die uebliche Faustregel fuer "die Zahl beginnt, etwas zu bedeuten".
 * Sie ist keine Signifikanz -- dafuer braeuchte es je nach Effektgroesse ein
 * Vielfaches -- sondern die Schwelle, unterhalb derer die Anzeige einer Quote
 * schlicht irrefuehrend waere.
 */
export const MIN_SAMPLE = 30;

const WEEKDAYS_DE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function makeBucket(key: string, label: string, contacts: Set<string>, replies: ReplySet): Bucket {
  const n = contacts.size;
  let answered = 0;
  for (const id of contacts) if (replies.has(id)) answered++;
  return {
    key,
    label,
    contacts: n,
    replies: answered,
    rate: n >= MIN_SAMPLE ? answered / n : null,
  };
}

/**
 * Kontakte je Gruppe einsammeln.
 *
 * Ein Set je Gruppe, weil derselbe Kontakt mehrere Mails bekommt -- ihn
 * mehrfach zu zaehlen wuerde die Quote genau um den Faktor der Sequenzlaenge
 * druecken.
 */
function groupContacts(rows: OutboundRow[], keyOf: (r: OutboundRow) => string | null): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.contactId) continue;
    const key = keyOf(row);
    if (key === null) continue;
    const set = groups.get(key);
    if (set) set.add(row.contactId);
    else groups.set(key, new Set([row.contactId]));
  }
  return groups;
}

/**
 * Nach Lead-Liste.
 *
 * Die wichtigste der drei Aufschluesselungen: sie beantwortet "welche Nische
 * antwortet mir ueberhaupt". Alles andere -- Text, Zeitpunkt, Kanal -- wirkt
 * erst, wenn die Zielgruppe stimmt.
 */
export function bySearch(rows: OutboundRow[], replies: ReplySet): Bucket[] {
  const names = new Map<string, string>();
  for (const r of rows) if (r.searchId && r.searchName) names.set(r.searchId, r.searchName);

  const groups = groupContacts(rows, (r) => r.searchId);
  return [...groups.entries()]
    .map(([id, contacts]) => makeBucket(id, names.get(id) ?? id, contacts, replies))
    .sort(sortByRateThenSize);
}

/** Nach Wochentag des Versands. */
export function byWeekday(rows: OutboundRow[], replies: ReplySet, lang: "de" | "en" = "de"): Bucket[] {
  const labels = lang === "en" ? WEEKDAYS_EN : WEEKDAYS_DE;
  const groups = groupContacts(rows, (r) => {
    const day = weekdayOf(r.sentAt);
    return day === null ? null : String(day);
  });
  return [...groups.entries()]
    .map(([key, contacts]) => makeBucket(key, labels[Number(key)], contacts, replies))
    // Nach Wochentag, nicht nach Quote: hier sucht man ein Muster ueber die
    // Woche, und ein Muster erkennt man nur in der natuerlichen Reihenfolge.
    .sort((a, b) => Number(a.key) - Number(b.key));
}

/** Nach Tageszeit des Versands, in Bloecken von drei Stunden. */
export function byHourBlock(rows: OutboundRow[], replies: ReplySet): Bucket[] {
  const groups = groupContacts(rows, (r) => {
    const hour = hourOf(r.sentAt);
    // Einzelstunden waeren 24 Zeilen mit je einem Dutzend Kontakten -- also
    // 24 Zahlen, von denen keine etwas bedeutet. Dreierbloecke halten die
    // Gruppen gross genug, um ueberhaupt die Mindestmenge erreichen zu koennen.
    return hour === null ? null : String(Math.floor(hour / 3) * 3);
  });
  return [...groups.entries()]
    .map(([key, contacts]) => {
      const from = Number(key);
      return makeBucket(key, `${pad(from)}–${pad(from + 3)}`, contacts, replies);
    })
    .sort((a, b) => Number(a.key) - Number(b.key));
}

/** Beste zuerst, aber nur unter denen mit belastbarer Grundlage. */
function sortByRateThenSize(a: Bucket, b: Bucket): number {
  if (a.rate === null && b.rate === null) return b.contacts - a.contacts;
  if (a.rate === null) return 1;
  if (b.rate === null) return -1;
  if (b.rate !== a.rate) return b.rate - a.rate;
  return b.contacts - a.contacts;
}

function weekdayOf(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getDay();
}

function hourOf(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getHours();
}

function pad(h: number): string {
  return String(h % 24).padStart(2, "0");
}

export type Overview = {
  contacted: number;
  replied: number;
  rate: number | null;
  /** Wie viele Kontakte noch fehlen, bis ueberhaupt etwas ausgesagt werden darf. */
  missing: number;
};

/** Die Gesamtzahl, mit derselben Ehrlichkeit wie die Aufschluesselungen. */
export function overview(rows: OutboundRow[], replies: ReplySet): Overview {
  const contacts = new Set<string>();
  for (const r of rows) if (r.contactId) contacts.add(r.contactId);
  let answered = 0;
  for (const id of contacts) if (replies.has(id)) answered++;
  return {
    contacted: contacts.size,
    replied: answered,
    rate: contacts.size >= MIN_SAMPLE ? answered / contacts.size : null,
    missing: Math.max(0, MIN_SAMPLE - contacts.size),
  };
}
