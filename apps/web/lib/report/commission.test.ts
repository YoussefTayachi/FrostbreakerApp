import { describe, expect, it } from "vitest";
import {
  byCampaign,
  monthOf,
  monthsPresent,
  replies,
  sumUp,
  toCsv,
  type CommissionRow,
} from "./commission";

const MEINE = "camp-mine";
const FREMD = "camp-theirs";
const marked = new Map([[MEINE, "retaiyn US"]]);

function out(email: string, at: string, campaign = MEINE): CommissionRow {
  return {
    direction: "outbound",
    from_email: email,
    instantly_campaign_id: campaign,
    ai_interest: null,
    sent_at: at,
    created_at: at,
  };
}

function ein(email: string, at: string, interest: string | null, campaign = MEINE): CommissionRow {
  return {
    direction: "inbound",
    from_email: email,
    instantly_campaign_id: campaign,
    ai_interest: interest,
    sent_at: at,
    created_at: at,
  };
}

describe("byCampaign", () => {
  // Der Kern: die Kampagne der anderen Firma sendet aus demselben Konto und
  // darf trotzdem in keiner Zahl auftauchen.
  it("zaehlt nur markierte Kampagnen", () => {
    const rows = [
      out("a@x.com", "2026-09-01T08:00:00Z"),
      ein("a@x.com", "2026-09-02T08:00:00Z", "interested"),
      out("b@y.com", "2026-09-01T08:00:00Z", FREMD),
      ein("b@y.com", "2026-09-02T08:00:00Z", "interested", FREMD),
    ];
    const result = byCampaign(rows, marked, null);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("retaiyn US");
    expect(result[0].totals).toEqual({ contacted: 1, replied: 1, human: 1, positive: 1 });
  });

  // Vier Stufen an dieselbe Adresse sind ein angeschriebener Kontakt, nicht
  // vier. Sonst waechst die Zahl mit der Laenge der Sequenz.
  it("zaehlt Adressen und nicht Mails", () => {
    const rows = [
      out("a@x.com", "2026-09-01T08:00:00Z"),
      out("a@x.com", "2026-09-04T08:00:00Z"),
      out("a@x.com", "2026-09-06T08:00:00Z"),
      ein("a@x.com", "2026-09-07T08:00:00Z", "question"),
      ein("a@x.com", "2026-09-08T08:00:00Z", "question"),
    ];
    expect(byCampaign(rows, marked, null)[0].totals).toEqual({
      contacted: 1,
      replied: 1,
      human: 1,
      positive: 1,
    });
  });

  // Der Unterschied, der eine Abrechnung entscheidet.
  it("trennt Abwesenheitsnotiz von einer Antwort eines Menschen", () => {
    const rows = [
      out("a@x.com", "2026-09-01T08:00:00Z"),
      out("b@x.com", "2026-09-01T08:00:00Z"),
      out("c@x.com", "2026-09-01T08:00:00Z"),
      ein("a@x.com", "2026-09-02T08:00:00Z", "out_of_office"),
      ein("b@x.com", "2026-09-02T08:00:00Z", "not_interested"),
      ein("c@x.com", "2026-09-02T08:00:00Z", "interested"),
    ];
    expect(byCampaign(rows, marked, null)[0].totals).toEqual({
      contacted: 3,
      replied: 3,
      human: 2,
      positive: 1,
    });
  });

  // Ein fehlendes Etikett heisst "noch nicht eingestuft", nicht "Maschine".
  it("zaehlt eine Antwort ohne Etikett als Mensch, aber nicht als positiv", () => {
    const rows = [out("a@x.com", "2026-09-01T08:00:00Z"), ein("a@x.com", "2026-09-02T08:00:00Z", null)];
    expect(byCampaign(rows, marked, null)[0].totals).toEqual({
      contacted: 1,
      replied: 1,
      human: 1,
      positive: 0,
    });
  });

  it("filtert nach Monat", () => {
    const rows = [
      out("a@x.com", "2026-08-30T08:00:00Z"),
      ein("a@x.com", "2026-09-01T08:00:00Z", "interested"),
      ein("b@x.com", "2026-08-31T08:00:00Z", "interested"),
    ];
    expect(byCampaign(rows, marked, "2026-09")[0].totals.replied).toBe(1);
    expect(byCampaign(rows, marked, "2026-08")[0].totals.replied).toBe(1);
    expect(byCampaign(rows, marked, "2026-07")).toHaveLength(0);
  });

  it("kommt mit leeren Eingaben klar", () => {
    expect(byCampaign([], marked, null)).toEqual([]);
    expect(byCampaign([out("a@x.com", "2026-09-01T08:00:00Z")], new Map(), null)).toEqual([]);
  });
});

