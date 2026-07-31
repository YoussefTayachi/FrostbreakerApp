import { describe, expect, it } from "vitest";
import {
  buildCampaignSequence,
  instantlyHtmlToPlainText,
  plainTextToInstantlyHtml,
  sequenceFromInstantly,
} from "./campaigns";

describe("plainTextToInstantlyHtml", () => {
  it("maskiert das kaufmaennische Und", () => {
    // Der eigentliche Fehler: ein einziges "&" liess Instantly den kompletten
    // Body als leeren String speichern -- bei HTTP 200, also unbemerkt.
    const html = plainTextToInstantlyHtml("paying a tool & a fee");
    expect(html).toContain("&amp;");
    expect(html).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });

  it("maskiert spitze Klammern", () => {
    const html = plainTextToInstantlyHtml("Preis < 100 > 50");
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
  });

  it("macht aus Leerzeilen Absaetze und aus Umbruechen <br />", () => {
    expect(plainTextToInstantlyHtml("Hallo\n\nWelt")).toBe("<p>Hallo</p><p>Welt</p>");
    expect(plainTextToInstantlyHtml("Zeile1\nZeile2")).toBe("<p>Zeile1<br />Zeile2</p>");
  });

  it("packt Inhalt immer in Blockelemente", () => {
    // Text zwischen blossen <br> wird von Instantly verschluckt, nur die Tags
    // bleiben stehen -- deshalb muss alles in <p>.
    expect(plainTextToInstantlyHtml("nur eine Zeile")).toBe("<p>nur eine Zeile</p>");
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

describe("buildCampaignSequence", () => {
  it("schickt den Body als HTML an Instantly", () => {
    const seq = buildCampaignSequence([{ subject: "Betreff", body: "A & B", delayDays: 0 }]);
    expect(seq[0].steps[0].variants[0].body).toBe("<p>A &amp; B</p>");
    // Der Betreff bleibt Klartext -- den speichert Instantly problemlos.
    expect(seq[0].steps[0].variants[0].subject).toBe("Betreff");
  });
});

describe("Wartezeit zwischen den Schritten", () => {
  // Unser Modell: delayDays = warte so lange VOR diesem Schritt.
  // Instantly:    delay     = warte so lange NACH diesem Schritt.
  // Ungefiltert durchgereicht ginge das Follow-up sofort raus.
  it("schreibt die Wartezeit auf den vorherigen Schritt", () => {
    const seq = buildCampaignSequence([
      { subject: "1", body: "a", delayDays: 0 },
      { subject: "2", body: "b", delayDays: 3 },
    ]);
    expect(seq[0].steps.map((s) => s.delay)).toEqual([3, 0]);
  });

  it("kommt mit drei Schritten klar", () => {
    const seq = buildCampaignSequence([
      { subject: "1", body: "a", delayDays: 0 },
      { subject: "2", body: "b", delayDays: 2 },
      { subject: "3", body: "c", delayDays: 5 },
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
      { subject: "1", body: "a", delayDays: 0 },
      { subject: "2", body: "b", delayDays: 3 },
      { subject: "3", body: "c", delayDays: 7 },
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
    expect(steps[0].body).toBe("A & B");
    // Der erste Schritt hat per Definition keine Vorlaufzeit -- die 2 oben ist
    // in Instantlys Modell die Wartezeit BIS zum naechsten Schritt.
    expect(steps[0].delayDays).toBe(0);
  });
});
