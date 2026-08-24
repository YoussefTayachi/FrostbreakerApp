import { describe, expect, it } from "vitest";
import { planCampaignLeads, splitByWebsiteFinding, type CampaignContactRow } from "./create-campaign";

/**
 * Wer beim Anlegen einer Kampagne tatsaechlich hochgeladen wird.
 *
 * Diese Funktion ist die CAN-SPAM-Zusage in Code, und sie hat seit dem
 * 2026-08-22 ZWEI Aufrufer: das Kampagnenformular (ueber
 * app/api/instantly/campaigns) und das MCP-Werkzeug publish_campaign. Genau
 * deshalb steht sie an einer Stelle und wird hier geprueft: eine zweite
 * Fassung wuerde irgendwann einen der vier Filter verlieren, und auffallen
 * wuerde es erst bei dem, der sich abgemeldet hat und trotzdem Post bekommt.
 */

function kontakt(overrides: Partial<CampaignContactRow> & { id: string }): CampaignContactRow {
  return {
    email: `${overrides.id}@firma.de`,
    first_name: "Ada",
    last_name: "Lovelace",
    title: "Inhaberin",
    business_id: `b-${overrides.id}`,
    is_primary: false,
    outreach_status: "new",
    email_verification_status: "valid",
    businesses: { name: "Firma", website: "firma.de", personalization: null, website_finding: null },
    ...overrides,
  };
}

describe("planCampaignLeads", () => {
  it("laesst durch, wer nichts dagegen hat", () => {
    const plan = planCampaignLeads([kontakt({ id: "a" })], [], []);
    expect(plan.rows.map((c) => c.id)).toEqual(["a"]);
    expect(plan.engaged).toHaveLength(0);
    expect(plan.suppressed).toHaveLength(0);
    expect(plan.unsendable).toHaveLength(0);
  });

  it("wer sich abgemeldet hat, wird nicht hochgeladen", () => {
    // api/unsubscribe schreibt genau in suppression_list; ueber diesen Filter
    // wirkt die Abmeldung auf JEDE spaetere Kampagne, egal ueber welchen Weg
    // sie angelegt wird.
    const plan = planCampaignLeads(
      [kontakt({ id: "a" }), kontakt({ id: "b" })],
      [{ email: "b@firma.de", domain: null }],
      []
    );
    expect(plan.rows.map((c) => c.id)).toEqual(["a"]);
    expect(plan.suppressed.map((c) => c.id)).toEqual(["b"]);
  });

  it("eine gesperrte Domain trifft auch die Firmen-Website", () => {
    const plan = planCampaignLeads(
      [kontakt({ id: "a", email: "info@anders.de", businesses: { name: "F", website: "https://www.gesperrt.de/impressum", personalization: null, website_finding: null } })],
      [{ email: null, domain: "gesperrt.de" }],
      []
    );
    expect(plan.rows).toHaveLength(0);
    expect(plan.suppressed.map((c) => c.id)).toEqual(["a"]);
  });

  it("eine archivierte Adresse kommt nicht ueber eine neue Liste zurueck", () => {
    // Migration 0095: die Liste ist geloescht, die Adresse wurde aber schon
    // angeschrieben. Ohne contact_archive rutschte sie ueber eine neu
    // gesuchte Liste ein zweites Mal in eine Kampagne.
    const plan = planCampaignLeads([kontakt({ id: "a" })], [], ["a@firma.de"]);
    expect(plan.rows).toHaveLength(0);
    expect(plan.suppressed.map((c) => c.id)).toEqual(["a"]);
  });

  it("das Archiv sperrt die Adresse, nicht die Domain", () => {
    // Bewusst nur mit der Adresse: die Domain sperrt der Dublettenschutz im
    // Worker. Hier waere sie zu grob und wuerde eine bewusst gewaehlte zweite
    // Ansprechpartnerin derselben Firma mit ausschliessen.
    const plan = planCampaignLeads(
      [kontakt({ id: "zweite", email: "zweite@firma.de" })],
      [],
      ["erste@firma.de"]
    );
    expect(plan.rows.map((c) => c.id)).toEqual(["zweite"]);
  });

  it("wer geantwortet hat, bekommt keine Kalt-Mail mehr, egal ueber welchen Kanal", () => {
    // 'replied' setzt auch eine LinkedIn-Antwort; genau deshalb haengt die
    // Regel am Status und nicht an einem Kanal-Merkmal (lib/contacts.ts).
    const plan = planCampaignLeads(
      [
        kontakt({ id: "a" }),
        kontakt({ id: "b", outreach_status: "replied" }),
        kontakt({ id: "c", outreach_status: "not_interested" }),
        kontakt({ id: "d", outreach_status: "contacted" }),
      ],
      [],
      []
    );
    // 'contacted' bleibt drin: angeschrieben heisst nicht reagiert.
    expect(plan.rows.map((c) => c.id).sort()).toEqual(["a", "d"]);
    expect(plan.engaged.map((c) => c.id).sort()).toEqual(["b", "c"]);
  });

  it("als ungueltig erkannte Adressen bleiben liegen", () => {
    const plan = planCampaignLeads(
      [
        kontakt({ id: "a" }),
        kontakt({ id: "b", email_verification_status: "invalid" }),
        kontakt({ id: "c", email_verification_status: "unknown" }),
      ],
      [],
      []
    );
    // "unknown" bleibt drin: ein Ausschluss waere eine Wette gegen den Lead,
    // keine belegte Aussage.
    expect(plan.rows.map((c) => c.id).sort()).toEqual(["a", "c"]);
    expect(plan.unsendable.map((c) => c.id)).toEqual(["b"]);
  });

  it("aus einer Firma geht genau eine Person raus, und zwar die ranghoechste", () => {
    const plan = planCampaignLeads(
      [
        kontakt({ id: "assistenz", business_id: "b1", title: "Assistenz" }),
        kontakt({ id: "chefin", business_id: "b1", title: "Geschäftsführerin" }),
      ],
      [],
      []
    );
    expect(plan.rows.map((c) => c.id)).toEqual(["chefin"]);
  });

  it("ein Kontakt ohne Adresse ist kein Empfaenger", () => {
    const plan = planCampaignLeads([kontakt({ id: "a", email: null })], [], []);
    expect(plan.rows).toHaveLength(0);
    // Und er zaehlt in keiner der drei Aussortier-Zahlen mit: er war nie ein
    // moeglicher Empfaenger.
    expect(plan.engaged.length + plan.suppressed.length + plan.unsendable.length).toBe(0);
  });
});

