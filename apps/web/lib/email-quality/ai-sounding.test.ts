import { describe, expect, it } from "vitest";
import { checkAiSounding } from "./ai-sounding";

const check = (body: string, lang: "de" | "en" = "de", subject = "") =>
  checkAiSounding({ subject, body }, lang);

describe("checkAiSounding", () => {
  it("bewertet eine normal geschriebene Mail als unauffaellig", () => {
    const r = check(
      "Hallo Anna,\n\nich habe gesehen, dass ihr acht Transporter fahrt.\n" +
        "Wir liefern Ersatzteile in 24 Stunden, meist günstiger als der Vertragshändler.\n" +
        "Lohnt sich ein kurzer Call nächste Woche?\n\nGruß, Youssef"
    );
    expect(r.band).toBe("low");
  });

  it("erkennt typische deutsche Modell-Floskeln", () => {
    const r = check("In der heutigen schnelllebigen Welt sind maßgeschneiderte Lösungen unerlässlich.");
    expect(r.issues.filter((i) => i.category === "ai-phrase").length).toBeGreaterThanOrEqual(2);
    expect(r.score).toBeGreaterThan(0);
  });

  it("erkennt typische englische Modell-Floskeln", () => {
    const r = check("I hope this email finds you well. Let us delve into a game-changer.", "en");
    expect(r.band).not.toBe("low");
  });

  it("findet Floskeln auch im Betreff", () => {
    const r = check("", "en", "Unlock the power of your pipeline");
    expect(r.issues.some((i) => i.field === "subject")).toBe(true);
  });

  describe("Gleichfoermigkeit der Satzlaengen", () => {
    it("bewertet kurze Mails gar nicht erst", () => {
      // Drei Saetze sind fuer eine Streuungsaussage zu wenig -- genau hier
      // entstehen sonst die Fehlalarme bei guten, knappen Mails.
      const r = check("Wir liefern schnell. Das spart Geld. Passt das?");
      expect(r.burstiness).toBeNull();
      expect(r.issues.map((i) => i.category)).not.toContain("low-burstiness");
    });

    it("meldet auffaellig gleichmaessige Saetze", () => {
      const uniform = Array.from({ length: 6 }, () => "Wir liefern die Ware immer sehr schnell aus.").join(" ");
      const r = check(uniform);
      expect(r.burstiness).not.toBeNull();
      expect(r.burstiness!).toBeLessThan(0.2);
      expect(r.issues.map((i) => i.category)).toContain("low-burstiness");
    });

    it("laesst gemischte Satzlaengen in Ruhe", () => {
      const mixed =
        "Kurz vorweg. Ich habe gesehen, dass ihr im letzten Quartal drei neue Standorte " +
        "eröffnet habt und die Logistik dafür offenbar komplett intern abbildet. " +
        "Das ist stark. Passt ein Call?";
      expect(check(mixed).issues.map((i) => i.category)).not.toContain("low-burstiness");
    });
  });

  it("deckelt den Score bei 100", () => {
    const r = check("In der heutigen schnelllebigen Welt ".repeat(20));
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("zitiert die Originalstelle", () => {
    const body = "Hallo {{firstName}}, nahtlos integriert.";
    const issue = check(body).issues.find((i) => i.category === "ai-phrase");
    expect(issue?.snippet).toBe("nahtlos");
    expect(body.slice(issue!.offset!.start, issue!.offset!.end)).toBe("nahtlos");
  });

  it("kommt mit leerem Text klar", () => {
    const r = check("");
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
    expect(r.burstiness).toBeNull();
  });
});
