import { describe, expect, it } from "vitest";
import { emptyOffer, type Offer, type OfferTextField } from "@/lib/offers";
import { offerFindings } from "./offer-tests";

function angebot(over: Partial<Pick<Offer, OfferTextField>> = {}): Pick<Offer, OfferTextField> {
  return { ...emptyOffer("Test"), ...over };
}

const arten = (o: Partial<Pick<Offer, OfferTextField>>) => offerFindings(angebot(o)).map((f) => f.kind);

describe("offerFindings", () => {
  it("laesst ein leeres Angebot in Ruhe", () => {
    // Leere Pflichtfelder meldet der Ring. Hier zusaetzlich zu meckern hiesse,
    // ein frisches Angebot mit acht roten Hinweisen zu begruessen.
    expect(offerFindings(angebot())).toEqual([]);
  });

  it("meldet einen Outcome ohne Zeitrahmen", () => {
    expect(arten({ outcome: "Mehr Anfragen über die Website" })).toContain("outcomeNoTimeframe");
  });

  it("nimmt einen Outcome mit Metrik und Zeitrahmen an", () => {
    const k = arten({ outcome: "In 14 Tagen von 12 auf unter 2 Stunden Antwortzeit" });
    expect(k).not.toContain("outcomeNoTimeframe");
    expect(k).not.toContain("outcomeNoNumber");
  });

  it("findet Werkzeugwoerter im Mechanismus", () => {
    const f = offerFindings(angebot({ mechanism: "Ein KI-Agent übernimmt die Antworten per API" }));
    const jargon = f.find((x) => x.kind === "mechanismJargon");
    expect(jargon).toBeDefined();
    if (jargon?.kind === "mechanismJargon") {
      expect(jargon.words).toEqual(expect.arrayContaining(["ki", "agent", "api"]));
    }
  });

  it("laesst einen Mechanismus ohne Werkzeugwoerter durch", () => {
    expect(arten({ mechanism: "Jede Anfrage wird sofort beantwortet und der Termin direkt gesetzt" })).not.toContain(
      "mechanismJargon"
    );
  });

  it("meldet einen Micro-Yes, der ein Termin ist", () => {
    const f = offerFindings(angebot({ cta: "Hast du diese Woche 15 Minuten für einen Call?" }));
    const my = f.find((x) => x.kind === "microYes");
    expect(my?.kind === "microYes" && my.problems).toContain("meeting");
  });

  it("meldet eine zu allgemeine Friction", () => {
    expect(arten({ friction: "Schlechte Website" })).toContain("frictionTooBroad");
    expect(arten({ friction: "Das Buchungsformular fragt neun Felder ab" })).not.toContain("frictionTooBroad");
  });

  it("verlangt eine Zeitzusage nur, wenn etwas versprochen wird", () => {
    expect(arten({ review_time: "" })).not.toContain("reviewTimeMissing");
    expect(arten({ preview_asset: "Eine kurze Aufnahme der Buchungsstrecke" })).toContain("reviewTimeMissing");
    expect(
      arten({ preview_asset: "Eine kurze Aufnahme der Buchungsstrecke", review_time: "kurz" })
    ).toContain("reviewTimeVague");
    expect(
      arten({ preview_asset: "Eine kurze Aufnahme der Buchungsstrecke", review_time: "90 Sekunden" })
    ).not.toContain("reviewTimeVague");
  });

  it("meldet einen Kernsatz, den man nicht in 15 Sekunden sagt", () => {
    const lang = Array.from({ length: 20 }, (_, i) => `wort${i}`).join(" ");
    expect(arten({ offering: lang, outcome: lang })).toContain("tooLongToSay");
  });
});
