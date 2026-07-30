import { describe, expect, it } from "vitest";
import { sanitizeBannedPunctuation, validateIcebreaker } from "./personalization-defaults";

describe("sanitizeBannedPunctuation", () => {
  it("ersetzt einen verbotenen Gedankenstrich durch ein Komma", () => {
    const text = "blending tennis with culinary events—that's why I wanted to drop you a line.";
    const result = sanitizeBannedPunctuation(text, ["—", "--", "-"]);
    expect(result).not.toContain("—");
    expect(result).toBe("blending tennis with culinary events, that's why I wanted to drop you a line.");
  });

  it("ersetzt einen doppelten Bindestrich vor einem einzelnen (laengeres Muster zuerst)", () => {
    const text = "Wild Thing and Pasta e Basta--that's why I wanted to drop you a line.";
    const result = sanitizeBannedPunctuation(text, ["-", "--"]);
    expect(result).not.toContain("--");
    expect(result).not.toMatch(/\s-\s/);
  });

  it("laesst normale Woerter in banned_words unangetastet (kein Buchstabe wird gestrichen)", () => {
    const text = "Das ist beeindruckend und voller Respekt.";
    const result = sanitizeBannedPunctuation(text, ["Respekt", "beeindruckt"]);
    expect(result).toBe(text);
  });

  it("ist ein No-op ohne Satzzeichen-Eintraege in banned_words", () => {
    const text = "Ein ganz normaler Satz ohne Verstoss.";
    expect(sanitizeBannedPunctuation(text, ["Respekt"])).toBe(text);
  });

  it("raeumt danach auch doppelte Kommas auf", () => {
    const text = "Erster Teil—, zweiter Teil.";
    const result = sanitizeBannedPunctuation(text, ["—"]);
    expect(result).not.toMatch(/,\s*,/);
  });
});

describe("validateIcebreaker findet nach sanitize keinen Verstoss mehr", () => {
  it("end-to-end: Gedankenstrich wird erkannt, saniert, dann nicht mehr gemeldet", () => {
    const text = "Kurzer Satz—mit Gedankenstrich.";
    const before = validateIcebreaker(text, 22, ["—"], "de");
    expect(before.some((p) => p.includes("verbotene"))).toBe(true);

    const cleaned = sanitizeBannedPunctuation(text, ["—"]);
    const after = validateIcebreaker(cleaned, 22, ["—"], "de");
    expect(after.some((p) => p.includes("verbotene"))).toBe(false);
  });
});
