import { describe, expect, it } from "vitest";
import {
  MIN_SENDS_PER_VARIANT,
  assessStep,
  assessSteps,
  proportionsDiffer,
  type VariantStats,
} from "./variant-winner";

function v(patch: Partial<VariantStats> & { variant: number }): VariantStats {
  return { step: 0, sent: 100, opened: 0, unique_replies: 3, ...patch };
}

describe("proportionsDiffer", () => {
  it("erkennt einen klaren Unterschied", () => {
    expect(proportionsDiffer(30, 200, 5, 200)).toBe(true);
  });

  it("haelt einen kleinen Unterschied fuer Zufall", () => {
    expect(proportionsDiffer(4, 100, 3, 100)).toBe(false);
  });

  it("kommt ohne einen einzigen Erfolg klar", () => {
    // Streuung null: es gibt nichts zu unterscheiden, und die Division
    // waere nicht definiert.
    expect(proportionsDiffer(0, 100, 0, 100)).toBe(false);
  });

  it("kommt mit ausschliesslich Erfolgen klar", () => {
    expect(proportionsDiffer(100, 100, 100, 100)).toBe(false);
  });

  it("meldet nichts ohne Sendungen", () => {
    expect(proportionsDiffer(0, 0, 0, 0)).toBe(false);
  });
});

describe("assessStep — schweigen, solange die Datenmenge nichts hergibt", () => {
  /**
   * Der wichtigste Test der Datei. Bei 40 Mails je Variante sieht 1 gegen 3
   * Antworten wie eine Verdreifachung aus und ist reines Rauschen. Wer danach
   * abschaltet, loescht mit einiger Wahrscheinlichkeit die bessere Fassung.
   */
  it("ruft bei zu wenig Sendungen keinen Gewinner aus, egal wie gross der Abstand wirkt", () => {
    const r = assessStep([
      v({ variant: 0, sent: 40, unique_replies: 1 }),
      v({ variant: 1, sent: 40, unique_replies: 3 }),
    ]);
    expect(r.winner).toBeNull();
    expect(r.variants.every((x) => x.verdict === "collecting")).toBe(true);
  });

  it("sagt, wie viele Sendungen noch fehlen", () => {
    const r = assessStep([
      v({ variant: 0, sent: 40, unique_replies: 1 }),
      v({ variant: 1, sent: 45, unique_replies: 3 }),
    ]);
    expect(r.missingSends).toBe(MIN_SENDS_PER_VARIANT - 40);
  });

  // Ein Feld ohne Gegner hat keinen Gewinner.
  it("behandelt eine einzelne Variante nicht als Gewinnerin", () => {
    const r = assessStep([v({ variant: 0, sent: 5000, unique_replies: 500 })]);
    expect(r.winner).toBeNull();
    expect(r.variants[0].verdict).toBe("collecting");
  });

  it("nennt genug Daten ohne klaren Abstand nur 'fuehrend'", () => {
    const r = assessStep([
      v({ variant: 0, sent: 200, unique_replies: 6 }),
      v({ variant: 1, sent: 200, unique_replies: 8 }),
    ]);
    expect(r.winner).toBeNull();
    expect(r.variants[1].verdict).toBe("leading");
    expect(r.variants[0].verdict).toBe("collecting");
  });
});

describe("assessStep — den Gewinner benennen", () => {
  it("kuert bei klarem Abstand und genug Daten", () => {
    const r = assessStep([
      v({ variant: 0, sent: 500, unique_replies: 5 }),
      v({ variant: 1, sent: 500, unique_replies: 50 }),
    ]);
    expect(r.winner).toBe(1);
    expect(r.variants[1].verdict).toBe("winner");
    expect(r.variants[0].verdict).toBe("behind");
  });

  /**
   * Der Gewinner muss gegen JEDE andere bestehen. Sonst waere der Fall
   * moeglich, dass A gegen C gewinnt, gegen B aber nicht, und man schaltet
   * B ab, obwohl sie die bessere sein koennte.
   */
  it("kuert niemanden, solange eine dritte Variante mithaelt", () => {
    const r = assessStep([
      v({ variant: 0, sent: 500, unique_replies: 50 }),
      v({ variant: 1, sent: 500, unique_replies: 48 }),
      v({ variant: 2, sent: 500, unique_replies: 5 }),
    ]);
    expect(r.winner).toBeNull();
    expect(r.variants[0].verdict).toBe("leading");
  });

  it("rechnet die Antwortquote je Variante mit", () => {
    const r = assessStep([v({ variant: 0, sent: 200, unique_replies: 10 })]);
    expect(r.variants[0].replyRate).toBeCloseTo(0.05);
  });

  it("kommt mit einer Variante ohne Versand klar", () => {
    const r = assessStep([v({ variant: 0, sent: 0, unique_replies: 0 }), v({ variant: 1, sent: 100 })]);
    expect(r.variants[0].replyRate).toBe(0);
    expect(r.winner).toBeNull();
  });

  it("sortiert die Varianten nach ihrer Nummer, nicht nach Eingang", () => {
    const r = assessStep([v({ variant: 2 }), v({ variant: 0 }), v({ variant: 1 })]);
    expect(r.variants.map((x) => x.variant)).toEqual([0, 1, 2]);
  });
});

describe("assessSteps", () => {
  it("gruppiert nach Schritt und sortiert aufsteigend", () => {
    const r = assessSteps([
      v({ step: 1, variant: 0 }),
      v({ step: 0, variant: 0 }),
      v({ step: 0, variant: 1 }),
    ]);
    expect(r.map((s) => s.step)).toEqual([0, 1]);
    expect(r[0].variants.length).toBe(2);
    expect(r[1].variants.length).toBe(1);
  });

  it("kommt mit einer leeren Auswertung klar", () => {
    expect(assessSteps([])).toEqual([]);
  });
});
