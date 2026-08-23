import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDIT_CODES, topFinding } from "./website-audit";

/**
 * Der Katalog steht zweimal im Repo: einmal im Worker (Python, dort wird er
 * erhoben) und einmal hier (TypeScript, hier wird er angezeigt). Dasselbe
 * Problem wie bei crypto.py/fernet.ts, nur leiser: laufen die beiden
 * auseinander, stuerzt nichts ab. Die Oberflaeche zeigt dann einfach einen
 * anderen Befund als den, der im Icebreaker steht, und das faellt niemandem
 * auf.
 *
 * Deshalb liest dieser Test die Python-Datei mit. Er ist billig und faengt
 * genau die eine Drift, die sonst durchrutscht.
 */
const PYTHON_SOURCE = new URL("../../worker/worker/website_audit.py", import.meta.url);

function pythonFindingCodes(): string[] {
  const source = readFileSync(PYTHON_SOURCE, "utf8");
  const block = source.match(/FINDING_CODES[^=]*=\s*\(([\s\S]*?)\)/);
  if (!block) throw new Error("FINDING_CODES nicht in website_audit.py gefunden");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("Katalog-Gleichstand mit dem Worker", () => {
  it("kennt dieselben Codes in derselben Rangfolge wie website_audit.py", () => {
    // toEqual auf Arrays: Menge UND Reihenfolge. Die Reihenfolge ist die
    // Rangfolge, sie zu verschieben aendert, welcher Befund gezeigt wird.
    expect(pythonFindingCodes()).toEqual([...AUDIT_CODES]);
  });

  it("liest die Python-Datei wirklich (Schutz gegen einen leer laufenden Test)", () => {
    expect(pythonFindingCodes().length).toBeGreaterThan(0);
  });
});

describe("topFinding", () => {
  it("liefert den ranghoechsten Befund, nicht den ersten der Liste", () => {
    const audit = {
      findings: [
        { code: "no_meta_description", evidence: null },
        { code: "ssl_broken", evidence: null },
        { code: "stale_copyright", evidence: "2019" },
      ],
    };
    expect(topFinding(audit)?.code).toBe("ssl_broken");
  });

  it("liefert genau einen Befund und behaelt seinen Beleg", () => {
    const audit = { findings: [{ code: "stale_copyright", evidence: "2019" }] };
    expect(topFinding(audit)).toEqual({ code: "stale_copyright", evidence: "2019" });
  });

  it("kommt mit leerem, fehlendem und unbrauchbarem Befund zurecht", () => {
    // 'unreachable' speichert genau das: eine leere Liste statt geratener Maengel.
    expect(topFinding({ checked_url: "https://weg.de/", findings: [] })).toBeNull();
    expect(topFinding({})).toBeNull();
    expect(topFinding(null)).toBeNull();
    expect(topFinding(undefined)).toBeNull();
  });

  it("uebergeht Codes, die es hier noch nicht gibt", () => {
    // Kaeme aus einer neueren Worker-Fassung: ohne Beschriftung in dict.ts
    // waere die Anzeige eine leere Zeile.
    const audit = { findings: [{ code: "aus_der_zukunft", evidence: null }] };
    expect(topFinding(audit)).toBeNull();
  });

  it("sortiert nicht die uebergebene Liste um", () => {
    const findings = [
      { code: "no_meta_description", evidence: null },
      { code: "no_https", evidence: null },
    ];
    topFinding({ findings });
    expect(findings[0].code).toBe("no_meta_description");
  });
});
