import { describe, expect, it } from "vitest";
import { checkSpamTriggers } from "./spam-triggers";

const check = (subject: string, body: string, lang: "de" | "en" = "de") =>
  checkSpamTriggers({ subject, body }, lang);

describe("checkSpamTriggers", () => {
  it("bewertet eine saubere Mail als geringes Risiko", () => {
    const r = check("Kurze Frage zu eurem Fuhrpark", "Hallo, wir liefern Ersatzteile für Transporter. Passt ein kurzer Call?");
    expect(r.riskLevel).toBe("low");
    expect(r.issues).toEqual([]);
  });

  it("erkennt eine offensichtliche Spam-Mail als hohes Risiko", () => {
    const r = check("GRATIS!!! Jetzt handeln, garantiert Rabatt!!!", "Sie wurden ausgewählt.");
    expect(r.riskLevel).toBe("high");
  });

  it("erkennt auch die englische Variante", () => {
    const r = check("FREE!!! Act now, guaranteed cash!!!", "You have been selected.", "en");
    expect(r.riskLevel).toBe("high");
  });

  it("ignoriert Gross-/Kleinschreibung", () => {
    expect(check("", "Das ist GARANTIERT gut.").categoryCounts["exaggerated-claims"]).toBe(1);
  });

  it("achtet auf Wortgrenzen", () => {
    // "kredit" darf nicht in "Kreditwuerdigkeitspruefung" anschlagen.
    expect(check("", "Wir prüfen die Kreditwürdigkeit.").categoryCounts.money).toBe(0);
    expect(check("", "We ran a classic test.", "en").categoryCounts.money).toBe(0);
  });

  it("gewichtet Treffer im Betreff staerker als im Text", () => {
    const inSubject = check("gratis gratis gratis", "");
    const inBody = check("", "gratis gratis gratis");
    expect(inSubject.riskScore).toBeGreaterThan(inBody.riskScore);
  });

  it("zaehlt pro Kategorie", () => {
    const r = check("", "Jetzt handeln und gratis sparen sie bares Geld.");
    expect(r.categoryCounts.urgency).toBe(1);
    expect(r.categoryCounts.money).toBeGreaterThanOrEqual(2);
  });

  describe("strukturelle Auffaelligkeiten", () => {
    it("meldet ein einzelnes Grossbuchstaben-Wort im Betreff", () => {
      expect(check("WICHTIG kurze Frage", "").issues.map((i) => i.category)).toContain("all-caps");
    });

    it("toleriert einzelne Grossbuchstaben-Woerter im Text", () => {
      const body = "Wir liefern Teile für die GmbH und kümmern uns um den Rest der Abwicklung ohne Aufwand.";
      expect(check("", body).issues.map((i) => i.category)).not.toContain("all-caps");
    });

    it("meldet Ausrufezeichen ab dem Schwellwert", () => {
      expect(check("Hallo!", "").issues.map((i) => i.category)).not.toContain("exclamation");
      expect(check("Hallo!! Kurz!", "").issues.map((i) => i.category)).toContain("exclamation");
    });

    it("meldet Satzzeichen-Ketten", () => {
      expect(check("", "Wirklich??").issues.map((i) => i.category)).toContain("punctuation-cluster");
    });
  });

  it("deckelt den Score bei 100", () => {
    const r = check("GRATIS GARANTIERT JETZT HANDELN!!!", "gratis ".repeat(60));
    expect(r.riskScore).toBeLessThanOrEqual(100);
    expect(r.riskLevel).toBe("high");
  });

  it("zitiert die Originalstelle und liefert passende Offsets", () => {
    const body = "Hallo {{firstName}}, das ist garantiert spannend.";
    const issue = check("", body).issues[0];
    expect(issue.snippet).toBe("garantiert");
    expect(body.slice(issue.offset!.start, issue.offset!.end)).toBe("garantiert");
  });
});
