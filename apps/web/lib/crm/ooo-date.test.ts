import { describe, expect, it } from "vitest";
import { estimateReturn, isoWeekStart, parseReturnDate, toIsoDate } from "./ooo-date";

const eingang = new Date("2026-09-24T12:00:00Z");

describe("parseReturnDate", () => {
  it("liest 'back on <Monat Tag>' als den Tag selbst", () => {
    const r = parseReturnDate(null, "I am out of the office and will be back on October 6.", eingang);
    expect(toIsoDate(r.date)).toBe("2026-10-06");
    expect(r.estimated).toBe(false);
  });

  it("liest 'returning Oct 6th' und 'return to the office on Monday, October 6'", () => {
    expect(toIsoDate(parseReturnDate(null, "Returning Oct 6th with limited access.", eingang).date)).toBe("2026-10-06");
    expect(
      toIsoDate(parseReturnDate(null, "I will return to the office on Monday, October 6 and reply then.", eingang).date)
    ).toBe("2026-10-06");
  });

  it("liest 'until <Datum>' als Folgetag", () => {
    const r = parseReturnDate("Out of office", "I am out of the office until October 5th.", eingang);
    expect(toIsoDate(r.date)).toBe("2026-10-06");
    expect(r.estimated).toBe(false);
  });

  it("liest US-Datum, deutsches Datum und '6 October'", () => {
    expect(toIsoDate(parseReturnDate(null, "back in the office on 10/6", eingang).date)).toBe("2026-10-06");
    expect(toIsoDate(parseReturnDate(null, "Ich bin ab dem 6.10. wieder erreichbar.", eingang).date)).toBe("2026-10-06");
    expect(toIsoDate(parseReturnDate(null, "Ich bin bis zum 5. Oktober im Urlaub.", eingang).date)).toBe("2026-10-06");
    expect(toIsoDate(parseReturnDate(null, "returning 6 October", eingang).date)).toBe("2026-10-06");
  });

  it("nimmt ohne Jahr das naechste passende Jahr", () => {
    const dezember = new Date("2026-12-20T12:00:00Z");
    expect(toIsoDate(parseReturnDate(null, "back on January 5", dezember).date)).toBe("2027-01-05");
  });

  it("schaetzt zwei Wochen, wenn kein Datum genannt ist", () => {
    const r = parseReturnDate("Automatic reply", "I am currently out of the office with limited access to email.", eingang);
    expect(r.estimated).toBe(true);
    expect(toIsoDate(r.date)).toBe(toIsoDate(estimateReturn(eingang)));
  });

  it("verwirft Unsinn und schaetzt dann", () => {
    const r = parseReturnDate(null, "back on 13/45", eingang);
    expect(r.estimated).toBe(true);
  });
});

describe("isoWeekStart", () => {
  it("liefert den Montag der Woche", () => {
    expect(isoWeekStart(new Date("2026-10-06T00:00:00Z"))).toBe("2026-10-05"); // Dienstag
    expect(isoWeekStart(new Date("2026-10-05T00:00:00Z"))).toBe("2026-10-05"); // Montag
    expect(isoWeekStart(new Date("2026-10-11T00:00:00Z"))).toBe("2026-10-05"); // Sonntag
  });
});
