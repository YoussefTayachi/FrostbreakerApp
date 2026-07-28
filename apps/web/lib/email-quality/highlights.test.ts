import { describe, expect, it } from "vitest";
import { bodyHighlightRanges, buildHighlightSegments } from "./highlights";
import { runEmailQualityCheck } from "./index";

const plain = (text: string) => buildHighlightSegments(text, []);

describe("buildHighlightSegments", () => {
  it("liefert ohne Bereiche einen einzigen, ungefaerbten Abschnitt", () => {
    expect(plain("Hallo Welt")).toEqual([{ text: "Hallo Welt", severity: null }]);
  });

  it("liefert fuer leeren Text nichts", () => {
    expect(plain("")).toEqual([]);
  });

  it("setzt den Text lueckenlos wieder zusammen", () => {
    const text = "Das ist eigentlich ziemlich spannend.";
    const segs = buildHighlightSegments(text, [
      { start: 8, end: 18, severity: "info" },
      { start: 19, end: 27, severity: "warning" },
    ]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
  });

  it("faerbt genau den angegebenen Bereich", () => {
    const text = "Das ist garantiert gut.";
    const segs = buildHighlightSegments(text, [{ start: 8, end: 18, severity: "danger" }]);
    expect(segs.find((s) => s.severity === "danger")?.text).toBe("garantiert");
  });

  it("laesst den engeren Bereich gewinnen", () => {
    // Ein Fuellwort in einem zu langen Satz darf nicht in der Satzflaeche
    // untergehen -- sonst sieht der Nutzer nur "Satz zu lang" und nicht, wo.
    const text = "aaaa bbbb cccc";
    const segs = buildHighlightSegments(text, [
      { start: 0, end: 14, severity: "warning" },
      { start: 5, end: 9, severity: "info" },
    ]);
    expect(segs).toEqual([
      { text: "aaaa ", severity: "warning" },
      { text: "bbbb", severity: "info" },
      { text: " cccc", severity: "warning" },
    ]);
  });

  it("nimmt bei gleich breiten Bereichen den schwereren Befund", () => {
    const segs = buildHighlightSegments("abcd", [
      { start: 0, end: 4, severity: "info" },
      { start: 0, end: 4, severity: "danger" },
    ]);
    expect(segs).toEqual([{ text: "abcd", severity: "danger" }]);
  });

  it("fasst benachbarte Abschnitte gleicher Farbe zusammen", () => {
    const segs = buildHighlightSegments("abcdef", [
      { start: 0, end: 3, severity: "warning" },
      { start: 3, end: 6, severity: "warning" },
    ]);
    expect(segs).toEqual([{ text: "abcdef", severity: "warning" }]);
  });

  it("ignoriert Bereiche ausserhalb des Texts", () => {
    // Kann auftreten, wenn Analyse und Tippen kurz auseinanderlaufen.
    expect(buildHighlightSegments("kurz", [{ start: 10, end: 20, severity: "danger" }])).toEqual([
      { text: "kurz", severity: null },
    ]);
  });
});

describe("bodyHighlightRanges", () => {
  it("nimmt nur Befunde aus dem Mailtext, nicht aus dem Betreff", () => {
    const report = runEmailQualityCheck({ subject: "GRATIS Angebot", body: "Das ist garantiert gut." }, "de");
    expect(report.spam.issues.some((i) => i.field === "subject")).toBe(true);
    expect(bodyHighlightRanges(report).length).toBeGreaterThan(0);
  });

  it("liefert Bereiche, die auf den echten Text zeigen", () => {
    const body = "Das ist eigentlich garantiert gut.";
    const ranges = bodyHighlightRanges(runEmailQualityCheck({ subject: "", body }, "de"));
    const words = ranges.map((r) => body.slice(r.start, r.end));
    expect(words).toContain("eigentlich");
    expect(words).toContain("garantiert");
  });

  it("laesst Aggregat-Befunde ohne Stelle weg", () => {
    // "3 Ausrufezeichen" bezieht sich auf den ganzen Text, hat also keine
    // Stelle und darf nichts einfaerben.
    const body = "Super!!!! Wirklich!! Klasse!! Toll!!";
    const report = runEmailQualityCheck({ subject: "", body }, "de");
    expect(report.spam.issues.some((i) => i.category === "exclamation" && i.offset === null)).toBe(true);
    expect(bodyHighlightRanges(report).every((r) => r.end > r.start)).toBe(true);
  });
});
