import { describe, expect, it } from "vitest";
import { CITY_SUGGESTIONS, US_CITY_STATE, citySuggestionsFor, usStateForCity } from "./locations";

describe("citySuggestionsFor", () => {
  it("liefert alphabetisch sortierte Vorschlaege ohne Duplikate", () => {
    const cities = citySuggestionsFor("US");
    expect(cities.length).toBeGreaterThan(20);
    expect(new Set(cities).size).toBe(cities.length);
    expect([...cities].sort((a, b) => a.localeCompare(b))).toEqual(cities);
  });

  it("liefert fuer ein unbekanntes Land eine leere Liste statt zu werfen", () => {
    expect(citySuggestionsFor("XX")).toEqual([]);
    expect(citySuggestionsFor("")).toEqual([]);
  });

  it("kennt jedes Land aus der Laenderauswahl", () => {
    for (const code of ["US", "DE", "AT", "CH", "GB", "NL", "FR", "IT", "ES"]) {
      expect(citySuggestionsFor(code).length).toBeGreaterThan(0);
    }
  });
});

describe("usStateForCity", () => {
  it("findet den Bundesstaat zu einer bekannten Stadt", () => {
    expect(usStateForCity("New York")).toBe("NY");
    expect(usStateForCity("Austin")).toBe("TX");
    expect(usStateForCity("Boston")).toBe("MA");
  });

  it("ignoriert Gross-/Kleinschreibung und Randleerzeichen", () => {
    expect(usStateForCity("new york")).toBe("NY");
    expect(usStateForCity("  SAN FRANCISCO  ")).toBe("CA");
  });

  it("liefert null statt zu raten, wenn die Stadt unbekannt ist", () => {
    expect(usStateForCity("Kleinkleckersdorf")).toBeNull();
    expect(usStateForCity("")).toBeNull();
    expect(usStateForCity("   ")).toBeNull();
  });
});

describe("Datenkonsistenz", () => {
  it("jede Stadt in US_CITY_STATE steht auch in den US-Vorschlaegen", () => {
    const suggestions = new Set(citySuggestionsFor("US"));
    for (const city of Object.keys(US_CITY_STATE)) {
      expect(suggestions.has(city), `${city} fehlt in CITY_SUGGESTIONS.US`).toBe(true);
    }
  });

  it("verwendet nur gueltige zweistellige US-Bundesstaat-Kuerzel", () => {
    for (const code of Object.values(US_CITY_STATE)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("enthaelt keine leeren Staedtenamen", () => {
    for (const [country, cities] of Object.entries(CITY_SUGGESTIONS)) {
      for (const city of cities) {
        expect(city.trim(), `leerer Eintrag bei ${country}`).not.toBe("");
      }
    }
  });
});
