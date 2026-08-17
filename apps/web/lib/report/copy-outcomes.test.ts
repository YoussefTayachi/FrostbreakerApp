import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE,
  bestBucket,
  byCopy,
  summarize,
  variantLabel,
  type OutboundRow,
  type ReplyRow,
} from "./copy-outcomes";

/** Erzeugt n Kontakte fuer eine Gruppe, damit MIN_SAMPLE erreichbar ist. */
function sends(n: number, over: Partial<OutboundRow> = {}, prefix = "c"): OutboundRow[] {
  return Array.from({ length: n }, (_, i) => ({
    contactId: `${prefix}${i}`,
    campaignId: "k1",
    campaignName: "Kampagne",
    step: 0,
    variant: 0,
    ...over,
  }));
}

function reply(contactId: string, interest: string | null, over: Partial<ReplyRow> = {}): ReplyRow {
  return { contactId, campaignId: "k1", step: 0, variant: 0, interest, ...over };
}

describe("byCopy", () => {
  it("zaehlt Kontakte je Schritt und Fassung getrennt", () => {
    const out = [
      ...sends(2, { step: 0, variant: 0 }, "a"),
      ...sends(3, { step: 0, variant: 1 }, "b"),
      ...sends(4, { step: 1, variant: 0 }, "c"),
    ];
    const buckets = byCopy(out, [], new Set());
    expect(buckets.map((b) => [b.step, b.variant, b.contacts])).toEqual([
      [0, 0, 2],
      [0, 1, 3],
      [1, 0, 4],
    ]);
  });

  it("zaehlt denselben Kontakt je Schritt nur einmal, auch bei mehreren Mails", () => {
    const out: OutboundRow[] = [
      { contactId: "a", campaignId: "k1", campaignName: "K", step: 0, variant: 0 },
      { contactId: "a", campaignId: "k1", campaignName: "K", step: 0, variant: 0 },
    ];
    expect(byCopy(out, [], new Set())[0].contacts).toBe(1);
  });

  /**
   * Der Fall aus der Wirklichkeit vom 2026-08-05: B fuehrt bei den Antworten,
   * beide sind Absagen. Genau das darf die Auswertung nicht verschlucken.
   */
  it("trennt Antworten von guten Antworten", () => {
    const out = [
      ...sends(MIN_SAMPLE, { variant: 0 }, "a"),
      ...sends(MIN_SAMPLE, { variant: 1 }, "b"),
    ];
    const replies = [
      reply("b0", "not_interested", { variant: 1 }),
      reply("b1", "not_interested", { variant: 1 }),
    ];
    const [a, b] = byCopy(out, replies, new Set());

    expect(a.replies).toBe(0);
    expect(b.replies).toBe(2);
    // B fuehrt bei der Antwortquote ...
    expect(b.replyRate).toBeGreaterThan(a.replyRate!);
    // ... und liegt bei dem, worauf es ankommt, gleichauf bei null.
    expect(b.positiveRate).toBe(0);
    expect(a.positiveRate).toBe(0);
    expect(b.notInterested).toBe(2);
  });

  it("zaehlt Abwesenheitsnotizen gesondert und nicht als Antwort", () => {
    const out = sends(MIN_SAMPLE);
    const replies = [reply("c0", "out_of_office"), reply("c1", "interested")];
    const [b] = byCopy(out, replies, new Set());

    expect(b.autoReplies).toBe(1);
    expect(b.replies).toBe(1);
    expect(b.interested).toBe(1);
    expect(b.replyRate).toBeCloseTo(1 / MIN_SAMPLE);
  });

  it("schreibt einen Termin dem Text zu, auf den geantwortet wurde", () => {
    const out = [
      ...sends(MIN_SAMPLE, { step: 0 }, "a"),
      ...sends(MIN_SAMPLE, { step: 1 }, "a"), // dieselben Kontakte, zweiter Schritt
    ];
    // Geantwortet wurde auf Schritt 1.
    const replies = [reply("a0", "interested", { step: 1 })];
    const buckets = byCopy(out, replies, new Set(["a0"]));
    const schritt0 = buckets.find((b) => b.step === 0)!;
    const schritt1 = buckets.find((b) => b.step === 1)!;

    // Der erste Schritt erbt den Termin NICHT, obwohl derselbe Kontakt ihn bekam.
    expect(schritt0.meetings).toBe(0);
    expect(schritt1.meetings).toBe(1);
  });

  it("zaehlt einen Kontakt mit zwei Antworten nur als einen Termin", () => {
    const out = sends(MIN_SAMPLE);
    const replies = [reply("c0", "interested"), reply("c0", "question")];
    const [b] = byCopy(out, replies, new Set(["c0"]));
    expect(b.replies).toBe(2);
    expect(b.meetings).toBe(1);
  });

  it("gibt unter MIN_SAMPLE keine Quote aus, aber die Rohzahlen", () => {
    const out = sends(MIN_SAMPLE - 1);
    const [b] = byCopy(out, [reply("c0", "interested")], new Set());
    expect(b.replyRate).toBeNull();
    expect(b.positiveRate).toBeNull();
    expect(b.replies).toBe(1);
    expect(b.contacts).toBe(MIN_SAMPLE - 1);
  });

  it("uebergeht Zeilen ohne Zuordnung, statt sie Schritt 0 zuzuschlagen", () => {
    const out: OutboundRow[] = [
      { contactId: "a", campaignId: "k1", campaignName: "K", step: null, variant: null },
      { contactId: "b", campaignId: "k1", campaignName: "K", step: 0, variant: 0 },
    ];
    const buckets = byCopy(out, [], new Set());
    expect(buckets).toHaveLength(1);
    expect(buckets[0].contacts).toBe(1);
    expect(summarize(out, buckets).unattributed).toBe(1);
  });

  it("ignoriert eine Antwort auf eine Gruppe, aus der nie etwas rausging", () => {
    const out = sends(MIN_SAMPLE, { step: 0 });
    const buckets = byCopy(out, [reply("c0", "interested", { step: 9 })], new Set());
    expect(buckets).toHaveLength(1);
    expect(buckets[0].replies).toBe(0);
  });

  it("haelt Kampagnen auseinander, auch bei gleichem Schritt", () => {
    const out = [
      ...sends(2, { campaignId: "k1", campaignName: "Eins" }, "a"),
      ...sends(2, { campaignId: "k2", campaignName: "Zwei" }, "b"),
    ];
    const buckets = byCopy(out, [], new Set());
    expect(buckets).toHaveLength(2);
    expect(buckets.map((b) => b.campaignName)).toEqual(["Eins", "Zwei"]);
  });

  /**
   * Kampagnen, die es bei Instantly nicht mehr gibt.
   *
   * Ihre Mails standen bis 2026-08-05 als eigene Gruppe "(nur bei Instantly)"
   * GANZ OBEN in der Auswertung: an der prominentesten Stelle also das, was
   * am wenigsten aussagt. Youssef hat genau das als Erstes bemaengelt.
   */
  it("laesst Kampagnen ohne lokale Zeile ganz weg", () => {
    const out = [
      ...sends(MIN_SAMPLE, { campaignId: "k1", campaignName: "Echte" }, "a"),
      ...sends(MIN_SAMPLE, { campaignId: null, campaignName: null }, "b"),
    ];
    const buckets = byCopy(out, [], new Set());
    expect(buckets).toHaveLength(1);
    expect(buckets[0].campaignName).toBe("Echte");
  });

  it("zaehlt die weggelassenen trotzdem, statt sie stillschweigend zu schlucken", () => {
    const out = [
      ...sends(MIN_SAMPLE, { campaignId: "k1" }, "a"),
      ...sends(7, { campaignId: null, campaignName: null }, "b"),
    ];
    const summary = summarize(out, byCopy(out, [], new Set()));
    expect(summary.orphaned).toBe(7);
    expect(summary.unattributed).toBe(0);
  });

  it("sortiert in Sequenzreihenfolge, nicht nach Erfolg", () => {
    const out = [
      ...sends(MIN_SAMPLE, { step: 1 }, "a"),
      ...sends(MIN_SAMPLE, { step: 0 }, "b"),
    ];
    // Schritt 1 hat Antworten, Schritt 0 nicht; die Reihenfolge bleibt trotzdem 0, 1.
    const buckets = byCopy(out, [reply("a0", "interested", { step: 1 })], new Set());
    expect(buckets.map((b) => b.step)).toEqual([0, 1]);
  });
});

