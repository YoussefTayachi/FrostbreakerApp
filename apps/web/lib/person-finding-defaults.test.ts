import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERSON_BANNED_DE,
  PERSON_BANNED_EN,
  PERSON_FINDING_MAX_WORDS,
  PERSON_SNIPPET_MAX_WORDS,
  personBannedWords,
} from "./person-finding-defaults";

/**
 * Liest den Worker und vergleicht. Dieselbe Bauart wie
 * website-finding-defaults.test.ts, aus demselben Grund: eine Abschrift, die
 * niemand nachprueft, weicht ab, ohne dass es jemand sieht. Hier haengt daran
 * der Torwart (rechnet den Platzhalter mit dieser Laenge) und die
 * Kontakt-Prueflliste (prueft einen von Hand geschriebenen Absatz gegen
 * diese Liste).
 */
const WORKER_FILE = join(process.cwd(), "..", "worker", "worker", "pipelines", "person_finding.py");

/** Eine Python-Liste aus String-Literalen lesen, ohne Python. */
function pythonStringList(source: string, name: string): string[] {
  const start = source.indexOf(`${name} = [`);
  if (start === -1) throw new Error(`Liste ${name} nicht in person_finding.py gefunden`);
  const end = source.indexOf("\n]", start);
  if (end === -1) throw new Error(`Liste ${name} ist nicht geschlossen`);
  const block = source.slice(start, end);
  const literals = block.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  return literals.map((lit) => lit.slice(1, -1));
}

describe("Personen-Befund: Spiegel des Workers", () => {
  const source = readFileSync(WORKER_FILE, "utf8");

  it("hat dieselbe Wortgrenze wie der Worker", () => {
    const match = source.match(/^PERSON_FINDING_MAX_WORDS = (\d+)$/m);
    expect(match?.[1]).toBe(String(PERSON_FINDING_MAX_WORDS));
  });

  it("hat dieselben Schnipsel-Grenzen wie der Worker", () => {
    const start = source.indexOf("SNIPPET_FIELDS = (");
    const end = source.indexOf("\n)", start);
    const block = source.slice(start, end);
    const paare = Object.fromEntries(
      Array.from(block.matchAll(/\("(\w+)", (\d+)\)/g)).map((m) => [m[1], Number(m[2])])
    );
    expect(paare).toEqual(PERSON_SNIPPET_MAX_WORDS);
  });

  it("hat dieselbe englische Verbotsliste wie der Worker", () => {
    expect([...PERSON_BANNED_EN]).toEqual(pythonStringList(source, "PERSON_BANNED_EN"));
  });

  it("hat dieselbe deutsche Verbotsliste wie der Worker", () => {
    expect([...PERSON_BANNED_DE]).toEqual(pythonStringList(source, "PERSON_BANNED_DE"));
  });
});

describe("personBannedWords", () => {
  // Der Grund fuer die eigene Liste: die Workspace-Liste verbietet die
  // Herkunftsnennung, und dieser Text muss sie nennen.
  it("nimmt aus der Workspace-Liste nur Striche", () => {
    const list = personBannedWords(["—", "--", "I saw", "I noticed", " - "], "en");
    expect(list).toContain("—");
    expect(list).toContain("--");
    expect(list).toContain("-");
    expect(list).not.toContain("I saw");
    expect(list).not.toContain("I noticed");
    expect(list).toContain("i think");
  });

  it("waehlt die Liste nach Sprache", () => {
    expect(personBannedWords([], "de")).toContain("vielleicht");
    expect(personBannedWords([], "de")).not.toContain("i think");
  });
});
