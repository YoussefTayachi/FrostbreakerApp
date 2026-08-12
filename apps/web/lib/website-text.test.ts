import { describe, expect, it } from "vitest";
import {
  MIN_USEFUL_CHARS,
  extractWebsiteContent,
  hasEnoughContent,
  htmlToText,
  normalizeWebsiteUrl,
} from "./website-text";

describe("htmlToText", () => {
  it("wirft Skripte und Styles samt Inhalt weg", () => {
    const html = "<p>Sichtbar</p><script>var geheim = 1;</script><style>.a{color:red}</style>";
    const text = htmlToText(html);
    expect(text).toContain("Sichtbar");
    expect(text).not.toContain("geheim");
    expect(text).not.toContain("color:red");
  });

  it("wirft Navigation und Fussbereich weg, behaelt aber den Kopfbereich", () => {
    // Der Kopfbereich traegt bei Firmenseiten fast immer die Kernaussage --
    // genau das, wonach hier gesucht wird. Die Linklisten drumherum nicht.
    const html =
      "<nav><a>Start</a><a>Preise</a></nav>" +
      "<header><h1>Wir bauen Onlineshops für Tierfutter</h1></header>" +
      "<footer><a>Impressum</a></footer>";
    const text = htmlToText(html);
    expect(text).toContain("Onlineshops für Tierfutter");
    expect(text).not.toContain("Preise");
    expect(text).not.toContain("Impressum");
  });

  it("macht aus Blockelementen Zeilenumbrueche statt Wortsalat", () => {
    const text = htmlToText("<h1>Überschrift</h1><p>Erster Absatz</p><p>Zweiter Absatz</p>");
    expect(text).toBe("Überschrift\nErster Absatz\nZweiter Absatz");
  });

  it("loest die Entities auf, die in echtem Text vorkommen", () => {
    expect(htmlToText("<p>Gr&uuml;n &amp; g&#252;nstig &#x27;23</p>")).toBe("Grün & günstig '23");
  });

  it("dampft Leerraum ein und deckelt die Laenge", () => {
    expect(htmlToText("<p>a</p>\n\n\n\n<p>b</p>")).toBe("a\nb");
    expect(htmlToText("<p>" + "x".repeat(500) + "</p>", 100)).toHaveLength(100);
  });
});

describe("extractWebsiteContent", () => {
  const html =
    "<html><head><title>Katzenfutter Manufaktur | Bio aus Bayern</title>" +
    '<meta name="description" content="Getreidefreies Nassfutter, direkt vom Hersteller."></head>' +
    "<body><h1>Bio-Nassfutter</h1><p>Seit 2019 in Familienhand.</p></body></html>";

  it("liest Titel und Beschreibung getrennt vom Fliesstext", () => {
    const c = extractWebsiteContent(html);
    expect(c.title).toBe("Katzenfutter Manufaktur | Bio aus Bayern");
    expect(c.description).toBe("Getreidefreies Nassfutter, direkt vom Hersteller.");
    expect(c.text).toContain("Seit 2019 in Familienhand.");
  });

  it("nimmt og:description, wenn keine normale da ist", () => {
    const c = extractWebsiteContent('<meta property="og:description" content="Zweite Wahl">');
    expect(c.description).toBe("Zweite Wahl");
  });

  it("liefert null statt leerer Zeichenkette, wenn nichts da ist", () => {
    const c = extractWebsiteContent("<html><head><title>  </title></head><body></body></html>");
    expect(c.title).toBeNull();
    expect(c.description).toBeNull();
  });
});

describe("hasEnoughContent", () => {
  it("laesst eine leere JS-Seite nicht als gelesen durchgehen", () => {
    // Sonst gilt "Website ausgewertet" fuer eine Seite ohne Inhalt -- und das
    // Modell denkt sich die sieben Felder aus.
    expect(hasEnoughContent({ title: "Shop", description: null, text: "Bitte JavaScript aktivieren." })).toBe(false);
  });

  it("laesst eine Seite mit Inhalt durch", () => {
    expect(hasEnoughContent({ title: null, description: null, text: "y".repeat(MIN_USEFUL_CHARS) })).toBe(true);
  });
});

describe("normalizeWebsiteUrl", () => {
  it("ergaenzt das fehlende Schema -- niemand tippt https:// mit", () => {
    expect(normalizeWebsiteUrl("firma.de")).toBe("https://firma.de/");
    expect(normalizeWebsiteUrl("  www.firma.de/preise ")).toBe("https://www.firma.de/preise");
  });

  it("laesst vorhandene Schemata stehen", () => {
    expect(normalizeWebsiteUrl("http://firma.de")).toBe("http://firma.de/");
  });

  it("weist alles ab, was kein http(s) ist", () => {
    expect(normalizeWebsiteUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeWebsiteUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeWebsiteUrl("localhost")).toBeNull();
    expect(normalizeWebsiteUrl("")).toBeNull();
  });
});