describe("variantLabel", () => {
  it("macht aus 0 ein A", () => {
    expect(variantLabel(0)).toBe("A");
    expect(variantLabel(1)).toBe("B");
    expect(variantLabel(2)).toBe("C");
  });
});

describe("bestBucket", () => {
  it("nimmt die Zeile mit den meisten Terminen", () => {
    const out = [
      ...sends(MIN_SAMPLE, { step: 0 }, "a"),
      ...sends(MIN_SAMPLE, { step: 1 }, "b"),
    ];
    const replies = [
      reply("a0", "interested", { step: 0 }),
      reply("a1", "interested", { step: 0 }),
      reply("b0", "interested", { step: 1 }),
    ];
    const buckets = byCopy(out, replies, new Set(["b0"]));
    // Schritt 0 hat mehr interessierte Antworten, Schritt 1 hat den Termin.
    expect(bestBucket(buckets)?.step).toBe(1);
  });

  it("faellt auf interessierte Antworten zurueck, wenn es keine Termine gibt", () => {
    const out = [
      ...sends(MIN_SAMPLE, { step: 0 }, "a"),
      ...sends(MIN_SAMPLE, { step: 1 }, "b"),
    ];
    const buckets = byCopy(out, [reply("b0", "interested", { step: 1 })], new Set());
    expect(bestBucket(buckets)?.step).toBe(1);
  });

  /**
   * Der Fehler, der am 2026-08-05 auf dem Bildschirm stand: markiert war
   * "Schritt 1 B: 2 Absagen, 0 interessiert" als BESTER SCHRITT, direkt
   * unter der Warnung, dass die Antwortquote allein die falsche Zielgroesse
   * ist. Ein Sieger ohne Sieg ist schlimmer als kein Sieger.
   */
  it("kuert keinen Sieger, wenn es nur Absagen gab", () => {
    const out = [
      ...sends(MIN_SAMPLE, { step: 0 }, "a"),
      ...sends(MIN_SAMPLE, { step: 1 }, "b"),
    ];
    const replies = [
      reply("b0", "not_interested", { step: 1 }),
      reply("b1", "not_interested", { step: 1 }),
    ];
    expect(bestBucket(byCopy(out, replies, new Set()))).toBeNull();
  });

  it("gibt null zurueck, wenn es nichts zu vergleichen gibt", () => {
    expect(bestBucket([])).toBeNull();
  });
});
