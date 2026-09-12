/**
 * Der Zeitverlauf der Wirkungs-Seite: was ging pro Tag raus, was kam zurueck.
 *
 * Gerechnet aus den EIGENEN messages-Zeilen, nicht aus Instantlys
 * Analytics-Rollup. Anlass: Instantlys eigene Oberflaeche zeigte am
 * 2026-09-12 fuer denselben Zeitraum "Reply rate 0%" ueber einer Tabelle mit
 * 4 Antworten. Unsere Zahlen muessen aus einer Quelle kommen, die wir selbst
 * pruefen koennen, und das sind die synchronisierten Mails.
 *
 * Drei Reihen, bewusst getrennt gehalten (keine Doppelachse: bei 200
 * gesendeten Mails am Tag und 2 Antworten wuerde jede gemeinsame Skala die
 * Antworten unsichtbar machen oder die Sendungen verzerren):
 *
 *   sent        versendete Mails (Sendevorgaenge, nicht Kontakte -- hier geht
 *               es um Aktivitaet pro Tag, nicht um Quoten)
 *   replies     eingegangene Antworten ohne Abwesenheitsnotizen, dieselbe
 *               Regel wie ueberall auf der Wirkungs-Seite
 *   interested  davon als interessiert eingestufte
 *
 * Tagesgrenzen in UTC. Der Versand laeuft in mehreren Zeitzonen
 * (US-Kampagnen in America/Chicago, UK in Europe/Belgrade); jede gewaehlte
 * Zone verschiebt irgendeinen Teil der Mails um einen Tag. UTC ist davon die
 * einzige, die nicht so aussieht, als waere sie die "richtige" lokale Sicht.
 */

export type TimelineRow = {
  sentAt: string | null;
  /** Nur fuer eingehende Zeilen gesetzt; ausgehende uebergeben null. */
  interest: string | null;
};

export type TimelinePoint = {
  /** ISO-Datum (YYYY-MM-DD, UTC). */
  day: string;
  sent: number;
  replies: number;
  interested: number;
};

/** Abwesenheitsnotizen zaehlen nicht als Antwort, wie in copy-outcomes.ts. */
const AUTO = "out_of_office";

function dayOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Die letzten `days` Tage als lueckenlose Reihe, aeltester Tag zuerst.
 *
 * Lueckenlos, weil ein Diagramm mit uebersprungenen Tagen luegt: ein
 * Wochenende ohne Versand ist eine sichtbare Null, kein fehlender Balken.
 * `today` ist nur fuer Tests von aussen setzbar.
 */
export function dailyTimeline(
  outbound: TimelineRow[],
  inbound: TimelineRow[],
  days = 30,
  today: Date = new Date()
): TimelinePoint[] {
  const byDay = new Map<string, TimelinePoint>();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    const day = d.toISOString().slice(0, 10);
    byDay.set(day, { day, sent: 0, replies: 0, interested: 0 });
  }

  for (const row of outbound) {
    const day = dayOf(row.sentAt);
    const p = day ? byDay.get(day) : undefined;
    if (p) p.sent++;
  }
  for (const row of inbound) {
    const day = dayOf(row.sentAt);
    const p = day ? byDay.get(day) : undefined;
    if (!p) continue;
    if (row.interest === AUTO) continue;
    p.replies++;
    if (row.interest === "interested") p.interested++;
  }

  return [...byDay.values()];
}
