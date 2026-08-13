import { describe, expect, it } from "vitest";
import { FIRST_MAIL_MAX_WORDS } from "@/lib/campaign-readiness";
import type { Offer } from "@/lib/offers";
import {
  DEFAULT_DELAYS,
  DEFAULT_STEP_COUNT,
  buildSequencePrompt,
  correctionInstruction,
  defaultSequenceOptions,
  greetingLine,
  ownWordBudget,
  signatureFor,
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
  friction: "Der Retourenschein liegt als PDF hinter dem Login",
  friction_reason: "Wer ihn nicht findet, schreibt den Support an statt zurückzuschicken",
  outcome: "Retourenquote im Schnitt 4 Punkte niedriger nach 90 Tagen",
  mechanism: "Jede Retoure wird beim Eingang erfasst und dem Grund zugeordnet",
  proof: "",
  preview_asset: "Eine kurze Aufnahme eurer Retourenstrecke",
  review_time: "90 Sekunden",
  cta: "Soll ich dir die Aufnahme schicken?",
  tone: "direkt, kein Hype",
  address_form: "du",
  language: "de",
  website: "https://beispiel.de",
  signature: "",
  is_default: true,
};

const opts = defaultSequenceOptions();

function stufe(bodies: string[], subjects = ["betreff a", "betreff b"]): DraftStep {
  return {
    variants: bodies.map((body, i) => ({ subject: subjects[i] ?? "betreff", body })),
    delayDays: 0,
  };
}

/**
 * Eine gueltige Sequenz als Ausgangspunkt -- die Tests kaputtmachen sie gezielt.
 *
 * Sie erfuellt das ganze Playbook und nicht nur die Formvorgaben: dieselbe
 * Friction in allen vier Stufen, derselbe Micro-Yes woertlich wiederholt,
 * derselbe Betreff, und jede Stufe kuerzer als die vorherige. Damit ist sie
 * zugleich das lesbarste Beispiel dafuer, was der Generator liefern soll.
 */
