import { describe, expect, it } from "vitest";
import { FIRST_MAIL_MAX_WORDS } from "@/lib/campaign-readiness";
import type { Offer } from "@/lib/offers";
import {
  DEFAULT_DELAYS,
  DEFAULT_STEP_COUNT,
  buildSequencePrompt,
  correctionInstruction,
  defaultSequenceOptions,
  ownWordBudget,
  parseSequence,
  sequenceProblems,
  unknownTags,
  type DraftStep,
} from "./sequence-prompt";

const angebot: Offer = {
  id: "o1",
  name: "Shopify-Betreuung",
  offering: "Monatliche Betreuung von Shopify-Shops",
  icp: "Tierfutter-Shops mit 5 bis 50 Mitarbeitern in der DACH-Region",
  problem: "Retouren fressen die Marge, niemand wertet sie aus",
  outcome: "Retourenquote im Schnitt 4 Punkte niedriger nach 90 Tagen",
  proof: "",
  cta: "Kurze Rückfrage per Mail",
  tone: "direkt, kein Hype",
  address_form: "du",
  language: "de",
  website: "https://beispiel.de",
  is_default: true,
};

const opts = defaultSequenceOptions();

function stufe(bodies: string[], subjects = ["betreff a", "betreff b"]): DraftStep {
  return {
    variants: bodies.map((body, i) => ({ subject: subjects[i] ?? "betreff", body })),
    delayDays: 0,
  };
}

/** Eine gueltige Sequenz als Ausgangspunkt -- die Tests kaputtmachen sie gezielt. */
function guelteSequenz(): DraftStep[] {
  return [
    stufe([
      "{{personalization}}\nWir kümmern uns um Retouren bei Shopify-Shops. Lohnt sich ein kurzer Austausch?",
      "{{personalization}}\nBei euch dürfte die Retourenquote Geld kosten. Soll ich dir zeigen, wo genau?",
    ]),
    stufe([
      "Kurz nachgehakt: die meisten Shops kennen ihre teuerste Retourengruppe nicht.",
      "Anderer Gedanke: Retouren nach Produktgruppe getrennt zu betrachten verändert die Sicht.",
    ]),
    stufe(["Ist das bei euch überhaupt ein Thema?", "Passt das gerade zeitlich bei euch?"]),
    stufe([
      "Ich lasse es dabei. Melde dich gern, falls es später passt.",
      "Letzte Mail von mir. Falls das Thema später kommt, weißt du wo du mich findest.",
    ]),
  ];
}

describe("buildSequencePrompt", () => {
  it("nennt die Angebotsfelder, die gefuellt sind", () => {
    const p = buildSequencePrompt(angebot, opts);
    expect(p).toContain("Monatliche Betreuung von Shopify-Shops");
    expect(p).toContain("Tierfutter-Shops");
  });

  it("verbietet bei leerem Beleg-Feld ausdruecklich jede Referenz", () => {
    // Der wichtigste leere Fall: ein Modell ohne Referenzen erfindet welche,
    // und das faellt erst dem Empfaenger auf.
    const p = buildSequencePrompt(angebot, opts);
    expect(p).toContain("NO proof exists");
    expect(p).toMatch(/Never mention clients, numbers, case studies/);
  });

  it("nennt vorhandene Belege statt des Verbots", () => {
    const p = buildSequencePrompt({ ...angebot, proof: "42 Shops betreut" }, opts);
    expect(p).toContain("42 Shops betreut");
    expect(p).not.toContain("NO proof exists");
  });

  it("verbietet ohne Terminlink das Erfinden eines Links", () => {
    expect(buildSequencePrompt(angebot, opts)).toContain("Never invent one");
  });

  it("nennt den Terminlink, wenn einer hinterlegt ist", () => {
    const p = buildSequencePrompt(angebot, { ...opts, calendarLink: "https://cal.com/y" });
    expect(p).toContain("https://cal.com/y");
    expect(p).not.toContain("Never invent one");
  });

  it("erfindet ohne Absendernamen keine Unterschrift", () => {
    expect(buildSequencePrompt(angebot, opts)).toContain("rather than inventing a name");
  });

  it("gibt die Anrede nur im Deutschen vor", () => {
    expect(buildSequencePrompt({ ...angebot, address_form: "sie" }, opts)).toContain('formally ("Sie")');
    expect(buildSequencePrompt({ ...angebot, language: "en" }, opts)).not.toContain('"Sie"');
    expect(buildSequencePrompt({ ...angebot, language: "en" }, opts)).toContain("Write every email in English");
  });

  it("zieht die Aufhaengerlaenge vom Wortbudget der ersten Mail ab", () => {
    // Sonst schreibt das Modell 90 Woerter und die Mail kommt mit ueber 110 an.
    expect(ownWordBudget(22)).toBe(FIRST_MAIL_MAX_WORDS - 22 - 5);
    expect(buildSequencePrompt(angebot, opts)).toContain(`at most ${ownWordBudget(22)} words`);
  });

  it("nimmt die beste eigene Fassung nur als Vorbild auf, wenn eine uebergeben wurde", () => {
    expect(buildSequencePrompt(angebot, opts)).not.toContain("earned the most replies");
    const p = buildSequencePrompt(angebot, {
      ...opts,
      bestExample: { subject: "kurze frage", body: "Text der funktioniert hat." },
    });
    expect(p).toContain("earned the most replies");
    expect(p).toContain("do NOT copy its sentences");
  });
});

