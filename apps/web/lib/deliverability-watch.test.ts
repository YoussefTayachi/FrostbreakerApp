import { describe, expect, it } from "vitest";
import {
  DOMAIN_CHECK_INTERVAL_MS,
  assessBounces,
  domainChange,
  domainCheckDue,
  domainIsBroken,
  type CampaignBounceState,
  type DomainCheck,
} from "./deliverability-watch";
import { BOUNCE_MIN_SAMPLE } from "./campaign-readiness";

function dom(patch: Partial<DomainCheck> = {}): DomainCheck {
  return { domain: "acme.de", spf: true, dkim: true, dmarc: true, ...patch };
}

function camp(patch: Partial<CampaignBounceState> = {}): CampaignBounceState {
  return {
    campaignId: "c1",
    name: "US E-Com",
    instantlyCampaignId: "i1",
    sent: 200,
    bounced: 2,
    active: true,
    ...patch,
  };
}

describe("domainIsBroken", () => {
  it("bei fehlendem SPF oder DKIM", () => {
    expect(domainIsBroken(dom({ spf: false }))).toBe(true);
    expect(domainIsBroken(dom({ dkim: false }))).toBe(true);
  });

  /**
   * DMARC ist wichtig, aber eine Mail ohne DMARC wird nicht zwingend
   * abgewiesen. Ein Alarm, der taeglich fuer etwas Nicht-Dringendes
   * schrillt, erzieht dazu, Alarme zu ignorieren.
   */
  it("nicht bei fehlendem DMARC allein", () => {
    expect(domainIsBroken(dom({ dmarc: false }))).toBe(false);
  });

  it("nicht bei vollstaendiger Domain", () => {
    expect(domainIsBroken(dom())).toBe(false);
  });
});

describe("domainChange — nur der Uebergang wird gemeldet", () => {
  it("meldet den Bruch", () => {
    expect(domainChange(dom(), dom({ dkim: false }))).toBe("broke");
  });

  /**
   * Eine seit Wochen kaputte Domain jeden Tag erneut zu melden ist die
   * zuverlaessigste Art, dafuer zu sorgen, dass die Meldung weggeklickt wird
   * -- und mit ihr die vom Tag, an dem etwas Neues passiert.
   */
  it("meldet einen anhaltenden Bruch nicht erneut", () => {
    expect(domainChange(dom({ spf: false }), dom({ spf: false }))).toBe("still_broken");
  });

  it("meldet die Behebung", () => {
    expect(domainChange(dom({ spf: false }), dom())).toBe("recovered");
  });

  it("schweigt, wenn alles in Ordnung bleibt", () => {
    expect(domainChange(dom(), dom())).toBe("still_ok");
  });

  // Beim allerersten Lauf soll eine kaputte Domain gemeldet werden, nicht
  // erst beim naechsten Wechsel.
  it("behandelt den ersten Lauf einer kaputten Domain als Bruch", () => {
    expect(domainChange(null, dom({ dkim: false }))).toBe("broke");
  });

  it("meldet beim ersten Lauf einer gesunden Domain nichts", () => {
    expect(domainChange(null, dom())).toBe("still_ok");
  });
});

describe("assessBounces", () => {
  it("haelt eine Kampagne ueber der Schwelle an", () => {
    const [v] = assessBounces([camp({ sent: 200, bounced: 20 })]);
    expect(v.shouldPause).toBe(true);
    expect(v.rate).toBeCloseTo(0.1);
  });

  it("laesst eine saubere Kampagne laufen", () => {
    expect(assessBounces([camp({ sent: 200, bounced: 2 })])[0].shouldPause).toBe(false);
  });

  /**
   * Bei 20 Mails ist ein einziger Bounce schon 5 Prozent. Dieselbe
   * Mindestmenge wie beim Torwart, und absichtlich aus derselben Konstante --
   * zwei Zahlen fuer dieselbe Frage driften auseinander.
   */
  it("schweigt unter der Mindestmenge, auch bei hoher Quote", () => {
    const [v] = assessBounces([camp({ sent: BOUNCE_MIN_SAMPLE - 1, bounced: 20 })]);
    expect(v.shouldPause).toBe(false);
  });

  it("laesst eine bereits pausierte Kampagne in Ruhe", () => {
    const [v] = assessBounces([camp({ sent: 200, bounced: 20, active: false })]);
    expect(v.shouldPause).toBe(false);
  });

  // Kollektivstrafe vermeiden: nur die auffaellige Liste wird angehalten.
  it("beurteilt jede Kampagne fuer sich", () => {
    const verdicts = assessBounces([
      camp({ campaignId: "gut", sent: 200, bounced: 1 }),
      camp({ campaignId: "schlecht", sent: 200, bounced: 30 }),
    ]);
    expect(verdicts.map((v) => v.shouldPause)).toEqual([false, true]);
  });

  it("kommt ohne Versand klar", () => {
    const [v] = assessBounces([camp({ sent: 0, bounced: 0 })]);
    expect(v.rate).toBe(0);
    expect(v.shouldPause).toBe(false);
  });
});

describe("domainCheckDue", () => {
  const now = new Date("2026-08-05T12:00:00Z").getTime();

  it("ist faellig, wenn noch nie geprueft wurde", () => {
    expect(domainCheckDue(null, now)).toBe(true);
  });

  it("ist nach einem Tag wieder faellig", () => {
    expect(domainCheckDue(new Date(now - DOMAIN_CHECK_INTERVAL_MS).toISOString(), now)).toBe(true);
  });

  // Ohne diese Bremse waeren es bei einem Minutentakt 1440 DNS-Abfragen je
  // Domain und Tag fuer eine Antwort, die sich fast nie aendert.
  it("ist kurz nach einer Pruefung nicht faellig", () => {
    expect(domainCheckDue(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });
});
