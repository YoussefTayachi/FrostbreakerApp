import { describe, expect, it } from "vitest";
import {
  allVariants,
  buildCampaignSequence,
  instantlyHtmlToPlainText,
  plainTextToInstantlyHtml,
  usesWebsiteFinding,
  sequenceFromInstantly,
} from "./campaigns";

describe("plainTextToInstantlyHtml", () => {
  it("maskiert das kaufmaennische Und", () => {
    // Der eigentliche Fehler: ein einziges "&" liess Instantly den kompletten
    // Body als leeren String speichern, bei HTTP 200, also unbemerkt.
    const html = plainTextToInstantlyHtml("paying a tool & a fee");
    expect(html).toContain("&amp;");
    expect(html).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });

  it("maskiert spitze Klammern", () => {
    const html = plainTextToInstantlyHtml("Preis < 100 > 50");
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
  });

  it("baut genau Instantlys eigenes <div>-Format", () => {
    // Nicht <p>: Instantlys Editor wuerde das beim ersten Oeffnen in <div>
    // umschreiben, und der Text sah danach ohne Absaetze aus. Schicken wir
    // ihr Format, gibt es nichts umzuschreiben.
    expect(plainTextToInstantlyHtml("Hallo\n\nWelt")).toBe(
      "<div>Hallo</div><div><br /></div><div>Welt</div>"
    );
    expect(plainTextToInstantlyHtml("Zeile1\nZeile2")).toBe(
      "<div>Zeile1</div><div>Zeile2</div>"
    );
  });

  it("packt Inhalt immer in Blockelemente", () => {
    // Text zwischen blossen <br> wird von Instantly verschluckt, nur die Tags
    // bleiben stehen; deshalb steht jede Zeile in einem <div>, auch die
    // leeren (dort als <div><br /></div>).
    expect(plainTextToInstantlyHtml("nur eine Zeile")).toBe("<div>nur eine Zeile</div>");
    expect(plainTextToInstantlyHtml("A\n\n\n\nB")).not.toMatch(/(^|>)\s*<br \/>\s*(<|$)(?!\/div)/);
  });

  it("ueberlebt beliebig viele Runden durch Instantlys Editor", () => {
    // Der eigentliche Zweck der Umstellung: Text -> HTML -> Text -> HTML muss
    // sich stabilisieren, sonst wandert die Formatierung bei jedem Oeffnen.
    const original = "Hi {{firstName}},\n\n{{personalization}}\n\nBest,\nYoussef";
    const einmal = plainTextToInstantlyHtml(original);
    const zurueck = instantlyHtmlToPlainText(einmal);
    expect(zurueck).toBe(original);
    expect(plainTextToInstantlyHtml(zurueck)).toBe(einmal);
  });

  it("laesst Merge-Tags unangetastet", () => {
    const html = plainTextToInstantlyHtml("Hi {{firstName}}, {{personalization}}");
    expect(html).toContain("{{firstName}}");
    expect(html).toContain("{{personalization}}");
  });

  it("haelt den Abmelde-Link samt Query-Parametern zusammen", () => {
    const url = "https://app.frostbreaker.app/api/unsubscribe?ws=abc&email={{email}}";
    const html = plainTextToInstantlyHtml(url);
    expect(html).toContain("ws=abc&amp;email={{email}}");
  });
});

describe("instantlyHtmlToPlainText", () => {
  it("stellt den Klartext wieder her", () => {
    expect(instantlyHtmlToPlainText("<p>Hallo</p><p>Welt</p>")).toBe("Hallo\n\nWelt");
    expect(instantlyHtmlToPlainText("<p>Zeile1<br />Zeile2</p>")).toBe("Zeile1\nZeile2");
  });

  it("dekodiert Entities korrekt", () => {
    expect(instantlyHtmlToPlainText("<p>A &amp; B</p>")).toBe("A & B");
    expect(instantlyHtmlToPlainText("<p>Preis &lt; 100</p>")).toBe("Preis < 100");
  });

  it("laesst reinen Text aus Alt-Kampagnen unveraendert", () => {
    expect(instantlyHtmlToPlainText("Hallo Welt")).toBe("Hallo Welt");
  });

  it("kommt mit leerem Body klar", () => {
    expect(instantlyHtmlToPlainText("")).toBe("");
  });
});

describe("Hin- und Rueckweg", () => {
  it("ueberlebt einen echten Mailtext verlustfrei", () => {
    const original = [
      "Hi {{firstName}},",
      "",
      "{{personalization}}",
      "",
      "You're either burning hours manually hunting down leads, or paying a tool & a fee for every single lead.",
      "",
      "Best,",
      "Youssef",
      "—",
      "Don't want these emails? Unsub: https://app.frostbreaker.app/api/unsubscribe?ws=abc&email={{email}}",
    ].join("\n");

    expect(instantlyHtmlToPlainText(plainTextToInstantlyHtml(original))).toBe(original);
  });
});

