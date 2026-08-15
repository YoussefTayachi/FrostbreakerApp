import { describe, expect, it } from "vitest";
import type { Offer } from "@/lib/offers";
import {
  SEARCH_SUGGESTED_FIELDS,
  SUMMARY_MAX_CHARS,
  SUMMARY_SAMPLE_SIZE,
  buildOfferFromSearchPrompt,
  parseOfferFromSearch,
  sampleSummaries,
  type LeadListContext,
} from "./offer-from-search";

const angebot: Offer = {
  id: "1",
  name: "Retourenheld",
  offering: "Wir senken Retourenquoten",
  icp: "Onlineshops",
  problem: "Zu viele Retouren",
  friction: "Der Retourenschein liegt hinter dem Login",
  friction_reason: "Sie brechen ab",
  outcome: "in 14 Tagen 12 Prozent weniger",
  mechanism: "Wir raeumen den Bestellabschluss auf",
  proof: "40 Shops seit 2019",
  preview_asset: "Eine Aufnahme des Bestellwegs",
  review_time: "90 Sekunden",
  cta: "Soll ich sie dir schicken?",
  tone: "direkt, kein Hype",
  address_form: "du",
  language: "de",
  website: null,
  signature: "",
  is_default: true,
};

const liste: LeadListContext = {
  name: "Shopify-Shops DACH",
  query: "supplements",
  location: "Deutschland",
  source: "apollo",
  filters: [
    { key: "headcount", items: ["11-50"] },
    { key: "technologies", items: ["shopify"], provider: "apollo" },
  ],
  summaries: [
    { name: "Nordfit", summary: "Verkauft Proteinpulver ueber einen Shopify-Shop." },
    { name: "Vitalis", summary: "Nahrungsergaenzung im Abo, Versand aus Hamburg." },
  ],
  totalWithSummary: 87,
};

describe("buildOfferFromSearchPrompt", () => {
  it("gibt Filter und Firmenbeschreibungen mit", () => {
    const p = buildOfferFromSearchPrompt(liste, angebot);
    expect(p).toContain("headcount: 11-50");
    expect(p).toContain("technologies: shopify");
    expect(p).toContain("Nordfit: Verkauft Proteinpulver");
  });

  it("sagt, dass es eine Stichprobe ist -- sonst haelt das Modell 2 fuer die ganze Liste", () => {
    expect(buildOfferFromSearchPrompt(liste, angebot)).toContain("2 of the 87 companies");
  });

  it("nennt keine Stichprobe, wenn alle Beschreibungen mitgehen", () => {
    const p = buildOfferFromSearchPrompt({ ...liste, totalWithSummary: 2 }, angebot);
    expect(p).toContain("the 2 companies");
    expect(p).not.toContain("2 of the 2");
  });

  it("verbietet das Erfinden", () => {
    const p = buildOfferFromSearchPrompt(liste, angebot);
    expect(p).toContain("Never guess");
    expect(p).toContain("Never add industry knowledge of your own");
  });

  it("gibt das Angebot als Ton- und Rahmenkontext mit, nicht als Vorlage", () => {
    const p = buildOfferFromSearchPrompt(liste, angebot);
    expect(p).toContain("Wir senken Retourenquoten");
    expect(p).toContain("direkt, kein Hype");
    expect(p).toContain("never material to quote");
  });

  it("erzeugt nichts zu den Feldern, die aus dem Standardangebot uebernommen werden", () => {
    // Der Micro-Yes und das Preview-Asset gehoeren dem Standardangebot. Stuenden
    // sie im Prompt, wuerde das Modell sie irgendwann mit ausgeben -- und die
    // Uebernahme haette sie ueberschrieben.
    const p = buildOfferFromSearchPrompt(liste, angebot);
    expect(p).not.toContain("Soll ich sie dir schicken?");
    expect(p).not.toContain("Eine Aufnahme des Bestellwegs");
    expect(p).not.toContain("90 Sekunden");
    expect(p).not.toContain("40 Shops seit 2019");
  });

  it("zeigt die bisherigen drei Felder als das, was ersetzt werden soll", () => {
    const p = buildOfferFromSearchPrompt(liste, angebot);
    expect(p).toContain("Do not hand them back unchanged");
    expect(p).toContain("problem: Zu viele Retouren");
  });

  it("laesst den Block weg, wenn die drei Felder leer sind", () => {
    const leer = { ...angebot, problem: "", friction: "", friction_reason: "" };
    expect(buildOfferFromSearchPrompt(liste, leer)).not.toContain("Do not hand them back unchanged");
  });

  it("gibt die Ausgabesprache aus dem Angebot vor, nicht die der Oberflaeche", () => {
    expect(buildOfferFromSearchPrompt(liste, angebot)).toContain("Write the values in German");
    expect(buildOfferFromSearchPrompt(liste, { ...angebot, language: "en" })).toContain(
      "Write the values in English"
    );
  });

  it("laesst leere Kontextzeilen weg statt sie leer zu schicken", () => {
    const p = buildOfferFromSearchPrompt({ ...liste, location: "", source: null }, angebot);
    expect(p).not.toContain("Location:");
    expect(p).not.toContain("Source:");
  });
});

