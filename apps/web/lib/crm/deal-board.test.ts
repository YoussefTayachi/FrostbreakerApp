import { describe, expect, it } from "vitest";
import {
  DEAL_STALE_AFTER_DAYS,
  dealSubtitle,
  dealValue,
  groupByStage,
  isDealStale,
  isOverdue,
  stageTotal,
  stageWeighted,
  type DealBoardRow,
} from "./deal-board";

const NOW = new Date("2026-08-03T12:00:00Z");

function deal(patch: Partial<DealBoardRow> = {}): DealBoardRow {
  return {
    id: "d1",
    title: "Website-Relaunch",
    value: 1000,
    currency: "EUR",
    stage: "qualified",
    probability: 20,
    expected_close_date: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    business_id: "b1",
    contact_id: "c1",
    company_name: "Acme",
    company_website: null,
    full_name: null,
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    linkedin: null,
    next_due_at: null,
    next_due_subject: null,
    days_idle: 0,
    ...patch,
  };
}

describe("dealValue", () => {
  // Der eigentliche Grund fuer diese Funktion: PostgREST liefert numeric als
  // String. Ungeprueft addiert waere "1000" + "2000" die Zeichenkette
  // "10002000", eine Spaltensumme, die plausibel aussieht und falsch ist.
  it("rechnet einen String aus PostgREST in eine Zahl um", () => {
    expect(dealValue({ value: "1500.50" })).toBe(1500.5);
  });

  it("nimmt eine Zahl unveraendert", () => {
    expect(dealValue({ value: 1500.5 })).toBe(1500.5);
  });

  it("faengt Unbrauchbares als 0 ab, statt NaN weiterzureichen", () => {
    expect(dealValue({ value: "keine Zahl" })).toBe(0);
  });
});

describe("stageTotal", () => {
  it("summiert Werte", () => {
    expect(stageTotal([deal({ value: 1000 }), deal({ value: 2500 })])).toBe(3500);
  });

  it("summiert auch String-Werte korrekt", () => {
    expect(stageTotal([deal({ value: "1000" }), deal({ value: "2000" })])).toBe(3000);
  });

  it("ist bei leerer Spalte 0", () => {
    expect(stageTotal([])).toBe(0);
  });
});

describe("stageWeighted", () => {
  it("gewichtet mit der Wahrscheinlichkeit", () => {
    expect(stageWeighted([deal({ value: 10000, probability: 20 })])).toBe(2000);
  });

  // Der Satz, um den es geht: vier Deals zu 10.000 in der Erstqualifizierung
  // sind nicht 40.000.
  it("vier Deals zu 10.000 bei 20 Prozent sind 8.000", () => {
    const rows = Array.from({ length: 4 }, () => deal({ value: 10000, probability: 20 }));
    expect(stageTotal(rows)).toBe(40000);
    expect(stageWeighted(rows)).toBe(8000);
  });
});

describe("groupByStage", () => {
  it("verteilt auf die Stufen", () => {
    const groups = groupByStage([
      deal({ id: "a", stage: "qualified" }),
      deal({ id: "b", stage: "proposal" }),
      deal({ id: "c", stage: "proposal" }),
    ]);
    expect(groups.qualified).toHaveLength(1);
    expect(groups.proposal).toHaveLength(2);
  });

  it("behaelt leere Stufen als leere Spalte", () => {
    const groups = groupByStage([deal({ stage: "qualified" })]);
    expect(groups.negotiation).toEqual([]);
    expect(Object.keys(groups)).toHaveLength(4);
  });

  it("laesst einen unbekannten Stufenwert nicht verschwinden", () => {
    const groups = groupByStage([deal({ stage: "erfunden" as never })]);
    const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
    expect(total).toBe(1);
  });
});

describe("isDealStale", () => {
  it("meldet ab der Schwelle", () => {
    expect(isDealStale({ days_idle: DEAL_STALE_AFTER_DAYS })).toBe(true);
  });

  it("meldet einen Tag davor nicht", () => {
    expect(isDealStale({ days_idle: DEAL_STALE_AFTER_DAYS - 1 })).toBe(false);
  });

  it("kommt mit fehlendem Wert klar", () => {
    expect(isDealStale({ days_idle: null })).toBe(false);
  });
});

describe("isOverdue", () => {
  it("meldet ein verstrichenes Abschlussdatum", () => {
    expect(isOverdue({ expected_close_date: "2026-08-01" }, NOW)).toBe(true);
  });

  // Ein Deal, der heute schliessen soll, ist heute noch nicht ueberfaellig.
  it("meldet den heutigen Tag nicht als ueberfaellig", () => {
    expect(isOverdue({ expected_close_date: "2026-08-03" }, NOW)).toBe(false);
  });

  it("meldet ohne Datum nichts", () => {
    expect(isOverdue({ expected_close_date: null }, NOW)).toBe(false);
  });
});

describe("dealSubtitle", () => {
  it("nennt Firma und Person", () => {
    expect(dealSubtitle(deal({ company_name: "Acme", full_name: "Anna Berg" }))).toBe(
      "Acme · Anna Berg"
    );
  });

  it("setzt den Namen aus Vor- und Nachnamen zusammen", () => {
    expect(dealSubtitle(deal({ first_name: "Anna", last_name: "Berg" }))).toBe("Acme · Anna Berg");
  });

  it("nennt nur die Firma, wenn kein Kontakt haengt", () => {
    expect(dealSubtitle(deal({ contact_id: null }))).toBe("Acme");
  });
});