/** Ein Schritt mit genau einer Fassung, der Normalfall in diesen Tests. */
function step(subject: string, body: string, delayDays: number) {
  return { variants: [{ subject, body }], delayDays };
}

describe("buildCampaignSequence", () => {
  it("schickt den Body als HTML an Instantly", () => {
    const seq = buildCampaignSequence([step("Betreff", "A & B", 0)]);
    expect(seq[0].steps[0].variants[0].body).toBe("<div>A &amp; B</div>");
    // Der Betreff bleibt Klartext; den speichert Instantly problemlos.
    expect(seq[0].steps[0].variants[0].subject).toBe("Betreff");
  });
});

describe("Wartezeit zwischen den Schritten", () => {
  // Unser Modell: delayDays = warte so lange VOR diesem Schritt.
  // Instantly:    delay     = warte so lange NACH diesem Schritt.
  // Ungefiltert durchgereicht ginge das Follow-up sofort raus.
  it("schreibt die Wartezeit auf den vorherigen Schritt", () => {
    const seq = buildCampaignSequence([
      step("1", "a", 0),
      step("2", "b", 3),
    ]);
    expect(seq[0].steps.map((s) => s.delay)).toEqual([3, 0]);
  });

  it("kommt mit drei Schritten klar", () => {
    const seq = buildCampaignSequence([
      step("1", "a", 0),
      step("2", "b", 2),
      step("3", "c", 5),
    ]);
    expect(seq[0].steps.map((s) => s.delay)).toEqual([2, 5, 0]);
  });

  it("liest die Wartezeit wieder an der richtigen Stelle aus", () => {
    const steps = sequenceFromInstantly({
      id: "x",
      name: "x",
      status: 0,
      sequences: [
        {
          steps: [
            { delay: 3, variants: [{ subject: "1", body: "<p>a</p>" }] },
            { delay: 0, variants: [{ subject: "2", body: "<p>b</p>" }] },
          ],
        },
      ],
    });
    expect(steps.map((s) => s.delayDays)).toEqual([0, 3]);
  });

  it("ueberlebt den Weg hin und zurueck", () => {
    const original = [
      step("1", "a", 0),
      step("2", "b", 3),
      step("3", "c", 7),
    ];
    const sent = buildCampaignSequence(original);
    const back = sequenceFromInstantly({
      id: "x",
      name: "x",
      status: 0,
      sequences: [{ steps: sent[0].steps }],
    });
    expect(back.map((s) => s.delayDays)).toEqual([0, 3, 7]);
  });
});

describe("sequenceFromInstantly", () => {
  it("liefert dem Editor wieder Klartext statt Tags", () => {
    const steps = sequenceFromInstantly({
      id: "x",
      name: "x",
      status: 0,
      sequences: [{ steps: [{ delay: 2, variants: [{ subject: "S", body: "<p>A &amp; B</p>" }] }] }],
    });
    expect(steps[0].variants[0].body).toBe("A & B");
    // Der erste Schritt hat per Definition keine Vorlaufzeit; die 2 oben ist
    // in Instantlys Modell die Wartezeit BIS zum naechsten Schritt.
    expect(steps[0].delayDays).toBe(0);
  });
});

// --- Instantlys eigenes <div>-HTML -----------------------------------------
// Der Rueckweg wurde bisher nur gegen unser EIGENES <p>-Format getestet.
// Instantlys Editor speichert aber in <div> um, und genau dieser Fall
// zerstoerte den Text. Die Vorlagen unten sind woertlich aus einer echten
// Kampagne kopiert (GET /api/v2/campaigns, 2026-08-02).
describe("instantlyHtmlToPlainText mit Instantlys <div>-HTML", () => {
  it("macht aus <div><br /></div> wieder eine Leerzeile", () => {
    expect(instantlyHtmlToPlainText("<div>A</div><div><br /></div><div>B</div>")).toBe("A\n\nB");
  });

  it("klebt aufeinanderfolgende <div> nicht ohne Leerzeichen zusammen", () => {
    // Der eigentliche Schaden: ohne Regel fuer die <div>-Grenze wurde daraus
    // "Hi Max,Last one from me.", und genau so waere es rausgegangen.
    expect(instantlyHtmlToPlainText("<div>Hi Max,</div><div>Last one from me.</div>")).toBe(
      "Hi Max,\nLast one from me."
    );
  });

  it("behaelt <br /> innerhalb eines <div> als einfachen Umbruch", () => {
    // Signaturbloecke stehen bei Instantly so drin.
    expect(
      instantlyHtmlToPlainText("<div>Best,<br />Youssef<br />Founder</div>")
    ).toBe("Best,\nYoussef\nFounder");
  });

  it("laesst Variablen unangetastet", () => {
    expect(
      instantlyHtmlToPlainText("<div>Hi {{firstName}},</div><div><br /></div><div>{{personalization}}</div>")
    ).toBe("Hi {{firstName}},\n\n{{personalization}}");
  });

  it("waechst bei mehrfachem Oeffnen und Speichern nicht um Leerzeilen", () => {
    // Ohne das Zusammenfassen auf maximal eine Leerzeile haette jeder
    // Durchgang eine weitere eingefuegt.
    const html = "<div>A</div><div><br /></div><div>B</div>";
    const einmal = instantlyHtmlToPlainText(html);
    const zweimal = instantlyHtmlToPlainText(plainTextToInstantlyHtml(einmal));
    expect(zweimal).toBe(einmal);
  });
});

