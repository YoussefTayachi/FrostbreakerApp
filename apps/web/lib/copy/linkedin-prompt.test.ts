import { describe, expect, it } from "vitest";
import { emptyOffer, type Offer } from "@/lib/offers";
import {
  LINKEDIN_MAX_CHARS,
  appendSignature,
  buildLinkedInPrompt,
  cleanLinkedInMessage,
  estimateLinkedInLength,
  freeStandingPersonalization,
  messageCorrection,
  messageProblems,
  signatureCost,
} from "./linkedin-prompt";
import { leadInBefore } from "./sequence-prompt";

const angebot: Offer = {
  ...emptyOffer("Retouren", "de"),
  id: "o1",
  is_default: true,
  offering: "Retourenberatung für Shopify-Shops",
  icp: "Tierfutter-Shops",
  problem: "Retouren fressen die Marge",
  friction: "Der Retourenschein liegt hinter dem Login",
  friction_reason: "Wer ihn nicht findet, schreibt den Support an",
  outcome: "4 Punkte weniger Retouren",
  mechanism: "Jede Retoure wird beim Eingang dem Grund zugeordnet",
  preview_asset: "Eine kurze Aufnahme eurer Retourenstrecke",
  review_time: "90 Sekunden",
  cta: "Soll ich dir die Aufnahme schicken?",
};

const SIGNATUR = "Beste Grüße\nYoussef";

/** Wortgrenze des Aufhaengers, wie sie der Workspace vorgibt. */
const WOERTER = 20;

/** Eine Nachricht mit genau `zeichen` eigenen Zeichen hinter den Platzhaltern. */
function nachricht(zeichen: number): string {
  return "Hi {{firstName}},\n\n{{personalization}}\n\n" + "x".repeat(zeichen);
}

/** Die Zahl, die der Prompt dem Modell als eigenen Spielraum nennt. */
function eigenBudget(prompt: string): number {
  const m = prompt.match(/HARD LIMIT: (\d+) characters/);
  if (!m) throw new Error("keine Zeichengrenze im Prompt");
  return Number(m[1]);
}

describe("buildLinkedInPrompt", () => {
  it("nennt nur den eigenen Spielraum, nicht die vollen 300", () => {
    // Live gemessen (2026-08-13): mit "300 INCLUDING the placeholders" kam eine
    // Nachricht heraus, die eingesetzt auf 341 Zeichen kam: die eigenen
    // Saetze waren kurz genug, die Platzhalter nahmen 148 vorweg, und die
    // rechnete das Modell nicht mit. Es kann nicht zaehlen, was es nicht sieht.
    const p = buildLinkedInPrompt(angebot, "", WOERTER);
    expect(p).toContain("characters OF YOUR OWN TEXT");
    expect(p).toContain(`LinkedIn allows ${LINKEDIN_MAX_CHARS}`);
    // Der Aufhaenger und die beiden Platzhalter sind abgezogen.
    expect(eigenBudget(p)).toBeLessThan(LINKEDIN_MAX_CHARS - WOERTER * 6);
    expect(p).toContain("Do NOT try to count the placeholders");
  });

  it("verbietet Betreff und Link", () => {
    const p = buildLinkedInPrompt(angebot, "", WOERTER);
    expect(p).toContain("No subject line");
    expect(p).toContain("No link, no URL");
  });

  it("laesst nur die drei LinkedIn-Platzhalter zu", () => {
    const p = buildLinkedInPrompt(angebot, "", WOERTER);
    expect(p).toContain("{{firstName}}");
    expect(p).toContain("{{personalization}}");
    // {{email}} gibt es auf LinkedIn nicht; er wuerde ungefuellt rausgehen.
    expect(p).not.toContain("{{email}}");
  });

  it("gibt die Anrede nur im Deutschen vor", () => {
    expect(buildLinkedInPrompt({ ...angebot, address_form: "sie" }, "", WOERTER)).toContain('formally ("Sie")');
    expect(buildLinkedInPrompt({ ...angebot, language: "en" }, "", WOERTER)).not.toContain('"Sie"');
  });

  it("verbietet die Unterschrift, solange keine hinterlegt ist", () => {
    const p = buildLinkedInPrompt(angebot, "", WOERTER);
    expect(p).toContain("No subject line. No signature.");
    expect(p).toContain("never invent one");
  });

  it("zieht die hinterlegte Signatur vom Zeichenbudget ab", () => {
    // Gemeldet 2026-08-13: die Signatur fehlte in der erzeugten Vorlage, weil
    // der Prompt sie ausdruecklich verbot. Jetzt wird sie angehaengt, und das
    // Modell muss wissen, wie wenig Platz ihm dann bleibt.
    const ohne = buildLinkedInPrompt(angebot, "", WOERTER);
    const p = buildLinkedInPrompt(angebot, SIGNATUR, WOERTER);
    expect(eigenBudget(ohne) - eigenBudget(p)).toBe(signatureCost(SIGNATUR));
    expect(p).toContain("is added under your text automatically");
    expect(p).toContain("do not type it");
    expect(p).not.toContain("No signature.");
  });

  it("zaehlt die Leerzeile ueber der Signatur mit", () => {
    expect(signatureCost(SIGNATUR)).toBe(SIGNATUR.length + 2);
    expect(signatureCost("   ")).toBe(0);
  });
});

