import { describe, expect, it } from "vitest";
import {
  buildPersonalizationInput,
  extractOutputText,
  type PersonalizationExample,
} from "./openai";

/**
 * Der Aufbau der input-Liste muss mit build_input() in
 * apps/worker/worker/pipelines/personalize.py uebereinstimmen. Weicht er ab,
 * prueft der Live-Test im AI-Agent-Tab etwas anderes als der Worker spaeter
 * tut, und genau das ist bei der Sprachwahl schon einmal passiert (siehe
 * constraintBlock in lib/personalization-defaults.ts).
 *
 * Reihenfolge und Form der Turns sind der Kern: ein Beispiel, das anders
 * aussieht als die echte Anfrage, bringt dem Modell eine andere Abbildung bei
 * als die gemeinte, und man sieht es dem Ergebnis nicht an.
 */
const EXAMPLES: PersonalizationExample[] = [
  { input_context: "Bäckerei Meier, seit 1912.", icebreaker: "Drei Filialen seit 1912." },
  { input_context: "Autohaus Nord, Elektro-Umbau.", icebreaker: "Der Umbau fällt auf." },
];

describe("buildPersonalizationInput", () => {
  it("stellt System-Prompt und Beispiele vor die echte Anfrage", () => {
    const input = buildPersonalizationInput("SYSTEM", "Muster GmbH", "Kontext", EXAMPLES);
    expect(input.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(input[0].content).toBe("SYSTEM");
    // Beispiel-User-Turn: der hinterlegte Kontext, unveraendert.
    expect(input[1].content).toBe(EXAMPLES[0].input_context);
    expect(input[3].content).toBe(EXAMPLES[1].input_context);
    // Beispiel-Assistant-Turn: die blanke Zeile, ohne Label.
    expect(input[2].content).toBe(EXAMPLES[0].icebreaker);
    expect(input[4].content).toBe(EXAMPLES[1].icebreaker);
    // Der veraenderliche Teil steht ganz hinten. Das ist zugleich die
    // Reihenfolge, die OpenAI fuers Praefix-Caching verlangt.
    expect(input[input.length - 1].content).toBe("Unternehmen: Muster GmbH\n\nKontext");
  });

  it("kommt ohne Beispiele aus", () => {
    const input = buildPersonalizationInput("SYSTEM", "Muster GmbH", "Kontext");
    expect(input.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("haengt die Korrektur an den letzten Turn, nie an ein Beispiel", () => {
    const input = buildPersonalizationInput(
      "SYSTEM",
      "Muster GmbH",
      "Kontext",
      EXAMPLES,
      "Bitte kürzer."
    );
    expect(input[input.length - 1].content).toBe(
      "Unternehmen: Muster GmbH\n\nKontext\n\nBitte kürzer."
    );
    for (const m of input.slice(0, -1)) expect(m.content).not.toContain("Bitte kürzer.");
  });
});

describe("extractOutputText", () => {
  it("nimmt nur output_text aus message-Bloecken", () => {
    const json = {
      output: [
        { type: "reasoning", content: [] },
        { type: "message", content: [{ type: "output_text", text: "Drei Filialen seit 1912." }] },
      ],
    };
    expect(extractOutputText(json)).toBe("Drei Filialen seit 1912.");
  });

  it("streift umschliessende Anfuehrungszeichen ab", () => {
    const json = {
      output: [{ type: "message", content: [{ type: "output_text", text: '"Ein Satz."' }] }],
    };
    expect(extractOutputText(json)).toBe("Ein Satz.");
  });
});
