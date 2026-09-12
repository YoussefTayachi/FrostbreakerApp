import { describe, expect, it } from "vitest";
import { classificationInput, effectiveInterest } from "./interest";

/**
 * Der Fall, der beides ausgeloest hat, steht als erster Test: Betreff "STOP",
 * Text "Website is good for us", darunter zitiert unsere eigene Frage nach
 * dem Entwurf. Eingestuft wurde er als 'interested'.
 */
const MIKE = `Hello Youssef,

Wish you all the best.
Website is good for us.

If you have any further questions, please do not hesitate to contact us.

Kind regards,

Mike

From: Youssef Tayachi <y.tayachi@marketing.frostbreaker.app>
Date: Friday, 11 September 2026 at 08:10
To: Mike Norman <mike.norman@nichematerials.com>
Subject: last one from me

Hi Mike,

Last one from me, no more emails after this. Want the prototype of your
homepage before I go? A yes or no is all I need.`;

describe("classificationInput", () => {
  it("laesst die zitierte Originalmail weg", () => {
    const input = classificationInput("STOP", MIKE);
    expect(input).toContain("Website is good for us");
    expect(input).not.toContain("Want the prototype");
    expect(input).not.toContain("y.tayachi@marketing.frostbreaker.app");
  });

  it("nimmt den Betreff mit auf", () => {
    expect(classificationInput("STOP", MIKE)).toContain("Betreff: STOP");
  });

  it("kommt ohne Betreff aus", () => {
    const input = classificationInput(null, "Kurz und knapp.");
    expect(input).toBe("Kurz und knapp.");
  });

  it("faellt auf den vollen Text zurueck, wenn der Schnitt nichts uebrig laesst", () => {
    // Eine Weiterleitung ohne eigenes Wort: der Zitat-Schnitt trifft die
    // erste Zeile. Lieber unscharf einstufen als gar nicht.
    const nurZitat = "> Hi Anna,\n> magst du den Entwurf sehen?";
    expect(classificationInput(null, nurZitat)).toContain("magst du den Entwurf sehen");
  });

  it("bleibt unter der Laengengrenze", () => {
    expect(classificationInput("Betreff", "x".repeat(5000)).length).toBeLessThanOrEqual(2000);
  });
});

describe("effectiveInterest", () => {
  it("der von Hand gesetzte Status schlaegt das Modellurteil", () => {
    expect(effectiveInterest("interested", "not_interested")).toBe("not_interested");
  });

  it("ein Termin und ein Kunde gelten als interessiert", () => {
    expect(effectiveInterest("question", "meeting_booked")).toBe("interested");
    expect(effectiveInterest(null, "customer")).toBe("interested");
    expect(effectiveInterest(null, "lead")).toBe("interested");
  });

  it("'replied' und 'contacted' sagen nichts und aendern nichts", () => {
    expect(effectiveInterest("question", "replied")).toBe("question");
    expect(effectiveInterest("not_interested", "replied")).toBe("not_interested");
    expect(effectiveInterest("interested", "contacted")).toBe("interested");
  });

  it("ohne beides bleibt es leer", () => {
    expect(effectiveInterest(null, "new")).toBeNull();
    expect(effectiveInterest(undefined, undefined)).toBeNull();
  });
});
