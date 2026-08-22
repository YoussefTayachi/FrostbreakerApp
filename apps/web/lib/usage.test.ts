import { describe, expect, it } from "vitest";
import {
  anthropicCostUsd,
  claudeTokensFromResponse,
  openaiCostUsd,
  tokensFromResponse,
} from "./usage";

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
    // Eine ehrliche Luecke statt einer erfundenen Zahl, gleiche Regel wie
    // im Worker.
    expect(tokensFromResponse({})).toBeNull();
    expect(tokensFromResponse(null)).toBeNull();
    expect(tokensFromResponse({ usage: { input_tokens: 0, output_tokens: 0 } })).toBeNull();
  });
});

describe("anthropicCostUsd", () => {
  it("rechnet alle vier Posten mit ihrem eigenen Satz ab", () => {
    // Muss mit anthropic_cost_usd in apps/worker/worker/usage.py
    // uebereinstimmen. Listenpreise Claude Opus 5, Stand 2026-08-22.
    expect(anthropicCostUsd(1_000_000, 0)).toBeCloseTo(5.0, 10);
    expect(anthropicCostUsd(0, 1_000_000)).toBeCloseTo(25.0, 10);
    expect(anthropicCostUsd(0, 0, 1_000_000, 0)).toBeCloseTo(6.25, 10);
    expect(anthropicCostUsd(0, 0, 0, 1_000_000)).toBeCloseTo(0.5, 10);
  });

  it("zaehlt Cache-Tokens nicht zum Eingangspreis", () => {
    // Der eigentliche Punkt: ein Cache-Treffer kostet ein Zehntel. Wuerden
    // die Cache-Tokens einfach zu input_tokens addiert, waere die Rechnung
    // beim gecachten Beispielblock um das Zehnfache zu hoch.
    expect(anthropicCostUsd(0, 0, 0, 1_000_000)).toBeLessThan(anthropicCostUsd(1_000_000, 0));
  });
});

describe("claudeTokensFromResponse", () => {
  it("liest auch die beiden Cache-Felder", () => {
    // Anthropic zaehlt sie NEBEN input_tokens, nicht darin. Wer sie weglaesst,
    // meldet bei einem gecachten Vorspann fast keinen Verbrauch.
    expect(
      claudeTokensFromResponse({
        usage: {
          input_tokens: 40,
          output_tokens: 30,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 5200,
        },
      })
    ).toEqual({ input: 40, output: 30, cacheWrite: 0, cacheRead: 5200 });
  });

  it("liefert null statt einer Schaetzung, wenn nichts gemeldet wurde", () => {
    expect(claudeTokensFromResponse({})).toBeNull();
    expect(claudeTokensFromResponse(null)).toBeNull();
    expect(claudeTokensFromResponse({ usage: { input_tokens: 0, output_tokens: 0 } })).toBeNull();
  });
});
