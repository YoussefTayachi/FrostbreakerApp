import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE,
  byHourBlock,
  bySearch,
  byWeekday,
  overview,
  type OutboundRow,
} from "./effectiveness";

/** n Kontakte einer Suche, alle am selben Zeitpunkt angeschrieben. */
function rows(n: number, opts: { searchId?: string; searchName?: string; sentAt?: string; from?: number } = {}): OutboundRow[] {
  const from = opts.from ?? 0;
  return Array.from({ length: n }, (_, i) => ({
    contactId: `c${from + i}`,
    sentAt: opts.sentAt ?? "2026-08-04T10:00:00",
    searchId: opts.searchId ?? "s1",
    searchName: opts.searchName ?? "US E-Com",
  }));
}

function replies(...ids: string[]): Set<string> {
  return new Set(ids);
}

describe("Die Mindestmenge ist die eigentliche Aussage", () => {
  /**
   * Bei 12 Mails und einer Antwort stuende da "8,3 Prozent" -- eine Zahl, die
   * praezise aussieht und nichts bedeutet. Wer daraufhin nur noch dienstags
   * sendet, hat eine Muenze geworfen und es Strategie genannt.
   */
  it("weist unter der Mindestmenge KEINE Quote aus", () => {
    const [b] = bySearch(rows(12), replies("c0"));
    expect(b.contacts).toBe(12);
    expect(b.replies).toBe(1);
    expect(b.rate).toBeNull();
  });

  it("weist ab der Mindestmenge eine Quote aus", () => {
    const [b] = bySearch(rows(MIN_SAMPLE), replies("c0", "c1", "c2"));
    expect(b.rate).toBeCloseTo(3 / MIN_SAMPLE);
  });

  it("zaehlt auch unterhalb der Schwelle ehrlich mit", () => {
    const [b] = bySearch(rows(5), replies("c0", "c1"));
    expect(b.replies).toBe(2);
  });
});

describe("Gemessen wird an Kontakten, nicht an Mails", () => {
  /**
   * Eine Sequenz schickt drei bis vier Mails an dieselbe Person. Die eine
   * Antwort darauf gehoert nicht durch vier geteilt -- sonst sinkt die Quote
   * genau um den Faktor der Sequenzlaenge.
   */
  it("zaehlt einen Kontakt mit vier Mails einmal", () => {
    const vier: OutboundRow[] = Array.from({ length: 4 }, () => ({
      contactId: "c1",
      sentAt: "2026-08-04T10:00:00",
      searchId: "s1",
      searchName: "US E-Com",
    }));
    const [b] = bySearch(vier, replies("c1"));
    expect(b.contacts).toBe(1);
    expect(b.replies).toBe(1);
  });

  it("ignoriert Zeilen ohne Kontakt", () => {
    const gemischt = [...rows(2), { contactId: null, sentAt: "2026-08-04T10:00:00", searchId: "s1", searchName: "X" }];
    expect(bySearch(gemischt, replies()).at(0)?.contacts).toBe(2);
  });
});

describe("bySearch", () => {
  it("trennt die Lead-Listen und benennt sie", () => {
    const alle = [
      ...rows(MIN_SAMPLE, { searchId: "a", searchName: "Agenturen", from: 0 }),
      ...rows(MIN_SAMPLE, { searchId: "b", searchName: "Supplements", from: 100 }),
    ];
    const buckets = bySearch(alle, replies("c0", "c1", "c2", "c100"));
    expect(buckets.map((b) => b.label).sort()).toEqual(["Agenturen", "Supplements"]);
  });

  it("stellt die beste Liste nach oben", () => {
    const alle = [
      ...rows(MIN_SAMPLE, { searchId: "schwach", searchName: "Schwach", from: 0 }),
      ...rows(MIN_SAMPLE, { searchId: "stark", searchName: "Stark", from: 100 }),
    ];
    const buckets = bySearch(alle, replies("c100", "c101", "c102", "c103", "c0"));
    expect(buckets[0].label).toBe("Stark");
  });

  // Eine Zeile ohne belastbare Grundlage darf nicht ueber einer mit Aussage
  // stehen, nur weil ihre zufaellige Quote hoeher ist.
  it("stellt Gruppen ohne Grundlage ans Ende", () => {
    const alle = [
      ...rows(MIN_SAMPLE, { searchId: "gross", searchName: "Gross", from: 0 }),
      ...rows(3, { searchId: "winzig", searchName: "Winzig", from: 100 }),
    ];
    const buckets = bySearch(alle, replies("c100", "c101", "c102", "c0"));
    expect(buckets.map((b) => b.label)).toEqual(["Gross", "Winzig"]);
  });

  it("kommt mit leerer Eingabe klar", () => {
    expect(bySearch([], replies())).toEqual([]);
  });
});

