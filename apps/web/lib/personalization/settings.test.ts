import { describe, expect, it } from "vitest";
import { resolveWritingRules } from "./settings";
import {
  DEFAULT_BANNED_WORDS,
  DEFAULT_MAX_WORDS,
  DEFAULT_PROMPT_DE,
  DEFAULT_PROMPT_EN,
} from "@/lib/personalization-defaults";

/**
 * Der Fall, um den es geht, steht im Kopf von settings.ts: im gemessenen
 * Workspace sind personalization_banned_words NULL und personalization_prompt
 * leer, und trotzdem gelten dort "— – -- -" und der deutsche Standardprompt.
 * Ein Werkzeug, das die Rohspalten ausliefert, wuerde einem Modell das
 * Gegenteil sagen.
 */
describe("resolveWritingRules", () => {
  it("leere Spalten ergeben die wirksamen Standards, nicht 'nichts'", () => {
    const regeln = resolveWritingRules({
      personalization_prompt: "",
      personalization_banned_words: null,
      personalization_max_words: 35,
      personalization_source: "company_summary",
      personalization_language: "de",
    });
    expect(regeln.bannedWords).toEqual(DEFAULT_BANNED_WORDS);
    expect(regeln.prompt).toBe(DEFAULT_PROMPT_DE);
    // Und es wird gesagt, dass beides geerbt ist.
    expect(regeln.origin.bannedWords).toBe("default");
    expect(regeln.origin.prompt).toBe("default");
  });

  it("eine fehlende Zeile ergibt vollstaendige Standards statt eines Absturzes", () => {
    const regeln = resolveWritingRules(null);
    expect(regeln.maxWords).toBe(DEFAULT_MAX_WORDS);
    expect(regeln.bannedWords).toEqual(DEFAULT_BANNED_WORDS);
    expect(regeln.language).toBe("de");
    expect(regeln.source).toBe("company_summary");
    expect(regeln.prompt).toBe(DEFAULT_PROMPT_DE);
    expect(Object.values(regeln.origin)).toEqual(["default", "default", "default", "default", "default"]);
  });

  it("eigene Werte gewinnen und werden als eingestellt gemeldet", () => {
    const regeln = resolveWritingRules({
      personalization_prompt: "  Schreib knapp.  ",
      personalization_banned_words: "—, sehr geehrte, ",
      personalization_max_words: 20,
      personalization_source: "both",
      personalization_language: "en",
    });
    expect(regeln.maxWords).toBe(20);
    expect(regeln.bannedWords).toEqual(["—", "sehr geehrte"]);
    expect(regeln.language).toBe("en");
    expect(regeln.source).toBe("both");
    expect(regeln.prompt).toBe("Schreib knapp.");
    expect(Object.values(regeln.origin)).toEqual([
      "workspace",
      "workspace",
      "workspace",
      "workspace",
      "workspace",
    ]);
  });

  it("ohne eigenen Prompt gilt der Standard IN DER GEWAEHLTEN SPRACHE", () => {
    // Der Fehler aus Migration 0083: deutsche Icebreaker fuer einen
    // Workspace, dessen Oberflaeche den englischen Prompt zeigte.
    const regeln = resolveWritingRules({ personalization_prompt: null, personalization_language: "en" });
    expect(regeln.prompt).toBe(DEFAULT_PROMPT_EN);
    expect(regeln.origin.prompt).toBe("default");
  });

  it("ein Feld aus lauter Kommas ist dasselbe wie ein leeres", () => {
    // Ein leerer Eintrag wuerde in der Pruefung als "kommt in jedem Text vor"
    // durchschlagen und JEDE Zeile als fehlerhaft melden.
    const regeln = resolveWritingRules({ personalization_banned_words: " , , " });
    expect(regeln.bannedWords).toEqual(DEFAULT_BANNED_WORDS);
    expect(regeln.origin.bannedWords).toBe("default");
  });

  it("unbrauchbare Werte fallen auf den Standard zurueck, wie im Worker", () => {
    // load_agent_config in personalize.py prueft source und language genauso
    // gegen ihre erlaubten Werte, statt sie durchzureichen.
    const regeln = resolveWritingRules({
      personalization_source: "irgendwas",
      personalization_language: "fr",
      personalization_max_words: 0,
    });
    expect(regeln.source).toBe("company_summary");
    expect(regeln.language).toBe("de");
    expect(regeln.maxWords).toBe(DEFAULT_MAX_WORDS);
    expect(regeln.origin.source).toBe("default");
    expect(regeln.origin.language).toBe("default");
    expect(regeln.origin.maxWords).toBe("default");
  });
});
