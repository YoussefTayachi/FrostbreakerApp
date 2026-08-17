import { describe, expect, it } from "vitest";
import {
  parseBannedWords,
  reviewIcebreaker,
  reviewIcebreakers,
  reviewSettingsFromWorkspace,
  sortVerdicts,
  summarizeReview,
  type IcebreakerRow,
} from "./review";
import { DEFAULT_BANNED_WORDS, DEFAULT_MAX_WORDS } from "../personalization-defaults";

const SETTINGS = { maxWords: 22, bannedWords: ["—", "-"], lang: "de" as const };

function row(patch: Partial<IcebreakerRow> = {}): IcebreakerRow {
  return {
    id: "b1",
    name: "Acme GmbH",
    personalization: "Ihr habt die Nische gehalten, waehrend andere breiter wurden. Dachte ich melde mich mal.",
    personalization_needs_review: false,
    ...patch,
  };
}

describe("parseBannedWords", () => {
  it("liest die gespeicherte Zeile", () => {
    expect(parseBannedWords("—, -, --")).toEqual(["—", "-", "--"]);
  });

  // Genau so steht es im echten Workspace: mit Komma am Ende.
  it("wirft leere Stuecke weg", () => {
    expect(parseBannedWords("—, -, --,")).toEqual(["—", "-", "--"]);
  });

  it("faellt ohne eigene Vorgabe auf die Voreinstellung zurueck", () => {
    expect(parseBannedWords(null)).toEqual(DEFAULT_BANNED_WORDS);
    expect(parseBannedWords("  ")).toEqual(DEFAULT_BANNED_WORDS);
  });
});

describe("reviewSettingsFromWorkspace", () => {
  it("nimmt die eigenen Vorgaben", () => {
    const s = reviewSettingsFromWorkspace(
      { personalization_max_words: 15, personalization_banned_words: "sehr, wirklich" },
      "de"
    );
    expect(s).toEqual({ maxWords: 15, bannedWords: ["sehr", "wirklich"], lang: "de" });
  });

  it("kommt ohne Workspace klar", () => {
    expect(reviewSettingsFromWorkspace(null, "en").maxWords).toBe(DEFAULT_MAX_WORDS);
  });
});

describe("reviewIcebreaker", () => {
  it("nennt eine saubere, nie markierte Zeile clean", () => {
    expect(reviewIcebreaker(row(), SETTINGS).state).toBe("clean");
  });

  /**
   * Der Kern der ganzen Datei: die Bindestrich-Korrektur vom 2026-08-02 hat
   * hunderte Markierungen entwertet. Ein Bindestrich im Wort ist kein
   * Verstoss — die Zeile ist damit nur noch veraltet markiert, nicht
   * fehlerhaft.
   */
  it("erkennt eine veraltete Markierung als stale", () => {
    const v = reviewIcebreaker(
      row({
        personalization: "Ihr setzt auf NSF-certified Produkte statt auf Masse. Dachte ich melde mich mal.",
        personalization_needs_review: true,
      }),
      SETTINGS
    );
    expect(v.state).toBe("stale");
    expect(v.problems).toEqual([]);
    expect(v.wasFlagged).toBe(true);
  });

  it("meldet einen echten Verstoss als failing, auch wenn er damals schon markiert war", () => {
    const v = reviewIcebreaker(
      row({ personalization: "Ihr habt die Nische gehalten — dachte ich melde mich mal.", personalization_needs_review: true }),
      SETTINGS
    );
    expect(v.state).toBe("failing");
    expect(v.problems[0]).toContain("verbotene");
  });

  /**
   * Der Fall, den ein reiner Filter auf das Flag nie zeigen wuerde: nie
   * markiert, nach heutigen Regeln trotzdem auffaellig. An echten Daten
   * betraf das 31 Zeilen.
   */
  it("meldet auch eine NIE markierte Zeile, die heute auffaellt", () => {
    const v = reviewIcebreaker(
      row({
        personalization: Array.from({ length: 30 }, (_, i) => `Wort${i}`).join(" "),
        personalization_needs_review: false,
      }),
      SETTINGS
    );
    expect(v.state).toBe("failing");
    expect(v.words).toBe(30);
    expect(v.wasFlagged).toBe(false);
  });

  it("zaehlt die Woerter fuer die Anzeige mit", () => {
    expect(reviewIcebreaker(row({ personalization: "Drei kurze Woerter" }), SETTINGS).words).toBe(3);
  });
});

describe("reviewIcebreakers", () => {
  // Ohne Text gibt es nichts abzuwaegen — das ist ein Fall fuer den Torwart
  // ("Leads ohne Aufhaenger"), nicht fuer die Pruefliste.
  it("laesst Firmen ohne Icebreaker aus", () => {
    const verdicts = reviewIcebreakers(
      [row({ id: "a" }), row({ id: "b", personalization: null }), row({ id: "c", personalization: "   " })],
      SETTINGS
    );
    expect(verdicts.map((v) => v.id)).toEqual(["a"]);
  });
});

describe("summarizeReview", () => {
  it("zaehlt je Zustand", () => {
    const verdicts = reviewIcebreakers(
      [
        row({ id: "sauber" }),
        row({ id: "veraltet", personalization_needs_review: true }),
        row({ id: "kaputt", personalization: "Ein Satz mit — Gedankenstrich." }),
      ],
      SETTINGS
    );
    expect(summarizeReview(verdicts)).toEqual({ failing: 1, stale: 1, clean: 1, total: 3 });
  });

  it("kommt mit einer leeren Liste klar", () => {
    expect(summarizeReview([]).total).toBe(0);
  });
});

describe("sortVerdicts", () => {
  it("stellt die fehlerhaften nach oben, die laengsten zuerst", () => {
    const lang = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const mittel = Array.from({ length: 25 }, (_, i) => `w${i}`).join(" ");
    const sorted = sortVerdicts(
      reviewIcebreakers(
        [
          row({ id: "sauber" }),
          row({ id: "mittel", personalization: mittel }),
          row({ id: "veraltet", personalization_needs_review: true }),
          row({ id: "lang", personalization: lang }),
        ],
        SETTINGS
      )
    );
    expect(sorted.map((v) => v.id)).toEqual(["lang", "mittel", "veraltet", "sauber"]);
  });

  it("laesst die Eingabe unangetastet", () => {
    const input = reviewIcebreakers([row({ id: "a" }), row({ id: "b" })], SETTINGS);
    sortVerdicts(input);
    expect(input.map((v) => v.id)).toEqual(["a", "b"]);
  });
});
