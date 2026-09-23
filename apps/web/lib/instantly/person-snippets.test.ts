import { describe, expect, it } from "vitest";
import {
  buildInstantlyLead,
  mergeTagValues,
  PERSON_SNIPPET_FIELDS,
  usesPersonFinding,
  usesPersonSnippets,
  type MergeTagSource,
} from "./campaigns";
import { hasPersonSnippets, pickLeadsForSend, type CampaignContactRow } from "./create-campaign";

const schnipsel = {
  thingWeHaveInCommon: "Email marketing for ecom brands",
  platformWhereIGotIt: "LinkedIn",
  whatTheySaid: "Womaness launching in over a thousand Walmart stores",
  thingWeHaveSynergyAround: "revenue from customers you already have",
  whatTheyDoWell: "built a brand women come back to",
  whatTheyLeaveOnTheTable: "default templates leave that money on the table",
};

function lead(extra: Partial<MergeTagSource> = {}): MergeTagSource {
  return {
    email: "sally@womaness.com",
    first_name: "Sally",
    last_name: "Mueller",
    person_finding: "Absatz.",
    person_finding_needs_review: false,
    person_snippets: schnipsel,
    businesses: { name: "Womaness", personalization: null, website_finding: null },
    ...extra,
  };
}

describe("Schnipsel als Merge-Tags", () => {
  it("liefert alle sechs Werte und laedt sie in custom_variables hoch", () => {
    const v = mergeTagValues(lead());
    for (const f of PERSON_SNIPPET_FIELDS) expect(v[f]).toBe(schnipsel[f]);
    const up = buildInstantlyLead(lead());
    expect(up.custom_variables).toMatchObject(schnipsel);
  });

  it("laesst fehlende Schnipsel leer und ohne Eintrag beim Upload", () => {
    const v = mergeTagValues(lead({ person_snippets: null }));
    for (const f of PERSON_SNIPPET_FIELDS) expect(v[f]).toBe("");
    expect(buildInstantlyLead(lead({ person_snippets: null })).custom_variables).toEqual({
      personFinding: "Absatz.",
    });
  });

  it("erkennt eine Sequenz, die Schnipsel benutzt, als Personen-Sequenz", () => {
    const steps = [{ subject: "Hi", body: "{{thingWeHaveInCommon}} is what I do too." }];
    expect(usesPersonSnippets(steps)).toBe(true);
    expect(usesPersonFinding(steps)).toBe(true);
    expect(usesPersonSnippets([{ subject: "", body: "{{personFinding}}" }])).toBe(false);
  });
});

describe("Rueckhalten ohne Schnipsel", () => {
  const row = (id: string, snips: Record<string, string> | null): CampaignContactRow => ({
    id,
    email: `${id}@x.com`,
    first_name: null,
    last_name: null,
    title: null,
    business_id: `b-${id}`,
    is_primary: true,
    outreach_status: "new",
    email_verification_status: null,
    person_finding: "Absatz.",
    person_finding_needs_review: false,
    person_snippets: snips,
    businesses: { name: null, website: null, personalization: null, website_finding: null },
  });

  it("verlangt alle sechs Schluessel", () => {
    expect(hasPersonSnippets(row("a", schnipsel))).toBe(true);
    expect(hasPersonSnippets(row("b", { ...schnipsel, whatTheySaid: " " }))).toBe(false);
    expect(hasPersonSnippets(row("c", null))).toBe(false);
  });

  it("haelt Kontakte ohne Schnipsel nur zurueck, wenn die Sequenz sie braucht", () => {
    const rows = [row("a", schnipsel), row("b", null)];
    expect(pickLeadsForSend(rows, true, true).rows.map((r) => r.id)).toEqual(["a"]);
    expect(pickLeadsForSend(rows, true, false).rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