describe("parseOfferFromSearch", () => {
  it("liest genau die vier Felder, auch aus einem Codeblock", () => {
    const raw =
      '```json\n{"problem":"Retouren","friction":"Schein hinter Login","friction_reason":"Sie brechen ab","icp":"Supplement-Shops"}\n```';
    expect(parseOfferFromSearch(raw)).toEqual({
      problem: "Retouren",
      friction: "Schein hinter Login",
      friction_reason: "Sie brechen ab",
      icp: "Supplement-Shops",
    });
  });

  it("ignoriert alles, was dem Standardangebot gehoert", () => {
    // Der gefaehrlichste Fall: das Modell liefert einen Micro-Yes mit, und die
    // Kopie ueberschreibt damit die Frage, die in allen vier Mails steht.
    for (const feld of ["cta", "offering", "outcome", "proof", "tone"] as const) {
      expect(SEARCH_SUGGESTED_FIELDS).not.toContain(feld);
    }
    expect(parseOfferFromSearch('{"cta":"Termin buchen?","problem":"Retouren"}')).toEqual({
      problem: "Retouren",
    });
  });

  it("wirft Ausreden weg statt sie als Tatsache zu speichern", () => {
    const raw = '{"problem":"Retouren","icp":"nicht angegeben","friction":"n/a"}';
    expect(parseOfferFromSearch(raw)).toEqual({ problem: "Retouren" });
  });

  it("liefert ein leeres Objekt statt zu werfen", () => {
    expect(parseOfferFromSearch("Dazu steht nichts im Material.")).toEqual({});
    expect(parseOfferFromSearch("{kaputt")).toEqual({});
  });
});

describe("sampleSummaries", () => {
  it("laesst Firmen ohne Beschreibung weg", () => {
    const rows = [
      { name: "A", company_summary: null },
      { name: "B", company_summary: "  " },
      { name: "C", company_summary: "Verkauft Kaffee." },
    ];
    expect(sampleSummaries(rows)).toEqual([{ name: "C", summary: "Verkauft Kaffee." }]);
  });

  it("deckelt Zahl und Laenge", () => {
    const rows = Array.from({ length: SUMMARY_SAMPLE_SIZE + 10 }, (_, i) => ({
      name: `Firma ${i}`,
      company_summary: "x".repeat(SUMMARY_MAX_CHARS + 50),
    }));
    const out = sampleSummaries(rows);
    expect(out).toHaveLength(SUMMARY_SAMPLE_SIZE);
    expect(out[0].summary).toHaveLength(SUMMARY_MAX_CHARS);
  });
});
