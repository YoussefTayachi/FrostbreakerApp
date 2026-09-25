import { describe, expect, it } from "vitest";
import { bucketName, groupByWeek, isoWeekNumber, reengageSteps, regionOf, REGION_SCHEDULE, senderOfMailbox } from "./wiederkontakt";

describe("senderOfMailbox", () => {
  it("ordnet die retaiyn-Postfaecher dem richtigen Absender zu", () => {
    for (const m of ["berat@retaiyn.de", "gunesberat@retaiyn.de", "guenb@retaiyn.de", "gb@retaiyn.de", "b.guenes@retaiyn.de", "g.berat@retaiyn.de"]) {
      expect(senderOfMailbox(m)).toBe("berat");
    }
    for (const m of ["ramy@retaiyn.de", "tichy@retaiyn.de", "rt@retaiyn.de", "r.t@retaiyn.de", "tramy@retaiyn.de", "tichr@retaiyn.de"]) {
      expect(senderOfMailbox(m)).toBe("ramy");
    }
    expect(senderOfMailbox(null)).toBe("berat");
  });
});

describe("groupByWeek", () => {
  const heute = new Date("2026-09-25T10:00:00Z"); // Freitag, KW 39 beginnt am 21.09.
  it("legt jede Rueckkehr in ihre Woche und trennt nach Absender", () => {
    const gruppen = groupByWeek(
      [
        { id: "a", ooo_until: "2026-10-06", ooo_estimated: false, eaccount: "berat@retaiyn.de" },
        { id: "b", ooo_until: "2026-10-08", ooo_estimated: true, eaccount: "ramy@retaiyn.de" },
        { id: "c", ooo_until: "2026-10-07", ooo_estimated: false, eaccount: "gb@retaiyn.de" },
        { id: "d", ooo_until: "2026-10-14", ooo_estimated: false, eaccount: null },
      ],
      heute
    );
    expect(gruppen.map((g) => `${g.week}|${g.sender}|${g.contacts.length}`)).toEqual([
      "2026-10-05|berat|2",
      "2026-10-05|ramy|1",
      "2026-10-12|berat|1",
    ]);
  });

  it("holt Rueckkehr in der Vergangenheit in die laufende Woche", () => {
    const gruppen = groupByWeek([{ id: "x", ooo_until: "2026-09-10", ooo_estimated: false, eaccount: "ramy@retaiyn.de" }], heute);
    expect(gruppen[0].week).toBe("2026-09-21");
  });
});

describe("Namen und Sequenz", () => {
  it("nummeriert die Woche nach ISO", () => {
    expect(isoWeekNumber("2026-10-05")).toBe(41);
    expect(isoWeekNumber("2026-01-05")).toBe(2);
    expect(bucketName("2026-10-05", "ramy")).toBe("yoyo Klaviyo | Wiederkontakt KW 41 | Ramy");
  });

  it("hat drei Stufen mit einem Tag Abstand, eigenem Angebot je Stufe und der Signatur des Absenders", () => {
    const steps = reengageSteps("ramy");
    expect(steps.map((s) => s.wait_days)).toEqual([0, 1, 1]);
    expect(steps[0].body).toContain("second purchase");
    expect(steps[0].body).toContain("free 5-minute video audit");
    expect(steps.every((s) => s.subject.length > 0)).toBe(true);
    expect(steps[0].subject).not.toMatch(/while you were out/i);
    expect(steps[1].body).toContain("repeat buyers");
    expect(steps[2].body).toContain("audit");
    for (const s of steps) {
      expect(s.body).toContain("ramy@retaiyn.com");
      expect(s.body).not.toMatch(/\b(would|could|might|maybe|probably|bumping|following up)\b/i);
    }
    expect(reengageSteps("berat")[0].body).toContain("berat@retaiyn.com");
  });
});

describe("Herkunft und Sendefenster", () => {
  it("ordnet UK-Domains und alte EU-Kampagnen UK zu, US-Kampagnen US", () => {
    expect(regionOf("jo@shop.co.uk", "America/Detroit")).toBe("uk");
    expect(regionOf("jo@shop.com", "America/Detroit")).toBe("us");
    expect(regionOf("jo@shop.com", null)).toBe("uk");
    expect(regionOf("jo@shop.com", "Arctic/Longyearbyen")).toBe("uk");
  });

  it("trennt dieselbe Woche und denselben Absender nach Herkunft", () => {
    const g = groupByWeek(
      [
        { id: "a", ooo_until: "2026-10-06", ooo_estimated: false, eaccount: "berat@retaiyn.de", region: "uk" },
        { id: "b", ooo_until: "2026-10-06", ooo_estimated: false, eaccount: "berat@retaiyn.de", region: "us" },
      ],
      new Date("2026-09-25T10:00:00Z")
    );
    expect(g.map((b) => b.region)).toEqual(["us", "uk"]);
    expect(bucketName(g[1].week, "berat", "uk")).toBe("yoyo Klaviyo | Wiederkontakt KW 41 | UK | Berat");
  });

  it("sendet UK am britischen Vormittag, US im New Yorker Arbeitstag", () => {
    expect(REGION_SCHEDULE.uk).toMatchObject({ timezone: "Europe/Isle_of_Man", from: "08:00", to: "12:00" });
    expect(REGION_SCHEDULE.us).toMatchObject({ timezone: "America/Detroit", from: "08:00", to: "17:00" });
  });
});
