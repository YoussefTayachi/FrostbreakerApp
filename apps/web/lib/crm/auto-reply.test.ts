import { describe, expect, it } from "vitest";
import { detectAutoReply } from "./auto-reply";

/**
 * Die Betreffzeilen stammen woertlich aus Instantly (Stand 2026-08-03);
 * ausgedachte Beispiele haetten hier wenig Wert, weil die Formulierungen von
 * fremden Mailservern kommen und niemand sie sich so ausdenken wuerde.
 */
const ECHTE_AUTO_ANTWORTEN = [
  "Automatic reply: after-hours product questions",
  "[Auto-Reply // Traveling] Re: after-hours product questions",
  "Out of the office Re: Apollo workflow issue",
  "Out Of Office - Expect Delay in Response Re: customer support",
  "BA SLOW TO RESPOND Re: customer support costs",
];

describe("detectAutoReply", () => {
  it.each(ECHTE_AUTO_ANTWORTEN)("erkennt %s", (subject) => {
    expect(detectAutoReply(subject, "").autoReply).toBe(true);
  });

  it("gibt die getroffene Stelle zurueck", () => {
    expect(detectAutoReply("Automatic reply: xyz", "").matched).toMatch(/automatic/i);
  });

  it("erkennt deutsche Abwesenheitsnotizen", () => {
    expect(detectAutoReply("Automatische Antwort: Ihre Anfrage", "").autoReply).toBe(true);
    expect(detectAutoReply("Abwesenheitsnotiz", "").autoReply).toBe(true);
    expect(detectAutoReply("Re: Angebot", "Ich bin derzeit nicht im Büro.").autoReply).toBe(true);
  });

  it("erkennt eine Auto-Antwort am Textanfang, wenn der Betreff nichts hergibt", () => {
    const body = "Hi there, thanks for reaching out! This is an auto-response...";
    expect(detectAutoReply("Re: customer support costs", body).autoReply).toBe(true);
  });

  // Der Kern: eine echte Absage darf NICHT als Abwesenheit durchgehen, sonst
  // wandert sie faelschlich zurueck in die naechste Kampagne.
  it("haelt echte Absagen auseinander", () => {
    expect(detectAutoReply("Re: Ihr Angebot", "Kein Interesse, danke.").autoReply).toBe(false);
    expect(detectAutoReply("Not interested", "We are all set, thanks.").autoReply).toBe(false);
    expect(detectAutoReply("Re: quick question", "We're out of budget this year.").autoReply).toBe(
      false
    );
  });

  it("haelt echte Antworten auseinander", () => {
    expect(detectAutoReply("Re: quick question", "Sounds interesting, when can we talk?").autoReply).toBe(
      false
    );
    expect(detectAutoReply("Re: Angebot", "Klingt spannend, rufen Sie mich an.").autoReply).toBe(false);
  });

  // Wendungen aus einer zitierten Originalmail weit unten duerfen nicht
  // greifen; geprueft wird nur der Anfang des Textes.
  it("greift nicht auf eine Wendung tief im Zitat", () => {
    const body = "Klingt gut!\n\n" + "x".repeat(600) + "\nI am currently out of the office";
    expect(detectAutoReply("Re: Termin", body).autoReply).toBe(false);
  });

  it("kommt mit leeren Werten klar", () => {
    expect(detectAutoReply("", "").autoReply).toBe(false);
    expect(detectAutoReply(null, null).autoReply).toBe(false);
    expect(detectAutoReply(undefined, undefined).autoReply).toBe(false);
  });
});
