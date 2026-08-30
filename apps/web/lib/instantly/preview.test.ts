import { describe, expect, it } from "vitest";
import {
  hasWebsiteFinding,
  pickPreviewLeads,
  renderVariables,
  renderVariablesForLead,
  PREVIEW_LEAD_COUNT,
} from "./preview";
import { buildInstantlyLead, mergeTagValues, type MergeTagSource } from "./campaigns";

/**
 * Die Vorschau ist nur dann etwas wert, wenn sie dasselbe zeigt, was
 * rausgeht. Deshalb steht in dieser Datei mehr als eine Textersetzung: die
 * Pruefung, dass Vorschau und Upload aus DERSELBEN Zuordnung kommen (unten,
 * "dieselbe Zuordnung wie der Upload").
 */
type BusinessFields = NonNullable<MergeTagSource["businesses"]>;

function lead(patch: Partial<BusinessFields> = {}, oben: Partial<MergeTagSource> = {}): MergeTagSource {
  return {
    email: "ada@firma.de",
    first_name: "Ada",
    last_name: "Lovelace",
    businesses: {
      name: "Firma GmbH",
      personalization: "Ihr haltet die Nische, waehrend andere breiter werden.",
      website_finding: "Eure Startseite laedt in 6 Sekunden.",
      ...patch,
    },
    ...oben,
  };
}