describe("appendSignature", () => {
  it("setzt die Signatur mit Leerzeile darunter", () => {
    expect(appendSignature("Hi {{firstName}},\n\nSchicke ich sie dir?", SIGNATUR)).toBe(
      "Hi {{firstName}},\n\nSchicke ich sie dir?\n\n" + SIGNATUR
    );
  });

  it("haengt ohne hinterlegte Signatur NICHTS an", () => {
    // Der ganze Sinn von Migration 0091: lieber ohne Unterschrift als mit
    // einem erfundenen Namen.
    expect(appendSignature("Schicke ich sie dir?", "")).toBe("Schicke ich sie dir?");
    expect(appendSignature("Schicke ich sie dir?", "  \n ")).toBe("Schicke ich sie dir?");
  });

  it("unterschreibt nicht zweimal, wenn das Modell es doch getan hat", () => {
    const selbst = "Schicke ich sie dir?\n\nBeste Grüße\nYoussef";
    expect(appendSignature(selbst, SIGNATUR)).toBe(selbst);
    // Auch mit anderer Zeichensetzung: entscheidend ist der Name am Ende.
    const anders = "Schicke ich sie dir?\n\nViele Grüße,\nYoussef!";
    expect(appendSignature(anders, SIGNATUR)).toBe(anders);
  });

  it("laesst einen Namen mitten im Text unberuehrt", () => {
    const text = "Hi {{firstName}},\n\nYoussef hier, ich baue Software.\n\nSchicke ich sie dir?";
    expect(appendSignature(text, SIGNATUR)).toBe(text + "\n\n" + SIGNATUR);
  });
});

describe("messageProblems mit Signatur", () => {
  it("zaehlt die Signatur in der Zeichengrenze mit", () => {
    // 136 Zeichen entfallen auf Anrede und Aufhaenger, 150 auf den eigenen
    // Satz: ohne Signatur passt das, mit den 21 Zeichen darunter nicht mehr.
    const text = nachricht(150);
    expect(messageProblems(text, WOERTER)).toEqual([]);
    expect(messageProblems(text, WOERTER, SIGNATUR)).toEqual([
      {
        kind: "tooLong",
        length: 286 + signatureCost(SIGNATUR),
        max: LINKEDIN_MAX_CHARS,
        withSignature: true,
      },
    ]);
  });

  it("sagt in der Korrektur, dass die Signatur nicht gekuerzt wird", () => {
    const mit = messageCorrection(messageProblems(nachricht(150), WOERTER, SIGNATUR));
    expect(mit).toContain("the signature added under your text are fixed");
    const ohne = messageCorrection(messageProblems(nachricht(200), WOERTER));
    expect(ohne).toContain("not the placeholders");
  });

  it("prueft die Absaetze am Text des Modells, nicht an der Signatur", () => {
    // Sonst ginge ein einziger Block als "hat Absaetze" durch, nur weil unten
    // eine Signatur klebt.
    const block = "Hi {{firstName}}, {{personalization}} Schicke ich sie dir?";
    expect(messageProblems(block, WOERTER, SIGNATUR)).toContainEqual({ kind: "noParagraphs" });
  });
});

describe("der Aufhänger steht für sich", () => {
  // Der gemeldete Fall vom 2026-08-12. Aus
  // "Hi {{firstName}}, {{personalization}}. Managing..." wurde beim Versand
  // "Hi Brian, Helping over 30,000 people ... reaching out.. Managing...":
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
