import { describe, expect, it } from "vitest";
import {
  MAX_PRODUCTS,
  PRODUCT_DESC_MAX,
  PRODUCT_NAME_MAX,
  buildProductDetectPrompt,
  cleanProduct,
  parseProductDetection,
} from "./offer-products";

/** Der Fall des Gruenders: zwei Apps aus einem Betrieb. */
const ZWEI_PRODUKTE =
  "Wir betreiben Chatarmin, eine App fuer WhatsApp-Marketing, und Armincx, eine App, " +
  "die den Kundensupport automatisiert.";

/** Der gefaehrliche Gegenfall: EIN Produkt, mit fuenf Vorteilen beschrieben. */
const EIN_PRODUKT_VIELE_VORTEILE =
  "Wir senken Retourenquoten in Onlineshops: Analyse des Bestellwegs, Umbau der " +
  "Produktseiten, automatische Groessenberatung, monatliches Reporting und ein " +
  "Onboarding fuer das Team.";

describe("buildProductDetectPrompt", () => {
  it("gibt das Angebotsfeld mit", () => {
    expect(buildProductDetectPrompt(ZWEI_PRODUKTE, "", "de")).toContain("Chatarmin");
  });

  it("nennt die Zielgruppe als Hintergrund und verbietet sie als Trenngrund", () => {
    const p = buildProductDetectPrompt(ZWEI_PRODUKTE, "Onlineshops und Agenturen", "de");
    expect(p).toContain("Onlineshops und Agenturen");
    expect(p).toContain("never a reason to split");
    // Zwei Branchen sind zwei Listen, nicht zwei Produkte -- genau dafuer gibt
    // es den Listen-Zuschnitt.
    expect(p).toContain("Selling the same thing to two audiences or industries is NOT two products");
  });

  it("laesst den Zielgruppenblock weg, wenn das Feld leer ist", () => {
    expect(buildProductDetectPrompt(ZWEI_PRODUKTE, "  ", "de")).not.toContain("WHO THEY SELL TO");
  });

  it("verbietet das Zerlegen einer Feature-Aufzaehlung", () => {
    // Der wichtigste Satz des Prompts: ein gut ausgefuelltes Feld zaehlt fast
    // immer mehrere Vorteile auf.
    const p = buildProductDetectPrompt(EIN_PRODUKT_VIELE_VORTEILE, "", "de");
    expect(p).toContain("are NOT several");
    expect(p).toContain("If you are unsure, answer with one");
  });

  it("verbietet erfundene Namen und eigenes Branchenwissen", () => {
    const p = buildProductDetectPrompt(ZWEI_PRODUKTE, "", "de");
    expect(p).toContain("Never invent a name");
    expect(p).toContain("Never add knowledge of your own");
  });

  it("gibt die Ausgabesprache aus dem Angebot vor", () => {
    expect(buildProductDetectPrompt(ZWEI_PRODUKTE, "", "de")).toContain(
      "Write the descriptions in German"
    );
    expect(buildProductDetectPrompt(ZWEI_PRODUKTE, "", "en")).toContain(
      "Write the descriptions in English"
    );
  });
});