describe("renderVariables", () => {
  it("setzt alle sechs Tags ein", () => {
    const r = renderVariablesForLead(
      {
        subject: "{{firstName}}, kurz zu {{companyName}}",
        body: "Hallo {{firstName}} {{lastName}}, {{personalization}} {{websiteFinding}} ({{email}})",
      },
      lead()
    );
    expect(r.subject).toBe("Ada, kurz zu Firma GmbH");
    expect(r.body).toBe(
      "Hallo Ada Lovelace, Ihr haltet die Nische, waehrend andere breiter werden. " +
        "Eure Startseite laedt in 6 Sekunden. (ada@firma.de)"
    );
    expect(r.filled).toEqual([
      "{{firstName}}",
      "{{companyName}}",
      "{{lastName}}",
      "{{personalization}}",
      "{{websiteFinding}}",
      "{{email}}",
    ]);
    expect(r.empty).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  /**
   * Der eigentliche Grund fuer diese Datei. Kein Befund ist ein haeufiger,
   * richtiger Zustand (Migration 0103): der Tag verschwindet ersatzlos, so
   * wie es beim Empfaenger auch waere, und wird trotzdem gemeldet.
   */
  it("laesst einen leeren Wert als Loch stehen und benennt ihn", () => {
    const r = renderVariablesForLead(
      { subject: "Kurz zu {{companyName}}", body: "Hallo {{firstName}},\n\n{{websiteFinding}}\n\nBeste Gruesse" },
      lead({ website_finding: null })
    );
    expect(r.body).toBe("Hallo Ada,\n\n\n\nBeste Gruesse");
    expect(r.empty).toEqual(["{{websiteFinding}}"]);
    expect(r.filled).toEqual(["{{companyName}}", "{{firstName}}"]);
  });

  // Nur Leerzeichen ist derselbe Fall, sonst wuerde die Vorschau einen Lead
  // als vollstaendig zeigen, den splitByWebsiteFinding zurueckhaelt.
  it("zaehlt einen Wert aus lauter Leerzeichen als leer", () => {
    const r = renderVariablesForLead({ subject: "", body: "{{personalization}}" }, lead({ personalization: "   " }));
    expect(r.body).toBe("");
    expect(r.empty).toEqual(["{{personalization}}"]);
  });

  /**
   * Ein erfundener Platzhalter wird von Instantly NICHT ersetzt und geht
   * woertlich raus (siehe unknownTags in lib/copy/sequence-prompt.ts). Die
   * Vorschau zeigt ihn deshalb genauso stehen.
   */
  it("laesst einen unbekannten Tag stehen und meldet ihn", () => {
    const r = renderVariablesForLead({ subject: "Zu {{painPoint}}", body: "Hi {{firstName}}" }, lead());
    expect(r.subject).toBe("Zu {{painPoint}}");
    expect(r.unknown).toEqual(["{{painPoint}}"]);
    expect(r.filled).toEqual(["{{firstName}}"]);
  });

  // Ein Name aus der Prototypenkette ist kein Tag. Ohne hasOwnProperty
  // stuende hier auf einmal Javascript-Innenleben in der Mail.
  it("faellt nicht auf {{constructor}} herein", () => {
    const r = renderVariablesForLead({ subject: "{{constructor}}", body: "" }, lead());
    expect(r.subject).toBe("{{constructor}}");
    expect(r.unknown).toEqual(["{{constructor}}"]);
  });

  it("erkennt Tags mit Leerzeichen in den Klammern", () => {
    const r = renderVariablesForLead({ subject: "{{ firstName }}", body: "{{  websiteFinding  }}" }, lead());
    expect(r.subject).toBe("Ada");
    expect(r.body).toBe("Eure Startseite laedt in 6 Sekunden.");
    expect(r.filled).toEqual(["{{firstName}}", "{{websiteFinding}}"]);
  });

  it("ersetzt jedes Vorkommen, meldet den Tag aber nur einmal", () => {
    const r = renderVariablesForLead({ subject: "", body: "{{firstName}}, kurz: {{firstName}}?" }, lead());
    expect(r.body).toBe("Ada, kurz: Ada?");
    expect(r.filled).toEqual(["{{firstName}}"]);
  });

  it("laesst einen Text ohne jeden Tag unangetastet", () => {
    const r = renderVariablesForLead({ subject: "Kurze Frage", body: "Hallo,\n\nmelde mich kurz." }, lead());
    expect(r.subject).toBe("Kurze Frage");
    expect(r.body).toBe("Hallo,\n\nmelde mich kurz.");
    expect(r.filled).toEqual([]);
    expect(r.empty).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  /**
   * Der Opt-out-Link (optOutLink in campaign-step-card.tsx) haelt bewusst ein
   * {{email}} als echtes Merge-Tag offen. Kein Sonderfall: Instantly ersetzt
   * es beim Versand, die Vorschau zeigt den Link, der beim Empfaenger
   * ankommt.
   */
  it("fuellt das {{email}} im Opt-out-Link", () => {
    const r = renderVariablesForLead(
      { subject: "", body: "Abmelden: https://app.example/api/unsubscribe?ws=w1&email={{email}}" },
      lead()
    );
    expect(r.body).toBe("Abmelden: https://app.example/api/unsubscribe?ws=w1&email=ada@firma.de");
    expect(r.filled).toEqual(["{{email}}"]);
  });

  // Werte kommen aus fremden Websites: ein $& im Text darf nicht als
  // Ersetzungsmuster von String#replace wirken.
  it("behandelt Dollarzeichen im Wert als Text", () => {
    const r = renderVariables(
      { subject: "", body: "{{personalization}}" },
      mergeTagValues(lead({ personalization: "Preis ab $5 statt $& mehr" }))
    );
    expect(r.body).toBe("Preis ab $5 statt $& mehr");
  });

  it("nimmt dieselbe Zuordnung wie der Upload zu Instantly", () => {
    // Wenn diese beiden auseinanderlaufen, luegt die Vorschau. Deshalb hier
    // wortwoertlich gegeneinander geprueft und nicht abgeschrieben.
    const l = lead();
    const upload = buildInstantlyLead(l);
    const r = renderVariablesForLead(
      { subject: "{{companyName}}", body: "{{firstName}}|{{lastName}}|{{email}}|{{personalization}}|{{websiteFinding}}" },
      l
    );
    expect(r.subject).toBe(upload.company_name);
    expect(r.body).toBe(
      [
        upload.first_name,
        upload.last_name,
        upload.email,
        upload.personalization,
        upload.custom_variables?.websiteFinding,
      ].join("|")
    );
  });

  /**
   * Der Fehler vom 2026-08-27, hier festgenagelt.
   *
   * websiteFinding stand als Schluessel auf oberster Ebene und kam bei
   * Instantly nie an: deren Schema fuer /api/v2/leads/add hat
   * "additionalProperties": false und kennt genau zwoelf Felder, von denen
   * custom_variables das einzige ist, das eigene Variablen aufnimmt.
   *
   * Der Test oben war gruen, WEIL Vorschau und Upload denselben falschen Ort
   * benutzten. Er vergleicht die beiden Seiten gegeneinander, nicht gegen
   * Instantlys Schema. Deshalb dieser zweite Test, der ausdruecklich die
   * Struktur prueft.
   */
  it("legt den Befund in custom_variables und NICHT nach oben", () => {
    const upload = buildInstantlyLead(lead({ website_finding: "Eure Nummer ist nicht antippbar." }));
    expect(upload.custom_variables).toEqual({ websiteFinding: "Eure Nummer ist nicht antippbar." });
    expect(upload).not.toHaveProperty("websiteFinding");
    // Die zwoelf erlaubten Felder, gegen ein versehentliches dreizehntes.
    const ERLAUBT = new Set([
      "email", "first_name", "last_name", "phone", "company_name", "job_title",
      "website", "personalization", "lt_interest_status", "pl_value_lead",
      "assigned_to", "custom_variables",
    ]);
    for (const key of Object.keys(upload)) {
      expect(ERLAUBT.has(key), `unerlaubtes Feld: ${key}`).toBe(true);
    }
  });

  it("laesst custom_variables ganz weg, wenn kein Befund da ist", () => {
    // Kein leeres Objekt: der Unterschied zwischen "nicht uebergeben" und
    // "leer uebergeben" ist an Instantlys API nicht nachgemessen, und ein
    // leerer Wert koennte einen vorhandenen ueberschreiben.
    const upload = buildInstantlyLead(lead({ website_finding: null }));
    expect(upload.custom_variables).toBeUndefined();
  });
});

describe("pickPreviewLeads", () => {
  const mit = (id: string) => lead({ website_finding: `Befund ${id}` }, { email: `${id}@firma.de` });
  const ohne = (id: string) => lead({ website_finding: null }, { email: `${id}@firma.de` });
  const mails = (rows: MergeTagSource[]) => rows.map((r) => r.email);

  it("nimmt einen mit und einen ohne Befund, auch wenn der ohne weit hinten steht", () => {
    const gewaehlt = pickPreviewLeads([mit("a"), mit("b"), mit("c"), ohne("d")]);
    expect(mails(gewaehlt)).toEqual(["a@firma.de", "d@firma.de"]);
  });

  it("haelt die Reihenfolge der Eingabe ein", () => {
    const gewaehlt = pickPreviewLeads([ohne("a"), mit("b"), ohne("c")]);
    expect(mails(gewaehlt)).toEqual(["a@firma.de", "b@firma.de"]);
  });

  it("fuellt auf, wenn alle einen Befund haben", () => {
    expect(mails(pickPreviewLeads([mit("a"), mit("b"), mit("c")]))).toEqual(["a@firma.de", "b@firma.de"]);
  });

  it("fuellt auf, wenn keiner einen Befund hat", () => {
    expect(mails(pickPreviewLeads([ohne("a"), ohne("b"), ohne("c")]))).toEqual(["a@firma.de", "b@firma.de"]);
  });

  it("kommt mit gar keinen Leads klar", () => {
    expect(pickPreviewLeads([])).toEqual([]);
  });

  it("gibt nicht mehr zurueck, als es Leads gibt", () => {
    expect(mails(pickPreviewLeads([mit("a")]))).toEqual(["a@firma.de"]);
  });

  // Deterministisch: die Vorschau haengt an einem Textfeld und darf bei
  // jedem Tastendruck nicht springen.
  it("liefert bei gleicher Eingabe immer dieselbe Auswahl", () => {
    const rows = [mit("a"), ohne("b"), mit("c"), ohne("d")];
    expect(mails(pickPreviewLeads(rows))).toEqual(mails(pickPreviewLeads(rows)));
  });

  it("nimmt bei Platz fuer einen den vollstaendigen Fall", () => {
    expect(mails(pickPreviewLeads([ohne("a"), mit("b")], 1))).toEqual(["b@firma.de"]);
  });

  it("liefert nichts bei einer Grenze von null", () => {
    expect(pickPreviewLeads([mit("a")], 0)).toEqual([]);
  });

  it("zeigt standardmaessig zwei", () => {
    expect(PREVIEW_LEAD_COUNT).toBe(2);
  });
});

describe("hasWebsiteFinding", () => {
  it("zaehlt nur Leerzeichen als keinen Befund", () => {
    expect(hasWebsiteFinding(lead())).toBe(true);
    expect(hasWebsiteFinding(lead({ website_finding: "   " }))).toBe(false);
    expect(hasWebsiteFinding(lead({ website_finding: null }))).toBe(false);
  });
});
