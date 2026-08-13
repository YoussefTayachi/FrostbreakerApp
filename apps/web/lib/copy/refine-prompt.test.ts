import { describe, expect, it } from "vitest";
import type { Offer } from "@/lib/offers";
import { MAX_INSTRUCTION_CHARS, buildRefinePrompt, parseVariant } from "./refine-prompt";
import {
  LINKEDIN_MAX_CHARS,
  buildLinkedInPrompt,
  cleanLinkedInMessage,
  estimateLinkedInLength,
  freeStandingPersonalization,
  messageProblems,
} from "./linkedin-prompt";
import { leadInBefore } from "./sequence-prompt";

const angebot: Offer = {
  id: "o1",
  name: "Retouren",
  offering: "Retourenberatung für Shopify-Shops",
  icp: "Tierfutter-Shops",
  problem: "Retouren fressen die Marge",
  friction: "Der Retourenschein liegt hinter dem Login",
  friction_reason: "Wer ihn nicht findet, schreibt den Support an",
  outcome: "4 Punkte weniger Retouren",
  mechanism: "Jede Retoure wird beim Eingang dem Grund zugeordnet",
  proof: "",
  preview_asset: "",
  review_time: "",
  cta: "Kurze Rückfrage",
  tone: "",
  address_form: "du",
  language: "de",
  website: null,
  signature: "",
  is_default: true,
};

const fassung = { subject: "kurze frage", body: "{{personalization}}\nLohnt sich ein Blick auf eure Retouren?" };
const opts = { stepNumber: 1, personalizationWords: 22, calendarLink: null, senderName: null };

describe("buildRefinePrompt", () => {
  it("gibt die aktuelle Fassung und die Anweisung mit", () => {
    const p = buildRefinePrompt(angebot, fassung, "mach es direkter", opts);
    expect(p).toContain("mach es direkter");
    expect(p).toContain("Lohnt sich ein Blick auf eure Retouren?");
    expect(p).toContain("kurze frage");
  });

  it("haelt das Modell davon ab, alles umzuschreiben", () => {
    // Sonst kommt bei "kuerzer" eine voellig andere Mail zurueck und die
    // bisherige Arbeit am Text ist weg.
    expect(buildRefinePrompt(angebot, fassung, "kürzer", opts)).toContain(
      "Everything the instruction does not mention stays as it is"
    );
  });

  it("verbietet ohne Belege ausdruecklich das Ergaenzen von Zahlen", () => {
    // Beim Nachschaerfen ist die Gefahr groesser als beim Erzeugen:
    // "überzeugender" liest ein Modell als Einladung, Zahlen zu erfinden.
    expect(buildRefinePrompt(angebot, fassung, "überzeugender", opts)).toContain("They have NO proof");
  });

  it("legt der ersten Stufe die Grenzen des Torwarts auf", () => {
    const p = buildRefinePrompt(angebot, fassung, "kürzer", opts);
    expect(p).toContain("{{personalization}} as the first line");
    expect(p).toContain("No link and no URL");
  });

  it("laesst Folgestufen den Terminlink benutzen", () => {
    const p = buildRefinePrompt(angebot, fassung, "termin anbieten", {
      ...opts,
      stepNumber: 3,
      calendarLink: "https://cal.com/y",
    });
    expect(p).toContain("https://cal.com/y");
    expect(p).not.toContain("No link and no URL");
  });

  it("deckelt eine ausufernde Anweisung", () => {
    const p = buildRefinePrompt(angebot, fassung, "x".repeat(1000), opts);
    expect(p).toContain("x".repeat(MAX_INSTRUCTION_CHARS));
    expect(p).not.toContain("x".repeat(MAX_INSTRUCTION_CHARS + 1));
  });
});

describe("parseVariant", () => {
  it("liest Betreff und Text", () => {
    expect(parseVariant('{"subject":"neu","body":"Neuer Text"}', fassung)).toEqual({
      subject: "neu",
      body: "Neuer Text",
    });
  });

  it("behaelt den alten Betreff, wenn nur der Text kam", () => {
    // Bei "mach den Text kuerzer" liefert das Modell manchmal nur den Text.
    // Die Antwort deswegen zu verwerfen waere die schlechtere Antwort.
    expect(parseVariant('{"body":"Kürzer."}', fassung)?.subject).toBe("kurze frage");
  });

  it("verwirft eine Antwort ohne Text", () => {
    expect(parseVariant('{"subject":"nur betreff"}', fassung)).toBeNull();
    expect(parseVariant("Tut mir leid.", fassung)).toBeNull();
  });
});

