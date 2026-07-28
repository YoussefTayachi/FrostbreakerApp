import { describe, expect, it } from "vitest";
import {
  countSyllables,
  findPhrases,
  normalizeVariables,
  splitSentences,
  splitWords,
  stdev,
} from "./text-utils";

describe("normalizeVariables", () => {
  it("ersetzt Instantly-Platzhalter laengengleich", () => {
    const input = "Hallo {{firstName}}, kurze Frage.";
    const out = normalizeVariables(input);
    expect(out.length).toBe(input.length);
    expect(out).toContain("Name");
    expect(out).not.toContain("{{");
  });

  it("laesst Text ohne Platzhalter unveraendert", () => {
    expect(normalizeVariables("Hallo Welt.")).toBe("Hallo Welt.");
  });
});

describe("splitSentences", () => {
  it("trennt an Satzzeichen", () => {
    const s = splitSentences("Erster Satz. Zweiter Satz! Dritter?", "de");
    expect(s.map((x) => x.text)).toEqual(["Erster Satz.", "Zweiter Satz!", "Dritter?"]);
  });

  it("trennt nicht bei Abkuerzungen und Initialen", () => {
    expect(splitSentences("Wir liefern z. B. Karton und Folie.", "de")).toHaveLength(1);
    expect(splitSentences("We ship boxes etc. to your depot.", "en")).toHaveLength(1);
  });

  it("trennt nicht in Zahlen oder Domains", () => {
    expect(splitSentences("Die Marge liegt bei 3.5 Prozent.", "de")).toHaveLength(1);
    expect(splitSentences("Check example.com for details.", "en")).toHaveLength(1);
  });

  it("behandelt Zeilenumbrueche als Satzgrenze", () => {
    // Anrede und Gruss stehen in E-Mails ohne Satzzeichen -- ohne diese Regel
    // waere das ein einziger, kuenstlich langer Satz.
    const s = splitSentences("Hallo Anna\n\nkurze Frage zu eurem Fuhrpark.\n\nGruesse", "de");
    expect(s).toHaveLength(3);
  });

  it("liefert Offsets, die auf den Originaltext zeigen", () => {
    const text = "Erster Satz. Zweiter Satz.";
    const s = splitSentences(text, "de");
    expect(text.slice(s[1].start, s[1].end)).toBe("Zweiter Satz.");
  });

  it("kommt mit leerem Text klar", () => {
    expect(splitSentences("", "de")).toEqual([]);
    expect(splitSentences("   \n  ", "de")).toEqual([]);
  });
});

describe("splitWords", () => {
  it("zaehlt Bindestrich- und Apostroph-Woerter als ein Wort", () => {
    expect(splitWords("don't e-mail us").map((w) => w.text)).toEqual(["don't", "e-mail", "us"]);
  });

  it("ignoriert Satzzeichen", () => {
    expect(splitWords("Hallo, Welt!")).toHaveLength(2);
  });
});

describe("countSyllables", () => {
  it("zaehlt englische Silben inkl. stummem e", () => {
    expect(countSyllables("make", "en")).toBe(1);
    expect(countSyllables("water", "en")).toBe(2);
    expect(countSyllables("beautiful", "en")).toBe(3);
  });

  it("zaehlt deutsche Silben ueber Vokalgruppen", () => {
    expect(countSyllables("Haus", "de")).toBe(1);
    expect(countSyllables("Fuhrpark", "de")).toBe(2);
    expect(countSyllables("Lieferkette", "de")).toBe(4); // Lie-fer-ket-te
  });

  it("liefert mindestens eine Silbe", () => {
    expect(countSyllables("str", "de")).toBe(1);
    expect(countSyllables("", "de")).toBe(0);
  });
});

describe("findPhrases", () => {
  it("findet unabhaengig von Gross-/Kleinschreibung", () => {
    expect(findPhrases("Jetzt HANDELN", ["jetzt handeln"])).toHaveLength(1);
  });

  it("achtet auf Wortgrenzen, auch mit Umlauten", () => {
    // "\b" waere hier nutzlos: es kennt nur ASCII-Wortzeichen.
    expect(findPhrases("Das ist klassisch", ["klasse"])).toHaveLength(0);
    expect(findPhrases("Unsere Grüße", ["grüße"])).toHaveLength(1);
    expect(findPhrases("überprüfen", ["über"])).toHaveLength(0);
  });

  it("unterdrueckt kuerzere Treffer innerhalb laengerer", () => {
    const hits = findPhrases("100% risk-free offer", ["free", "risk-free"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].phrase).toBe("risk-free");
  });

  it("liefert Offsets, die auf den Originaltext zeigen", () => {
    const text = "Wir liefern gratis.";
    const [hit] = findPhrases(text, ["gratis"]);
    expect(text.slice(hit.start, hit.end)).toBe("gratis");
  });
});

describe("stdev", () => {
  it("ist 0 bei identischen Werten", () => {
    expect(stdev([5, 5, 5, 5])).toBe(0);
  });

  it("ist 0 bei weniger als zwei Werten", () => {
    expect(stdev([7])).toBe(0);
    expect(stdev([])).toBe(0);
  });
});