function guelteSequenz(): DraftStep[] {
  return [
    stufe([
      "Hi {{firstName}},\n\n{{personalization}}\n\nEuer Retourenschein liegt hinter dem Login. Wer ihn dort nicht findet, schreibt stattdessen den Support an.\n\nIch nehme eure Retourenstrecke einmal auf, 90 Sekunden, ohne dass ihr etwas vorbereiten müsst.\n\nSoll ich dir die Aufnahme schicken?\n\nBeste Grüße\nYoussef",
      "Hi {{firstName}},\n\n{{personalization}}\n\nZwischen Bestellung und Rücksendung steht bei euch der Login. Genau dort brechen die meisten ab und melden sich lieber telefonisch.\n\nIch zeichne den Weg einmal auf, 90 Sekunden zum Ansehen.\n\nSoll ich dir die Aufnahme schicken?\n\nBeste Grüße\nYoussef",
    ]),
    stufe([
      "Hi {{firstName}},\n\nKurz zurück zu dem Schein hinter dem Login. Wer ihn sucht und nicht findet, landet am Ende beim Support.\n\nSoll ich dir die Aufnahme schicken?\n\nBeste Grüße\nYoussef",
      "Hi {{firstName}},\n\nNoch einmal zu der Hürde vor der Rücksendung. Jede zweite Nachfrage im Postfach hängt daran.\n\nSoll ich dir die Aufnahme schicken?\n\nBeste Grüße\nYoussef",
    ]),
    stufe([
      "Hi {{firstName}},\n\nEs geht am Ende um weniger Nachfragen im Postfach.\n\nSoll ich dir die Aufnahme schicken?",
      "Hi {{firstName}},\n\nUnterm Strich: weniger Anrufe wegen einer Rücksendung.\n\nSoll ich dir die Aufnahme schicken?",
    ]),
    stufe([
      "Hi {{firstName}},\n\nLetzte Mail von mir.\n\nSoll ich dir die Aufnahme schicken?",
      "Hi {{firstName}},\n\nDanach lasse ich es.\n\nSoll ich dir die Aufnahme schicken?",
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

  it("verbietet jeden Terminlink in der Sequenz", () => {
    // Frueher stand hier ein Fall, in dem der Terminlink aus den Einstellungen
    // in die Stufen 2 bis 4 wanderte. Mit dem Playbook gibt es diesen Fall
    // nicht mehr: eine Kaltsequenz bittet nie um einen Termin.
    const p = buildSequencePrompt(angebot, opts);
    expect(p).toContain("no booking link in this sequence at all");
    expect(p).toContain("NEVER ask for a meeting");
  });

  it("stellt die Friction und den Micro-Yes in den Auftrag", () => {
    const p = buildSequencePrompt(angebot, opts);
    expect(p).toContain("Der Retourenschein liegt als PDF hinter dem Login");
    expect(p).toContain("Soll ich dir die Aufnahme schicken?");
    expect(p).toContain("word for word");
  });

  it("verbietet ein Versprechen, wenn es nichts zu schicken gibt", () => {
    const p = buildSequencePrompt({ ...angebot, preview_asset: "", review_time: "" }, opts);
    expect(p).toContain("there is nothing to send");
    expect(p).toContain("no time promise exists");
  });

  it("haelt den Mechanismus aus der ersten Mail heraus", () => {
    expect(buildSequencePrompt(angebot, opts)).toContain("NEVER put this in step 1");
  });

  it("erfindet ohne Absendernamen keine Unterschrift", () => {
    expect(buildSequencePrompt(angebot, opts)).toContain("Never invent a name");
  });

  it("nimmt die Signatur des Angebots, sonst den Workspace-Namen", () => {
    // Angebot schlaegt Workspace: eine Agentur unterschreibt je Nische anders.
    expect(signatureFor({ ...angebot, signature: "Cheers\nY" }, "Youssef")).toBe("Cheers\nY");
    expect(signatureFor(angebot, "Youssef")).toBe("Beste Grüße\nYoussef");
    expect(signatureFor({ ...angebot, language: "en" }, "Youssef")).toBe("Best,\nYoussef");
    expect(signatureFor(angebot, null)).toBe("");
  });

  it("schreibt die Signatur woertlich in den Prompt", () => {
    const p = buildSequencePrompt({ ...angebot, signature: "Beste Grüße\nYoussef" }, opts);
    expect(p).toContain("End every email with exactly this signature");
    expect(p).toContain("Beste Grüße\nYoussef");
  });

  it("gibt Anrede und Absaetze als Schablone vor", () => {
    // Ohne diese Schablone kam an echten Daten ein einziger Block ohne Anrede
    // und ohne eine Leerzeile zurueck.
    const p = buildSequencePrompt(angebot, opts);
    expect(p).toContain("Hi {{firstName}},");
    expect(p).toContain("separated by BLANK LINES");
    expect(p).toContain("A wall of text does not get read");
  });

  it("siezt in der Anrede, wenn das Angebot es verlangt", () => {
    expect(greetingLine({ ...angebot, address_form: "sie" })).toBe("Guten Tag {{firstName}},");
    expect(greetingLine(angebot)).toBe("Hi {{firstName}},");
    expect(greetingLine({ ...angebot, language: "en", address_form: "sie" })).toBe("Hi {{firstName}},");
  });

  it("gibt die Anrede nur im Deutschen vor", () => {
    expect(buildSequencePrompt({ ...angebot, address_form: "sie" }, opts)).toContain('formally ("Sie")');
    expect(buildSequencePrompt({ ...angebot, language: "en" }, opts)).not.toContain('"Sie"');
    expect(buildSequencePrompt({ ...angebot, language: "en" }, opts)).toContain("Write every email in English");
  });

  it("zieht die Aufhaengerlaenge vom Wortbudget der ersten Mail ab", () => {
    // Sonst schreibt das Modell 90 Woerter und die Mail kommt mit ueber 110
    // an. Der zweite Abzug deckt Anrede, Gruss und Unterschrift ab -- die
    // zaehlen in der Wortzahl des Torwarts mit.
    expect(ownWordBudget(22)).toBe(FIRST_MAIL_MAX_WORDS - 22 - 8);
    // Nicht mit einer festen Zahl vergleichen: die Aufhaengerlaenge steht am
    // Workspace und ist am 2026-08-13 von 22 auf 35 gestiegen.
    expect(buildSequencePrompt(angebot, opts)).toContain(
      `at most ${ownWordBudget(opts.personalizationWords)} words`
    );
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

  it("meldet eine Stufe, die nicht kuerzer wurde", () => {
    const s = guelteSequenz();
    // Stufe 3 auf die Laenge von Stufe 2 aufblaehen: genau der Fehler, den das
    // Playbook "Hinterherlaufen" nennt.
    s[2].variants[0].body =
      s[2].variants[0].body + " Noch ein Gedanke dazu, weil es sonst leicht untergeht und später teuer wird.";
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "notShorter", step: 3 });
  });

  it("meldet eine Terminbitte", () => {
    const s = guelteSequenz();
    s[1].variants[0].body = "Hi {{firstName}},\n\nHast du Donnerstag 15 Minuten für einen Call?";
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "meetingAsk", step: 2 });
  });

  it("meldet Wendungen, an denen man Massenpost erkennt", () => {
    const s = guelteSequenz();
    s[1].variants[0].body = "Hi {{firstName}},\n\nJust checking in wegen meiner letzten Mail.";
    expect(sequenceProblems(s, opts)).toContainEqual({
      kind: "bannedPhrase",
      step: 2,
      phrase: "just checking in",
    });
  });

  it("meldet einen Betreff, der mitten in der Sequenz wechselt", () => {
    const s = guelteSequenz();
    s[2].variants[0].subject = "ganz anderer betreff";
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "subjectDrift", step: 3 });
  });

  it("haelt ein anderes Satzzeichen im Betreff NICHT fuer einen Wechsel", () => {
    const s = guelteSequenz();
    s[2].variants[0].subject = "Betreff A?";
    expect(sequenceProblems(s, opts).some((p) => p.kind === "subjectDrift")).toBe(false);
  });

  it("meldet einen zu langen Betreff", () => {
    const s = guelteSequenz();
    s[0].variants[0].subject = "eine wirklich sehr lange betreffzeile ohne not";
    expect(sequenceProblems(s, opts)).toContainEqual({
      kind: "subjectTooLong",
      step: 1,
      words: 7,
      max: 5,
    });
  });

  it("meldet einen Betreff, der etwas anderes ankuendigt als die Frage", () => {
    const s = guelteSequenz();
    expect(sequenceProblems(s, opts, { ...angebot, cta: "Soll ich dir die Aufnahme schicken?" })).toContainEqual({
      kind: "subjectNoMirror",
      step: 1,
    });
    const gespiegelt = guelteSequenz().map((st) => ({
      ...st,
      variants: st.variants.map((v) => ({ ...v, subject: "Aufnahme schicken" })),
    }));
    expect(
      sequenceProblems(gespiegelt, opts, { ...angebot, cta: "Soll ich dir die Aufnahme schicken?" }).some(
        (p) => p.kind === "subjectNoMirror"
      )
    ).toBe(false);
  });

  it("meldet einen Betreff, der die Frage selbst ist", () => {
    // Gemeldet am 2026-08-13 mit Bild: in allen vier Stufen stand woertlich
    // "Reply yes then i can send you sth over?" als Betreff -- also der
    // Micro-Yes. Die Regel "der Betreff kuendigt die Entscheidung an" las das
    // Modell als "nimm die Frage".
    const frage = "Reply yes then i can send you sth over?";
    const abgeschrieben = guelteSequenz().map((st) => ({
      ...st,
      variants: st.variants.map((v) => ({ ...v, subject: frage })),
    }));
    const befunde = sequenceProblems(abgeschrieben, opts, { ...angebot, cta: frage });
    expect(befunde).toContainEqual({ kind: "subjectIsMicroYes", step: 1 });
    // Der Spiegel-Befund waere hier gegenstandslos: eine Abschrift spiegelt
    // natuerlich. Nur der schwerere Befund soll dastehen.
    expect(befunde.some((p) => p.kind === "subjectNoMirror")).toBe(false);
  });

  it("meldet auch den gekuerzten Micro-Yes als Betreff", () => {
    const s = guelteSequenz().map((st) => ({
      ...st,
      variants: st.variants.map((v) => ({ ...v, subject: "Aufnahme schicken" })),
    }));
    expect(
      sequenceProblems(s, opts, { ...angebot, cta: "Soll ich dir die Aufnahme schicken?" })
    ).toContainEqual({ kind: "subjectIsMicroYes", step: 1 });
  });

  it("meldet ein Fragezeichen im Betreff, auch ohne Micro-Yes", () => {
    const s = guelteSequenz();
    s[0].variants[0].subject = "Retourenschein hinter Login?";
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "subjectAsks", step: 1 });
  });

  it("prueft den Betreff-Spiegel gar nicht, wenn kein Micro-Yes bekannt ist", () => {
    // Lieber keine Aussage als eine geratene: ohne Micro-Yes gibt es nichts,
    // wogegen der Betreff gespiegelt werden koennte.
    expect(sequenceProblems(guelteSequenz(), opts).some((p) => p.kind === "subjectNoMirror")).toBe(false);
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

  it("meldet eine fehlende Anrede", () => {
    // Der gemeldete Fall vom 2026-08-12: die Mail fing direkt mit dem
    // Aufhaenger an und las sich wie ein Rundschreiben.
    const s = guelteSequenz();
    s[0].variants[0].body = "{{personalization}}\n\nWir kümmern uns um Retouren.\n\nPasst das?";
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "noGreeting", step: 1 });
  });

  it("meldet eine Textwand ohne Absaetze", () => {
    const s = guelteSequenz();
    s[1].variants[0].body =
      "Hi {{firstName}}, " + "wort ".repeat(40) + "passt das bei euch?";
    expect(sequenceProblems(s, opts)).toContainEqual({ kind: "noParagraphs", step: 2 });
  });

  it("meckert eine kurze Nachfassmail ohne Absatz NICHT an", () => {
    // Zwei Saetze brauchen keinen Absatz. Sie trotzdem zu bemaengeln waere
    // dieselbe Sorte unbegruendetes Rot wie beim Copy-Check.
    const s = guelteSequenz();
    s[2].variants[0].body = "Hi {{firstName}},\nIst das bei euch ein Thema?";
    expect(sequenceProblems(s, opts).some((p) => p.kind === "noParagraphs")).toBe(false);
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
