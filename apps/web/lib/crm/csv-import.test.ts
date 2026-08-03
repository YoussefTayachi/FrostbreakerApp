import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  guessMapping,
  guessTarget,
  isImportable,
  parseCsv,
  planImport,
  toRow,
  type ImportRow,
  type ImportTarget,
} from "./csv-import";

describe("parseCsv", () => {
  it("zerlegt eine einfache Datei", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  // Die drei Faelle, an denen naive Zerlegung scheitert -- und alle drei
  // kommen in echten Exporten vor.
  it("laesst ein Komma innerhalb von Anfuehrungszeichen stehen", () => {
    expect(parseCsv('name,ort\n"Meyer, Anna GmbH",Wien')).toEqual([
      ["name", "ort"],
      ["Meyer, Anna GmbH", "Wien"],
    ]);
  });

  it("versteht verdoppelte Anfuehrungszeichen als ein Zeichen", () => {
    expect(parseCsv('name\n"Die ""Alte"" Muehle"')).toEqual([["name"], ['Die "Alte" Muehle']]);
  });

  it("laesst einen Zeilenumbruch innerhalb eines Feldes zu", () => {
    const rows = parseCsv('name,adresse\nAcme,"Hauptstr. 1\n1010 Wien"');
    expect(rows[1][1]).toBe("Hauptstr. 1\n1010 Wien");
    expect(rows).toHaveLength(2);
  });

  it("kommt mit Windows-Zeilenenden klar", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  // Excel schreibt beim UTF-8-Export einen BOM. Ungefiltert heisst die erste
  // Spalte dann nicht "Name", und die Zuordnung findet sie nie.
  it("entfernt den Byte Order Mark aus Excel-Exporten", () => {
    expect(parseCsv("﻿Name,Email")[0][0]).toBe("Name");
  });

  it("wirft leere Zeilen weg", () => {
    expect(parseCsv("a\n\n1\n")).toEqual([["a"], ["1"]]);
  });

  it("kommt mit einer leeren Datei klar", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("nimmt ein anderes Trennzeichen", () => {
    expect(parseCsv("a;b\n1;2", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("detectDelimiter", () => {
  it("erkennt Komma", () => {
    expect(detectDelimiter("name,email,phone\nx,y,z")).toBe(",");
  });

  it("erkennt Semikolon aus deutschem Excel", () => {
    expect(detectDelimiter("name;email;phone\nx;y;z")).toBe(";");
  });

  it("erkennt Tabulator", () => {
    expect(detectDelimiter("name\temail\nx\ty")).toBe("\t");
  });

  // An einer Datenzeile waere die Zaehlung unzuverlaessig: ein Fliesstext mit
  // Kommas wuerde das Semikolon ueberstimmen.
  it("entscheidet an der Kopfzeile, nicht an den Daten", () => {
    expect(detectDelimiter('name;ort\n"Meyer, Anna, GmbH";Wien')).toBe(";");
  });
});

describe("guessTarget", () => {
  it("erkennt Pipedrives deutsche Spalten", () => {
    expect(guessTarget("Vorname")).toBe("first_name");
    expect(guessTarget("Nachname")).toBe("last_name");
    expect(guessTarget("Organisation")).toBe("company_name");
    expect(guessTarget("E-Mail")).toBe("email");
    expect(guessTarget("Telefon")).toBe("phone");
  });

  it("erkennt die englischen Spalten", () => {
    expect(guessTarget("First name")).toBe("first_name");
    expect(guessTarget("Organization")).toBe("company_name");
    expect(guessTarget("Email")).toBe("email");
    expect(guessTarget("Job title")).toBe("title");
  });

  // Falsch raten waere schlimmer als nicht raten: eine E-Mail-Spalte, die als
  // Telefonnummer landet, faellt erst beim naechsten Versand auf.
  it("laesst Unbekanntes lieber offen", () => {
    expect(guessTarget("Lead-Quelle")).toBe("ignore");
    expect(guessTarget("")).toBe("ignore");
  });
});

describe("guessMapping", () => {
  it("ordnet eine Pipedrive-Kopfzeile zu", () => {
    expect(guessMapping(["Vorname", "Nachname", "Organisation", "E-Mail"])).toEqual([
      "first_name",
      "last_name",
      "company_name",
      "email",
    ]);
  });

  // Sonst wuerde "E-Mail 2" die erste Adresse ueberschreiben.
  it("belegt jedes Ziel hoechstens einmal", () => {
    const mapping = guessMapping(["E-Mail", "E-Mail 2"]);
    expect(mapping[0]).toBe("email");
    expect(mapping[1]).toBe("ignore");
  });
});

describe("toRow", () => {
  const mapping: ImportTarget[] = ["first_name", "last_name", "company_name", "email"];

  it("uebernimmt die zugeordneten Spalten", () => {
    const row = toRow(["Anna", "Berg", "Acme", "Anna@Acme.COM"], mapping);
    expect(row.first_name).toBe("Anna");
    expect(row.company_name).toBe("Acme");
  });

  it("schreibt die Adresse klein, damit der Dublettenabgleich greift", () => {
    expect(toRow(["", "", "Acme", "Anna@Acme.COM"], mapping).email).toBe("anna@acme.com");
  });

  it("bildet den vollen Namen aus Vor- und Nachnamen", () => {
    expect(toRow(["Anna", "Berg", "Acme", ""], mapping).full_name).toBe("Anna Berg");
  });

  // Am ERSTEN Leerzeichen: "Anna Maria Berg" ist haeufiger als ein doppelter
  // Nachname, und bei der Anrede zaehlt der Vorname.
  it("teilt einen vollen Namen am ersten Leerzeichen", () => {
    const row = toRow(["Anna Maria Berg", "Acme"], ["full_name", "company_name"]);
    expect(row.first_name).toBe("Anna");
    expect(row.last_name).toBe("Maria Berg");
  });

  it("kommt mit einem einzelnen Namen klar", () => {
    const row = toRow(["Cher", "Acme"], ["full_name", "company_name"]);
    expect(row.first_name).toBe("Cher");
    expect(row.last_name).toBeNull();
  });

  it("ignoriert Spalten ohne Ziel", () => {
    expect(toRow(["x", "Acme"], ["ignore", "company_name"]).company_name).toBe("Acme");
  });
});

describe("isImportable", () => {
  it("verlangt eine Firma", () => {
    expect(isImportable({ company_name: "Acme" } as ImportRow)).toBe(true);
    expect(isImportable({ company_name: null } as ImportRow)).toBe(false);
    expect(isImportable({ company_name: "  " } as ImportRow)).toBe(false);
  });
});

describe("planImport", () => {
  const row = (email: string | null, company = "Acme"): ImportRow =>
    ({ email, company_name: company }) as ImportRow;

  it("laesst neue Zeilen durch", () => {
    const plan = planImport([row("a@x.com"), row("b@x.com")], []);
    expect(plan.usable).toHaveLength(2);
  });

  it("erkennt Dubletten gegen den Bestand", () => {
    const plan = planImport([row("a@x.com"), row("b@x.com")], ["A@X.com"]);
    expect(plan.duplicates).toBe(1);
    expect(plan.usable).toHaveLength(1);
  });

  it("erkennt Dubletten innerhalb der Datei", () => {
    const plan = planImport([row("a@x.com"), row("a@x.com")], []);
    expect(plan.duplicatesInFile).toBe(1);
    expect(plan.usable).toHaveLength(1);
  });

  it("zaehlt Zeilen ohne Firma getrennt", () => {
    const plan = planImport([row("a@x.com", "")], []);
    expect(plan.withoutCompany).toBe(1);
    expect(plan.usable).toHaveLength(0);
  });

  // Zwei Personen ohne Adresse bei derselben Firma koennen zwei verschiedene
  // sein -- ein faelschlich verworfener Kontakt waere schlimmer als ein
  // doppelter.
  it("wirft Zeilen ohne Adresse nie als Dublette weg", () => {
    const plan = planImport([row(null), row(null)], []);
    expect(plan.usable).toHaveLength(2);
    expect(plan.duplicates).toBe(0);
  });
});
