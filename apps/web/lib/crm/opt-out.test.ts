import { describe, expect, it } from "vitest";
import { detectOptOut, stripQuotedReply } from "./opt-out";

describe("stripQuotedReply", () => {
  it("schneidet am klassischen Zitatzeichen ab", () => {
    expect(stripQuotedReply("Klingt gut!\n\n> Hi Anna,\n> unsubscribe hier")).toBe("Klingt gut!");
  });

  it("schneidet an 'On ... wrote:' ab", () => {
    const body = "Sounds interesting.\n\nOn Mon, 3 Aug 2026 at 09:12, Youssef wrote:\nreply stop to opt out";
    expect(stripQuotedReply(body)).toBe("Sounds interesting.");
  });

  it("schneidet am deutschen 'Am ... schrieb' ab", () => {
    const body = "Passt, melde mich.\n\nAm 03.08.2026 schrieb Youssef:\nAbmelden mit stop";
    expect(stripQuotedReply(body)).toBe("Passt, melde mich.");
  });

  it("schneidet an Outlooks Kopfzeilen ab", () => {
    expect(stripQuotedReply("Ja gerne.\n\nVon: Youssef\nGesendet: Montag")).toBe("Ja gerne.");
  });

  it("laesst eine Antwort ohne Zitat unangetastet", () => {
    expect(stripQuotedReply("Nur mein Text")).toBe("Nur mein Text");
  });

  it("nimmt die frueheste Zitatgrenze, wenn mehrere vorkommen", () => {
    const body = "Kurz.\n\nOn Mon wrote:\n> alt\n\nFrom: X";
    expect(stripQuotedReply(body)).toBe("Kurz.");
  });

  it("kommt mit leerem Text klar", () => {
    expect(stripQuotedReply("")).toBe("");
  });
});

describe("detectOptOut", () => {
  it("erkennt ein alleinstehendes 'stop'", () => {
    expect(detectOptOut("stop").optOut).toBe(true);
  });

  it("erkennt 'Stop.' mit Satzzeichen und Grossschreibung", () => {
    expect(detectOptOut("Stop.").optOut).toBe(true);
  });

  it("erkennt 'unsubscribe'", () => {
    expect(detectOptOut("Please unsubscribe me from this list").optOut).toBe(true);
  });

  it("erkennt deutsche Abmeldungen", () => {
    expect(detectOptOut("Bitte austragen, danke.").optOut).toBe(true);
    expect(detectOptOut("Ich möchte mich abmelden").optOut).toBe(true);
    expect(detectOptOut("Keine weiteren Mails bitte").optOut).toBe(true);
    expect(detectOptOut("Bitte nicht mehr anschreiben").optOut).toBe(true);
  });

  it("gibt die Fundstelle zurueck", () => {
    expect(detectOptOut("Please stop emailing me").phrase).toMatch(/stop/i);
  });

  // Der eigentliche Grund fuer stripQuotedReply: die eigene Signatur enthaelt
  // "reply stop", und die steht im Zitat unter JEDER Antwort.
  it("sperrt NICHT, wenn 'stop' nur in der zitierten Originalmail steht", () => {
    const body = [
      "Sounds interesting, can you send more details?",
      "",
      "On Mon, 3 Aug 2026 at 09:12, Youssef Tayachi wrote:",
      "> Hi Anna,",
      "> ...",
      "> If this isn't relevant, just reply stop and I'll leave you alone.",
    ].join("\n");
    expect(detectOptOut(body).optOut).toBe(false);
  });

  it("sperrt NICHT bei einem zitierten Abmeldelink", () => {
    const body = "Ja, gerne!\n\n> Klicken Sie hier zum Abmelden: https://.../unsubscribe";
    expect(detectOptOut(body).optOut).toBe(false);
  });

  // Wortgrenzen: ohne \b wuerden diese vier faelschlich sperren.
  it("sperrt NICHT bei Woertern, die 'stop' enthalten", () => {
    expect(detectOptOut("We stopped using that tool last year").optOut).toBe(false);
    expect(detectOptOut("Kommt ihr zum Workshop?").optOut).toBe(false);
    expect(detectOptOut("Nonstop unterwegs gerade").optOut).toBe(false);
    expect(detectOptOut("Our bus stop is around the corner").optOut).toBe(false);
  });

  // Abmeldung und Absage sind zwei verschiedene Dinge, siehe Dateikopf.
  it("wertet eine blosse Absage NICHT als Abmeldung", () => {
    expect(detectOptOut("Kein Interesse, danke.").optOut).toBe(false);
    expect(detectOptOut("Not interested right now").optOut).toBe(false);
    expect(detectOptOut("Passt gerade nicht, vielleicht nächstes Jahr").optOut).toBe(false);
    expect(detectOptOut("Thanks, but we're all set").optOut).toBe(false);
  });

  it("wertet eine positive Antwort NICHT als Abmeldung", () => {
    expect(detectOptOut("Klingt spannend, wann haben Sie Zeit?").optOut).toBe(false);
    expect(detectOptOut("Sure, let's set up a call next week").optOut).toBe(false);
  });

  it("kommt mit leerem Text klar", () => {
    expect(detectOptOut("").optOut).toBe(false);
  });
});
