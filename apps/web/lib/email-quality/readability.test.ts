import { describe, expect, it } from "vitest";
import { checkReadability } from "./readability";
import type { IssueCategory } from "./types";

const categories = (text: string, lang: "de" | "en"): IssueCategory[] =>
  checkReadability(text, lang).issues.map((i) => i.category);

describe("checkReadability", () => {
  it("liefert einen neutralen Befund fuer leeren Text", () => {
    const r = checkReadability("", "de");
    expect(r.wordCount).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.gradeLevel).toBeNull();
  });

  it("bewertet kurze, einfache Saetze besser als lange, verschachtelte", () => {
    const easy = checkReadability("Wir liefern schnell. Das spart Geld. Passt das?", "de");
    const hard = checkReadability(
      "Die von uns bereitgestellte Logistikinfrastruktur ermöglicht Ihrem Unternehmen " +
        "eine signifikante Reduktion der Gesamtbetriebskosten unter Berücksichtigung " +
        "sämtlicher regulatorischer Rahmenbedingungen.",
      "de"
    );
    expect(easy.readingEaseScore).toBeGreaterThan(hard.readingEaseScore);
    expect(easy.band).toBe("very-easy");
  });

  describe("die Note kommt aus der Satzlaenge, nicht aus dem Flesch-Wert", () => {
    // Der gemeldete Fall vom 2026-08-12: eine erzeugte Kampagnenmail, kurze
    // Saetze, keine Befunde — und trotzdem ein rotes "Schwer", allein wegen
    // Fachwoertern wie "verification". Ein rotes Abzeichen ueber "Nichts zu
    // beanstanden" ist ein Widerspruch.
    const gemeldetEN =
      "{{personalization}}\nManaging multiple client campaigns with separate tools can waste hours. " +
      "Frostbreaker unifies lead discovery, contact verification, and outreach automation across " +
      "email, LinkedIn, and phone in one workspace. Would you be open to a quick call to explore " +
      "simplifying your outbound efforts?";
    const gemeldetDE =
      "{{personalization}}\nMehrere Kundenkampagnen mit getrennten Werkzeugen zu steuern kostet Stunden. " +
      "Frostbreaker verbindet Leadsuche, Adressprüfung und Versandsteuerung über Mail, LinkedIn und " +
      "Telefon in einer Oberfläche. Wärst du offen für ein kurzes Gespräch?";

    it("benotet kurze Saetze mit Fachwoertern nicht als schwer", () => {
      for (const [text, lang] of [[gemeldetEN, "en"], [gemeldetDE, "de"]] as const) {
        const r = checkReadability(text, lang);
        expect(r.issues).toEqual([]);
        expect(r.avgSentenceLength).toBeLessThan(15);
        expect(r.band).toBe("very-easy");
      }
    });

    it("widerspricht sich nicht: ohne Befund nie eine schlechte Note", () => {
      const r = checkReadability(gemeldetEN, "en");
      expect(["very-easy", "easy"]).toContain(r.band);
      // Der Flesch-Wert bleibt als ANGABE stehen, er ist nur nicht mehr das
      // Urteil — er liegt hier weiterhin niedrig.
      expect(r.readingEaseScore).toBeLessThan(60);
    });

    it("meldet lange Saetze weiterhin als schwer", () => {
      const lang = "de" as const;
      const r = checkReadability(
        "Die von uns bereitgestellte Logistikinfrastruktur ermöglicht Ihrem Unternehmen eine " +
          "signifikante Reduktion der Gesamtbetriebskosten unter Berücksichtigung sämtlicher " +
          "regulatorischer Rahmenbedingungen und interner Vorgaben.",
        lang
      );
      expect(["difficult", "very-difficult"]).toContain(r.band);
    });

    it("zieht extrem schwere Wortwahl um eine Stufe herunter", () => {
      // Kurze Saetze, aber unlesbare Woerter: das soll nicht gruen sein.
      const r = checkReadability(
        "Interessenskonfliktvermeidungsstrategieentwicklung. Wirtschaftlichkeitsberechnungsgrundlagenermittlung.",
        "de"
      );
      expect(r.avgSentenceLength).toBeLessThan(5);
      expect(r.band).not.toBe("very-easy");
    });
  });

  it("haelt den Score in 0-100 und die Stufe in 1-20", () => {
    const r = checkReadability(
      "Interessenskonfliktvermeidungsstrategieentwicklungsprozessdokumentation " +
        "Wirtschaftlichkeitsberechnungsgrundlagenermittlungsverfahren.",
      "de"
    );
    expect(r.readingEaseScore).toBeGreaterThanOrEqual(0);
    expect(r.readingEaseScore).toBeLessThanOrEqual(100);
    expect(r.gradeLevel!).toBeLessThanOrEqual(20);
  });

  describe("lange Saetze", () => {
    it("meldet erst ab dem Schwellwert", () => {
      expect(categories("Wir liefern morgen.", "de")).not.toContain("long-sentence");
    });

    it("stuft sehr lange Saetze schaerfer ein", () => {
      const veryLong = "wort ".repeat(35) + ".";
      expect(categories(veryLong, "de")).toContain("very-long-sentence");
    });

    it("nutzt fuer Deutsch eine hoehere Schwelle als fuer Englisch", () => {
      const sentence = "word ".repeat(21) + ".";
      expect(categories(sentence, "en")).toContain("long-sentence");
      expect(categories(sentence, "de")).not.toContain("long-sentence");
    });
  });

  describe("Passiv", () => {
    it("erkennt deutsches Vorgangspassiv", () => {
      expect(categories("Die Ware wird morgen von uns geliefert.", "de")).toContain("passive");
      expect(categories("Der Prozess wurde vollständig optimiert.", "de")).toContain("passive");
      expect(categories("Ihre Bestellung ist bereits versendet.", "de")).toContain("passive");
    });

    it("haelt aktive und Futur-Saetze frei", () => {
      expect(categories("Wir liefern die Ware morgen.", "de")).not.toContain("passive");
      // "wird verkaufen" ist Futur, kein Passiv — klassischer Fehlalarm.
      expect(categories("Ihr Team wird mehr verkaufen.", "de")).not.toContain("passive");
    });

    it("haelt Adjektive frei, die wie ein Partizip aussehen", () => {
      // "erwähnenswert"/"verfügbar" enden auf "t"/"r" nach Vorsilbe, sind aber
      // Adjektive — ohne Ausnahme meldet jedes "ist ..." hier ein Passiv.
      expect(categories("Das ist erwähnenswert.", "de")).not.toContain("passive");
      expect(categories("Die Ware ist sofort verfügbar.", "de")).not.toContain("passive");
      expect(categories("Der Preis ist bekannt.", "de")).not.toContain("passive");
    });

    it("erkennt englisches Passiv inkl. unregelmaessiger Partizipien", () => {
      expect(categories("The report was written by our team.", "en")).toContain("passive");
      expect(categories("Invoices are processed automatically.", "en")).toContain("passive");
    });

    it("haelt aktive englische Saetze frei", () => {
      expect(categories("Our team writes the report.", "en")).not.toContain("passive");
    });

    it("zaehlt den Passiv-Anteil pro Satz", () => {
      const r = checkReadability("Die Ware wird geliefert. Wir melden uns.", "de");
      expect(r.passiveRatio).toBe(0.5);
    });
  });

  describe("Fuellwoerter und Adverbien", () => {
    it("findet deutsche Fuellwoerter", () => {
      expect(categories("Das ist eigentlich ziemlich spannend.", "de")).toContain("weasel");
    });

    it("findet deutsche Verstaerker", () => {
      expect(categories("Das ist sehr gut.", "de")).toContain("adverb");
    });

    it("findet englische -ly-Adverbien", () => {
      expect(categories("We quickly shipped it.", "en")).toContain("adverb");
    });

    it("ignoriert -ly-Woerter, die keine Adverbien sind", () => {
      // "reply" und "supply" stehen in praktisch jeder Vertriebsmail.
      expect(categories("Please reply about the supply.", "en")).not.toContain("adverb");
    });
  });

  it("zitiert die Originalstelle inklusive Platzhalter", () => {
    const body = "Hallo {{firstName}}, das ist eigentlich spannend.";
    const weasel = checkReadability(body, "de").issues.find((i) => i.category === "weasel");
    expect(weasel?.snippet).toBe("eigentlich");
    expect(body.slice(weasel!.offset!.start, weasel!.offset!.end)).toBe("eigentlich");
  });

  it("verzerrt die Statistik nicht durch Platzhalter", () => {
    const withVar = checkReadability("Hallo {{firstName}}, wir liefern morgen.", "de");
    const withName = checkReadability("Hallo Name, wir liefern morgen.", "de");
    expect(withVar.wordCount).toBe(withName.wordCount);
    expect(withVar.readingEaseScore).toBe(withName.readingEaseScore);
  });
});
