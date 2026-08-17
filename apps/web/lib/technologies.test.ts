import { describe, expect, it } from "vitest";
import { TECHNOLOGIES, resolveTechnologies, technologiesFor } from "./technologies";

/** Die drei Apollo-UIDs, die sich NICHT aus dem Anzeigenamen ableiten lassen.
 *
 *  Sie stehen hier ausdruecklich als Literale, weil der naheliegende, "logisch"
 *  abgeleitete Wert jeweils falsch ist und Apollo einen unbekannten UID nicht
 *  ablehnt, sondern stillschweigend null Treffer liefert. Wer einen dieser
 *  Werte "korrigiert", laesst damit Suchen leer laufen, ohne dass irgendwo ein
 *  Fehler auftaucht — genau am 2026-08-02 passiert. Alle drei sind live gegen
 *  mixed_people/api_search geprueft (per_page=1, kostet keine Credits). */
const VERIFIED_APOLLO_UIDS: Record<string, string> = {
  apollo_io: "apolloio",
  outreach: "outreach",
  jtl: "jtlshop",
};

describe("Apollo-UIDs, die nicht ableitbar sind", () => {
  for (const [id, uid] of Object.entries(VERIFIED_APOLLO_UIDS)) {
    it(`${id} nutzt den geprueften UID "${uid}"`, () => {
      expect(TECHNOLOGIES.find((t) => t.id === id)?.apollo).toBe(uid);
    });
  }

  it("nutzt nirgends den ungueltigen Unterstrich-vor-io-Stil", () => {
    // apollo_io und outreach_io existieren bei Apollo nicht. Ein Slug, der so
    // endet, ist praktisch immer aus dem Anzeigenamen geraten statt geprueft.
    const guessed = TECHNOLOGIES.filter((t) => t.apollo?.endsWith("_io"));
    expect(guessed.map((t) => t.label)).toEqual([]);
  });

  it("verwechselt Apollo.io nicht mit Apollo GraphQL", () => {
    // "apollo" ist bei Apollo das GraphQL-Framework (Microsoft, Razorpay),
    // nicht das CRM. Ein Filter darauf liefert Webentwickler statt Agenturen.
    expect(TECHNOLOGIES.find((t) => t.id === "apollo_io")?.apollo).not.toBe("apollo");
  });
});

describe("technologiesFor", () => {
  it("bietet nur Eintraege an, die der Anbieter auch kennt", () => {
    for (const provider of ["apollo", "hunter"] as const) {
      const offered = technologiesFor(provider);
      expect(offered.length).toBeGreaterThan(0);
      expect(offered.every((t) => Boolean(t[provider]))).toBe(true);
    }
  });

  it("blendet die Vertriebs-Tools im Hunter-Modus fast vollstaendig aus", () => {
    // Hunters Katalog kennt von der Vertriebs-Gruppe nur SalesLoft und
    // ZoomInfo. Waeren es ploetzlich mehr, waere jemand vom Pruefen abgekommen.
    const sales = technologiesFor("hunter").filter((t) => t.group === "sales");
    expect(sales.map((t) => t.label).sort()).toEqual(["SalesLoft", "ZoomInfo"]);
  });
});

describe("resolveTechnologies", () => {
  it("uebersetzt interne IDs in die Slugs des Anbieters", () => {
    expect(resolveTechnologies(["apollo_io", "shopify"], "apollo")).toEqual([
      "apolloio",
      "shopify",
    ]);
  });

  it("verwirft IDs, die der Anbieter nicht kennt, statt zu werfen", () => {
    // Eine Vorlage aus dem Apollo-Modus kann IDs enthalten, die Hunter fehlen.
    expect(resolveTechnologies(["apollo_io", "shopify"], "hunter")).toEqual(["shopify"]);
    expect(resolveTechnologies(["gibt-es-nicht"], "apollo")).toEqual([]);
  });

  it("entdoppelt Slugs", () => {
    expect(resolveTechnologies(["shopify", "shopify"], "apollo")).toEqual(["shopify"]);
  });
});

describe("Katalog-Hygiene", () => {
  it("hat eindeutige interne IDs", () => {
    const ids = TECHNOLOGIES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hat fuer jeden Eintrag mindestens einen Anbieter-Slug", () => {
    // Ein Eintrag ohne beide Slugs waere in keinem Modus waehlbar — toter Code.
    const orphans = TECHNOLOGIES.filter((t) => !t.apollo && !t.hunter);
    expect(orphans.map((t) => t.label)).toEqual([]);
  });
});
