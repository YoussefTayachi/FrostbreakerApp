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

/**
 * Die zweite Fuhre, gemessen am 2026-09-22 im Posteingang von
 * ramy@retaiyn.com: 31 von 163 eingegangenen Antworten standen dort ohne
 * Etikett, und zehn davon waren Abwesenheitsnotizen, die diese Erkennung
 * haette finden muessen. Auch hier woertlich uebernommen -- "Autosvar" und
 * "nog longer working" (Tippfehler des Absenders) denkt sich niemand aus.
 */
const ECHTE_AUTO_ANTWORTEN_I18N: [string, string][] = [
  ["Respuesta automática: What's up, Santa?", "Hola, Estaré fuera de la oficina hasta el 14 de septiembre."],
  ["Automatisch antwoord: The channel your competitors are using", "Bedankt voor uw bericht. Op dit moment ben ik afwezig wegens ziekte."],
  ["Autosvar: What's happening to your contacts?", "Hi! Thanks for reaching out! I'm currently on a short vacation."],
  ["Lisa Nielsen OOO Re: The channel your competitors are using", "Thank you for your email. I am currently OOO."],
  ["Lily Holden-OOO Re: The channel your competitors are using", "Hi there, I am currently out of office for anything urgent."],
];

describe("detectAutoReply in anderen Sprachen und Kurzformen", () => {
  it.each(ECHTE_AUTO_ANTWORTEN_I18N)("erkennt %s", (subject, body) => {
    expect(detectAutoReply(subject, body).autoReply).toBe(true);
  });

  // Der Betreff sagt nichts, die erste Zeile alles.
  it("erkennt die Ansage im Text, wenn der Betreff nur 'Re:' ist", () => {
    const faelle = [
      "I am currently out of office, I will respond on my return Monday.",
      "Hello, Thanks for your email. I'm now on Annual Leave, returning 27th August.",
      "Hi Ramy, Thanks for getting in touch! Please expect a response from our customer service team within two working days.",
      "Graag informeer ik je dat ik met zwangerschap verlof ben vanaf 6 juli tot november.",
      "Hi there, I am writing to let you know that I have recently left my role at PHIX.",
      "Hi There, I have now left the business. Please contact Jamal@smiley.com.",
      "Hello, I'm nog longer working at POM Amsterdam. Please contact my colleagues.",
      "Hi, As of 27/2, I am no longer with Aarke and will not be monitoring this inbox.",
    ];
    for (const body of faelle) {
      expect(detectAutoReply("Re: The channel your competitors are using", body).autoReply).toBe(true);
    }
  });

  // Der Preis der neuen Muster waere, dass echte Antworten hineinfallen.
  // Diese Zeilen stehen woertlich im selben Posteingang und muessen draussen
  // bleiben -- sonst verschwindet ein Lead hinter "Abwesend".
  it("laesst echte Antworten aus demselben Posteingang draussen", () => {
    const echte: [string, string][] = [
      ["Re: The channel your competitors are using", "Am interested"],
      ["Re: You are slooww...", "Good morning What is your product? I work on the player care side of this business."],
      ["Re: What's happening to your dead contacts?", "Sure"],
      ["Re: The channel your competitors are using", "we are allready on it"],
      ["RE: What's happening to your dead contacts?", "Not interested"],
      ["Re: What's happening to your dead contacts?", "Dear Berat, Thank you for reaching out. At present, we're doing great with our current setup."],
    ];
    for (const [subject, body] of echte) {
      expect(detectAutoReply(subject, body).autoReply).toBe(false);
    }
  });
});
