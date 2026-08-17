import { describe, expect, it } from "vitest";
import { searchRowToPresetConfig } from "./search-presets";
import { APOLLO_DEFAULT_SENIORITIES } from "./apollo-query";

/**
 * Die Rueckwaerts-Abbildung ist der Teil, der still falsch sein kann: eine
 * Vorlage, die neunzig Prozent der Filter mitbringt, sieht beim Laden richtig
 * aus. Was fehlt, merkt der Nutzer erst an der Trefferzahl — oder gar nicht,
 * weil er ja nicht mehr weiss, was er ausgewaehlt hatte. Genau deshalb gibt es
 * die Funktion (und diese Tests).
 */

describe("searchRowToPresetConfig -- Apollo", () => {
  // Nachgebaut aus der echten Suche ddf4c1be vom 2026-08-09.
  const zeile = {
    source: "apollo",
    query: "supplements, nutrition, cosmetics · Founder",
    location: "Netherlands",
    max_results: 15,
    target_email_count: 15,
    filters: {
      person_titles: "Founder",
      apollo_locations: ["Netherlands"],
      apollo_seniorities: ["owner", "founder"],
      headcount: "11-20",
      keywords: "supplements, nutrition, cosmetics",
      technologies: ["shopify"],
      market_segments: ["ecommerce"],
    },
  };

  it("uebernimmt die Filter, nicht die erzeugte Ueberschrift", () => {
    const c = searchRowToPresetConfig(zeile);
    expect(c.mode).toBe("apollo");
    expect(c.personTitles).toBe("Founder");
    expect(c.keywords).toBe("supplements, nutrition, cosmetics");
    expect(c.headcount).toBe("11-20");
    expect(c.marketSegments).toEqual(["ecommerce"]);
    // query/location sind bei Apollo nur Anzeigetext — landen sie in der
    // Vorlage, taucht "supplements, nutrition, cosmetics · Founder" beim
    // naechsten Mal als Google-Maps-Suchbegriff auf.
    expect(c.query).toBe("");
    expect(c.location).toBe("");
  });

  it("rechnet Laendernamen in die Codes der Auswahl zurueck", () => {
    expect(searchRowToPresetConfig(zeile).apolloCountries).toEqual(["NL"]);
  });

  it("rechnet Apollo-Slugs in interne Technologie-IDs zurueck", () => {
    expect(searchRowToPresetConfig(zeile).technologies).toEqual(["shopify"]);
  });

  it("nimmt die Zielzahl aus target_email_count", () => {
    expect(searchRowToPresetConfig(zeile).targetEmails).toBe(15);
  });

  it("faellt bei fehlenden Senioritaeten auf die Entscheider-Stufen zurueck", () => {
    const ohne = { ...zeile, filters: { ...zeile.filters, apollo_seniorities: [] } };
    expect(searchRowToPresetConfig(ohne).apolloSeniorities).toEqual([
      ...APOLLO_DEFAULT_SENIORITIES,
    ]);
  });

  it("laesst Laender weg, die das Formular gar nicht anbietet", () => {
    const exotisch = { ...zeile, filters: { ...zeile.filters, apollo_locations: ["Japan", "Germany"] } };
    expect(searchRowToPresetConfig(exotisch).apolloCountries).toEqual(["DE"]);
  });
});