describe("byWeekday", () => {
  it("ordnet nach Wochentag, nicht nach Quote", () => {
    const alle = [
      // 2026-08-03 ist ein Montag, 2026-08-05 ein Mittwoch.
      ...rows(MIN_SAMPLE, { sentAt: "2026-08-05T10:00:00", from: 0 }),
      ...rows(MIN_SAMPLE, { sentAt: "2026-08-03T10:00:00", from: 100 }),
    ];
    const buckets = byWeekday(alle, replies("c0", "c1", "c2", "c3"));
    expect(buckets.map((b) => b.label)).toEqual(["Montag", "Mittwoch"]);
  });

  it("kennt englische Beschriftungen", () => {
    expect(byWeekday(rows(1, { sentAt: "2026-08-03T10:00:00" }), replies(), "en")[0].label).toBe("Monday");
  });

  it("laesst Zeilen ohne Zeitpunkt weg", () => {
    const ohne: OutboundRow[] = [{ contactId: "x", sentAt: null, searchId: "s", searchName: "S" }];
    expect(byWeekday(ohne, replies())).toEqual([]);
  });

  it("laesst einen unbrauchbaren Zeitpunkt weg statt zu werfen", () => {
    const kaputt: OutboundRow[] = [{ contactId: "x", sentAt: "keine Zeit", searchId: "s", searchName: "S" }];
    expect(byWeekday(kaputt, replies())).toEqual([]);
  });
});

describe("byHourBlock", () => {
  /**
   * Einzelstunden waeren 24 Zeilen mit je einem Dutzend Kontakten -- also 24
   * Zahlen, von denen keine die Mindestmenge erreicht.
   */
  it("fasst zu Dreierbloecken zusammen", () => {
    const alle = [
      ...rows(10, { sentAt: "2026-08-04T09:00:00", from: 0 }),
      ...rows(10, { sentAt: "2026-08-04T10:30:00", from: 100 }),
      ...rows(10, { sentAt: "2026-08-04T11:59:00", from: 200 }),
    ];
    const buckets = byHourBlock(alle, replies());
    expect(buckets.length).toBe(1);
    expect(buckets[0].label).toBe("09–12");
    expect(buckets[0].contacts).toBe(30);
  });

  it("sortiert nach Uhrzeit", () => {
    const alle = [
      ...rows(1, { sentAt: "2026-08-04T16:00:00", from: 0 }),
      ...rows(1, { sentAt: "2026-08-04T07:00:00", from: 100 }),
    ];
    expect(byHourBlock(alle, replies()).map((b) => b.label)).toEqual(["06–09", "15–18"]);
  });

  it("schreibt den Tageswechsel als 21-00", () => {
    expect(byHourBlock(rows(1, { sentAt: "2026-08-04T22:00:00" }), replies())[0].label).toBe("21–00");
  });
});

describe("overview", () => {
  it("zaehlt ueber alle Listen hinweg", () => {
    const alle = [...rows(MIN_SAMPLE, { searchId: "a", from: 0 }), ...rows(MIN_SAMPLE, { searchId: "b", from: 100 })];
    const o = overview(alle, replies("c0", "c100"));
    expect(o.contacted).toBe(MIN_SAMPLE * 2);
    expect(o.replied).toBe(2);
    expect(o.rate).toBeCloseTo(2 / (MIN_SAMPLE * 2));
  });

  it("sagt, wie viele Kontakte noch fehlen", () => {
    const o = overview(rows(10), replies());
    expect(o.rate).toBeNull();
    expect(o.missing).toBe(MIN_SAMPLE - 10);
  });

  it("kommt ohne Daten klar", () => {
    expect(overview([], replies())).toEqual({ contacted: 0, replied: 0, rate: null, missing: MIN_SAMPLE });
  });
});