describe("parseSequence", () => {
  it("liest JSON auch aus einem Codeblock mit Vorrede", () => {
    const raw =
      'Klar, hier die Sequenz:\n```json\n[{"variants":[{"subject":"a","body":"Text A"}]}]\n```\nViel Erfolg!';
    expect(parseSequence(raw)).toEqual([{ variants: [{ subject: "a", body: "Text A" }], delayDays: 0 }]);
  });

  it("akzeptiert auch die flache Form ohne variants", () => {
    const raw = '[{"subject":"a","body":"Text A"},{"subject":"b","body":"Text B"}]';
    const steps = parseSequence(raw);
    expect(steps).toHaveLength(2);
    expect(steps[1].variants[0].body).toBe("Text B");
  });

  it("setzt die Abstaende selbst, egal was das Modell schickt", () => {
    const raw = '[{"delayDays":99,"variants":[{"subject":"a","body":"A"}]},{"variants":[{"subject":"b","body":"B"}]}]';
    const steps = parseSequence(raw);
    expect(steps.map((s) => s.delayDays)).toEqual([DEFAULT_DELAYS[0], DEFAULT_DELAYS[1]]);
  });

  it("wirft Fassungen ohne Betreff oder ohne Text weg", () => {
    const raw = '[{"variants":[{"subject":"a","body":"A"},{"subject":"","body":"B"},{"subject":"c","body":"  "}]}]';
    expect(parseSequence(raw)[0].variants).toHaveLength(1);
  });

  it("liefert eine leere Liste statt zu werfen, wenn nichts brauchbar ist", () => {
    expect(parseSequence("Tut mir leid, das kann ich nicht.")).toEqual([]);
    expect(parseSequence("[kaputt")).toEqual([]);
    expect(parseSequence('{"variants":[]}')).toEqual([]);
  });

  it("nimmt hoechstens vier Stufen", () => {
    const eine = '{"variants":[{"subject":"a","body":"A"}]}';
    expect(parseSequence("[" + Array(9).fill(eine).join(",") + "]")).toHaveLength(DEFAULT_STEP_COUNT);
  });
});

describe("unknownTags", () => {
  it("laesst die echten Instantly-Platzhalter durch", () => {
    expect(unknownTags("Hi {{firstName}} von {{companyName}}, {{personalization}}")).toEqual([]);
  });

  it("meldet erfundene Platzhalter -- die gehen ungefuellt raus", () => {
    expect(unknownTags("Hi {{painPoint}}")).toEqual(["{{painPoint}}"]);
  });

  it("meldet eckige und spitze Fuellklammern", () => {
    expect(unknownTags("Viele Grüße, [Dein Name]")).toEqual(["[Dein Name]"]);
    expect(unknownTags("bei <Firma>")).toEqual(["<Firma>"]);
  });
});

describe("sequenceProblems", () => {
  it("findet an einer sauberen Sequenz nichts", () => {
    expect(sequenceProblems(guelteSequenz(), opts)).toEqual([]);
  });

  it("meldet eine fehlende Aufhaengerzeile in Stufe 1", () => {
    const s = guelteSequenz();
    s[0].variants[0].body = "Wir kümmern uns um Retouren. Lohnt sich ein Austausch?";
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "missingPersonalization" });
  });

  it("misst die erste Mail mit eingesetztem Aufhaenger, nicht ohne", () => {
    // 80 eigene Woerter sind unter der Grenze -- mit den 22 des Aufhaengers
    // nicht mehr. Genau diese Rechnung macht auch der Torwart.
    const s = guelteSequenz();
    s[0].variants[0].body = "{{personalization}}\n" + "wort ".repeat(80);
    const problems = sequenceProblems(s, opts);
    expect(problems.some((p) => p.kind === "firstMailTooLong")).toBe(true);
  });

  it("meldet einen Link in der ersten Mail", () => {
    const s = guelteSequenz();
    s[0].variants[1].body += " Mehr dazu: https://beispiel.de/retouren";
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "firstMailHasLink" });
  });

  it("meldet Gedankenstriche mit der Stufe, in der sie stehen", () => {
    const s = guelteSequenz();
    s[2].variants[0].body = "Kurze Frage — passt das?";
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "dash", step: 3 });
  });

  it("meldet zwei Fassungen, die dasselbe sagen", () => {
    // Zwei Umformulierungen desselben Gedankens messen nichts, der
    // A/B-Vergleich verglaeche Rauschen.
    const s = guelteSequenz();
    s[1].variants[1].body = s[1].variants[0].body.replace("Kurz nachgehakt", "Kurz nachgefragt");
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "variantsTooSimilar", step: 2 });
  });

  it("haelt zwei echte Gegenentwuerfe NICHT fuer dasselbe", () => {
    const s = guelteSequenz();
    expect(sequenceProblems(s, opts).some((p) => p.kind === "variantsTooSimilar")).toBe(false);
  });

  it("meldet eine unvollstaendige Sequenz", () => {
    const s = guelteSequenz().slice(0, 2);
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "stepCount", got: 2 });
  });

  it("meldet eine Stufe mit nur einer Fassung", () => {
    const s = guelteSequenz();
    s[3].variants = [s[3].variants[0]];
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "variantCount", step: 4, got: 1 });
  });
});

describe("correctionInstruction", () => {
  it("nennt jeden Befund als konkrete Anweisung", () => {
    const text = correctionInstruction([
      { kind: "missingPersonalization" },
      { kind: "firstMailTooLong", words: 104, max: FIRST_MAIL_MAX_WORDS },
      { kind: "unknownTags", tags: ["{{painPoint}}"] },
    ]);
    expect(text).toContain("{{personalization}}");
    expect(text).toContain("104");
    expect(text).toContain("{{painPoint}}");
    expect(text).toContain("Change nothing else");
  });
});
