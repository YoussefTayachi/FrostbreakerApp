import { describe, expect, it } from "vitest";
import type { WebsiteContent } from "@/lib/website-text";
import {
  MAX_PRODUCTS,
  PRODUCT_DESC_MAX,
  PRODUCT_NAME_MAX,
  buildProductDetectPrompt,
  cleanProduct,
  hasProductMaterial,
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

/** Das Feld "was verkaufst du" als Quelle — der Weg von Aim. */
const feld = (offering: string, icp = "") => ({ kind: "offering" as const, offering, icp });

/** Eine Seite als Quelle — der Weg von Core. */
const seite = (text: string, title: string | null = null, description: string | null = null) => ({
  kind: "website" as const,
  content: { title, description, text } satisfies WebsiteContent,
});

/** Dieselben zwei Apps, aber so, wie sie auf einer Startseite stehen --
 *  einschliesslich der fremden Namen, die keine eigenen Produkte sind. */
const WEBSITE_ZWEI_PRODUKTE =
  "Chatarmin ist die WhatsApp-Marketing-App fuer Shopify-Shops. Newsletter, " +
  "Automationen, Rueckgewinnung.\n" +
  "Armincx automatisiert den Kundensupport: Anfragen werden gelesen, sortiert und " +
  "beantwortet.\n" +
  "Integrationen: Shopify, Klaviyo, Zendesk. Vertrauen uns: Snocks, waterdrop.";

/** Eine Seite zu EINEM Produkt, wie sie wirklich aussieht: fuenf Abschnitte,
 *  die alle dasselbe verkaufen. */
const WEBSITE_EIN_PRODUKT =
  "Weniger Retouren in deinem Onlineshop.\n" +
  "Analyse des Bestellwegs. Umbau der Produktseiten. Automatische Groessenberatung.\n" +
  "Monatliches Reporting. Onboarding fuer dein Team.\n" +
  "Pakete: Start, Wachstum, Enterprise.";

describe("buildProductDetectPrompt", () => {
  it("gibt das Angebotsfeld mit", () => {
    expect(buildProductDetectPrompt(feld(ZWEI_PRODUKTE), "de")).toContain("Chatarmin");
  });

  it("nennt die Zielgruppe als Hintergrund und verbietet sie als Trenngrund", () => {
    const p = buildProductDetectPrompt(feld(ZWEI_PRODUKTE, "Onlineshops und Agenturen"), "de");
    expect(p).toContain("Onlineshops und Agenturen");
    expect(p).toContain("never a reason to split");
    // Zwei Branchen sind zwei Listen, nicht zwei Produkte — genau dafuer gibt
    // es den Listen-Zuschnitt.
    expect(p).toContain("Selling the same thing to two audiences or industries is NOT two products");
  });

  it("laesst den Zielgruppenblock weg, wenn das Feld leer ist", () => {
    expect(buildProductDetectPrompt(feld(ZWEI_PRODUKTE, "  "), "de")).not.toContain(
      "WHO THEY SELL TO"
    );
  });

  it("verbietet das Zerlegen einer Feature-Aufzaehlung", () => {
    // Der wichtigste Satz des Prompts: ein gut ausgefuelltes Feld zaehlt fast
    // immer mehrere Vorteile auf.
    const p = buildProductDetectPrompt(feld(EIN_PRODUKT_VIELE_VORTEILE), "de");
    expect(p).toContain("are NOT several");
    expect(p).toContain("If you are unsure, answer with one");
  });

  it("verbietet erfundene Namen und eigenes Branchenwissen", () => {
    const p = buildProductDetectPrompt(feld(ZWEI_PRODUKTE), "de");
    expect(p).toContain("Never invent a name");
    expect(p).toContain("Never add knowledge of your own");
  });

  it("gibt die Ausgabesprache aus dem Angebot vor", () => {
    expect(buildProductDetectPrompt(feld(ZWEI_PRODUKTE), "de")).toContain(
      "Write the descriptions in German"
    );
    expect(buildProductDetectPrompt(feld(ZWEI_PRODUKTE), "en")).toContain(
      "Write the descriptions in English"
    );
  });
});

describe("buildProductDetectPrompt (Website)", () => {
  it("gibt Titel, Beschreibung und Seitentext mit", () => {
    const p = buildProductDetectPrompt(
      seite(WEBSITE_ZWEI_PRODUKTE, "Chatarmin", "WhatsApp-Marketing und Support"),
      "de"
    );
    expect(p).toContain("THE PAGE:");
    expect(p).toContain("Title: Chatarmin");
    expect(p).toContain("Description: WhatsApp-Marketing und Support");
    expect(p).toContain("Armincx");
    // Das Angebotsfeld gibt es an dieser Stelle noch gar nicht — seine
    // Ueberschrift darf also auch nicht im Prompt stehen.
    expect(p).not.toContain("WHAT THEY SELL:");
    expect(p).not.toContain("WHO THEY SELL TO");
  });

  it("laesst Titel und Beschreibung weg, wenn die Seite keine hat", () => {
    const p = buildProductDetectPrompt(seite(WEBSITE_ZWEI_PRODUKTE), "de");
    expect(p).not.toContain("Title:");
    expect(p).not.toContain("Description:");
  });

  it("beurteilt nach denselben Regeln wie das Angebotsfeld", () => {
    // Eine Seite zu EINEM Produkt zaehlt immer mehrere Bausteine und Pakete
    // auf. Der Satz, der genau das vom zweiten Produkt trennt, muss auch auf
    // diesem Weg im Prompt stehen — sonst zerlegt das Modell jede Startseite.
    const p = buildProductDetectPrompt(seite(WEBSITE_EIN_PRODUKT), "de");
    expect(p).toContain("are NOT several");
    expect(p).toContain("If you are unsure, answer with one");
    expect(p).toContain("Never invent a name");
    expect(p).toContain("Never add knowledge of your own");
    expect(p).toContain("Write the descriptions in German");
  });

  it("verbietet fremde Namen als eigene Produkte", () => {
    // Der Fehlalarm, den es nur auf einer Website gibt: Shopify, Klaviyo und
    // die Kundenlogos stehen dort so gross wie das eigene Produkt.
    const p = buildProductDetectPrompt(seite(WEBSITE_ZWEI_PRODUKTE), "de");
    expect(p).toContain("Only things this company sells THEMSELVES");
    expect(p).toContain("Ignore blog posts, job ads, legal text and cookie notices");
  });

  it("liest die Antwort zur Seite mit derselben Funktion", () => {
    // Die Antwortform ist quellenunabhaengig — ausdruecklich geprueft, weil
    // sonst irgendwann jemand fuer die Website eine zweite Auswertung baut.
    const zwei =
      '{"multiple":true,"products":[{"name":"Chatarmin","description":"WhatsApp-Marketing fuer Shops"},' +
      '{"name":"Armincx","description":"Automatisiert den Kundensupport"}]}';
    expect(parseProductDetection(zwei)).toEqual([
      { name: "Chatarmin", description: "WhatsApp-Marketing fuer Shops" },
      { name: "Armincx", description: "Automatisiert den Kundensupport" },
    ]);
    // Die Seite zu EINEM Produkt: viele Bausteine, trotzdem keine Frage an
    // den Nutzer.
    expect(parseProductDetection('{"multiple":false,"products":[]}')).toEqual([]);
  });

  it("stellt diese beiden Regeln nur der Website", () => {
    // Im Freitextfeld gibt es weder Integrationslogos noch Blogtitel. Zwei
    // Regeln ohne Gegenstand kosten dort nur Aufmerksamkeit des Modells.
    const p = buildProductDetectPrompt(feld(ZWEI_PRODUKTE), "de");
    expect(p).not.toContain("Only things this company sells THEMSELVES");
    expect(p).not.toContain("Ignore blog posts");
  });
});

describe("hasProductMaterial", () => {
  it("erkennt beide Quellen als brauchbar", () => {
    expect(hasProductMaterial(feld(ZWEI_PRODUKTE))).toBe(true);
    expect(hasProductMaterial(seite(WEBSITE_ZWEI_PRODUKTE))).toBe(true);
  });

  it("haelt ein leeres Feld fuer eindeutig -- ohne bezahlten Aufruf", () => {
    expect(hasProductMaterial(feld("   "))).toBe(false);
  });

  it("haelt eine leere oder unlesbare Seite fuer eindeutig", () => {
    // Der haeufigste Fall dahinter: eine Seite, die ihren Inhalt erst im
    // Browser per JavaScript aufbaut. Es gibt dann nichts zu unterscheiden,
    // und der Hauptaufruf meldet das Problem gleich danach selbst.
    expect(hasProductMaterial(seite(""))).toBe(false);
    expect(hasProductMaterial(seite("Cookies akzeptieren"))).toBe(false);
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
    // nicht beantwortet, sondern das Feld wiederholt — den Nutzer dafuer zu
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
