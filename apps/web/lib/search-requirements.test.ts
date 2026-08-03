import { describe, expect, it } from "vitest";
import { missingProviders, requiredProviders, type SearchMode } from "./search-requirements";

const ALL = ["google_maps", "apollo", "hunter", "openai", "neverbounce", "instantly"];
const MODES: SearchMode[] = ["maps", "apollo", "corporate"];

describe("requiredProviders", () => {
  it("Maps braucht Google Maps und OpenAI", () => {
    expect(requiredProviders("maps")).toEqual(["google_maps", "openai"]);
  });

  it("Corporate braucht Hunter und OpenAI", () => {
    expect(requiredProviders("corporate")).toEqual(["hunter", "openai"]);
  });

  it("Apollo braucht Apollo und OpenAI", () => {
    expect(requiredProviders("apollo")).toEqual(["apollo", "openai"]);
  });

  // personalize wird in allen drei Wegen eingereiht und zieht dort den Key.
  it("jeder Weg braucht OpenAI", () => {
    for (const mode of MODES) expect(requiredProviders(mode)).toContain("openai");
  });

  // Genau die Verwechslung, die im Code kommentiert ist: seit "genau eine
  // Adressquelle pro Suchweg" laeuft Hunter NICHT mehr bei Maps mit.
  it("Maps braucht kein Hunter", () => {
    expect(requiredProviders("maps")).not.toContain("hunter");
  });

  it("Apollo braucht kein Hunter und kein Google Maps", () => {
    expect(requiredProviders("apollo")).not.toContain("hunter");
    expect(requiredProviders("apollo")).not.toContain("google_maps");
  });
});

describe("missingProviders", () => {
  it("meldet nichts, wenn alles da ist", () => {
    for (const mode of MODES) expect(missingProviders(mode, ALL)).toEqual([]);
  });

  it("meldet alles, wenn gar nichts hinterlegt ist", () => {
    expect(missingProviders("maps", [])).toEqual(["google_maps", "openai"]);
  });

  // Die beiden realen Fehlschlaege aus den Job-Logs.
  it("erkennt den fehlenden Google-Maps-Key", () => {
    expect(missingProviders("maps", ["openai", "hunter"])).toEqual(["google_maps"]);
  });

  it("erkennt den fehlenden Hunter-Key", () => {
    expect(missingProviders("corporate", ["openai", "google_maps"])).toEqual(["hunter"]);
  });

  it("ignoriert Keys, die dieser Weg nicht braucht", () => {
    expect(missingProviders("apollo", ["apollo", "openai"])).toEqual([]);
    expect(missingProviders("apollo", ["apollo", "openai", "neverbounce"])).toEqual([]);
  });

  it("behaelt die Reihenfolge aus der Anforderung", () => {
    expect(missingProviders("corporate", [])).toEqual(["hunter", "openai"]);
  });
});
