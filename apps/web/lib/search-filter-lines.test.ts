import { describe, expect, it } from "vitest";
import { FILTER_KEYS, searchFilterLines } from "./search-filter-lines";
import { dict } from "./i18n/dict";

describe("Beschriftungen", () => {
  // Die Anzeige greift per Cast auf die Karte zu — ein fehlender Schluessel
  // faellt dort nicht auf, sondern erst im Browser als "undefined:".
  it.each(["de", "en"] as const)("hat in %s fuer jeden Filter eine Beschriftung", (lang) => {
    const labels = dict[lang].searchDetail.filterLabels as Record<string, string>;
    for (const key of FILTER_KEYS) {
      expect(labels[key], `${lang}: ${key} fehlt`).toBeTruthy();
    }
  });
});

describe("searchFilterLines", () => {
  it("zeigt bei Apollo genau die gesetzten Filter", () => {
    const zeilen = searchFilterLines({
      source: "apollo",
      query: "supplements · Founder",
      location: "Netherlands",
      filters: {
        person_titles: "Founder",
        apollo_seniorities: ["owner", "founder"],
        apollo_locations: ["Netherlands"],
        headcount: "11-20",
        keywords: "supplements",
        technologies: ["shopify"],
        market_segments: ["ecommerce"],
      },
    });
    expect(zeilen.map((z) => z.key)).toEqual([
      "personTitles", "seniorities", "locations", "headcount",
      "keywords", "technologies", "marketSegments",
    ]);
    expect(zeilen.find((z) => z.key === "seniorities")?.items).toEqual(["owner", "founder"]);
    // Die Oberflaeche muss wissen, aus welcher Slug-Welt sie uebersetzt.
    expect(zeilen.find((z) => z.key === "technologies")?.provider).toBe("apollo");
  });

  it("laesst leere Filter ganz weg, statt sie leer anzuzeigen", () => {
    const zeilen = searchFilterLines({
      source: "apollo",
      query: "x",
      location: "",
      filters: { person_titles: "Founder", keywords: "", market_segments: [], headcount: null },
    });
    expect(zeilen.map((z) => z.key)).toEqual(["personTitles"]);
  });

  it("nimmt bei Corporate die Hunter-Slug-Welt", () => {
    const zeilen = searchFilterLines({
      source: "corporate",
      query: "SaaS",
      location: "München",
      filters: { industry: "SaaS", city: "München", country: "DE", technologies: ["shopify"] },
    });
    expect(zeilen.find((z) => z.key === "technologies")?.provider).toBe("hunter");
    expect(zeilen.find((z) => z.key === "city")?.items).toEqual(["München"]);
  });

  it("fasst US-Bundesstaat und Stadt in einer Zeile zusammen", () => {
    const zeilen = searchFilterLines({
      source: "corporate", query: "x", location: "y",
      filters: { city: "Austin", state: "TX", country: "US" },
    });
    expect(zeilen.find((z) => z.key === "city")?.items).toEqual(["Austin", "TX"]);
  });

  it("zeigt bei Maps Umkreis und Schmerzpunkte", () => {
    const zeilen = searchFilterLines({
      source: "maps", query: "Zahnarzt", location: "Berlin", radius_m: 25000,
      filters: { pain_point_no_website: true, pain_point_max_rating: 4 },
    });
    expect(zeilen.map((z) => z.key)).toEqual(["radius", "noWebsite", "maxRating"]);
    expect(zeilen[0].items).toEqual(["25 km"]);
    expect(zeilen[2].items).toEqual(["≤ 4"]);
  });

  it("formuliert Prospeos Spannen je nachdem, welche Grenze gesetzt ist", () => {
    const nurMin = searchFilterLines({
      source: "prospeo", query: "x", location: "y",
      filters: { job_posting_min: 2, traffic_min_visits: 10000, traffic_max_visits: 50000 },
    });
    expect(nurMin.find((z) => z.key === "jobPostings")?.items).toEqual(["≥ 2"]);
    expect(nurMin.find((z) => z.key === "traffic")?.items).toEqual(["10000–50000"]);

    const nurMax = searchFilterLines({
      source: "prospeo", query: "x", location: "y", filters: { job_posting_max: 5 },
    });
    expect(nurMax.find((z) => z.key === "jobPostings")?.items).toEqual(["≤ 5"]);
  });

  it("kommt ohne filters aus", () => {
    expect(searchFilterLines({ source: "apollo", query: "x", location: "y" })).toEqual([]);
  });
});
