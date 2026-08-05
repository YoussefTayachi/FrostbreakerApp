import { describe, expect, it } from "vitest";
import {
  PROSPEO_HEADCOUNT_RANGES,
  PROSPEO_LIMITS,
  buildProspeoFilters,
  hasAnyProspeoFilter,
  requiredProspeoPlan,
  type ProspeoFilters,
} from "./prospeo-query";

describe("buildProspeoFilters", () => {
  /**
   * Die wichtigste Eigenschaft: ein nicht gesetzter Filter taucht GAR NICHT
   * auf. Ein leeres include-Array ist bei Prospeo keine fehlende Bedingung,
   * sondern eine, die nichts erfuellt -- der Fehler erschiene als "keine
   * Treffer" und waere von einem echten Nullergebnis nicht zu unterscheiden.
   */
  it("laesst leere Filter komplett weg", () => {
    expect(buildProspeoFilters({})).toEqual({});
    expect(
      buildProspeoFilters({
        person_titles: "  ",
        technologies: [],
        headcount: [],
        keywords: "",
        traffic_countries: [],
      })
    ).toEqual({});
  });

  /**
   * GROSSGESCHRIEBEN. Die Doku sagt "contains"/"exact", die echte API lehnt
   * beides klein mit einem 400 ab: "Invalid match_mode. Must be one of:
   * CONTAINS, EXACT, SIMILAR, STRICT." Am 2026-08-05 im Testlauf gemessen.
   */
  it("baut Stellentitel mit GROSS geschriebener Vergleichsart", () => {
    expect(buildProspeoFilters({ person_titles: "CEO, Head of Support" })).toEqual({
      person_job_title: { include: ["CEO", "Head of Support"], match_mode: "CONTAINS" },
    });
    expect(
      buildProspeoFilters({ person_titles: "CEO", person_title_match: "EXACT" })
    ).toEqual({
      person_job_title: { include: ["CEO"], match_mode: "EXACT" },
    });
  });

  it("normalisiert eine klein geschriebene Vergleichsart, statt sie durchzureichen", () => {
    const built = buildProspeoFilters({
      person_titles: "CEO",
      person_title_match: "exact" as unknown as "EXACT",
    });
    expect((built.person_job_title as { match_mode: string }).match_mode).toBe("EXACT");
  });

  it("faellt bei unbekannter Vergleichsart auf CONTAINS zurueck", () => {
    const built = buildProspeoFilters({
      person_titles: "CEO",
      person_title_match: "fuzzy" as unknown as "EXACT",
    });
    expect((built.person_job_title as { match_mode: string }).match_mode).toBe("CONTAINS");
  });

  it("verwirft Groessenstufen, die Prospeo nicht kennt", () => {
    const built = buildProspeoFilters({ headcount: ["11-50", "51-100", "10001+"] });
    // "11-50" gibt es nicht, "10001+" ist Apollos Schreibweise -- Prospeo
    // schreibt "10000+". Beide fliegen raus, 51-100 bleibt.
    expect(built).toEqual({ company_headcount_range: { include: ["51-100"] } });
  });

  it("kennt Prospeos oberste Stufe als 10000+, nicht Apollos 10001+", () => {
    expect(PROSPEO_HEADCOUNT_RANGES).toContain("10000+");
    expect(PROSPEO_HEADCOUNT_RANGES).not.toContain("10001+");
  });

  it("deckelt Technologien bei 20 und Keywords bei 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Tech${i}`);
    const built = buildProspeoFilters({
      technologies: many,
      keywords: many.join(","),
    });
    expect((built.company_technology as { include: string[] }).include).toHaveLength(
      PROSPEO_LIMITS.technologies
    );
    expect((built.company_keywords as { include: string[] }).include).toHaveLength(
      PROSPEO_LIMITS.keywords
    );
  });

  it("verwirft Umsatzstufen ausserhalb der Liste", () => {
    expect(buildProspeoFilters({ revenue: ["1M", "3M"] })).toEqual({
      company_revenue: { include: ["1M"] },
    });
  });

  describe("Stellenausschreibungen", () => {
    it("baut hiring_for mit Vergleichsart", () => {
      expect(buildProspeoFilters({ hiring_for: "Customer Support, Support Agent" })).toEqual({
        company_job_posting_hiring_for: {
          include: ["Customer Support", "Support Agent"],
          match_type: "CONTAINS",
        },
      });
    });

    it("baut die Mengenspanne auch, wenn nur eine Seite gesetzt ist", () => {
      expect(buildProspeoFilters({ job_posting_min: 5 })).toEqual({
        company_job_posting_quantity: { min: 5 },
      });
      expect(buildProspeoFilters({ job_posting_max: 100 })).toEqual({
        company_job_posting_quantity: { max: 100 },
      });
    });

    it("behandelt 0 als gesetzten Wert, nicht als leer", () => {
      expect(buildProspeoFilters({ job_posting_min: 0 })).toEqual({
        company_job_posting_quantity: { min: 0 },
      });
    });
  });

  describe("Website-Traffic", () => {
    it("baut die Besuchsspanne", () => {
      expect(
        buildProspeoFilters({ traffic_min_visits: 10000, traffic_max_visits: 1000000 })
      ).toEqual({
        company_website_traffic: { min_monthly_visits: 10000, max_monthly_visits: 1000000 },
      });
    });

    it("baut die Veraenderung mit Zeitraum", () => {
      expect(
        buildProspeoFilters({
          traffic_change_min: 10,
          traffic_change_max: 200,
          traffic_change_period: "quarterly",
        })
      ).toEqual({
        company_website_traffic: {
          visit_change: { period: "quarterly", min_change: 10, max_change: 200 },
        },
      });
    });

    it("nimmt monthly als Zeitraum, wenn keiner gewaehlt wurde", () => {
      const built = buildProspeoFilters({ traffic_change_min: 25 });
      expect(built.company_website_traffic).toEqual({
        visit_change: { period: "monthly", min_change: 25 },
      });
    });

    it("deckelt Laender bei 5 und nimmt den Prozentsatz nur mit Laendern mit", () => {
      const built = buildProspeoFilters({
        traffic_countries: ["US", "UK", "DE", "FR", "IT", "ES"],
        traffic_country_min_pct: 20,
      });
      const traffic = built.company_website_traffic as Record<string, unknown>;
      expect(traffic.top_countries).toHaveLength(PROSPEO_LIMITS.trafficCountries);
      expect(traffic.min_country_pct).toBe(20);
    });

    /**
     * Der Prozentsatz ist laut Doku NUR zusammen mit top_countries erlaubt.
     * Allein gesetzt waere er eine ungueltige Anfrage.
     */
    it("laesst den Prozentsatz weg, wenn keine Laender gewaehlt sind", () => {
      expect(buildProspeoFilters({ traffic_country_min_pct: 20 })).toEqual({});
    });

    /**
     * Ein Traffic-Objekt braucht laut Doku mindestens ein echtes Kriterium.
     * Nur ein Zeitraum ohne Werte ergibt keine Bedingung.
     */
    it("baut gar kein Traffic-Objekt, wenn nur der Zeitraum dasteht", () => {
      expect(buildProspeoFilters({ traffic_change_period: "yearly" })).toEqual({});
    });
  });

  it("ignoriert unbrauchbare Zahlen statt NaN zu schicken", () => {
    expect(
      buildProspeoFilters({ traffic_min_visits: "abc" as unknown as number })
    ).toEqual({});
  });
});

