import { describe, expect, it } from "vitest";
import {
  APOLLO_DEFAULT_SENIORITIES,
  buildApolloSearchBody,
  employeeRange,
  hasAnyApolloFilter,
} from "./apollo-query";

// Diese Tests spiegeln test_apollo.py im Worker. Weicht der Body hier ab,
// zaehlt die Vorschau etwas anderes, als die Suche spaeter holt — und die
// angezeigte Zahl waere eine Zusage, die die Suche nicht einloest.

describe("buildApolloSearchBody", () => {
  it("verlangt immer verifizierte Adressen", () => {
    // Der Kern der Integration: nur so ist die gezaehlte Zahl auch die Zahl
    // erreichbarer Leads und nicht bloss passender Personen.
    const body = buildApolloSearchBody({ keywords: "ecommerce" });
    expect(body.contact_email_status).toEqual(["verified"]);
  });

  it("zerlegt Titel und Keywords an Kommas und wirft Leerraum weg", () => {
    const body = buildApolloSearchBody({
      person_titles: " Founder , CEO ,, ",
      keywords: "marketing agency, digital marketing",
    });
    expect(body.person_titles).toEqual(["Founder", "CEO"]);
    expect(body.q_organization_keyword_tags).toEqual(["marketing agency", "digital marketing"]);
  });

  it("laesst leere Felder ganz weg, statt leere Listen zu schicken", () => {
    const body = buildApolloSearchBody({ keywords: "ecommerce" });
    expect(body).not.toHaveProperty("person_titles");
    expect(body).not.toHaveProperty("organization_locations");
    expect(body).not.toHaveProperty("currently_using_any_of_technology_uids");
  });

  it("faellt bei ungueltiger Senioritaet auf die Entscheider-Auswahl zurueck", () => {
    // Eine Suche ohne Senioritaet wuerde quer durch alle Hierarchiestufen
    // Credits verbrauchen — deshalb nie leer lassen.
    expect(buildApolloSearchBody({ apollo_seniorities: ["gibt-es-nicht"] }).person_seniorities)
      .toEqual(APOLLO_DEFAULT_SENIORITIES);
    expect(buildApolloSearchBody({}).person_seniorities).toEqual(APOLLO_DEFAULT_SENIORITIES);
  });

  it("behaelt nur von Apollo anerkannte Senioritaeten", () => {
    const body = buildApolloSearchBody({ apollo_seniorities: ["owner", "quatsch", "vp"] });
    expect(body.person_seniorities).toEqual(["owner", "vp"]);
  });

  it("entdoppelt Technologie-Slugs bei stabiler Reihenfolge", () => {
    const body = buildApolloSearchBody({ technologies: ["shopify", "shopify", "apolloio"] });
    expect(body.currently_using_any_of_technology_uids).toEqual(["shopify", "apolloio"]);
  });

  it("uebernimmt Seite und Seitengroesse", () => {
    const body = buildApolloSearchBody({ keywords: "x" }, 3, 100);
    expect(body.page).toBe(3);
    expect(body.per_page).toBe(100);
  });
});

describe("employeeRange", () => {
  it("uebersetzt Apollos Stufen in die Range-Schreibweise", () => {
    expect(employeeRange("11-20")).toBe("11,20");
    expect(employeeRange("10001+")).toBe("10001,1000000");
  });

  it("verwirft Stufen, die Apollos Oberflaeche nicht kennt", () => {
    // "11-50" ist bei Apollo keine Option. Umrechnen waere eine stille
    // Abweichung von dem, was der Kunde dort sieht.
    expect(employeeRange("11-50")).toBeNull();
    expect(employeeRange(null)).toBeNull();
    expect(employeeRange("")).toBeNull();
  });
});

describe("market_segments", () => {
  it("uebergibt Apollos eigene Schreibweise, Reihenfolge stabil", () => {
    // Am 2026-08-09 gegen die echte API gemessen: der Parameter heisst
    // market_segments, "ecommerce" steht ohne Bindestrich.
    // Reihenfolge folgt APOLLO_MARKET_SEGMENTS, nicht der Klickreihenfolge --
    // sonst waere der Body nicht vergleichbar und matching_prior_search_ids
    // haelte zwei gleiche Suchen fuer verschieden.
    const body = buildApolloSearchBody({ market_segments: ["saas", "ecommerce", "non_profit"] });
    expect(body.market_segments).toEqual(["ecommerce", "non_profit", "saas"]);
  });

  it("verwirft unbekannte Werte", () => {
    const body = buildApolloSearchBody({ keywords: "agency", market_segments: ["healthcare", "b2b"] });
    expect(body.market_segments).toEqual(["b2b"]);
  });

  it("setzt das Feld gar nicht, wenn nichts gewaehlt ist", () => {
    const body = buildApolloSearchBody({ keywords: "agency" });
    expect(body.market_segments).toBeUndefined();
  });
});

describe("hasAnyApolloFilter", () => {
  it("erkennt jeden einzelnen Filter als ausreichend", () => {
    expect(hasAnyApolloFilter({ person_titles: "CEO" })).toBe(true);
    expect(hasAnyApolloFilter({ apollo_locations: ["United States"] })).toBe(true);
    expect(hasAnyApolloFilter({ keywords: "agency" })).toBe(true);
    expect(hasAnyApolloFilter({ headcount: "11-20" })).toBe(true);
    expect(hasAnyApolloFilter({ technologies: ["shopify"] })).toBe(true);
    expect(hasAnyApolloFilter({ market_segments: ["saas"] })).toBe(true);
  });

  it("zaehlt ein unbekanntes Marktsegment NICHT als Filter", () => {
    // Apollo verwirft unbekannte Werte stillschweigend. Wuerde die
    // Oberflaeche sie als Filter zaehlen, liesse sie eine Suche zu, die in
    // Wahrheit ungefiltert ist.
    expect(hasAnyApolloFilter({ market_segments: ["healthcare"] })).toBe(false);
    expect(hasAnyApolloFilter({ market_segments: [] })).toBe(false);
  });

  it("zaehlt eine reine Senioritaets-Auswahl NICHT als Filter", () => {
    // Senioritaet ist immer gesetzt (Vorauswahl). Wuerde sie zaehlen, waere
    // die Anfrage "alle Entscheider weltweit" — der Worker weist das ab.
    expect(hasAnyApolloFilter({ apollo_seniorities: ["owner"] })).toBe(false);
    expect(hasAnyApolloFilter({})).toBe(false);
    expect(hasAnyApolloFilter({ headcount: "11-50", keywords: "  " })).toBe(false);
  });
});
