import { describe, expect, it } from "vitest";
import { pickPrimaryContactPerBusiness, rankContactTitle } from "./contacts";

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
});
