import { describe, expect, it } from "vitest";
import { normalizeDomainInput } from "./deliverability";

describe("normalizeDomainInput", () => {
  it("laesst eine reine Domain unveraendert", () => {
    expect(normalizeDomainInput("frostbreaker.app")).toBe("frostbreaker.app");
  });

  it("schneidet eine komplette E-Mail-Adresse auf die Domain herunter", () => {
    // Naheliegender Fehler: das Feld steht direkt neben den Mailbox-Adressen.
    expect(normalizeDomainInput("youssef.tayachi@frostbreaker.app")).toBe("frostbreaker.app");
  });

  it("schneidet Protokoll und Pfad ab", () => {
    expect(normalizeDomainInput("https://frostbreaker.app/settings")).toBe("frostbreaker.app");
  });

  it("normalisiert Gross-/Kleinschreibung und Leerzeichen", () => {
    expect(normalizeDomainInput("  Frostbreaker.App  ")).toBe("frostbreaker.app");
  });

  it("kombiniert E-Mail-Adresse mit Protokoll/Pfad korrekt", () => {
    expect(normalizeDomainInput("https://user@frostbreaker.app/x")).toBe("frostbreaker.app");
  });
});
