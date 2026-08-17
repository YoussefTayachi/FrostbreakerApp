import { describe, expect, it } from "vitest";
import {
  BOUNCE_MIN_SAMPLE,
  assessCampaign,
  estimateWords,
  hasLink,
  stepFacts,
  type CheckId,
  type ReadinessFacts,
  type Severity,
} from "./campaign-readiness";

/** Ein Zustand, bei dem nichts zu beanstanden ist — die Tests aendern je einen Punkt daran. */
function facts(patch: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return {
    sendableLeads: 200,
    unverifiedLeads: 0,
    leadsWithoutIcebreaker: 0,
    leadsWithFailingIcebreaker: 0,
    domains: [{ domain: "acme.de", spf: true, dkim: true, dmarc: true }],
    sentSoFar: 1000,
    bouncedSoFar: 5,
    steps: [
      { words: 70, hasLink: false },
      { words: 40, hasLink: true },
    ],
    ...patch,
  };
}

function severityOf(f: ReadinessFacts, id: CheckId): Severity {
  const check = assessCampaign(f).checks.find((c) => c.id === id);
  if (!check) throw new Error(`Pruefung ${id} fehlt`);
  return check.severity;
}

describe("assessCampaign — der saubere Fall", () => {
  it("laesst starten und meldet nichts", () => {
    const r = assessCampaign(facts());
    expect(r.canStart).toBe(true);
    expect(r.blockers).toBe(0);
    expect(r.warnings).toBe(0);
  });

  // Auch die bestandenen kommen zurueck: eine Liste, die nur Fehler zeigt,
  // beantwortet nicht, ob ueberhaupt hingeschaut wurde.
  it("gibt jede Pruefung zurueck, auch die bestandenen", () => {
    const r = assessCampaign(facts());
    expect(r.checks.length).toBe(11);
    expect(r.checks.every((c) => c.severity === "ok")).toBe(true);
  });
});

describe("Blocker", () => {
  it("ohne sendbare Leads", () => {
    expect(severityOf(facts({ sendableLeads: 0 }), "leads")).toBe("blocker");
    expect(assessCampaign(facts({ sendableLeads: 0 })).canStart).toBe(false);
  });

  it("bei fehlendem SPF und fehlendem DKIM", () => {
    const ohneSpf = facts({ domains: [{ domain: "acme.de", spf: false, dkim: true, dmarc: true }] });
    expect(severityOf(ohneSpf, "spf")).toBe("blocker");
    const ohneDkim = facts({ domains: [{ domain: "acme.de", spf: true, dkim: false, dmarc: true }] });
    expect(severityOf(ohneDkim, "dkim")).toBe("blocker");
  });

  it("nennt alle betroffenen Domains in einer Meldung", () => {
    const f = facts({
      domains: [
        { domain: "a.de", spf: false, dkim: true, dmarc: true },
        { domain: "b.de", spf: false, dkim: true, dmarc: true },
        { domain: "c.de", spf: true, dkim: true, dmarc: true },
      ],
    });
    const spf = assessCampaign(f).checks.find((c) => c.id === "spf")!;
    expect(spf.values.domains).toBe("a.de, b.de");
    expect(spf.values.count).toBe(2);
  });

  it("ab 5 Prozent Bounce", () => {
    expect(severityOf(facts({ sentSoFar: 1000, bouncedSoFar: 50 }), "bounce")).toBe("blocker");
  });
});

