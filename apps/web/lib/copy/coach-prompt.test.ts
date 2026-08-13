import { describe, expect, it } from "vitest";
import { emptyOffer, type Offer } from "@/lib/offers";
import { buildCoachPrompt, parseCoachFindings } from "./coach-prompt";
import { MICRO_YES_MAX_WORDS } from "./playbook";

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
  preview_asset: "Ein Beispiel-Retourenschein für ihren Shop",
  review_time: "5 Minuten",
  cta: "Sollen wir telefonieren?",
};

/** Der gemeldete Fall vom 2026-08-13: elf von zwoelf Feldern gefuellt, leer ist
 *  ausgerechnet das Pflichtfeld cta. */
const ohneCta: Offer = { ...angebot, cta: "" };

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

  it("verlangt zu einem leeren Pflichtfeld einen fertigen Satz", () => {
    // Der gemeldete Fehler: zu cta stand nur "leere Felder meldest du nicht",
    // also konnte der Coach zum einzigen offenen Pflichtfeld nie etwas sagen.
    const p = buildCoachPrompt(ohneCta);
    expect(p).toContain("THEY ARE EMPTY AND REQUIRED, SO WRITE THEM");
    expect(p).toContain("- cta. No email can be built");
    expect(p).toContain("FINISHED TEXT for that field");
    expect(p).toContain("INVENT NOTHING while doing so");
  });

  it("nennt fuer den Micro-Yes die Wortgrenze, an der die App ihn misst", () => {
    const p = buildCoachPrompt({ ...angebot, cta: "" });
    expect(p).toContain(`HARD LIMIT ${MICRO_YES_MAX_WORDS} words`);
  });

  it("schweigt weiter, wenn kein Pflichtfeld leer ist", () => {
    // mechanism, friction_reason und tone sind im Angebot leer -- optional,
    // und dazu bleibt Schweigen richtig.
    expect(buildCoachPrompt(angebot)).not.toContain("THEY ARE EMPTY AND REQUIRED");
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

  it("meldet nichts an einem leeren OPTIONALEN Feld", () => {
    const raw = '[{"field":"mechanism","severity":"weak","verdict":"Fehlt.","proposal":"Trag was ein."}]';
    expect(parseCoachFindings(raw, angebot)).toEqual([]);
  });

  it("nimmt den Entwurf fuer ein leeres PFLICHTfeld an, immer als Blocker", () => {
    // Ohne das kam der Nutzer nie auf ein fertiges Angebot: das eine leere
    // Pflichtfeld war genau das, zu dem der Coach nichts sagen durfte.
    const raw =
      '[{"field":"cta","severity":"weak","verdict":"Hier fehlt die eine Frage.",' +
      '"proposal":"Soll ich dir den Beispiel-Retourenschein schicken?"}]';
    expect(parseCoachFindings(raw, ohneCta)).toEqual([
      {
        field: "cta",
        severity: "blocker",
        verdict: "Hier fehlt die eine Frage.",
        proposal: "Soll ich dir den Beispiel-Retourenschein schicken?",
      },
    ]);
  });

  it("wirft einen Entwurf mit erfundener Zahl weg", () => {
    // "5 Minuten" steht im Angebot, "30" nirgends. Lieber die Luecke behalten
    // als eine Zahl, die niemand mehr nachprueft.
    const mitZahl = (n: string) =>
      `[{"field":"cta","severity":"blocker","verdict":"v","proposal":"Schicke ich dir das in ${n} Minuten?"}]`;
    expect(parseCoachFindings(mitZahl("30"), ohneCta)).toEqual([]);
    expect(parseCoachFindings(mitZahl("5"), ohneCta)).toHaveLength(1);
  });

  it("wirft einen Micro-Yes weg, den die App selbst bemaengeln wuerde", () => {
    // Am Live-Stand aufgefallen (2026-08-13): der erste Vorschlag fuer das
    // leere cta war fachlich richtig hergeleitet und 30 Woerter lang -- die
    // Anzeige unter dem Feld haette ihn sofort als "zu lang" gemeldet. Ein
    // Coach, dessen Vorschlag durch seine eigene Pruefung faellt, schickt den
    // Nutzer im Kreis.
    const mit = (p: string) =>
      `[{"field":"cta","severity":"blocker","verdict":"v","proposal":${JSON.stringify(p)}}]`;
    const zuLang =
      "Would you like to receive a customized outreach sequence preview or a sample list of " +
      "verified decision maker contacts personalized for your agency to look at soon?";
    expect(parseCoachFindings(mit(zuLang), ohneCta)).toEqual([]);
    // Terminbitte und fehlendes Fragezeichen fallen aus demselben Grund raus.
    expect(parseCoachFindings(mit("Sollen wir einen Termin machen?"), ohneCta)).toEqual([]);
    expect(parseCoachFindings(mit("Schicke ich dir die Vorschau."), ohneCta)).toEqual([]);
    expect(parseCoachFindings(mit("Schicke ich dir die Vorschau?"), ohneCta)).toHaveLength(1);
  });

  it("stellt ein fehlendes Pflichtfeld vor die Stilhinweise", () => {
    // Sonst verschwindet das eine blockierende Feld hinter der Kappung.
    const eins = (f: string) => `{"field":"${f}","severity":"weak","verdict":"v","proposal":"p"}`;
    const raw =
      "[" +
      ["offering", "icp", "problem", "friction", "outcome"].map(eins).join(",") +
      ',{"field":"cta","severity":"weak","verdict":"v","proposal":"Schicke ich es dir?"}]';
    const befunde = parseCoachFindings(raw, ohneCta);
    expect(befunde).toHaveLength(5);
    expect(befunde[0].field).toBe("cta");
  });

  // Diese beiden pruefen die Buchfuehrung des Parsers, nicht den Inhalt --
  // deshalb ein Feld ohne eigene Formregeln. Mit "cta" wuerde stattdessen die
  // Micro-Yes-Pruefung greifen, und der Test haette nichts mehr mit seinem
  // Namen zu tun.
  it("nimmt je Feld nur den ersten Befund", () => {
    const raw =
      '[{"field":"problem","severity":"blocker","verdict":"A","proposal":"a"},' +
      '{"field":"problem","severity":"weak","verdict":"B","proposal":"b"}]';
    expect(parseCoachFindings(raw, angebot)).toHaveLength(1);
  });

  it("ignoriert erfundene Feldnamen", () => {
    const raw = '[{"field":"pricing","severity":"weak","verdict":"X","proposal":"y"}]';
    expect(parseCoachFindings(raw, angebot)).toEqual([]);
  });

  it("laesst einen Verweis auf sich selbst fallen", () => {
    const raw =
      '[{"field":"problem","severity":"weak","verdict":"X","proposal":"y","relatedField":"problem"}]';
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
