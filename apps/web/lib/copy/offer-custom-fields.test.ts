import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_FIELDS,
  CUSTOM_VALUE_MAX,
  customFieldNotesBlock,
  customFieldPromptBlock,
  defsFor,
  parseCustomFields,
  readCustomFields,
  slugifyFieldKey,
  type OfferFieldDef,
} from "./offer-custom-fields";

function feld(over: Partial<OfferFieldDef> = {}): OfferFieldDef {
  return {
    key: "risk_reversal",
    label: "Risikoumkehr",
    instruction: "Was nimmst du dem Empfaenger an Risiko ab?",
    fill_from: "core",
    ...over,
  };
}

describe("defsFor", () => {
  it("gibt Core nur, was aus der eigenen Website kommen kann", () => {
    // Die Trennlinie ist dieselbe wie bei SEARCH_SUGGESTED_FIELDS: Core liest
    // die Verkaeuferseite, Aim die Empfaengerbeschreibungen. Wer beides aus
    // derselben Quelle zieht, bekommt erfundene Werte.
    const defs = [
      feld({ key: "risk", fill_from: "core" }),
      feld({ key: "painpoint", fill_from: "aim" }),
      feld({ key: "loesung", fill_from: "both" }),
      feld({ key: "notiz", fill_from: "manual" }),
    ];
    expect(defsFor(defs, "core").map((d) => d.key)).toEqual(["risk", "loesung"]);
    expect(defsFor(defs, "aim").map((d) => d.key)).toEqual(["painpoint", "loesung"]);
  });

  it("laesst 'manual' nie an ein Modell", () => {
    const defs = [feld({ fill_from: "manual" })];
    expect(defsFor(defs, "core")).toEqual([]);
    expect(defsFor(defs, "aim")).toEqual([]);
  });

  it("deckelt bei MAX_CUSTOM_FIELDS, auch wenn in der Datenbank mehr stehen", () => {
    const defs = Array.from({ length: MAX_CUSTOM_FIELDS + 3 }, (_, i) => feld({ key: `f${i}` }));
    expect(defsFor(defs, "core")).toHaveLength(MAX_CUSTOM_FIELDS);
  });
});

describe("customFieldPromptBlock", () => {
  it("liefert ohne Definitionen NICHTS, damit der Prompt der alte bleibt", () => {
    expect(customFieldPromptBlock([], "core")).toEqual({ fields: [], json: "", keys: [] });
    expect(customFieldPromptBlock([feld({ fill_from: "aim" })], "core").json).toBe("");
  });

  it("macht aus Schluessel und Anweisung eine FIELDS-Zeile", () => {
    const block = customFieldPromptBlock([feld()], "core");
    expect(block.fields).toEqual(["- risk_reversal: Was nimmst du dem Empfaenger an Risiko ab?"]);
    expect(block.json).toBe(',"risk_reversal":"..."');
    expect(block.keys).toEqual(["risk_reversal"]);
  });

  it("faellt ohne Anweisung auf das Label zurueck statt eine leere Zeile zu bauen", () => {
    const block = customFieldPromptBlock([feld({ instruction: "  " })], "core");
    expect(block.fields).toEqual(["- risk_reversal: Risikoumkehr"]);
  });
});

describe("parseCustomFields", () => {
  it("liest die eigenen Felder, auch aus einem Codeblock", () => {
    const raw = '```json\n{"risk_reversal":"Erste Woche kostenlos","offering":"egal"}\n```';
    expect(parseCustomFields(raw, [feld()])).toEqual({ risk_reversal: "Erste Woche kostenlos" });
  });

  it("wirft unbekannte Schluessel weg", () => {
    // Auch die eines anderen Kerns: `defs` ist bereits gefiltert, ein
    // Core-Lauf, der ein Aim-Feld ausfuellt, hat geraten.
    const raw = '{"painpoint":"Aus der Website geraten","risk_reversal":"Monatlich kündbar"}';
    expect(parseCustomFields(raw, [feld()])).toEqual({ risk_reversal: "Monatlich kündbar" });
  });

  it("behandelt Ausreden wie leer", () => {
    // Sonst steht woertlich "nicht angegeben" im Feld, und der
    // Sequenzgenerator liest das als Tatsache.
    const raw = '{"risk_reversal":"nicht angegeben"}';
    expect(parseCustomFields(raw, [feld()])).toEqual({});
  });

  it("ignoriert falsche Typen und kappt die Laenge", () => {
    expect(parseCustomFields('{"risk_reversal":42}', [feld()])).toEqual({});
    const lang = '{"risk_reversal":"' + "a".repeat(CUSTOM_VALUE_MAX + 50) + '"}';
    expect(parseCustomFields(lang, [feld()]).risk_reversal).toHaveLength(CUSTOM_VALUE_MAX);
  });

  it("liefert ein leeres Objekt statt zu werfen", () => {
    expect(parseCustomFields("Das kann ich nicht.", [feld()])).toEqual({});
    expect(parseCustomFields("{kaputt", [feld()])).toEqual({});
    expect(parseCustomFields("[1,2]", [feld()])).toEqual({});
  });
});

