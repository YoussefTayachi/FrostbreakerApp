import { describe, expect, it } from "vitest";
import { SUGGESTED_FIELDS, buildOfferPrompt, parseOfferSuggestion } from "./offer-from-website";

const seite = {
  title: "Retourenheld | Weniger Retouren für Shopify-Shops",
  description: "Wir senken Retourenquoten im E-Commerce.",
  text: "Seit 2019 begleiten wir Shops.\nUnsere Kunden sparen im Schnitt 12 Prozent.",
};

describe("buildOfferPrompt", () => {
  it("gibt Titel, Beschreibung und Text mit", () => {
    const p = buildOfferPrompt(seite, "de");
    expect(p).toContain("Retourenheld");
    expect(p).toContain("Wir senken Retourenquoten");
    expect(p).toContain("Seit 2019");
  });

  it("verbietet das Erfinden von Angaben", () => {
    const p = buildOfferPrompt(seite, "de");
    expect(p).toContain("Never guess");
    expect(p).toMatch(/'proof' may ONLY contain/);
  });

  it("laesst fehlende Kopfangaben einfach weg statt leere Zeilen zu schicken", () => {
    const p = buildOfferPrompt({ title: null, description: null, text: "Nur Text." }, "de");
    expect(p).not.toContain("Title:");
    expect(p).not.toContain("Description:");
  });

  it("gibt die Ausgabesprache vor", () => {
    expect(buildOfferPrompt(seite, "en")).toContain("Write the values in English");
    expect(buildOfferPrompt(seite, "de")).toContain("Write the values in German");
  });

  it("bleibt ohne gewaehltes Produkt Wort fuer Wort der alte", () => {
    // Die eindeutige Seite ist der Normalfall. Weder null noch ein fehlender
    // Wert darf am Prompt etwas aendern — sonst haette die Erkennung den
    // Entwurf jeder anderen Seite mitverschoben.
    expect(buildOfferPrompt(seite, "de", null)).toBe(buildOfferPrompt(seite, "de"));
    expect(buildOfferPrompt(seite, "de")).not.toContain("THE ONE PRODUCT");
  });

  it("grenzt auf das gewaehlte Produkt ein -- als Regel UND am Produkt selbst", () => {
    const p = buildOfferPrompt(seite, "de", {
      name: "Armincx",
      description: "Automatisiert den Kundensupport",
    });
    expect(p).toContain("This company sells more than one thing");
    expect(p).toContain("THE ONE PRODUCT OR SERVICE THIS PROFILE IS ABOUT:");
    expect(p).toContain("Name: Armincx");
    expect(p).toContain("What it is: Automatisiert den Kundensupport");
    expect(p).toContain("Do not mention the others");
    // Der Block gehoert vor die Seite: er schraenkt ein, was gleich darunter
    // zu lesen ist.
    expect(p.indexOf("THE ONE PRODUCT")).toBeLessThan(p.indexOf("THE PAGE:"));
  });

  it("laesst die Beschreibung weg, wenn der Nutzer nur einen Namen getippt hat", () => {
    const p = buildOfferPrompt(seite, "de", { name: "Armincx", description: "" });
    expect(p).toContain("Name: Armincx");
    expect(p).not.toContain("What it is:");
  });
});

describe("parseOfferSuggestion", () => {
  it("liest die Felder, auch aus einem Codeblock", () => {
    const raw = '```json\n{"offering":"Retourenberatung","icp":"Shopify-Shops","proof":"12 Prozent"}\n```';
    expect(parseOfferSuggestion(raw)).toEqual({
      offering: "Retourenberatung",
      icp: "Shopify-Shops",
      proof: "12 Prozent",
    });
  });

  it("schlaegt den Ton nicht vor -- der steht nicht auf einer Website", () => {
    expect(SUGGESTED_FIELDS).not.toContain("tone");
    expect(parseOfferSuggestion('{"tone":"locker und frech"}')).toEqual({});
  });

  it("schlaegt den Micro-Yes NICHT aus der Website vor", () => {
    // Auf fast jeder Seite steht "Termin buchen". Genau das ist der Micro-Yes
    // nicht — solange dieses Feld mitlief, hat die Uebernahme dem Nutzer die
    // Terminbitte ins Angebot geschrieben.
    expect(SUGGESTED_FIELDS).not.toContain("cta");
    expect(parseOfferSuggestion('{"cta":"Kostenloses Erstgespräch buchen"}')).toEqual({});
  });

  it("schlaegt nichts vor, was eine Entscheidung ist", () => {
    for (const feld of ["preview_asset", "review_time", "friction_reason"] as const) {
      expect(SUGGESTED_FIELDS).not.toContain(feld);
    }
  });

  it("schlaegt Friction und Mechanismus vor -- die stehen auf der Seite", () => {
    expect(SUGGESTED_FIELDS).toContain("friction");
    expect(SUGGESTED_FIELDS).toContain("mechanism");
  });

  it("wirft Ausreden weg statt sie als Tatsache zu speichern", () => {
    // Sonst steht woertlich "Keine Angabe" im Beleg-Feld, und der
    // Sequenzgenerator liest das als etwas, das er erwaehnen darf.
    const raw = '{"offering":"Beratung","proof":"Keine Angaben","outcome":"n/a","cta":"not specified"}';
    expect(parseOfferSuggestion(raw)).toEqual({ offering: "Beratung" });
  });

  it("haelt einen echten Satz nicht faelschlich fuer eine Ausrede", () => {
    const raw = '{"proof":"Keine Vertragsbindung, monatlich kündbar, über 40 betreute Shops seit 2019"}';
    expect(parseOfferSuggestion(raw).proof).toContain("40 betreute Shops");
  });

  it("ignoriert unbekannte Schluessel und falsche Typen", () => {
    expect(parseOfferSuggestion('{"offering":"A","unsinn":"B","icp":42}')).toEqual({ offering: "A" });
  });

  it("liefert ein leeres Objekt statt zu werfen", () => {
    expect(parseOfferSuggestion("Das kann ich nicht.")).toEqual({});
    expect(parseOfferSuggestion("{kaputt")).toEqual({});
    expect(parseOfferSuggestion("[1,2]")).toEqual({});
  });
});
