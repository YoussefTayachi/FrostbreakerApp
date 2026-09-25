/**
 * Rueckkehrdatum aus einer Abwesenheitsnotiz.
 *
 * Reine Muster, kein Modell: an den 165 Abwesenheitsantworten im retaiyn-
 * Workspace (Stand 2026-09-25) trug etwa die Haelfte eine Form wie
 * "back on October 6", "returning 10/6", "out of the office until Oct 5th",
 * "zurueck am 6.10." oder "bis zum 5. Oktober". Diese Formen decken die
 * Muster unten ab. Fehlt jede Angabe, schaetzt estimateReturn zwei Wochen ab
 * Eingang und markiert das (contacts.ooo_estimated), damit die Liste den
 * Unterschied zeigt.
 *
 * "until" und "through" heissen "ab dem Folgetag wieder da"; "back on" und
 * "returning on" nennen den Tag selbst. Ein Datum ohne Jahr bekommt das
 * naechste Jahr, in dem es nach dem Eingang liegt (eine Notiz vom 20.12. mit
 * "back on January 5" meint das Folgejahr).
 */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, februar: 2, february: 2, feb: 2, march: 3, mar: 3, maerz: 3, märz: 3,
  april: 4, apr: 4, may: 5, mai: 5, june: 6, jun: 6, juni: 6, july: 7, jul: 7, juli: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, oktober: 10, okt: 10,
  november: 11, nov: 11, december: 12, dec: 12, dezember: 12, dez: 12,
};

const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

/** "October 6", "Oct 6th", "6 October", "6. Oktober", "10/6", "10/06/2026", "6.10.", "6.10.2026" */
const DATE_PART =
  `(?:(?<m1>${MONTH_RE})\\.?\\s+(?<d1>\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(?<y1>\\d{4}))?` +
  `|(?<d2>\\d{1,2})(?:st|nd|rd|th)?\\.?\\s+(?:of\\s+)?(?<m2>${MONTH_RE})\\.?(?:,?\\s*(?<y2>\\d{4}))?` +
  `|(?<us_m>\\d{1,2})/(?<us_d>\\d{1,2})(?:/(?<us_y>\\d{2,4}))?` +
  `|(?<de_d>\\d{1,2})\\.(?<de_m>\\d{1,2})\\.(?<de_y>\\d{4})?)`;

/** Wendungen, die den Rueckkehrtag SELBST nennen. */
const ON_DAY = new RegExp(
  `(?:back|return(?:ing)?|returns?|zur[uü]ck|wieder\\s+(?:im\\s+b[uü]ro|erreichbar|da))` +
  `(?:\\s+(?:in|to)\\s+(?:the\\s+)?office)?\\s*(?:on|am|ab(?:\\s+dem)?)?\\s*(?:\\w+day,?\\s*|montag,?\\s*|dienstag,?\\s*|mittwoch,?\\s*|donnerstag,?\\s*|freitag,?\\s*)?` +
  DATE_PART,
  "i"
);
/** Deutsch mit Datum VOR dem Verb: "ab dem 6.10. wieder erreichbar", "ab 6. Oktober wieder da". */
const AB_DAY = new RegExp(`\\bab\\s+(?:dem\\s+|montag,?\\s*|dienstag,?\\s*|mittwoch,?\\s*|donnerstag,?\\s*|freitag,?\\s*)?` + DATE_PART, "i");
/** Wendungen, die den LETZTEN Abwesenheitstag nennen: ab dem Folgetag wieder da. */
const THROUGH_DAY = new RegExp(
  `(?:until|through|thru|till|bis(?:\\s+(?:zum|einschlie[sß]lich|inkl\\.?))?)\\s*(?:\\w+day,?\\s*)?` + DATE_PART,
  "i"
);

function toDate(g: Record<string, string | undefined>, received: Date): Date | null {
  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;
  if (g.m1) {
    month = MONTHS[g.m1.toLowerCase()];
    day = Number(g.d1);
    year = g.y1 ? Number(g.y1) : undefined;
  } else if (g.m2) {
    month = MONTHS[g.m2.toLowerCase()];
    day = Number(g.d2);
    year = g.y2 ? Number(g.y2) : undefined;
  } else if (g.us_m) {
    month = Number(g.us_m);
    day = Number(g.us_d);
    year = g.us_y ? Number(g.us_y.length === 2 ? "20" + g.us_y : g.us_y) : undefined;
  } else if (g.de_d) {
    day = Number(g.de_d);
    month = Number(g.de_m);
    year = g.de_y ? Number(g.de_y) : undefined;
  }
  if (!day || !month || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Ohne Jahr: das naechste Jahr, in dem der Tag nach dem Eingang liegt.
  const y0 = year ?? received.getUTCFullYear();
  let d = new Date(Date.UTC(y0, month - 1, day));
  if (!year && d.getTime() < received.getTime() - 24 * 3600 * 1000) {
    d = new Date(Date.UTC(y0 + 1, month - 1, day));
  }
  if (Number.isNaN(d.getTime())) return null;
  // Mehr als ein Jahr in der Zukunft ist kein Urlaub, sondern ein Tippfehler.
  if (d.getTime() - received.getTime() > 400 * 24 * 3600 * 1000) return null;
  return d;
}

export type ReturnDate = { date: Date; estimated: false } | { date: Date; estimated: true };

/** Zwei Wochen ab Eingang, wenn die Notiz kein Datum nennt. */
export function estimateReturn(received: Date): Date {
  return new Date(received.getTime() + 14 * 24 * 3600 * 1000);
}

export function parseReturnDate(subject: string | null | undefined, body: string | null | undefined, received: Date): ReturnDate {
  const text = `${subject ?? ""}\n${body ?? ""}`.replace(/\s+/g, " ");
  const on = ON_DAY.exec(text);
  if (on?.groups) {
    const d = toDate(on.groups, received);
    if (d) return { date: d, estimated: false };
  }
  const ab = AB_DAY.exec(text);
  if (ab?.groups) {
    const d = toDate(ab.groups, received);
    if (d) return { date: d, estimated: false };
  }
  const through = THROUGH_DAY.exec(text);
  if (through?.groups) {
    const d = toDate(through.groups, received);
    if (d) return { date: new Date(d.getTime() + 24 * 3600 * 1000), estimated: false };
  }
  return { date: estimateReturn(received), estimated: true };
}

/** "2026-10-06" fuer die date-Spalte. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Montag der ISO-Woche, in der der Tag liegt, als "YYYY-MM-DD". */
export function isoWeekStart(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const weekday = (day.getUTCDay() + 6) % 7; // Montag = 0
  day.setUTCDate(day.getUTCDate() - weekday);
  return toIsoDate(day);
}
