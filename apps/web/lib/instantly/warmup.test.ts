import { describe, expect, it } from "vitest";
import { WARMUP_TARGET_DAYS, readyDate, warmupDays, warmupInfo } from "./warmup";

const NOW = new Date("2026-08-09T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("warmupDays", () => {
  it("zaehlt ab Tag 1, nicht ab Tag 0", () => {
    // Ein Postfach, das vor einer Stunde gestartet ist, steht bei Tag 1.
    // Eine Null saehe aus, als sei nichts passiert.
    expect(warmupDays(new Date(NOW.getTime() - 3600_000).toISOString(), NOW)).toBe(1);
  });

  it("rechnet volle Tage", () => {
    expect(warmupDays(daysAgo(0), NOW)).toBe(1);
    expect(warmupDays(daysAgo(6), NOW)).toBe(7);
    expect(warmupDays(daysAgo(13), NOW)).toBe(14);
  });

  it("bleibt bei einer Startzeit in der Zukunft bei Tag 1", () => {
    // Uhren zwischen Instantly und uns koennen leicht auseinanderliegen;
    // "Tag -0" waere Unsinn auf dem Bildschirm.
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    expect(warmupDays(future, NOW)).toBe(1);
  });

  it("liefert null, wenn kein Startzeitpunkt vorliegt", () => {
    expect(warmupDays(null, NOW)).toBeNull();
    expect(warmupDays(undefined, NOW)).toBeNull();
    expect(warmupDays("kein datum", NOW)).toBeNull();
  });
});

describe("warmupInfo", () => {
  it("erkennt die Sperre durch Instantly", () => {
    // Der gemeldete Fall: g.berat@retaiyn.de stand auf warmup_status -1,
    // die Oberflaeche zeigte trotzdem "Aktiv".
    const info = warmupInfo({ warmup_status: -1, timestamp_warmup_start: daysAgo(1) }, NOW);
    expect(info.state).toBe("blocked");
  });

  it("meldet ein gesperrtes Postfach NICHT als bereit, egal wie alt", () => {
    // Wuerde zuerst auf die Tage geschaut, stuende hier nach zwei Wochen
    // "bereit" fuer ein Postfach, das gar nichts tut.
    const info = warmupInfo({ warmup_status: -1, timestamp_warmup_start: daysAgo(60) }, NOW);
    expect(info.state).toBe("blocked");
  });

  it("zaehlt waehrend des Aufwaermens mit", () => {
    const info = warmupInfo({ warmup_status: 1, timestamp_warmup_start: daysAgo(2) }, NOW);
    expect(info).toMatchObject({ state: "warming", days: 3, remaining: 11 });
    expect(info.percent).toBe(21);
  });

  it("ist ab dem Zieltag bereit", () => {
    const info = warmupInfo({ warmup_status: 1, timestamp_warmup_start: daysAgo(13) }, NOW);
    expect(info).toMatchObject({ state: "ready", days: WARMUP_TARGET_DAYS, remaining: 0, percent: 100 });
  });

  it("deckelt den Balken bei 100 Prozent", () => {
    const info = warmupInfo({ warmup_status: 1, timestamp_warmup_start: daysAgo(90) }, NOW);
    expect(info.percent).toBe(100);
    expect(info.state).toBe("ready");
  });

  it("unterscheidet pausiert von gesperrt", () => {
    expect(warmupInfo({ warmup_status: 0, timestamp_warmup_start: daysAgo(3) }, NOW).state).toBe("paused");
  });

  it("kommt ohne Startzeitpunkt zurecht", () => {
    expect(warmupInfo({ warmup_status: 1, timestamp_warmup_start: null }, NOW).state).toBe("unknown");
  });
});

describe("readyDate", () => {
  it("richtet sich nach dem zuletzt gestarteten Postfach", () => {
    // Die Frage lautet "ab wann kann ich senden?", und das entscheidet das
    // juengste Postfach, nicht das aelteste.
    const date = readyDate(
      [
        { warmup_status: 1, timestamp_warmup_start: daysAgo(10) },
        { warmup_status: 1, timestamp_warmup_start: daysAgo(2) },
      ],
      NOW
    );
    expect(date).not.toBeNull();
    // Tag 3 von 14 -> noch 11 Tage
    expect(Math.round((date!.getTime() - NOW.getTime()) / 86_400_000)).toBe(11);
  });

  it("liefert null, wenn alle schon so weit sind", () => {
    expect(readyDate([{ warmup_status: 1, timestamp_warmup_start: daysAgo(20) }], NOW)).toBeNull();
  });

  it("laesst gesperrte und pausierte aussen vor", () => {
    // Sie haben kein Datum, auf das man warten koennte, und wuerden das
    // Ergebnis sonst ins Unendliche schieben.
    expect(
      readyDate(
        [
          { warmup_status: -1, timestamp_warmup_start: daysAgo(1) },
          { warmup_status: 0, timestamp_warmup_start: daysAgo(1) },
        ],
        NOW
      )
    ).toBeNull();
  });

  it("liefert null ohne Postfaecher", () => {
    expect(readyDate([], NOW)).toBeNull();
  });
});
