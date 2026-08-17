import { describe, expect, it } from "vitest";
import {
  countLeads,
  hasProblem,
  isContacted,
  matchesFilter,
  sortLeads,
  type CampaignLead,
} from "./campaign-leads";

function lead(patch: Partial<CampaignLead> = {}): CampaignLead {
  return {
    id: "l1",
    email: "a@x.com",
    name: "Anna Berg",
    company: "Acme",
    contacted_at: null,
    opens: 0,
    clicks: 0,
    replies: 0,
    bounced: false,
    unsubscribed: false,
    ...patch,
  };
}

describe("isContacted", () => {
  // Der Kern der Ansicht: der Zeitstempel entscheidet, nicht Instantlys
  // Zahlencode — der steht auch waehrend einer laufenden Sequenz auf 1.
  it("gilt als kontaktiert, sobald ein Zeitpunkt da ist", () => {
    expect(isContacted(lead({ contacted_at: "2026-08-03T12:00:00Z" }))).toBe(true);
  });

  it("ohne Zeitpunkt nicht", () => {
    expect(isContacted(lead({ contacted_at: null }))).toBe(false);
  });
});

describe("hasProblem", () => {
  it("umfasst Bounces und Abmeldungen", () => {
    expect(hasProblem(lead({ bounced: true }))).toBe(true);
    expect(hasProblem(lead({ unsubscribed: true }))).toBe(true);
    expect(hasProblem(lead())).toBe(false);
  });
});

describe("matchesFilter", () => {
  const kontaktiert = lead({ contacted_at: "2026-08-03T12:00:00Z" });
  const offen = lead();
  const geantwortet = lead({ contacted_at: "2026-08-03T12:00:00Z", replies: 1 });
  const gebounct = lead({ bounced: true });

  it("zeigt bei 'alle' alles", () => {
    for (const l of [kontaktiert, offen, geantwortet, gebounct]) {
      expect(matchesFilter(l, "all")).toBe(true);
    }
  });

  it("trennt kontaktiert und ausstehend", () => {
    expect(matchesFilter(kontaktiert, "contacted")).toBe(true);
    expect(matchesFilter(offen, "contacted")).toBe(false);
    expect(matchesFilter(offen, "pending")).toBe(true);
    expect(matchesFilter(kontaktiert, "pending")).toBe(false);
  });

  // Bei einem Bounce wird nichts mehr passieren — ihn als "ausstehend" zu
  // fuehren waere die Aufforderung, auf etwas zu warten, das nie kommt.
  it("fuehrt einen Bounce nicht als ausstehend", () => {
    expect(matchesFilter(gebounct, "pending")).toBe(false);
    expect(matchesFilter(gebounct, "problem")).toBe(true);
  });

  it("findet Antworten", () => {
    expect(matchesFilter(geantwortet, "replied")).toBe(true);
    expect(matchesFilter(kontaktiert, "replied")).toBe(false);
  });
});

describe("countLeads", () => {
  it("zaehlt je Filter", () => {
    const counts = countLeads([
      lead({ contacted_at: "2026-08-03T12:00:00Z" }),
      lead({ contacted_at: "2026-08-03T12:00:00Z", replies: 2 }),
      lead(),
      lead({ bounced: true }),
    ]);
    expect(counts.all).toBe(4);
    expect(counts.contacted).toBe(2);
    expect(counts.pending).toBe(1);
    expect(counts.replied).toBe(1);
    expect(counts.problem).toBe(1);
  });

  it("kommt mit leerer Liste klar", () => {
    expect(countLeads([]).all).toBe(0);
  });
});

describe("sortLeads", () => {
  it("stellt Antworten nach oben, Erledigtes nach unten", () => {
    const sorted = sortLeads([
      lead({ id: "kontaktiert", contacted_at: "2026-08-01T00:00:00Z" }),
      lead({ id: "offen" }),
      lead({ id: "bounce", bounced: true }),
      lead({ id: "antwort", contacted_at: "2026-08-01T00:00:00Z", replies: 1 }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["antwort", "bounce", "offen", "kontaktiert"]);
  });

  it("sortiert innerhalb einer Gruppe die zuletzt angefassten zuerst", () => {
    const sorted = sortLeads([
      lead({ id: "alt", contacted_at: "2026-08-01T00:00:00Z" }),
      lead({ id: "neu", contacted_at: "2026-08-03T00:00:00Z" }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["neu", "alt"]);
  });

  it("laesst die Eingabe unangetastet", () => {
    const input = [lead({ id: "a" }), lead({ id: "b", replies: 1 })];
    sortLeads(input);
    expect(input.map((l) => l.id)).toEqual(["a", "b"]);
  });
});
