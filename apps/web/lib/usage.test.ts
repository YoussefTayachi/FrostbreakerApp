import { describe, expect, it } from "vitest";
import { openaiCostUsd, tokensFromResponse } from "./usage";

describe("openaiCostUsd", () => {
  it("rechnet Ein- und Ausgabe getrennt ab", () => {
    // Muss mit openai_cost_usd in apps/worker/worker/usage.py uebereinstimmen.
    expect(openaiCostUsd(1_000_000, 0)).toBeCloseTo(0.4, 10);
    expect(openaiCostUsd(0, 1_000_000)).toBeCloseTo(1.6, 10);
    expect(openaiCostUsd(1500, 40)).toBeCloseTo(0.0006 + 0.000064, 10);
  });

  it("zaehlt gecachte Token als Teil der Eingabe, nicht zusaetzlich", () => {
    // Der Punkt, an dem sich die Zahl leicht vervierfacht: OpenAI meldet
    // input_tokens als Gesamtsumme und cached_tokens als Anteil DARIN.
    expect(openaiCostUsd(1_000_000, 0, 1_000_000)).toBeCloseTo(0.1, 10);
    expect(openaiCostUsd(1_000_000, 0, 500_000)).toBeCloseTo(0.25, 10);
    // Kaeme je mehr Gecachtes als Eingang zurueck, waere ein Minusbetrag
    // schlimmer als eine zu hohe Zahl: er zoege die Summe der Suche herunter.
    expect(openaiCostUsd(100, 0, 999_999)).toBeGreaterThanOrEqual(0);
  });
});

describe("tokensFromResponse", () => {
  it("liest die gemeldeten Token", () => {
    expect(tokensFromResponse({ usage: { input_tokens: 120, output_tokens: 30 } })).toEqual({
      input: 120,
      output: 30,
      cached: 0,
    });
  });

  it("liest den gecachten Anteil aus input_tokens_details", () => {
    expect(
      tokensFromResponse({
        usage: {
          input_tokens: 2600,
          output_tokens: 30,
          input_tokens_details: { cached_tokens: 2000 },
        },
      })
    ).toEqual({ input: 2600, output: 30, cached: 2000 });
  });

  it("liefert null statt einer Schaetzung, wenn nichts gemeldet wurde", () => {
    // Eine ehrliche Luecke statt einer erfundenen Zahl, gleiche Regel wie
    // im Worker.
    expect(tokensFromResponse({})).toBeNull();
    expect(tokensFromResponse(null)).toBeNull();
    expect(tokensFromResponse({ usage: { input_tokens: 0, output_tokens: 0 } })).toBeNull();
  });
});