describe("sumUp", () => {
  it("addiert ueber mehrere Kampagnen", () => {
    const zwei = new Map([
      ["c1", "Kampagne 1"],
      ["c2", "Kampagne 2"],
    ]);
    const rows = [
      out("a@x.com", "2026-09-01T08:00:00Z", "c1"),
      ein("a@x.com", "2026-09-02T08:00:00Z", "interested", "c1"),
      out("b@x.com", "2026-09-01T08:00:00Z", "c2"),
      ein("b@x.com", "2026-09-02T08:00:00Z", "out_of_office", "c2"),
    ];
    expect(sumUp(byCampaign(rows, zwei, null))).toEqual({
      contacted: 2,
      replied: 2,
      human: 1,
      positive: 1,
    });
  });
});

describe("replies", () => {
  // Die Provision haengt an der Antwort, nicht am Umfang des Hin und Her.
  it("nimmt je Adresse die erste Antwort", () => {
    const rows = [
      ein("a@x.com", "2026-09-05T08:00:00Z", "question"),
      ein("a@x.com", "2026-09-02T08:00:00Z", "interested"),
    ];
    const list = replies(rows, marked, null);
    expect(list).toHaveLength(1);
    expect(list[0].at).toBe("2026-09-02T08:00:00Z");
    expect(list[0].interest).toBe("interested");
  });

  it("laesst Ausgaenge und fremde Kampagnen draussen", () => {
    const rows = [
      out("a@x.com", "2026-09-01T08:00:00Z"),
      ein("b@x.com", "2026-09-02T08:00:00Z", "interested", FREMD),
    ];
    expect(replies(rows, marked, null)).toEqual([]);
  });

  it("sortiert neueste zuerst", () => {
    const rows = [
      ein("a@x.com", "2026-09-02T08:00:00Z", "interested"),
      ein("b@x.com", "2026-09-09T08:00:00Z", "question"),
    ];
    expect(replies(rows, marked, null).map((r) => r.email)).toEqual(["b@x.com", "a@x.com"]);
  });
});

describe("monthOf und monthsPresent", () => {
  it("schneidet auf YYYY-MM", () => {
    expect(monthOf("2026-09-22T07:03:02.073999+00:00")).toBe("2026-09");
  });

  it("listet nur Monate markierter Kampagnen, neueste zuerst", () => {
    const rows = [
      out("a@x.com", "2026-08-30T08:00:00Z"),
      ein("a@x.com", "2026-09-01T08:00:00Z", "interested"),
      ein("b@x.com", "2026-07-01T08:00:00Z", "interested", FREMD),
    ];
    expect(monthsPresent(rows, marked)).toEqual(["2026-09", "2026-08"]);
  });
});

describe("toCsv", () => {
  it("schreibt Kopfzeile und Semikolon als Trenner", () => {
    const csv = toCsv([
      { email: "a@x.com", campaignLabel: "retaiyn US", interest: "interested", at: "2026-09-02T08:00:00Z" },
    ]);
    expect(csv.split("\n")[0]).toBe("email;kampagne;einstufung;datum");
    expect(csv.split("\n")[1]).toBe("a@x.com;retaiyn US;interested;2026-09-02T08:00:00Z");
  });

  // Ein Semikolon im Kampagnennamen darf die Spalten nicht verschieben.
  it("maskiert Trennzeichen und Anfuehrungszeichen", () => {
    const csv = toCsv([
      { email: "a@x.com", campaignLabel: 'US; "Q4"', interest: null, at: "2026-09-02T08:00:00Z" },
    ]);
    expect(csv.split("\n")[1]).toBe('a@x.com;"US; ""Q4""";;2026-09-02T08:00:00Z');
  });
});