describe("Warnungen", () => {
  // DMARC bewusst keine Blockade: seit 2024 von Google/Yahoo bei
  // Massenversand verlangt, aber eine Mail ohne DMARC wird nicht zwingend
  // abgewiesen — anders als eine, die am SPF-Abgleich scheitert.
  it("fehlendes DMARC blockiert nicht", () => {
    const f = facts({ domains: [{ domain: "acme.de", spf: true, dkim: true, dmarc: false }] });
    expect(severityOf(f, "dmarc")).toBe("warning");
    expect(assessCampaign(f).canStart).toBe(true);
  });

  it("Bounce zwischen 3 und 5 Prozent", () => {
    expect(severityOf(facts({ sentSoFar: 1000, bouncedSoFar: 35 }), "bounce")).toBe("warning");
  });

  it("ab einem Viertel ungeprueften Adressen", () => {
    expect(severityOf(facts({ sendableLeads: 100, unverifiedLeads: 25 }), "verification")).toBe("warning");
    expect(severityOf(facts({ sendableLeads: 100, unverifiedLeads: 24 }), "verification")).toBe("ok");
  });

  it("ab einem Fuenftel fehlender oder fehlerhafter Aufhaenger", () => {
    expect(severityOf(facts({ sendableLeads: 100, leadsWithoutIcebreaker: 20 }), "icebreakerMissing")).toBe("warning");
    expect(severityOf(facts({ sendableLeads: 100, leadsWithFailingIcebreaker: 20 }), "icebreakerFailing")).toBe("warning");
  });

  it("bei einer Sequenz aus nur einem Schritt", () => {
    expect(severityOf(facts({ steps: [{ words: 70, hasLink: false }] }), "sequence")).toBe("warning");
  });

  it("bei einer zu langen ersten Mail", () => {
    expect(severityOf(facts({ steps: [{ words: 91, hasLink: false }] }), "firstMailLength")).toBe("warning");
    expect(severityOf(facts({ steps: [{ words: 90, hasLink: false }] }), "firstMailLength")).toBe("ok");
  });

  // Nur der erste Schritt: in Folge-Mails ist ein Link unproblematisch, und
  // im sauberen Fall oben hat Schritt 2 bewusst einen.
  it("bei einem Link in der ersten Mail, aber nicht in spaeteren", () => {
    expect(severityOf(facts({ steps: [{ words: 70, hasLink: true }] }), "firstMailLink")).toBe("warning");
    expect(severityOf(facts(), "firstMailLink")).toBe("ok");
  });
});

describe("Bounce-Quote braucht genug Grundlage", () => {
  /**
   * Bei 20 Mails ist ein einziger Bounce schon 5 %. Daraus einen Blocker zu
   * machen hiesse, jeden Neustart nach dem ersten Missgeschick zu verhindern.
   */
  it("schweigt unter der Mindestmenge, auch bei hoher Quote", () => {
    const f = facts({ sentSoFar: BOUNCE_MIN_SAMPLE - 1, bouncedSoFar: 20 });
    expect(severityOf(f, "bounce")).toBe("ok");
    expect(assessCampaign(f).canStart).toBe(true);
  });

  it("greift ab der Mindestmenge", () => {
    expect(severityOf(facts({ sentSoFar: BOUNCE_MIN_SAMPLE, bouncedSoFar: 20 }), "bounce")).toBe("blocker");
  });

  it("kommt ohne jeden Versand klar", () => {
    expect(severityOf(facts({ sentSoFar: 0, bouncedSoFar: 0 }), "bounce")).toBe("ok");
  });
});

describe("estimateWords", () => {
  it("zaehlt normalen Text", () => {
    expect(estimateWords("Hallo Anna, hast du kurz Zeit?", 22)).toBe(6);
  });

  /**
   * Der Aufhaenger wird so lang, wie die Vorgabe erlaubt. Ihn als ein Wort zu
   * zaehlen wuerde jede Mail kuerzer rechnen, als sie ankommt — und die
   * Laengenpruefung damit wertlos machen.
   */
  it("rechnet den Aufhaenger mit seiner erlaubten Laenge", () => {
    expect(estimateWords("Hi {{firstName}}, {{personalization}} Passt Dienstag?", 22)).toBe(1 + 1 + 22 + 2);
  });

  it("zaehlt andere Platzhalter als ein Wort", () => {
    expect(estimateWords("{{firstName}} von {{companyName}}", 22)).toBe(3);
  });

  it("kommt mit Leerraum im Platzhalter klar", () => {
    expect(estimateWords("{{ personalization }}", 10)).toBe(10);
  });
});

describe("hasLink", () => {
  it("findet die ueblichen Formen", () => {
    expect(hasLink("Schau mal auf https://acme.de vorbei")).toBe(true);
    expect(hasLink("Mehr unter www.acme.de")).toBe(true);
    expect(hasLink('<a href="x">hier</a>')).toBe(true);
    expect(hasLink("[unser Angebot](https://acme.de)")).toBe(true);
  });

  it("haelt einen Platzhalter nicht fuer einen Link", () => {
    expect(hasLink("Ich habe {{website}} gesehen")).toBe(false);
  });

  it("meldet nichts bei einer Mail ohne Link", () => {
    expect(hasLink("Hallo Anna, hast du Dienstag 15 Minuten?")).toBe(false);
  });
});

describe("stepFacts", () => {
  it("fasst beides zusammen", () => {
    // "Hi" + Aufhaenger (5) + "—" + "mehr" + "auf" + die Adresse
    expect(stepFacts("Hi {{personalization}} — mehr auf https://acme.de", 5)).toEqual({
      words: 1 + 5 + 4,
      hasLink: true,
    });
  });
});
