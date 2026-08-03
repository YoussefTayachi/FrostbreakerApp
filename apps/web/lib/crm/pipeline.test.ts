import { describe, expect, it } from "vitest";
import {
  STALE_AFTER_DAYS,
  daysInStage,
  displayName,
  hasNoNextStep,
  isStale,
  type PipelineRow,
} from "./pipeline";

const NOW = new Date("2026-08-03T12:00:00Z");

function row(patch: Partial<PipelineRow> = {}): PipelineRow {
  return {
    id: "c1",
    full_name: null,
    first_name: null,
    last_name: null,
    title: null,
    email: null,
    phone: null,
    phone_is_company: false,
    linkedin: null,
    outreach_status: "contacted",
    business_id: "b1",
    created_at: "2026-07-01T00:00:00Z",
    company_name: null,
    company_website: null,
    list_id: null,
    list_name: null,
    list_location: null,
    list_source: null,
    last_touch_at: null,
    last_touch_channel: null,
    last_reply_at: null,
    next_due_at: null,
    next_due_subject: null,
    next_due_channel: null,
    next_due_type: null,
    stage_since: "2026-08-01T12:00:00Z",
    ...patch,
  };
}

describe("displayName", () => {
  it("nimmt den vollen Namen", () => {
    expect(displayName(row({ full_name: "Anna Berg" }), "-")).toBe("Anna Berg");
  });

  it("setzt sonst Vor- und Nachnamen zusammen", () => {
    expect(displayName(row({ first_name: "Anna", last_name: "Berg" }), "-")).toBe("Anna Berg");
  });

  it("kommt mit nur einem Namensteil klar", () => {
    expect(displayName(row({ last_name: "Berg" }), "-")).toBe("Berg");
  });

  it("faellt auf den Ersatztext zurueck, nie auf eine leere Zeile", () => {
    expect(displayName(row(), "Ohne Namen")).toBe("Ohne Namen");
  });
});

describe("daysInStage", () => {
  it("rechnet volle Tage", () => {
    expect(daysInStage(row({ stage_since: "2026-08-01T12:00:00Z" }), NOW)).toBe(2);
  });

  it("gibt 0 fuer heute", () => {
    expect(daysInStage(row({ stage_since: "2026-08-03T06:00:00Z" }), NOW)).toBe(0);
  });

  it("gibt null ohne Zeitpunkt", () => {
    expect(daysInStage(row({ stage_since: null }), NOW)).toBeNull();
  });
});

describe("isStale", () => {
  it("meldet Stillstand ab der Schwelle", () => {
    const since = new Date(NOW.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString();
    expect(isStale(row({ stage_since: since }), NOW)).toBe(true);
  });

  it("meldet einen Tag davor noch nichts", () => {
    const since = new Date(NOW.getTime() - (STALE_AFTER_DAYS - 1) * 86_400_000).toISOString();
    expect(isStale(row({ stage_since: since }), NOW)).toBe(false);
  });

  // Ein Kunde ist kein liegengebliebener Vorgang, sondern das Ergebnis.
  it("meldet bei Endzustaenden nie Stillstand", () => {
    const since = new Date(NOW.getTime() - 400 * 86_400_000).toISOString();
    expect(isStale(row({ stage_since: since, outreach_status: "customer" }), NOW)).toBe(false);
    expect(isStale(row({ stage_since: since, outreach_status: "not_interested" }), NOW)).toBe(false);
  });

  it("meldet ohne Zeitpunkt nichts", () => {
    expect(isStale(row({ stage_since: null }), NOW)).toBe(false);
  });
});

describe("hasNoNextStep", () => {
  it("meldet fehlenden naechsten Schritt", () => {
    expect(hasNoNextStep(row({ next_due_at: null }))).toBe(true);
  });

  it("meldet nichts, wenn ein Termin steht", () => {
    expect(hasNoNextStep(row({ next_due_at: "2026-08-10T00:00:00Z" }))).toBe(false);
  });

  // Bei einem gewonnenen Kunden fehlt kein Schritt, es ist einer zu viel.
  it("verlangt bei Endzustaenden keinen naechsten Schritt", () => {
    expect(hasNoNextStep(row({ next_due_at: null, outreach_status: "customer" }))).toBe(false);
    expect(hasNoNextStep(row({ next_due_at: null, outreach_status: "not_interested" }))).toBe(false);
  });
});