describe("Varianten je Schritt", () => {
  /**
   * Bis 2026-08-04 schickte buildCampaignSequence immer genau EINE Variante.
   * Instantly verteilt den Versand auf alle und zaehlt getrennt mit; ohne
   * mehrere gibt es keinen Vergleich, egal wie viele Mails rausgehen.
   */
  it("gibt alle Fassungen an Instantly weiter", () => {
    const seq = buildCampaignSequence([
      { variants: [{ subject: "A", body: "erste" }, { subject: "B", body: "zweite" }], delayDays: 0 },
    ]);
    expect(seq[0].steps[0].variants.map((v) => v.subject)).toEqual(["A", "B"]);
    expect(seq[0].steps[0].variants[1].body).toBe("<div>zweite</div>");
  });

  // Ein v_disabled:false an einer Kampagne, die das Feld nie kannte, waere
  // eine Aenderung ohne Anlass.
  it("setzt v_disabled nur bei abgeschalteten Varianten", () => {
    const seq = buildCampaignSequence([
      { variants: [{ subject: "A", body: "x" }, { subject: "B", body: "y", disabled: true }], delayDays: 0 },
    ]);
    expect(seq[0].steps[0].variants[0]).not.toHaveProperty("v_disabled");
    expect(seq[0].steps[0].variants[1]).toHaveProperty("v_disabled", true);
  });

  it("liest alle Fassungen wieder ein, samt Abschaltung", () => {
    const steps = sequenceFromInstantly({
      id: "x",
      name: "x",
      status: 0,
      sequences: [
        {
          steps: [
            {
              delay: 0,
              variants: [
                { subject: "A", body: "<p>eins</p>" },
                { subject: "B", body: "<p>zwei</p>", v_disabled: true },
              ],
            },
          ],
        },
      ],
    });
    expect(steps[0].variants.map((v) => v.subject)).toEqual(["A", "B"]);
    expect(steps[0].variants[0].disabled).toBeUndefined();
    expect(steps[0].variants[1].disabled).toBe(true);
  });

  // Sonst stuende im Formular ein Schritt ganz ohne Textfeld.
  it("erfindet eine leere Fassung, wenn Instantly gar keine liefert", () => {
    const steps = sequenceFromInstantly({
      id: "x",
      name: "x",
      status: 0,
      sequences: [{ steps: [{ delay: 0 }] }],
    });
    expect(steps[0].variants).toEqual([{ subject: "", body: "" }]);
  });

  it("ueberlebt mit zwei Fassungen den Weg hin und zurueck", () => {
    const original = [
      { variants: [{ subject: "A", body: "eins" }, { subject: "B", body: "zwei" }], delayDays: 0 },
      { variants: [{ subject: "C", body: "drei" }], delayDays: 3 },
    ];
    const back = sequenceFromInstantly({
      id: "x",
      name: "x",
      status: 0,
      sequences: [{ steps: buildCampaignSequence(original)[0].steps }],
    });
    expect(back).toEqual(original);
  });
});

describe("usesWebsiteFinding", () => {
  const stufe = (subject: string, body: string) => ({ variants: [{ subject, body }] });

  it("findet die Variable im Text", () => {
    expect(usesWebsiteFinding(allVariants([stufe("betreff", "Hi\n\n{{websiteFinding}}\n\nGruss")]))).toBe(
      true
    );
  });

  it("findet sie auch im Betreff und in Fassung B", () => {
    // Eine Variable, die nur in Fassung B steht, geht trotzdem an die
    // Haelfte der Empfaenger.
    const step = {
      variants: [
        { subject: "a", body: "ohne" },
        { subject: "b", body: "mit {{websiteFinding}}" },
      ],
    };
    expect(usesWebsiteFinding(allVariants([step]))).toBe(true);
    expect(usesWebsiteFinding(allVariants([stufe("{{websiteFinding}}", "ohne")]))).toBe(true);
  });

  it("vertraegt Leerzeichen in den Klammern", () => {
    expect(usesWebsiteFinding([{ body: "{{ websiteFinding }}" }])).toBe(true);
  });

  it("sagt nein, wenn sie nirgends steht", () => {
    expect(usesWebsiteFinding(allVariants([stufe("betreff", "nur {{personalization}}")]))).toBe(false);
    expect(usesWebsiteFinding([])).toBe(false);
  });
});
