import { describe, expect, it } from "vitest";
import { emptyOffer, type Offer } from "@/lib/offers";
import { buildCoachPrompt, parseCoachFindings } from "./coach-prompt";

const angebot: Offer = {
  ...emptyOffer("Test", "de"),
  id: "o1",
  is_default: true,
  offering: "Retourenberatung für Shopify-Shops",
  icp: "Tierfutter-Shops",
  problem: "Retouren fressen die Marge",
  friction: "Der Retourenschein liegt hinter dem Login",
  outcome: "Ein Kunde kam von 6 auf 17 Termine",
  proof: "Wir sind unser eigener Beweis.",
  cta: "Sollen wir telefonieren?",
};

describe("buildCoachPrompt", () => {
  it("stellt jedes Feld mit seinem Zweck daneben", () => {
    const p = buildCoachPrompt(angebot);
    expect(p).toContain("Der Retourenschein liegt hinter dem Login");
    expect(p).toContain("ONE binary yes/no question");
    expect(p).toContain("A meeting is not a thing that gets sent");
  });

  it("markiert leere Felder als leer statt sie wegzulassen", () => {
    // Weglassen hiesse, das Modell muesste aus der Abwesenheit schliessen --
    // und es schliesst dann meistens, dass es sich das Feld ausdenken soll.
    expect(buildCoachPrompt(angebot)).toContain("mechanism: (empty)");
  });

  it("verlangt Schweigen als gueltige Antwort", () => {
    const p = buildCoachPrompt(angebot);
    expect(p).toContain("An empty array [] is a valid answer");
    expect(p).toContain("SAY NOTHING about a field that does its job");
  });

  it("verbietet das Erfinden von Zahlen im Gegenvorschlag", () => {
    expect(buildCoachPrompt(angebot)).toContain("Never invent a number");
  });

  it("nennt die Sprache des Angebots fuer Urteil und Vorschlag", () => {
    expect(buildCoachPrompt(angebot)).toContain("one plain sentence in German");
    expect(buildCoachPrompt({ ...angebot, language: "en" })).toContain("one plain sentence in English");
  });
});

describe("parseCoachFindings", () => {
  it("liest einen Befund samt Verweis auf das zweite Feld", () => {
    const raw = `Hier:\n\`\`\`json
[{"field":"outcome","severity":"blocker","verdict":"Das ist ein Beleg.","proposal":"Mehr Termine je Monat.","relatedField":"proof"}]
\`\`\``;
    expect(parseCoachFindings(raw, angebot)).toEqual([
      {
        field: "outcome",
        severity: "blocker",
        verdict: "Das ist ein Beleg.",
        proposal: "Mehr Termine je Monat.",
        relatedField: "proof",
      },
    ]);
  });

  it("wirft einen Befund ohne Gegenvorschlag weg", () => {
    // "Das ist zu vage" ohne besseren Satz daneben ist eine Hausaufgabe,
    // keine Hilfe.
    const raw = '[{"field":"icp","severity":"weak","verdict":"Zu breit."}]';
    expect(parseCoachFindings(raw, angebot)).toEqual([]);
  });

  it("meldet nichts an einem leeren Feld", () => {
    const raw = '[{"field":"mechanism","severity":"weak","verdict":"Fehlt.","proposal":"Trag was ein."}]';
    expect(parseCoachFindings(raw, angebot)).toEqual([]);
  });

  it("nimmt je Feld nur den ersten Befund", () => {
    const raw =
      '[{"field":"cta","severity":"blocker","verdict":"A","proposal":"a"},' +
      '{"field":"cta","severity":"weak","verdict":"B","proposal":"b"}]';
    expect(parseCoachFindings(raw, angebot)).toHaveLength(1);
  });

  it("ignoriert erfundene Feldnamen", () => {
    const raw = '[{"field":"pricing","severity":"weak","verdict":"X","proposal":"y"}]';
    expect(parseCoachFindings(raw, angebot)).toEqual([]);
  });

  it("laesst einen Verweis auf sich selbst fallen", () => {
    const raw = '[{"field":"cta","severity":"weak","verdict":"X","proposal":"y","relatedField":"cta"}]';
    expect(parseCoachFindings(raw, angebot)[0].relatedField).toBeUndefined();
  });

  it("haelt hoechstens fuenf Befunde", () => {
    const eins = (f: string) => `{"field":"${f}","severity":"weak","verdict":"v","proposal":"p"}`;
    const raw = "[" + ["offering", "icp", "problem", "friction", "outcome", "proof"].map(eins).join(",") + "]";
    expect(parseCoachFindings(raw, angebot)).toHaveLength(5);
  });

  it("liefert eine leere Liste statt zu werfen", () => {
    expect(parseCoachFindings("Da ist alles in Ordnung.", angebot)).toEqual([]);
    expect(parseCoachFindings("[kaputt", angebot)).toEqual([]);
  });
});