describe("searchRowToPresetConfig -- Maps", () => {
  const zeile = {
    source: "maps",
    query: "Zahnarzt",
    location: "Berlin",
    radius_m: 25000,
    max_results: 50,
    target_email_count: 10,
    filters: { pain_point_no_website: true, pain_point_max_rating: 4 },
  };

  it("behaelt Begriff, Ort und Umkreis -- hier IST query die Eingabe", () => {
    const c = searchRowToPresetConfig(zeile);
    expect(c.query).toBe("Zahnarzt");
    expect(c.location).toBe("Berlin");
    expect(c.radius).toBe(25000);
  });

  it("uebernimmt die Schmerzpunkt-Filter", () => {
    const c = searchRowToPresetConfig(zeile);
    expect(c.noWebsite).toBe(true);
    expect(c.maxRating).toBe(4);
  });

  it("setzt maxRating auf leer, wenn kein Wert gesetzt war", () => {
    const c = searchRowToPresetConfig({ ...zeile, filters: {} });
    expect(c.maxRating).toBe("");
    expect(c.noWebsite).toBe(false);
  });

  it("holt bei einer gebuendelten Suche die urspruenglichen Kommalisten zurueck", () => {
    // Die Gruppen-Zeile traegt in query/location Zusammenfassungen fuers Auge
    // (Migration 0096). Landeten die in der Vorlage, wuerde die naechste Suche
    // nach dem Ort "15 Orte" fahnden.
    const gruppe = {
      source: "maps",
      query: "Zahnarzt, Zahnklinik",
      location: "15 Orte",
      radius_m: 2000,
      target_email_count: 300,
      filters: {
        group_queries: ["Zahnarzt", "Zahnklinik"],
        group_locations: ["Amsterdam, Netherlands", "Rotterdam, Netherlands"],
        group_target_email_count: 20,
      },
    };
    const c = searchRowToPresetConfig(gruppe);
    expect(c.query).toBe("Zahnarzt, Zahnklinik");
    expect(c.location).toBe("Amsterdam, Netherlands, Rotterdam, Netherlands");
    // Die Zielzahl PRO Teilsuche, nicht die Summe: 300 waere im Formularfeld
    // (max. 20) ein ungueltiger Wert, den niemand getippt hat.
    expect(c.targetEmails).toBe(20);
  });
});

describe("searchRowToPresetConfig -- Corporate", () => {
  const zeile = {
    source: "corporate",
    query: "SaaS · crm",
    location: "München, DE",
    max_results: 50,
    target_email_count: 10,
    filters: {
      industry: "SaaS",
      city: "München",
      state: null,
      country: "DE",
      headcount: "11-50",
      keywords: "crm",
      technologies: ["shopify"],
    },
  };

  it("holt Branche, Ort und Land aus den Filtern", () => {
    const c = searchRowToPresetConfig(zeile);
    expect(c.industry).toBe("SaaS");
    expect(c.city).toBe("München");
    expect(c.country).toBe("DE");
    expect(c.headcount).toBe("11-50");
  });

  it("rechnet die Slugs ueber die Hunter-Spalte zurueck", () => {
    expect(searchRowToPresetConfig(zeile).technologies).toEqual(["shopify"]);
  });
});

describe("searchRowToPresetConfig -- Prospeo", () => {
  // Prospeos Filterobjekt wandert unveraendert in searches.filters — und muss
  // genauso unveraendert wieder herauskommen. Bis zum 2026-08-10 speicherte
  // die Vorlage davon NICHTS.
  const filters = {
    person_titles: "Head of Growth",
    company_locations: ["Netherlands"],
    hiring_for: "Performance Marketing",
    job_posting_min: 2,
    traffic_min_visits: 10000,
    technologies: ["shopify"],
    revenue: ["1M-10M"],
  };

  it("nimmt das ganze Filterobjekt mit", () => {
    const c = searchRowToPresetConfig({
      source: "prospeo",
      query: "Performance Marketing · shopify",
      location: "Netherlands",
      target_email_count: 5,
      filters,
    });
    expect(c.mode).toBe("prospeo");
    expect(c.prospeoFilters).toEqual(filters);
  });
});

describe("searchRowToPresetConfig -- Grenzfaelle", () => {
  it("kommt ohne filters aus", () => {
    const c = searchRowToPresetConfig({ source: "maps", query: "Bäckerei", location: "Wien" });
    expect(c.noWebsite).toBe(false);
    expect(c.targetEmails).toBe(10);
    expect(c.radius).toBe(10000);
  });

  it("faellt bei unbekannter Quelle auf den Maps-Modus zurueck", () => {
    // Kann eine Suche aus einer spaeteren Version sein. Ein unbekannter Modus
    // waere im Formular ein Zustand ohne Oberflaeche — lieber der Weg, den es
    // seit der ersten Fassung gibt.
    const c = searchRowToPresetConfig({ source: "irgendwas_neues", query: "x", location: "y" });
    expect(c.mode).toBe("maps");
  });

  it("nimmt max_results, wenn die Zielzahl fehlt (Vorlagen von frueher)", () => {
    const c = searchRowToPresetConfig({
      source: "maps", query: "x", location: "y", max_results: 42,
    });
    expect(c.targetEmails).toBe(42);
  });
});
