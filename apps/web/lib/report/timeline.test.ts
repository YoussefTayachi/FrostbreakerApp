import { describe, expect, it } from "vitest";
import { dailyTimeline } from "./timeline";

const HEUTE = new Date("2026-09-12T14:30:00Z");

describe("dailyTimeline", () => {
  it("liefert eine lueckenlose Reihe, aeltester Tag zuerst", () => {
    const punkte = dailyTimeline([], [], 7, HEUTE);
    expect(punkte).toHaveLength(7);
    expect(punkte[0].day).toBe("2026-09-06");
    expect(punkte[6].day).toBe("2026-09-12");
    // Ein Wochenende ohne Versand ist eine sichtbare Null, kein Loch.
    expect(punkte.every((p) => p.sent === 0 && p.replies === 0)).toBe(true);
  });

  it("zaehlt Sendungen und Antworten auf den richtigen Tag", () => {
    const punkte = dailyTimeline(
      [
        { sentAt: "2026-09-10T08:00:00Z", interest: null },
        { sentAt: "2026-09-10T16:00:00Z", interest: null },
        { sentAt: "2026-09-11T09:00:00Z", interest: null },
      ],
      [
        { sentAt: "2026-09-11T10:00:00Z", interest: "not_interested" },
        { sentAt: "2026-09-11T11:00:00Z", interest: "interested" },
      ],
      7,
      HEUTE
    );
    const tag10 = punkte.find((p) => p.day === "2026-09-10")!;
    const tag11 = punkte.find((p) => p.day === "2026-09-11")!;
    expect(tag10).toMatchObject({ sent: 2, replies: 0 });
    expect(tag11).toMatchObject({ sent: 1, replies: 2, interested: 1 });
  });

  it("zaehlt Abwesenheitsnotizen nicht als Antwort", () => {
    // Dieselbe Regel wie ueberall auf der Wirkungs-Seite: ein Autoresponder
    // ist kein Mensch, der reagiert hat.
    const punkte = dailyTimeline(
      [],
      [{ sentAt: "2026-09-11T10:00:00Z", interest: "out_of_office" }],
      7,
      HEUTE
    );
    expect(punkte.find((p) => p.day === "2026-09-11")).toMatchObject({ replies: 0, interested: 0 });
  });

  it("laesst Zeilen ausserhalb des Fensters und ohne Datum still weg", () => {
    const punkte = dailyTimeline(
      [
        { sentAt: "2026-08-01T08:00:00Z", interest: null },
        { sentAt: null, interest: null },
        { sentAt: "kein datum", interest: null },
      ],
      [],
      7,
      HEUTE
    );
    expect(punkte.every((p) => p.sent === 0)).toBe(true);
  });
});
