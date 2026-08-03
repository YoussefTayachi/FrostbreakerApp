import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINKEDIN_TEMPLATE_DE,
  getDefaultLinkedInTemplate,
  renderLinkedInMessage,
  unknownPlaceholders,
  variableHighlightRanges,
} from "./linkedin-message";

describe("renderLinkedInMessage", () => {
  it("setzt alle drei Platzhalter ein", () => {
    const out = renderLinkedInMessage("Hi {{firstName}}, {{companyName}} — {{personalization}}", {
      firstName: "Anna",
      companyName: "Acme",
      personalization: "Ihr baut seit 1996 selbst.",
    });
    expect(out).toBe("Hi Anna, Acme — Ihr baut seit 1996 selbst.");
  });

  it("toleriert Leerzeichen innerhalb der geschweiften Klammern", () => {
    expect(renderLinkedInMessage("{{ firstName }}", { firstName: "Bo" })).toBe("Bo");
  });

  it("ersetzt jeden Platzhalter auch mehrfach", () => {
    const out = renderLinkedInMessage("{{companyName}} und {{companyName}}", { companyName: "Acme" });
    expect(out).toBe("Acme und Acme");
  });

  // Fall 1 aus dem Dateikopf: Apollo liefert bei manchen Treffern keinen Vornamen.
  it("macht aus einer Anrede ohne Vornamen kein 'Hi ,'", () => {
    const out = renderLinkedInMessage("Hi {{firstName}},\n\nText", { firstName: null });
    expect(out).toBe("Hallo,\n\nText");
    expect(out).not.toContain("Hi ,");
  });

  it("laesst eine vorhandene Anrede unangetastet", () => {
    const out = renderLinkedInMessage("Hi {{firstName}},\n\nText", { firstName: "Anna" });
    expect(out).toBe("Hi Anna,\n\nText");
  });

  // Fall 2: 16 der 230 reinen LinkedIn-Kontakte haben keine Personalisierung.
  it("entfernt den Absatz eines fehlenden Icebreakers ohne Luecke", () => {
    const out = renderLinkedInMessage("Hi Anna,\n\n{{personalization}}\n\nGruss", {
      personalization: null,
    });
    expect(out).toBe("Hi Anna,\n\nGruss");
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("behaelt genau einen Absatz, wenn der Icebreaker da ist", () => {
    const out = renderLinkedInMessage("Hi Anna,\n\n{{personalization}}\n\nGruss", {
      personalization: "Ihr liefert seit 1996.",
    });
    expect(out).toBe("Hi Anna,\n\nIhr liefert seit 1996.\n\nGruss");
  });

  it("setzt bei fehlendem Firmennamen ein neutrales Wort statt einer Luecke", () => {
    const out = renderLinkedInMessage("Arbeit fuer {{companyName}}", { companyName: "" });
    expect(out).toBe("Arbeit fuer euch");
  });

  it("laesst keine Leerzeichen am Zeilenende stehen", () => {
    const out = renderLinkedInMessage("Zeile {{personalization}}\nZweite", { personalization: "" });
    expect(out.split("\n").every((line) => line === line.trimEnd())).toBe(true);
  });

  it("die Standardvorlage bleibt ohne jeden Wert lesbar", () => {
    const out = renderLinkedInMessage(DEFAULT_LINKEDIN_TEMPLATE_DE, {});
    expect(out).toContain("Hallo,");
    expect(out).not.toContain("{{");
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("die Standardvorlagen enthalten nur bekannte Platzhalter", () => {
    expect(unknownPlaceholders(getDefaultLinkedInTemplate("de"))).toEqual([]);
    expect(unknownPlaceholders(getDefaultLinkedInTemplate("en"))).toEqual([]);
  });
});

describe("unknownPlaceholders", () => {
  it("findet einen falsch geschriebenen Platzhalter", () => {
    expect(unknownPlaceholders("Hi {{firstname}}")).toEqual(["firstname"]);
  });

  // Genau der Fehler aus Session 3: {{personalization - e.g., ...}} war kein
  // gueltiges Feld und stand woertlich in der Mail.
  it("erkennt einen Platzhalter mit angehaengter Erklaerung als ungueltig", () => {
    expect(unknownPlaceholders("{{personalization - e.g., etwas}}")).toEqual([
      "personalization - e.g., etwas",
    ]);
  });

  it("meldet nichts bei korrekter Vorlage", () => {
    expect(unknownPlaceholders("{{firstName}} {{companyName}} {{personalization}}")).toEqual([]);
  });

  it("meldet jeden falschen Platzhalter nur einmal", () => {
    expect(unknownPlaceholders("{{foo}} und {{foo}}")).toEqual(["foo"]);
  });
});

describe("variableHighlightRanges", () => {
  it("markiert eine gueltige Variable blau", () => {
    const template = "Hi {{firstName}}!";
    const [range] = variableHighlightRanges(template);
    expect(range).toEqual({ start: 3, end: 16, severity: "info" });
    expect(template.slice(range.start, range.end)).toBe("{{firstName}}");
  });

  it("markiert einen Schreibfehler rot", () => {
    const [range] = variableHighlightRanges("Hi {{firstname}}!");
    expect(range.severity).toBe("danger");
  });

  it("findet alle Variablen einer Vorlage", () => {
    const ranges = variableHighlightRanges("{{firstName}} {{companyName}} {{personalization}}");
    expect(ranges).toHaveLength(3);
    expect(ranges.every((r) => r.severity === "info")).toBe(true);
  });

  it("liefert Bereiche, die exakt auf dem Text sitzen", () => {
    const template = "A {{firstName}} B {{nope}} C";
    for (const r of variableHighlightRanges(template)) {
      expect(template.slice(r.start, r.end)).toMatch(/^\{\{.*\}\}$/);
    }
  });

  it("meldet nichts bei einer Vorlage ohne Variablen", () => {
    expect(variableHighlightRanges("Nur Text")).toEqual([]);
  });

  // Die Markierung und die Fehlerliste teilen sich dieselbe Regex -- sonst
  // koennte etwas rot markiert sein, das unten nicht genannt wird, oder
  // umgekehrt.
  it("stimmt mit unknownPlaceholders ueberein", () => {
    const template = "{{firstName}} {{foo}} {{companyName}} {{bar}}";
    const rot = variableHighlightRanges(template)
      .filter((r) => r.severity === "danger")
      .map((r) => template.slice(r.start, r.end).replace(/[{}]/g, "").trim());
    expect(rot).toEqual(unknownPlaceholders(template));
  });

  it("markiert in der Standardvorlage ausschliesslich gueltige Variablen", () => {
    const ranges = variableHighlightRanges(DEFAULT_LINKEDIN_TEMPLATE_DE);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.some((r) => r.severity === "danger")).toBe(false);
  });
});
