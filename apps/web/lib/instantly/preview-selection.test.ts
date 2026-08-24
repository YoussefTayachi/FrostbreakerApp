import { describe, expect, it } from "vitest";
import {
  clampPreviewSelection,
  hasSequenceText,
  isHeldBack,
  selectedVariant,
  sequenceGaps,
} from "./preview-selection";
import type { MergeTagSource, SequenceStep } from "./campaigns";

function lead(websiteFinding: string | null = "Eure Startseite laedt in 6 Sekunden."): MergeTagSource {
  return {
    email: "ada@firma.de",
    first_name: "Ada",
    last_name: "Lovelace",
    businesses: {
      name: "Firma GmbH",
      personalization: "Ihr haltet die Nische.",
      website_finding: websiteFinding,
    },
  };
}

function steps(...bodies: string[][]): SequenceStep[] {
  return bodies.map((variants) => ({
    variants: variants.map((body) => ({ subject: "Betreff", body })),
  }));
}

describe("clampPreviewSelection", () => {
  it("laesst eine gueltige Auswahl unveraendert", () => {
    expect(clampPreviewSelection(steps(["a"], ["b", "c"]), { step: 1, variant: 1 })).toEqual({
      step: 1,
      variant: 1,
    });
  });

  it("zieht auf die letzte Stufe, wenn die gewaehlte geloescht wurde", () => {
    expect(clampPreviewSelection(steps(["a"], ["b"]), { step: 3, variant: 0 })).toEqual({
      step: 1,
      variant: 0,
    });
  });

  it("zieht auf die letzte Fassung, wenn die gewaehlte geloescht wurde", () => {
    expect(clampPreviewSelection(steps(["a"]), { step: 0, variant: 2 })).toEqual({
      step: 0,
      variant: 0,
    });
  });

  it("faengt negative Werte ab", () => {
    expect(clampPreviewSelection(steps(["a"], ["b"]), { step: -1, variant: -5 })).toEqual({
      step: 0,
      variant: 0,
    });
  });

  it("kommt mit einer Sequenz ohne Stufen zurecht", () => {
    expect(clampPreviewSelection([], { step: 2, variant: 1 })).toEqual({ step: 0, variant: 0 });
  });

  it("kommt mit einer Stufe ohne Fassung zurecht", () => {
    expect(clampPreviewSelection([{ variants: [] }], { step: 0, variant: 1 })).toEqual({
      step: 0,
      variant: 0,
    });
  });
});

describe("selectedVariant", () => {
  it("liefert die gewaehlte Fassung", () => {
    expect(selectedVariant(steps(["a"], ["b", "c"]), { step: 1, variant: 1 }).body).toBe("c");
  });

  it("liefert leere Felder statt undefined, wenn es nichts gibt", () => {
    expect(selectedVariant([], { step: 0, variant: 0 })).toEqual({ subject: "", body: "" });
  });
});

describe("hasSequenceText", () => {
  it("ist falsch, solange nur Leerzeichen dastehen", () => {
    expect(hasSequenceText([{ variants: [{ subject: "  ", body: "\n" }] }])).toBe(false);
  });

  it("ist wahr, sobald irgendeine Fassung Text hat", () => {
    expect(
      hasSequenceText([{ variants: [{ subject: "", body: "" }, { subject: "", body: "Hallo" }] }])
    ).toBe(true);
  });
});

describe("isHeldBack", () => {
  const mitVariable = steps(["Hallo, {{websiteFinding}}"]);

  it("haelt einen Lead ohne Befund zurueck", () => {
    expect(isHeldBack(mitVariable, lead(null))).toBe(true);
    expect(isHeldBack(mitVariable, lead("   "))).toBe(true);
  });

  it("laesst einen Lead mit Befund durch", () => {
    expect(isHeldBack(mitVariable, lead())).toBe(false);
  });

  it("haelt niemanden zurueck, wenn die Sequenz die Variable gar nicht benutzt", () => {
    expect(isHeldBack(steps(["Hallo {{firstName}}"]), lead(null))).toBe(false);
  });

  it("zaehlt auch eine Fassung mit, die nur in Stufe 3 steht", () => {
    const s = steps(["Hallo"], ["Hallo"], ["Kurz noch: {{websiteFinding}}"]);
    expect(isHeldBack(s, lead(null))).toBe(true);
  });

  it("zaehlt eine abgeschaltete Fassung mit, wie splitByWebsiteFinding auch", () => {
    const s: SequenceStep[] = [
      { variants: [{ subject: "s", body: "Hallo" }, { subject: "s", body: "{{websiteFinding}}", disabled: true }] },
    ];
    expect(isHeldBack(s, lead(null))).toBe(true);
  });
});

describe("sequenceGaps", () => {
  it("nennt Stufe und Fassung jeder Luecke", () => {
    const s: SequenceStep[] = [
      { variants: [{ subject: "Hi {{firstName}}", body: "Alles da." }] },
      {
        variants: [
          { subject: "Hi", body: "Alles da." },
          { subject: "Hi", body: "Und noch: {{websiteFinding}}" },
        ],
      },
    ];
    expect(sequenceGaps(s, lead(null))).toEqual([
      { step: 1, variant: 1, empty: ["{{websiteFinding}}"], unknown: [] },
    ]);
  });

  it("meldet einen erfundenen Platzhalter getrennt von einem leeren Wert", () => {
    const s = steps(["Hallo {{vorname}}, {{websiteFinding}}"]);
    expect(sequenceGaps(s, lead(null))).toEqual([
      { step: 0, variant: 0, empty: ["{{websiteFinding}}"], unknown: ["{{vorname}}"] },
    ]);
  });

  it("bleibt leer, wenn dieser Lead ueberall Werte hat", () => {
    expect(sequenceGaps(steps(["Hallo {{firstName}}, {{websiteFinding}}"]), lead())).toEqual([]);
  });
});
