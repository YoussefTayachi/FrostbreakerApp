import { describe, expect, it } from "vitest";
import { pickPrimaryContactPerBusiness, rankContactTitle, isSendableEmail, splitBySendability } from "./contacts";

describe("isSendableEmail", () => {
  it("sperrt nur Status, die garantiert bouncen", () => {
    expect(isSendableEmail("invalid")).toBe(false);
    expect(isSendableEmail("disposable")).toBe(false);
  });

  it("laesst zustellbare und unklare Status durch", () => {
    expect(isSendableEmail("valid")).toBe(true);
    expect(isSendableEmail("catchall")).toBe(true);
    expect(isSendableEmail("accept_all")).toBe(true);
    // Unklar heisst nicht ungueltig -- ein Ausschluss waere eine Wette, keine Aussage.
    expect(isSendableEmail("unknown")).toBe(true);
  });

  it("laesst noch nicht gepruefte Kontakte durch", () => {
    expect(isSendableEmail(null)).toBe(true);
    expect(isSendableEmail(undefined)).toBe(true);
  });
});

describe("splitBySendability", () => {
  it("trennt ungueltige Adressen ab, ohne sie zu verlieren", () => {
    const contacts = [
      { email: "a@x.com", email_verification_status: "valid" },
      { email: "b@x.com", email_verification_status: "invalid" },
      { email: "c@x.com", email_verification_status: "catchall" },
      { email: "d@x.com", email_verification_status: null },
      { email: "e@x.com", email_verification_status: "disposable" },
    ];
    const { sendable, unsendable } = splitBySendability(contacts);
    expect(sendable.map((c) => c.email)).toEqual(["a@x.com", "c@x.com", "d@x.com"]);
    expect(unsendable.map((c) => c.email)).toEqual(["b@x.com", "e@x.com"]);
  });
});

describe("rankContactTitle", () => {
  it("stuft Owner/CEO/President am hoechsten ein", () => {
    expect(rankContactTitle("President & CEO")).toBe(0);
    expect(rankContactTitle("Founder")).toBe(0);
    expect(rankContactTitle("Geschäftsführer")).toBe(0);
  });

  it("stuft VP/C-Level unter Owner/CEO ein", () => {
    expect(rankContactTitle("Vice President of Marketing & Communications")).toBe(1);
    expect(rankContactTitle("CFO")).toBe(1);
  });

  it("stuft Director/Head unter VP ein", () => {
    expect(rankContactTitle("Director of Finance and Administration")).toBe(2);
  });

  it("stuft Manager unter Director ein", () => {
    expect(rankContactTitle("Business Development Manager")).toBe(3);
  });

  it("gibt fuer unbekannte/fehlende Titel den niedrigsten Rang zurueck", () => {
    expect(rankContactTitle("Content & Brand Manager")).toBe(3); // enthaelt "Manager"
    expect(rankContactTitle("Marketing Coordinator")).toBe(4);
    expect(rankContactTitle(null)).toBe(5);
    expect(rankContactTitle(undefined)).toBe(5);
  });
});

describe("pickPrimaryContactPerBusiness", () => {
  it("waehlt pro Firma nur die ranghoechste Person", () => {
    const contacts = [
      { business_id: "biz1", title: "Business Development Manager", email: "megan@x.com" },
      { business_id: "biz1", title: "Vice President of Marketing & Communications", email: "markr@x.com" },
      { business_id: "biz1", title: "President & CEO", email: "kim@x.com" },
      { business_id: "biz1", title: "Marketing Coordinator", email: "angel@x.com" },
    ];
    const result = pickPrimaryContactPerBusiness(contacts);
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("kim@x.com");
  });

  it("behandelt mehrere Firmen unabhaengig voneinander", () => {
    const contacts = [
      { business_id: "biz1", title: "Manager", email: "a@x.com" },
      { business_id: "biz1", title: "Owner", email: "b@x.com" },
      { business_id: "biz2", title: "Director", email: "c@x.com" },
    ];
    const result = pickPrimaryContactPerBusiness(contacts);
    expect(result.map((c) => c.email).sort()).toEqual(["b@x.com", "c@x.com"]);
  });

  it("behaelt bei Gleichstand die zuerst uebergebene Person", () => {
    const contacts = [
      { business_id: "biz1", title: "Manager", email: "first@x.com" },
      { business_id: "biz1", title: "Manager", email: "second@x.com" },
    ];
    const result = pickPrimaryContactPerBusiness(contacts);
    expect(result[0].email).toBe("first@x.com");
  });

  it("laesst Kontakte ohne business_id unveraendert durch", () => {
    const contacts = [{ title: "Manager", email: "no-business@x.com" }];
    expect(pickPrimaryContactPerBusiness(contacts)).toEqual(contacts);
  });

  it("manuelle Auswahl (is_primary) gewinnt auch gegen einen ranghoeheren Titel", () => {
    const contacts = [
      { business_id: "biz1", title: "President & CEO", email: "kim@x.com" },
      { business_id: "biz1", title: "Marketing Coordinator", email: "angel@x.com", is_primary: true },
    ];
    const result = pickPrimaryContactPerBusiness(contacts);
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("angel@x.com");
  });

  it("faellt bei mehreren manuell markierten Kontakten auf Titel-Rang zurueck", () => {
    const contacts = [
      { business_id: "biz1", title: "Manager", email: "a@x.com", is_primary: true },
      { business_id: "biz1", title: "Owner", email: "b@x.com", is_primary: true },
    ];
    const result = pickPrimaryContactPerBusiness(contacts);
    expect(result[0].email).toBe("b@x.com");
  });
});
