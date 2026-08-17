import { describe, expect, it } from "vitest";
import { campaignStats, campaignStatsRow, type StatsRow } from "./campaign-stats";

/** Fuenf Suchen einer Kampagne: jede Zeile traegt dieselbe Kampagnensumme. */
function rows(n: number, values: Partial<StatsRow> = {}): StatsRow[] {
  return Array.from({ length: n }, (_, i) => ({
    updated_at: `2026-08-04T12:0${i}:00Z`,
    leads_count: 406,
    contacted_count: 17,
    emails_sent_count: 17,
    open_count: 0,
    reply_count_unique: 0,
    bounced_count: 0,
    ...values,
  }));
}

describe("campaignStats", () => {
  /**
   * Der Fehler, um den es geht. Am 2026-08-04 zeigte die Liste fuer eine
   * Kampagne mit fuenf Suchen 2030 Leads statt 406 und 85 Kontaktierte statt
   * 17, genau der Faktor fuenf, weil aufaddiert wurde.
   */
  it("multipliziert NICHT mit der Zahl der Suchen", () => {
    const s = campaignStats(rows(5))!;
    expect(s.leads_count).toBe(406);
    expect(s.contacted_count).toBe(17);
  });

  it("liefert bei einer einzigen Suche dasselbe", () => {
    expect(campaignStats(rows(1))!.leads_count).toBe(406);
  });

  it("gibt null zurueck, solange nichts abgeholt wurde", () => {
    expect(campaignStats([])).toBeNull();
  });

  it("macht aus fehlenden Feldern eine Null statt NaN", () => {
    const s = campaignStats([{ updated_at: "2026-08-04T12:00:00Z" }])!;
    expect(s.leads_count).toBe(0);
    expect(s.reply_count_unique).toBe(0);
  });

  it("liest auch Zahlen, die als Text ankommen", () => {
    expect(campaignStats([{ updated_at: "x", leads_count: "406" }])!.leads_count).toBe(406);
  });
});

describe("campaignStatsRow", () => {
  /**
   * Alle Zeilen treffen dieselbe Aussage, werden aber zu unterschiedlichen
   * Zeitpunkten abgeholt: jede Suche hat ihren eigenen Poll-Termin. Die
   * juengste ist der frischeste Stand derselben Wahrheit.
   */
  it("nimmt die zuletzt aktualisierte Zeile", () => {
    const gemischt: StatsRow[] = [
      { updated_at: "2026-08-04T12:00:00Z", contacted_count: 10 },
      { updated_at: "2026-08-04T12:30:00Z", contacted_count: 17 },
      { updated_at: "2026-08-04T11:00:00Z", contacted_count: 4 },
    ];
    expect(campaignStatsRow(gemischt)!.contacted_count).toBe(17);
  });

  it("kommt mit fehlendem Zeitstempel klar", () => {
    const ohne: StatsRow[] = [{ contacted_count: 3 }, { updated_at: "2026-08-04T12:00:00Z", contacted_count: 9 }];
    expect(campaignStatsRow(ohne)!.contacted_count).toBe(9);
  });

  it("gibt null zurueck ohne Zeilen", () => {
    expect(campaignStatsRow([])).toBeNull();
  });
});
