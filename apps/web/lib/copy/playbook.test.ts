import { describe, expect, it } from "vitest";
import {
  PLAYBOOK_DELAYS,
  STEP_MAX_WORDS,
  bannedPhrasesIn,
  copiedFrom,
  hasTimeframe,
  microYesProblems,
  mirrorsMicroYes,
  wordCount,
} from "./playbook";

describe("Abstaende und Laengen", () => {
  it("laeuft ueber sieben Tage", () => {
    // 0 + 3 + 2 + 2. Der Kurs endet am siebten Tag, danach kein Follow-up mehr.
    expect(PLAYBOOK_DELAYS.reduce((a, b) => a + b, 0)).toBe(7);
  });

  it("hat schrumpfende Abstaende", () => {
    // Der eigentliche Punkt gegenueber der alten Staffelung [0,2,3,5]: die
    // Abstaende werden enger, nicht weiter.
    const pausen = PLAYBOOK_DELAYS.slice(1);
    for (let i = 1; i < pausen.length; i++) expect(pausen[i]).toBeLessThanOrEqual(pausen[i - 1]);
  });

  it("laesst jede Stufe kuerzer werden", () => {
    for (let i = 1; i < STEP_MAX_WORDS.length; i++) {
      expect(STEP_MAX_WORDS[i]).toBeLessThan(STEP_MAX_WORDS[i - 1]);
    }
  });
});

describe("bannedPhrasesIn", () => {
  it("findet Floskeln", () => {
    expect(bannedPhrasesIn("Hi, ich hoffe, es geht dir gut. Kurz zu X.")).toContain(
      "ich hoffe, es geht dir gut"
    );
    expect(bannedPhrasesIn("Just checking in on my last mail")).toContain("just checking in");
  });

  it("achtet auf Wortgrenzen", () => {
    // "10x" darf nicht in "110x" anschlagen — sonst meldet die Pruefung
    // Fehler, die niemand nachvollziehen kann.
    expect(bannedPhrasesIn("Die Anlage liefert 110x mehr")).toEqual([]);
    expect(bannedPhrasesIn("Das ist 10x schneller")).toContain("10x");
  });

  it("laesst saubere Texte in Ruhe", () => {
    expect(bannedPhrasesIn("Zwei Fragen zur Buchungsstrecke. Soll ich es dir zeigen?")).toEqual([]);
  });
});

describe("hasTimeframe", () => {
  it("erkennt Zahl plus Zeiteinheit", () => {
    expect(hasTimeframe("90 Sekunden")).toBe(true);
    expect(hasTimeframe("in 7 Tagen live")).toBe(true);
    expect(hasTimeframe("under 3 minutes")).toBe(true);
  });

  it("weist eine Zahl ohne Einheit ab", () => {
    expect(hasTimeframe("30 Prozent mehr Anfragen")).toBe(false);
    expect(hasTimeframe("schnell")).toBe(false);
  });
});

describe("microYesProblems", () => {
  it("nimmt eine binaere Frage an", () => {
    expect(microYesProblems("Soll ich dir die zwei Stellen zeigen?")).toEqual([]);
  });

  it("erkennt eine Terminbitte", () => {
    expect(microYesProblems("Hast du Donnerstag 15 Minuten für einen Call?")).toContain("meeting");
  });

  it("erkennt eine fehlende Frage", () => {
    expect(microYesProblems("Melde dich gern.")).toContain("noQuestion");
  });

  it("erkennt einen Link", () => {
    expect(microYesProblems("Passt dir ein Termin? https://cal.com/x")).toContain("link");
  });

  it("erkennt mehrere Zeilen", () => {
    expect(microYesProblems("Willst du es sehen?\nOder lieber telefonieren?")).toContain("multiline");
  });

  it("meldet ein leeres Feld genau einmal", () => {
    // Leer ist ein eigener Zustand, kein Buendel aus vier Verstoessen — sonst
    // steht am leeren Feld eine Mauer aus Befunden.
    expect(microYesProblems("   ")).toEqual(["empty"]);
  });
});

describe("mirrorsMicroYes", () => {
  it("erkennt ein gemeinsames inhaltliches Wort", () => {
    expect(mirrorsMicroYes("kurze Buchungsstrecke", "Soll ich dir die Buchungsstrecke zeigen?")).toBe(true);
  });

  it("meldet einen Betreff ohne Bezug", () => {
    expect(mirrorsMicroYes("Kurze Frage", "Soll ich dir die Buchungsstrecke zeigen?")).toBe(false);
  });

  it("ist nachsichtig, wenn nichts zu vergleichen ist", () => {
    expect(mirrorsMicroYes("Hi", "?")).toBe(true);
  });
});

describe("copiedFrom", () => {
  const notiz = "Role addresses like info@ or office@ get filtered out automatically";

  it("erkennt einen woertlich uebernommenen Feldinhalt", () => {
    const mail = `Hi,\n\nRole addresses like info@ or office@ get filtered out automatically, aber das ist zu ändern.`;
    expect(copiedFrom(mail, [notiz])).toEqual([notiz]);
  });

  it("laesst eine echte Umformulierung durch", () => {
    const mail = "Hi,\n\nPost an info@ landet bei euch nirgends, weil dahinter niemand sitzt.";
    expect(copiedFrom(mail, [notiz])).toEqual([]);
  });

  it("ignoriert Satzzeichen und Grossschreibung", () => {
    expect(copiedFrom("... ROLE ADDRESSES LIKE INFO@ OR OFFICE@ GET FILTERED OUT AUTOMATICALLY!", [notiz])).toHaveLength(1);
  });

  it("schlaegt bei kurzen Feldern nicht an", () => {
    // "90 Sekunden" steht im Angebot UND soll in der Mail stehen — das ist
    // keine Abschrift, das ist der Zweck.
    expect(copiedFrom("Dauert 90 Sekunden.", ["90 Sekunden"])).toEqual([]);
  });
});

describe("wordCount", () => {
  it("zaehlt ohne leere Stellen", () => {
    expect(wordCount("  zwei   worte  ")).toBe(2);
    expect(wordCount("")).toBe(0);
  });
});