describe("buildLinkedInPrompt", () => {
  it("nennt die Zeichengrenze als harte Vorgabe", () => {
    expect(buildLinkedInPrompt(angebot)).toContain(`HARD LIMIT: ${LINKEDIN_MAX_CHARS} characters`);
  });

  it("verbietet Betreff, Link und Unterschrift", () => {
    const p = buildLinkedInPrompt(angebot);
    expect(p).toContain("No subject line");
    expect(p).toContain("No link, no URL");
  });

  it("laesst nur die drei LinkedIn-Platzhalter zu", () => {
    const p = buildLinkedInPrompt(angebot);
    expect(p).toContain("{{firstName}}");
    expect(p).toContain("{{personalization}}");
    // {{email}} gibt es auf LinkedIn nicht -- er wuerde ungefuellt rausgehen.
    expect(p).not.toContain("{{email}}");
  });

  it("gibt die Anrede nur im Deutschen vor", () => {
    expect(buildLinkedInPrompt({ ...angebot, address_form: "sie" })).toContain('formally ("Sie")');
    expect(buildLinkedInPrompt({ ...angebot, language: "en" })).not.toContain('"Sie"');
  });
});

describe("der Aufhänger steht für sich", () => {
  // Der gemeldete Fall vom 2026-08-12. Aus
  // "Hi {{firstName}}, {{personalization}}. Managing..." wurde beim Versand
  // "Hi Brian, Helping over 30,000 people ... reaching out.. Managing..." --
  // Grossbuchstabe nach Komma, zwei Punkte, alles eine graue Wand.
  const gemeldet = "Hi {{firstName}}, {{personalization}}. Managing multi-client outreach can be complex.";

  it("stellt den Platzhalter frei und schluckt den Punkt dahinter", () => {
    expect(freeStandingPersonalization(gemeldet)).toBe(
      "Hi {{firstName}},\n\n{{personalization}}\n\nManaging multi-client outreach can be complex."
    );
  });

  it("laesst eine bereits richtige Nachricht unangetastet", () => {
    const gut = "Hi {{firstName}},\n\n{{personalization}}\n\nPasst das?";
    expect(freeStandingPersonalization(gut)).toBe(gut);
  });

  it("kommt ohne Platzhalter klar", () => {
    expect(freeStandingPersonalization("Hi, kurze Frage.")).toBe("Hi, kurze Frage.");
  });

  it("meldet eine Einleitung vor dem Aufhaenger", () => {
    // "noticed" davor zu schreiben ist genau der Fehler: der Aufhaenger
    // beginnt gross und braucht keine Ueberleitung.
    const mit = freeStandingPersonalization("Hi {{firstName}}, I noticed {{personalization}} Passt das?");
    expect(messageProblems(mit, 22)).toContainEqual({ kind: "personalizationLeadIn", text: "I noticed" });
  });

  it("haelt die blosse Anrede NICHT fuer eine Einleitung", () => {
    const gut = "Hi {{firstName}},\n\n{{personalization}}\n\nPasst das?";
    expect(messageProblems(gut, 22).some((p) => p.kind === "personalizationLeadIn")).toBe(false);
  });

  it("meldet eine Nachricht ohne Absaetze", () => {
    expect(messageProblems("Hi {{firstName}}, passt das?", 22)).toContainEqual({ kind: "noParagraphs" });
  });

  it("meldet dieselbe Einleitung auch in der Mail-Sequenz", () => {
    expect(leadInBefore("Hi {{firstName}}, I noticed {{personalization}}")).toBe("I noticed");
    expect(leadInBefore("Hi {{firstName}},\n\n{{personalization}}")).toBeNull();
    expect(leadInBefore("Kein Platzhalter hier")).toBeNull();
  });
});

describe("cleanLinkedInMessage", () => {
  it("entfernt Anfuehrungszeichen und Vorspann", () => {
    expect(cleanLinkedInMessage('Nachricht: "Hi {{firstName}}, kurze Frage."')).toBe(
      "Hi {{firstName}}, kurze Frage."
    );
    expect(cleanLinkedInMessage("„Hi du.“")).toBe("Hi du.");
  });

  it("laesst einen sauberen Text unangetastet", () => {
    expect(cleanLinkedInMessage("Hi {{firstName}}, passt das?")).toBe("Hi {{firstName}}, passt das?");
  });
});

describe("estimateLinkedInLength", () => {
  it("rechnet den Aufhaenger mit seiner spaeteren Laenge, nicht mit der des Platzhalters", () => {
    // Sonst gilt eine Nachricht als kurz, die beim Versand abgeschnitten wird:
    // der Platzhalter hat 19 Zeichen, der eingesetzte Aufhaenger rund 130.
    const text = "{{personalization}} Passt das?";
    expect(estimateLinkedInLength(text, 22)).toBeGreaterThan(text.length + 100);
  });

  it("erkennt eine Nachricht als zu lang, die mit Platzhalter noch passt", () => {
    const text = "{{personalization}} " + "wort ".repeat(35);
    expect(text.length).toBeLessThan(LINKEDIN_MAX_CHARS);
    expect(estimateLinkedInLength(text, 22)).toBeGreaterThan(LINKEDIN_MAX_CHARS);
  });

  it("zaehlt normale Platzhalter mit etwa einem Wort", () => {
    expect(estimateLinkedInLength("Hi {{firstName}}!", 22)).toBe("Hi xxxxxxxx!".length);
  });
});
