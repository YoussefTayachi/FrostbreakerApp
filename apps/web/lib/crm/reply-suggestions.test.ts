import { describe, expect, it } from "vitest";
import {
  buildReplyPrompt,
  formatThread,
  hasPlaceholder,
  parseSuggestions,
  type ThreadMessage,
} from "./reply-suggestions";

const CTX = { interest: null, calendarLink: null, senderName: null };

function msg(patch: Partial<ThreadMessage> = {}): ThreadMessage {
  return { direction: "inbound", subject: "Re: kurze Frage", body: "Klingt spannend.", sent_at: null, ...patch };
}

describe("buildReplyPrompt", () => {
  /**
   * Der wichtigste Fall: ein erfundener Terminlink faellt erst dem Empfaenger
   * auf, und dann ist die Antwort verbrannt.
   */
  it("verbietet einen erfundenen Terminlink, wenn keiner hinterlegt ist", () => {
    const p = buildReplyPrompt([msg()], CTX);
    expect(p).toContain("Erfinde keinen");
    expect(p).toContain("Zeitfenster");
  });

  it("gibt einen hinterlegten Terminlink woertlich mit", () => {
    const p = buildReplyPrompt([msg()], { ...CTX, calendarLink: "https://cal.com/youssef/15min" });
    expect(p).toContain("https://cal.com/youssef/15min");
    expect(p).not.toContain("Erfinde keinen");
  });

  it("nennt Unterschrift und Einstufung, wenn sie da sind", () => {
    const p = buildReplyPrompt([msg()], { ...CTX, senderName: "Youssef", interest: "interested" });
    expect(p).toContain("Youssef");
    expect(p).toContain("interested");
  });

  it("verlangt drei unterscheidbare Entwuerfe und JSON", () => {
    const p = buildReplyPrompt([msg()], CTX);
    expect(p).toContain("GENAU DREI");
    expect(p).toContain("JSON");
  });

  it("haengt das Gespraech an", () => {
    expect(buildReplyPrompt([msg({ body: "Sehr interessant!" })], CTX)).toContain("Sehr interessant!");
  });
});

describe("formatThread", () => {
  it("kennzeichnet, wer geschrieben hat", () => {
    const out = formatThread([msg({ direction: "outbound", body: "unsere Mail" }), msg({ body: "die Antwort" })]);
    expect(out).toContain("[WIR]");
    expect(out).toContain("[EMPFAENGER]");
  });

  // Aeltere Mails tragen zur Antwort nichts bei und kosten nur Tokens.
  it("nimmt nur die letzten sechs Nachrichten", () => {
    const viele = Array.from({ length: 10 }, (_, i) => msg({ body: `Nachricht ${i}` }));
    const out = formatThread(viele);
    expect(out).not.toContain("Nachricht 3");
    expect(out).toContain("Nachricht 9");
  });

  it("kuerzt eine sehr lange Nachricht", () => {
    const out = formatThread([msg({ body: "x".repeat(5000) })]);
    expect(out.length).toBeLessThan(2000);
  });

  it("kommt mit leerem Text klar", () => {
    expect(() => formatThread([msg({ body: null, subject: null })])).not.toThrow();
  });
});

describe("parseSuggestions", () => {
  const gut = JSON.stringify([
    { label: "Termin", text: "Gerne, passt Dienstag 10 Uhr?" },
    { label: "Rueckfrage", text: "Was genau meinst du damit?" },
    { label: "Absage", text: "Alles klar, danke fuer die Rueckmeldung." },
  ]);

  it("liest sauberes JSON", () => {
    const s = parseSuggestions(gut);
    expect(s.length).toBe(3);
    expect(s[0].label).toBe("Termin");
  });

  // GPT liefert das angeforderte JSON meistens, aber nicht immer nackt.
  it("findet das JSON auch in einem Codeblock", () => {
    expect(parseSuggestions("Hier sind die Entwuerfe:\n```json\n" + gut + "\n```").length).toBe(3);
  });

  /**
   * Ein Vorschlag mit "[Dein Name]" ist keine Zeitersparnis, sondern eine
   * Falle — genau so etwas geht versehentlich raus.
   */
  it("wirft Entwuerfe mit uebrig gebliebenen Platzhaltern weg", () => {
    const s = parseSuggestions(
      JSON.stringify([
        { label: "A", text: "Gerne, passt Dienstag? Viele Gruesse, [Dein Name]" },
        { label: "B", text: "Gerne, passt Dienstag 10 Uhr?" },
      ])
    );
    expect(s.map((x) => x.label)).toEqual(["B"]);
  });

  it("wirft leere Entwuerfe weg", () => {
    expect(parseSuggestions(JSON.stringify([{ label: "A", text: "   " }])).length).toBe(0);
  });

  it("erfindet eine Bezeichnung, wenn keine da ist", () => {
    expect(parseSuggestions(JSON.stringify([{ text: "Passt Dienstag?" }]))[0].label).toBe("Entwurf 1");
  });

  it("liefert hoechstens drei", () => {
    const viele = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ label: `${i}`, text: `Text ${i}` })));
    expect(parseSuggestions(viele).length).toBe(3);
  });

  it("gibt bei unbrauchbarer Antwort eine leere Liste zurueck statt zu werfen", () => {
    expect(parseSuggestions("Tut mir leid, das kann ich nicht.")).toEqual([]);
    expect(parseSuggestions("[ kaputt ")).toEqual([]);
    expect(parseSuggestions("[1,2,3]")).toEqual([]);
    expect(parseSuggestions("")).toEqual([]);
  });
});

describe("hasPlaceholder", () => {
  it("erkennt die ueblichen Formen", () => {
    expect(hasPlaceholder("Gruesse, [Dein Name]")).toBe(true);
    expect(hasPlaceholder("Hallo {{firstName}}")).toBe(true);
    expect(hasPlaceholder("bei <Firma> gesehen")).toBe(true);
  });

  it("haelt normalen Text nicht faelschlich fuer einen Platzhalter", () => {
    expect(hasPlaceholder("Passt Dienstag 10 Uhr? Viele Gruesse, Youssef")).toBe(false);
    expect(hasPlaceholder("Wir sind 3 < 5 mal guenstiger")).toBe(false);
  });
});
