import { describe, expect, it } from "vitest";
import { parseInput } from "./blocklist";

describe("parseInput", () => {
  it("erkennt E-Mails und Domains getrennt nach Zeilen", () => {
    const r = parseInput("max@bestandskunde.de\nkunde-gmbh.at\ninfo@schon-kontaktiert.de");
    expect(r.emails).toEqual(["max@bestandskunde.de", "info@schon-kontaktiert.de"]);
    expect(r.domains).toEqual(["kunde-gmbh.at"]);
  });

  it("erkennt Komma- und Semikolon-getrennte Eintraege", () => {
    const r = parseInput("kunde-a.de, kunde-b.de; kunde-c.de");
    expect(r.domains).toEqual(["kunde-a.de", "kunde-b.de", "kunde-c.de"]);
  });

  it("schneidet Protokoll, www und Pfad von Domains ab", () => {
    expect(parseInput("https://www.kunde-gmbh.de/impressum").domains).toEqual(["kunde-gmbh.de"]);
  });

  it("fischt die E-Mail aus einer CSV-Zeile heraus", () => {
    expect(parseInput("Max Mustermann;max@firma.de;Inhaber").emails).toEqual(["max@firma.de"]);
  });

  it("verwirft Fliesstext als Domain, statt ihn zu speichern", () => {
    // Genau der Bug aus der Produktion: ein versehentlich eingefuegter
    // Website-Text-Absatz landete woertlich als "Domain" in der Sperrliste,
    // weil die alte Pruefung nur "enthaelt einen Punkt" verlangte.
    const r = parseInput(
      "ihre online-sichtbarkeit zu erhöhen und mehr kunden zu gewinnen. sie bieten maßgeschneiderte lösungen."
    );
    expect(r.domains).toEqual([]);
    expect(r.emails).toEqual([]);
  });

  it("verwirft einzelne Woerter mit Punkt, die keine Domain sind", () => {
    expect(parseInput("z.b. das ist ein test").domains).toEqual([]);
  });

  it("akzeptiert Subdomains und mehrteilige Endungen", () => {
    expect(parseInput("mail.beispiel.co.uk").domains).toEqual(["mail.beispiel.co.uk"]);
  });

  it("ignoriert leere Eingabe", () => {
    expect(parseInput("")).toEqual({ emails: [], domains: [] });
    expect(parseInput("   \n  ")).toEqual({ emails: [], domains: [] });
  });
});