describe("customFieldNotesBlock", () => {
  it("erzeugt zu einem LEEREN eigenen Feld gar nichts", () => {
    // Anders als bei den zwoelf festen Feldern: dort erzeugt ein leeres Feld
    // ein ausdrueckliches Verbot, weil das Modell die bekannte Rolle sonst
    // selbst erfindet. Ein eigenes Feld hat keine bekannte Rolle, es gibt also
    // nichts Bestimmtes zu verbieten.
    expect(customFieldNotesBlock([feld()], {})).toEqual([]);
    expect(customFieldNotesBlock([feld()], { risk_reversal: "   " })).toEqual([]);
    expect(customFieldNotesBlock([], { risk_reversal: "Erste Woche kostenlos" })).toEqual([]);
  });

  it("beschriftet mit dem Label und verbietet eine zweite Frage", () => {
    const zeilen = customFieldNotesBlock([feld()], { risk_reversal: "Erste Woche kostenlos" });
    expect(zeilen.join("\n")).toContain("Risikoumkehr: Erste Woche kostenlos");
    expect(zeilen.join("\n")).toContain("NEVER add a second friction");
    expect(zeilen.join("\n")).not.toContain("risk_reversal");
  });

  it("nimmt nur Felder mit Wert mit", () => {
    const defs = [feld({ key: "a", label: "A" }), feld({ key: "b", label: "B" })];
    const zeilen = customFieldNotesBlock(defs, { a: "steht da", b: "" });
    expect(zeilen.filter((z) => z.startsWith("A: "))).toHaveLength(1);
    expect(zeilen.some((z) => z.startsWith("B: "))).toBe(false);
  });
});

describe("slugifyFieldKey", () => {
  it("schreibt Umlaute aus statt sie wegzuwerfen", () => {
    expect(slugifyFieldKey("Ungefähre Verluste", [])).toBe("ungefaehre_verluste");
    expect(slugifyFieldKey("Größe", [])).toBe("groesse");
  });

  it("zaehlt bei Kollision hoch, statt einen fremden Wert zu treffen", () => {
    expect(slugifyFieldKey("Risk Reversal", ["risk_reversal"])).toBe("risk_reversal_2");
    expect(slugifyFieldKey("Risk Reversal", ["risk_reversal", "risk_reversal_2"])).toBe(
      "risk_reversal_3"
    );
  });

  it("liefert auch ohne verwertbare Zeichen einen Schluessel", () => {
    expect(slugifyFieldKey("???", [])).toBe("feld");
    expect(slugifyFieldKey("???", ["feld"])).toBe("feld_2");
  });
});

describe("readCustomFields", () => {
  it("nimmt nur Strings und behaelt verwaiste Schluessel", () => {
    // Verwaist heisst: die Definition wurde geloescht, der Wert nicht. Das ist
    // Absicht (Migration 0098): gelesen wird nur ueber die Definitionen.
    expect(readCustomFields({ a: "x", b: 3, c: null, alt: "bleibt" })).toEqual({
      a: "x",
      alt: "bleibt",
    });
  });

  it("vertraegt null und falsche Formen", () => {
    expect(readCustomFields(null)).toEqual({});
    expect(readCustomFields([1, 2])).toEqual({});
    expect(readCustomFields("{}")).toEqual({});
  });
});
