import { describe, expect, it } from "vitest";
import {
  buildClaudeMessages,
  buildClaudeSystem,
  extractClaudeText,
  type ClaudeExample,
} from "./anthropic";

/**
 * Der Nachrichtenaufbau muss mit generate_claude() in
 * apps/worker/worker/pipelines/personalize.py uebereinstimmen. Weicht er ab,
 * prueft der Live-Test im AI-Agent-Tab etwas anderes als der Worker spaeter
 * tut, und genau das ist bei der Sprachwahl schon einmal passiert (siehe
 * constraintBlock in lib/personalization-defaults.ts).
 *
 * Die Reihenfolge und Form der Turns sind der Kern: ein Beispiel, das anders
 * aussieht als die echte Anfrage, bringt dem Modell eine andere Abbildung bei
 * als die gemeinte, und man sieht es dem Ergebnis nicht an.
 */
const EXAMPLES: ClaudeExample[] = [
  { input_context: "Bäckerei Meier, seit 1912.", icebreaker: "Drei Filialen seit 1912." },
  { input_context: "Autohaus Nord, Elektro-Umbau.", icebreaker: "Der Umbau fällt auf." },
];

describe("buildClaudeMessages", () => {
  it("stellt Beispiele als user/assistant-Paare vor die echte Anfrage", () => {
    const msgs = buildClaudeMessages("Muster GmbH", "Kontext", EXAMPLES);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(msgs[0].content).toBe(EXAMPLES[0].input_context);
    expect(msgs[2].content).toBe(EXAMPLES[1].input_context);
    expect(msgs[msgs.length - 1].content).toBe("Unternehmen: Muster GmbH\n\nKontext");
  });

  it("schickt die Beispielzeile blank, ohne Anfuehrungszeichen und ohne Label", () => {
    const msgs = buildClaudeMessages("Muster GmbH", "Kontext", EXAMPLES);
    const answer = msgs[1].content as { type: string; text: string }[];
    expect(answer[0]).toMatchObject({ type: "text", text: "Drei Filialen seit 1912." });
  });

  it("haengt die Korrektur an den letzten Turn, nie an ein Beispiel", () => {
    const msgs = buildClaudeMessages("Muster GmbH", "Kontext", EXAMPLES, "Bitte kürzer.");
    expect(msgs[msgs.length - 1].content).toBe(
      "Unternehmen: Muster GmbH\n\nKontext\n\nBitte kürzer."
    );
    for (const m of msgs.slice(0, -1)) {
      const text = typeof m.content === "string" ? m.content : m.content[0].text;
      expect(text).not.toContain("Bitte kürzer.");
    }
  });

  it("setzt genau einen Cache-Punkt, am Ende des geteilten Vorspanns", () => {
    const msgs = buildClaudeMessages("Muster GmbH", "Kontext", EXAMPLES);
    const first = msgs[1].content as { cache_control?: unknown }[];
    const last = msgs[3].content as { cache_control?: unknown }[];
    expect(first[0].cache_control).toBeUndefined();
    expect(last[0].cache_control).toEqual({ type: "ephemeral" });
    // Ein Punkt auf der echten Anfrage wuerde je Lead einen eigenen Eintrag
    // schreiben und nie einen lesen.
    expect(typeof msgs[4].content).toBe("string");
  });

  it("kommt ohne Beispiele aus", () => {
    const msgs = buildClaudeMessages("Muster GmbH", "Kontext", []);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
  });
});

describe("buildClaudeSystem", () => {
  it("traegt den Cache-Punkt nur ohne Beispiele", () => {
    expect(buildClaudeSystem("SYSTEM", 0)[0].cache_control).toEqual({ type: "ephemeral" });
    expect(buildClaudeSystem("SYSTEM", 2)[0].cache_control).toBeUndefined();
  });
});

describe("extractClaudeText", () => {
  it("nimmt nur text-Bloecke und laesst thinking liegen", () => {
    const json = {
      content: [
        { type: "thinking", thinking: "erst mal überlegen" },
        { type: "text", text: "Drei Filialen seit 1912." },
      ],
    };
    expect(extractClaudeText(json)).toBe("Drei Filialen seit 1912.");
  });

  it("streift umschliessende Anfuehrungszeichen ab, wie der OpenAI-Pfad", () => {
    expect(extractClaudeText({ content: [{ type: "text", text: '"Ein Satz."' }] })).toBe(
      "Ein Satz."
    );
  });

  it("liefert leer statt zu werfen, wenn nichts da ist", () => {
    expect(extractClaudeText({})).toBe("");
    expect(extractClaudeText(null)).toBe("");
  });
});
