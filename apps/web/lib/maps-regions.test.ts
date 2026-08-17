import { describe, expect, it } from "vitest";
import {
  LEADS_PER_COMBINATION,
  MAPS_REGIONS,
  MAX_COUNTRY_FANOUT,
  MAX_RAW_RESULTS,
  planCountryCoverage,
  regionFor,
} from "./maps-regions";

// Diese Tests halten die Mengenlehre fest, mit der die Vorschau dem Nutzer
// eine Zahl nennt. Rechnet der Planer anders als die Vorschau anzeigt, waere
// die Zahl eine Zusage, die die Suche nicht einloest.

describe("planCountryCoverage", () => {
  it("waehlt so viele Staedte, wie die Zielzahl konservativ verlangt", () => {
    // 300 Leads / (15 pro Kombination * 1 Nische) = 20 Staedte — mehr als die
    // Niederlande hergeben, deshalb hier mit zwei Nischen: 300 / (15*2) = 10.
    const plan = planCountryCoverage({
      country: "NL",
      niches: ["marketing agency", "wervingsbureau"],
      targetLeads: 300,
    });
    expect(plan.cities).toHaveLength(10);
    expect(plan.combinations).toBe(20);
    expect(plan.estimatedLeads).toBe(300);
    expect(plan.shortfall).toBe(false);
    expect(plan.limit).toBe("ok");
  });

  it("rundet auf, statt die Zielzahl knapp zu verfehlen", () => {
    // 100 / 15 = 6,67 -> sieben Staedte. Abrunden waere eine stille
    // Untererfuellung.
    const plan = planCountryCoverage({ country: "NL", niches: ["kapper"], targetLeads: 100 });
    expect(plan.citiesNeeded).toBe(7);
    expect(plan.cities).toHaveLength(7);
    expect(plan.estimatedLeads).toBe(105);
  });

  it("nimmt immer die vorderen Staedte der Liste, in Listenreihenfolge", () => {
    const plan = planCountryCoverage({ country: "NL", niches: ["kapper"], targetLeads: 45 });
    expect(plan.cities).toEqual(["Amsterdam", "Rotterdam", "Utrecht"]);
  });

  it("haengt den Landeszusatz an, damit das Geocoding eindeutig ist", () => {
    // "Birmingham" allein waere zwischen England und Alabama nicht
    // entscheidbar — der Worker geokodiert freien Text.
    const plan = planCountryCoverage({ country: "GB", niches: ["agency"], targetLeads: 45 });
    expect(plan.locations).toEqual([
      "London, United Kingdom",
      "Manchester, United Kingdom",
      "Birmingham, United Kingdom",
    ]);
  });

  it("erfindet keine Staedte, wenn das Land ausgeschoepft ist", () => {
    // Belgien hat neun Staedte; 9 * 15 = 135 Leads sind das Ende der Fahnenstange.
    const plan = planCountryCoverage({ country: "BE", niches: ["agency"], targetLeads: 1000 });
    expect(plan.cities).toHaveLength(9);
    expect(plan.estimatedLeads).toBe(135);
    expect(plan.shortfall).toBe(true);
    expect(plan.limit).toBe("city_limit");
  });

  it("deckelt bei MAX_COUNTRY_FANOUT statt unbegrenzt loszulaufen", () => {
    // Sechs Nischen * 15 US-Staedte waeren 90 Kombinationen — der Deckel
    // laesst 60 zu, also zehn Staedte.
    const plan = planCountryCoverage({
      country: "US",
      niches: ["a", "b", "c", "d", "e", "f"],
      targetLeads: 5000,
    });
    expect(plan.combinations).toBe(MAX_COUNTRY_FANOUT);
    expect(plan.cities).toHaveLength(10);
    expect(plan.limit).toBe("fanout_limit");
    expect(plan.shortfall).toBe(true);
  });

  it("gibt gar keinen Plan zurueck, wenn schon eine Stadt den Deckel sprengt", () => {
    // Mehr Nischen als erlaubte Kombinationen: eine Auswahl, die die Haelfte
    // der Nischen stillschweigend weglaesst, waere schlimmer als keine.
    const niches = Array.from({ length: MAX_COUNTRY_FANOUT + 1 }, (_, i) => `n${i}`);
    const plan = planCountryCoverage({ country: "NL", niches, targetLeads: 100 });
    expect(plan.combinations).toBe(0);
    expect(plan.locations).toEqual([]);
    expect(plan.limit).toBe("fanout_limit");
  });

  it("rechnet die durchsuchten Firmen mit dem Deckel pro Einzelsuche", () => {
    const plan = planCountryCoverage({ country: "NL", niches: ["kapper"], targetLeads: 45 });
    expect(plan.scannedCompanies).toBe(3 * MAX_RAW_RESULTS);
  });

  it("entdoppelt und trimmt Nischen", () => {
    const plan = planCountryCoverage({
      country: "NL",
      niches: [" agency ", "agency", "", "  "],
      targetLeads: 30,
    });
    expect(plan.nicheCount).toBe(1);
    expect(plan.combinations).toBe(2);
  });

  it("meldet fehlende Eingaben, statt eine leere Suche zu planen", () => {
    expect(planCountryCoverage({ country: "", niches: ["agency"], targetLeads: 100 }).limit)
      .toBe("no_country");
    expect(planCountryCoverage({ country: "DE", niches: ["agency"], targetLeads: 100 }).limit)
      .toBe("no_country");
    expect(planCountryCoverage({ country: "NL", niches: [], targetLeads: 100 }).limit)
      .toBe("no_niche");
    expect(planCountryCoverage({ country: "NL", niches: [], targetLeads: 100 }).combinations)
      .toBe(0);
  });

  it("behandelt eine unsinnige Zielzahl wie die kleinstmoegliche", () => {
    // 0 oder negativ kaeme nur ueber ein leergeraeumtes Zahlenfeld — eine
    // einzelne Kombination ist die ehrlichste Auslegung davon.
    for (const targetLeads of [0, -50, Number.NaN]) {
      const plan = planCountryCoverage({ country: "NL", niches: ["kapper"], targetLeads });
      expect(plan.combinations).toBe(1);
      expect(plan.cities).toEqual(["Amsterdam"]);
    }
  });
});

describe("MAPS_REGIONS", () => {
  it("hat fuer jedes Land Staedte und einen Geocoding-Zusatz", () => {
    for (const region of MAPS_REGIONS) {
      expect(region.cities.length).toBeGreaterThan(0);
      expect(region.geocodeSuffix.trim()).not.toBe("");
      // Doppelte Staedte waeren doppelte Suchen auf dieselbe Stelle: der
      // place_id-Dedupe im Worker faengt die Leads ab, die Places-Aufrufe
      // waeren trotzdem bezahlt.
      expect(new Set(region.cities).size).toBe(region.cities.length);
    }
  });

  it("liefert regionFor nur bekannte Laender", () => {
    expect(regionFor("NL")?.cities[0]).toBe("Amsterdam");
    expect(regionFor("DE")).toBeUndefined();
    expect(regionFor("")).toBeUndefined();
  });

  it("rechnet konservativer als das theoretische Maximum pro Suche", () => {
    // 20 waere das Maximum des Ziel-Feldes; 15 ist die bewusste Untertreibung.
    expect(LEADS_PER_COMBINATION).toBeLessThan(20);
  });
});
