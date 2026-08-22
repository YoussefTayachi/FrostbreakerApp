import { describe, expect, it } from "vitest";
import type { Offer } from "@/lib/offers";
import { MAX_INSTRUCTION_CHARS, buildRefinePrompt, parseVariant } from "./refine-prompt";

// Die LinkedIn-Vorlage hat mit dem Nachschaerfen nichts zu tun und wird seit
// 2026-08-13 in linkedin-prompt.test.ts geprueft: dort, wo sie hingehoert.

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
  custom_fields: {},
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