describe("parseProductDetection", () => {
  it("liest zwei benannte Produkte, auch aus einem Codeblock", () => {
    const raw =
      '```json\n{"multiple":true,"products":[' +
      '{"name":"Chatarmin","description":"WhatsApp-Marketing fuer Shops"},' +
      '{"name":"Armincx","description":"Automatisiert den Kundensupport"}]}\n```';
    expect(parseProductDetection(raw)).toEqual([
      { name: "Chatarmin", description: "WhatsApp-Marketing fuer Shops" },
      { name: "Armincx", description: "Automatisiert den Kundensupport" },
    ]);
  });

  it("meldet ein einzelnes Produkt als eindeutig", () => {
    expect(parseProductDetection('{"multiple":false,"products":[]}')).toEqual([]);
  });

  it("ignoriert Produkte, wenn das Modell selbst 'eindeutig' sagt", () => {
    // Kommt vor: das Modell fuellt die Beispielstruktur aus, obwohl es sich
    // gerade fuer EINE Sache entschieden hat.
    const raw =
      '{"multiple":false,"products":[{"name":"Retourenheld","description":"Senkt Retouren"}]}';
    expect(parseProductDetection(raw)).toEqual([]);
  });

  it("gilt erst ab zwei -- eine 'Mehrfachantwort' mit einem Eintrag ist keine", () => {
    // Der wichtigste Fehlalarm: EIN Produkt mit vielen Vorteilen. Antwortet das
    // Modell trotzdem mit multiple, aber nur einem Eintrag, hat es die Frage
    // nicht beantwortet, sondern das Feld wiederholt -- den Nutzer dafuer zu
    // fragen waere eine Auswahl ohne Wahl.
    const raw =
      '{"multiple":true,"products":[{"name":"Retourensenkung","description":"Analyse, Umbau, Reporting"}]}';
    expect(parseProductDetection(raw)).toEqual([]);
  });

  it("wirft Ausreden als Namen weg -- und damit die ganze Teilung, wenn nur einer bleibt", () => {
    const raw =
      '{"multiple":true,"products":[{"name":"Chatarmin","description":"WhatsApp"},' +
      '{"name":"nicht angegeben","description":"unbekannt"}]}';
    expect(parseProductDetection(raw)).toEqual([]);
  });

  it("laesst eine leere Beschreibung stehen statt eine Ausrede zu uebernehmen", () => {
    const raw =
      '{"multiple":true,"products":[{"name":"Chatarmin","description":"n/a"},' +
      '{"name":"Armincx","description":"Support"}]}';
    expect(parseProductDetection(raw)).toEqual([
      { name: "Chatarmin", description: "" },
      { name: "Armincx", description: "Support" },
    ]);
  });

  it("nimmt denselben Namen nur einmal", () => {
    const raw =
      '{"multiple":true,"products":[{"name":"Chatarmin","description":"A"},' +
      '{"name":"chatarmin","description":"B"}]}';
    expect(parseProductDetection(raw)).toEqual([]);
  });

  it("deckelt Anzahl und Laenge", () => {
    const viele = Array.from({ length: MAX_PRODUCTS + 3 }, (_, i) => ({
      name: `Produkt ${i} ${"x".repeat(PRODUCT_NAME_MAX)}`,
      description: "y".repeat(PRODUCT_DESC_MAX + 40),
    }));
    const out = parseProductDetection(JSON.stringify({ multiple: true, products: viele }));
    expect(out).toHaveLength(MAX_PRODUCTS);
    expect(out[0].name).toHaveLength(PRODUCT_NAME_MAX);
    expect(out[0].description).toHaveLength(PRODUCT_DESC_MAX);
  });

  it("liefert eine leere Liste statt zu werfen", () => {
    expect(parseProductDetection("Das ist eine Sache.")).toEqual([]);
    expect(parseProductDetection("{kaputt")).toEqual([]);
    expect(parseProductDetection('{"multiple":true}')).toEqual([]);
    expect(parseProductDetection('{"multiple":true,"products":"Chatarmin, Armincx"}')).toEqual([]);
    expect(parseProductDetection('{"multiple":true,"products":["Chatarmin","Armincx"]}')).toEqual(
      []
    );
  });
});

describe("cleanProduct", () => {
  it("nimmt den Freitext des Nutzers an", () => {
    expect(cleanProduct({ name: "  Armincx  " })).toEqual({ name: "Armincx", description: "" });
  });

  it("weist alles ohne Namen ab -- ohne Namen gibt es nichts einzugrenzen", () => {
    expect(cleanProduct(null)).toBeNull();
    expect(cleanProduct("Armincx")).toBeNull();
    expect(cleanProduct({ description: "Support" })).toBeNull();
    expect(cleanProduct({ name: "   " })).toBeNull();
  });

  it("deckelt die Laengen wie die Erkennung", () => {
    const p = cleanProduct({
      name: "x".repeat(PRODUCT_NAME_MAX + 20),
      description: "y".repeat(PRODUCT_DESC_MAX + 20),
    });
    expect(p?.name).toHaveLength(PRODUCT_NAME_MAX);
    expect(p?.description).toHaveLength(PRODUCT_DESC_MAX);
  });
});
