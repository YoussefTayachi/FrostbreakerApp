import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FINDING_PROMPT_DE,
  DEFAULT_FINDING_PROMPT_EN,
  FINDING_MAX_WORDS,
  getDefaultFindingPrompt,
} from "./website-finding-defaults";

/**
 * Der eigentliche Wert dieser Datei: sie liest den WORKER und vergleicht.
 *
 * Die Web-Fassung des Standardtexts ist eine Abschrift aus
 * apps/worker/worker/pipelines/website_finding.py. Ein Kommentar "muss
 * uebereinstimmen" haelt das nicht: beim Icebreaker standen beide Fassungen
 * monatelang nebeneinander und wichen auseinander, ohne dass es jemand sah.
 *
 * Was ein Unterschied anrichtet, ist konkret: der AI-Agent-Tab speichert einen
 * Prompt als NULL, solange er dem angezeigten Standard entspricht (leer heisst
 * "nimm den Standard", Migration 0103, Abschnitt 3). Weicht die Web-Fassung um
 * ein Zeichen ab, gilt der unveraenderte Standardtext als eigener Prompt und
 * wird eingefroren. Der Workspace bekommt spaetere Verbesserungen dann nie
 * mehr zu sehen.
 *
 * Vitest laeuft in der node-Umgebung, das Lesen der Datei ist also erlaubt und
 * kostet nichts. Der Pfad ist relativ zum Wurzelverzeichnis von apps/web.
 */
const WORKER_FILE = join(process.cwd(), "..", "worker", "worker", "pipelines", "website_finding.py");

/**
 * Eine Python-Konstante aus dem Quelltext lesen, ohne Python.
 *
 * Beide Prompts stehen dort als aneinandergereihte String-Literale
 * ("...\n" "..."), wie es der Formatierer setzt. Zusammengesetzt wird hier
 * genau so, wie Python es tut: Literale ohne Trennzeichen aneinander, danach
 * die Escapes aufloesen.
 */
function pythonStringConst(source: string, name: string): string {
  const start = source.indexOf(`${name} = (`);
  if (start === -1) throw new Error(`Konstante ${name} nicht in website_finding.py gefunden`);
  const end = source.indexOf("\n)", start);
  if (end === -1) throw new Error(`Konstante ${name} ist nicht geschlossen`);
  const block = source.slice(start, end);
  const literals = block.match(/"(?:[^"\\]|\\.)*"/g);
  if (!literals) throw new Error(`Konstante ${name} enthaelt keine Zeichenketten`);
  return literals
    .map((lit) => lit.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\"))
    .join("");
}

describe("Standardtext des Website-Befunds", () => {
  const source = readFileSync(WORKER_FILE, "utf8");

  it("stimmt zeichengenau mit DEFAULT_FINDING_PROMPT_DE im Worker ueberein", () => {
    expect(DEFAULT_FINDING_PROMPT_DE).toBe(pythonStringConst(source, "DEFAULT_FINDING_PROMPT_DE"));
  });

  it("stimmt zeichengenau mit DEFAULT_FINDING_PROMPT_EN im Worker ueberein", () => {
    expect(DEFAULT_FINDING_PROMPT_EN).toBe(pythonStringConst(source, "DEFAULT_FINDING_PROMPT_EN"));
  });

  it("hat dieselbe Wortgrenze wie der Worker", () => {
    const match = source.match(/^FINDING_MAX_WORDS = (\d+)$/m);
    expect(match?.[1]).toBe(String(FINDING_MAX_WORDS));
  });

  // Die Sprachwahl folgt default_prompt() im Worker: alles ausser "en" ist
  // Deutsch, damit ein unbekannter Wert nicht in einer leeren Vorgabe endet.
  it("waehlt die Fassung nach der Ausgabesprache", () => {
    expect(getDefaultFindingPrompt("de")).toBe(DEFAULT_FINDING_PROMPT_DE);
    expect(getDefaultFindingPrompt("en")).toBe(DEFAULT_FINDING_PROMPT_EN);
  });
});