/**
 * Der Leerfall des Website-Befunds.
 *
 * Nicht jeder Lead hat einen. Diese Tests halten die Entscheidung fest, was
 * dann passiert: der Lead geht nicht mit, statt eine Mail mit einem Loch zu
 * bekommen. Die Begruendung steht bei splitByWebsiteFinding.
 */
describe("splitByWebsiteFinding", () => {
  const mitBefund = kontakt({
    id: "mit",
    businesses: { name: "F", website: "f.de", personalization: null, website_finding: "Kein HTTPS." },
  });
  const ohneBefund = kontakt({ id: "ohne" });
  const leerzeichen = kontakt({
    id: "leer",
    businesses: { name: "F", website: "f.de", personalization: null, website_finding: "   " },
  });

  it("haelt Leads ohne Befund zurueck, wenn die Sequenz ihn benutzt", () => {
    const split = splitByWebsiteFinding([mitBefund, ohneBefund, leerzeichen], true);
    expect(split.rows.map((c) => c.id)).toEqual(["mit"]);
    expect(split.withoutFinding.map((c) => c.id)).toEqual(["ohne", "leer"]);
  });

  it("laesst alle durch, wenn die Sequenz ihn nicht benutzt", () => {
    // Sonst wuerde eine ganz normale Kampagne Leads verlieren, weil
    // irgendwann einmal ein Website-Check nichts gefunden hat.
    const split = splitByWebsiteFinding([mitBefund, ohneBefund], false);
    expect(split.rows).toHaveLength(2);
    expect(split.withoutFinding).toHaveLength(0);
  });
});