describe("hasAnyProspeoFilter", () => {
  it("erkennt eine Suche ohne jeden Filter", () => {
    expect(hasAnyProspeoFilter({})).toBe(false);
    expect(hasAnyProspeoFilter({ person_titles: "CEO" })).toBe(true);
  });
});

describe("requiredProspeoPlan", () => {
  it("meldet free, solange nur freie Filter gesetzt sind", () => {
    expect(requiredProspeoPlan({ person_titles: "CEO", headcount: ["11-20"] })).toEqual({
      plan: "free",
      fields: [],
    });
  });

  it("meldet starter beim Technologie-Filter", () => {
    const r = requiredProspeoPlan({ technologies: ["Shopify"] });
    expect(r.plan).toBe("starter");
    expect(r.fields).toContain("company_technology");
  });

  it("meldet starter bei Stellenausschreibungen", () => {
    expect(requiredProspeoPlan({ hiring_for: "Support" }).plan).toBe("starter");
  });

  /** Die hoechste Anforderung gewinnt, nicht die zuletzt gefundene. */
  it("meldet pro, sobald Website-Traffic dabei ist", () => {
    const r = requiredProspeoPlan({
      technologies: ["Shopify"],
      hiring_for: "Support",
      traffic_min_visits: 10000,
    });
    expect(r.plan).toBe("pro");
    expect(r.fields).toContain("company_website_traffic");
    expect(r.fields).toContain("company_technology");
  });
});
