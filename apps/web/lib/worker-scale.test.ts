import { describe, expect, it } from "vitest";
import { desiredReplicas, RUHE_NACH_MINUTEN, SCALE_DEFAULTS } from "./worker-scale";

// Die Zahlen unten spiegeln den gemessenen Tag (2026-08-31): ein Batch mit
// 240 Firmen erzeugte ueber 700 Jobs, dazwischen lagen Stunden voelliger
// Stille. Die Entscheidung muss beides billig machen.
describe("desiredReplicas", () => {
  it("faehrt bei vollem Batch auf die Obergrenze", () => {
    expect(
      desiredReplicas({ faellig: 700, laufend: 2, minutenSeitLetzterAktivitaet: 0 })
    ).toBe(SCALE_DEFAULTS.max);
  });

  it("nimmt fuer ein paar Nachzuegler nur die Zwischenstufe", () => {
    expect(desiredReplicas({ faellig: 3, laufend: 0, minutenSeitLetzterAktivitaet: 0 })).toBe(2);
  });

  it("haelt die Besetzung, solange noch etwas laeuft", () => {
    expect(desiredReplicas({ faellig: 0, laufend: 1, minutenSeitLetzterAktivitaet: 0 })).toBe(2);
  });

  it("haelt die Besetzung in der Luecke zwischen zwei Wellen", () => {
    // Recherche fertig, Befundsaetze noch nicht eingereiht: kurze Stille ist
    // kein Feierabend.
    expect(
      desiredReplicas({
        faellig: 0,
        laufend: 0,
        minutenSeitLetzterAktivitaet: RUHE_NACH_MINUTEN - 1,
      })
    ).toBe(2);
  });

  it("geht nach echter Stille auf die Ruhebesetzung", () => {
    expect(
      desiredReplicas({
        faellig: 0,
        laufend: 0,
        minutenSeitLetzterAktivitaet: RUHE_NACH_MINUTEN,
      })
    ).toBe(SCALE_DEFAULTS.ruhe);
  });

  it("die Ruhebesetzung ist nie null, sonst holt niemand mehr Jobs ab", () => {
    expect(
      desiredReplicas(
        { faellig: 0, laufend: 0, minutenSeitLetzterAktivitaet: 60 },
        { max: 6, ruhe: 0, burstAb: 50 }
      )
    ).toBe(1);
  });

  it("die Obergrenze deckelt auch den Burst", () => {
    expect(
      desiredReplicas(
        { faellig: 999, laufend: 0, minutenSeitLetzterAktivitaet: 0 },
        { max: 3, ruhe: 1, burstAb: 50 }
      )
    ).toBe(3);
  });
});
