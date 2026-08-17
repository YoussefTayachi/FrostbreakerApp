import { describe, expect, it } from "vitest";
import { openaiCostUsd, tokensFromResponse } from "./usage";

describe("openaiCostUsd", () => {
  it("rechnet Ein- und Ausgabe getrennt ab", () => {
    // Muss mit openai_cost_usd in apps/worker/worker/usage.py uebereinstimmen.
    expect(openaiCostUsd(1_000_000, 0)).toBeCloseTo(0.4, 10);
    expect(openaiCostUsd(0, 1_000_000)).toBeCloseTo(1.6, 10);
    expect(openaiCostUsd(1500, 40)).toBeCloseTo(0.0006 + 0.000064, 10);
  });
});

describe("tokensFromResponse", () => {
  it("liest die gemeldeten Token", () => {
    expect(tokensFromResponse({ usage: { input_tokens: 120, output_tokens: 30 } })).toEqual({
      input: 120,
      output: 30,
    });
  });

  it("liefert null statt einer Schaetzung, wenn nichts gemeldet wurde", () => {
    // Eine ehrliche Luecke statt einer erfundenen Zahl — gleiche Regel wie
    // im Worker.
    expect(tokensFromResponse({})).toBeNull();
    expect(tokensFromResponse(null)).toBeNull();
    expect(tokensFromResponse({ usage: { input_tokens: 0, output_tokens: 0 } })).toBeNull();
  });
});
