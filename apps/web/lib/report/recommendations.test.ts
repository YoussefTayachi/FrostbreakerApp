import { describe, expect, it } from "vitest";
import { nicheOutcomes, recommend, STOP_SAMPLE, type NicheOutcome } from "./recommendations";
import type { CopyBucket } from "./copy-outcomes";

function nische(over: Partial<NicheOutcome>): NicheOutcome {
  return { key: "s-1", label: "Nische", contacts: 0, replies: 0, positives: 0, ...over };
}

function bucket(over: Partial<CopyBucket>): CopyBucket {
  return {
    key: "c|0|0",
    campaignName: "Kampagne",
    step: 0,
    variant: 0,
    contacts: 0,
    replies: 0,
    interested: 0,
    notInterested: 0,
    questions: 0,
    meetings: 0,
    autoReplies: 0,
    replyRate: null,
    positiveRate: null,
    ...over,
  };
}

describe("nicheOutcomes", () => {
  it("zaehlt Kontakte, Antworten und Positive je Nische, Kontakte nur einmal", () => {
    const rows = [
      { contactId: "a", sentAt: null, searchId: "s1", searchName: "Bau UK" },
      { contactId: "a", sentAt: null, searchId: "s1", searchName: "Bau UK" }, // Folgemail
      { contactId: "b", sentAt: null, searchId: "s1", searchName: "Bau UK" },
      { contactId: "c", sentAt: null, searchId: "s2", searchName: "Logistik" },
    ];
    const ergebnis = nicheOutcomes(rows, new Set(["a"]), new Set(["a"]));
    const bau = ergebnis.find((n) => n.key === "s1")!;
    expect(bau).toMatchObject({ label: "Bau UK", contacts: 2, replies: 1, positives: 1 });
    expect(ergebnis.find((n) => n.key === "s2")).toMatchObject({ contacts: 1, positives: 0 });
  });
});

describe("recommend", () => {
  it("empfiehlt double down auf die Nische mit den meisten Positiven", () => {
    const recs = recommend(
      [
        nische({ key: "a", label: "Bau UK", contacts: 100, positives: 3 }),
        nische({ key: "b", label: "Logistik", contacts: 100, positives: 1 }),
      ],
      []
    );
    expect(recs[0]).toMatchObject({ kind: "double_down", niche: "Bau UK", positives: 3 });
  });

  it("empfiehlt keinen Gewinner unter der Mindestmenge", () => {
    // 5 Kontakte mit einem Treffer sind Glueck, keine Nische.
    const recs = recommend([nische({ contacts: 5, positives: 1 })], []);
    expect(recs.some((r) => r.kind === "double_down")).toBe(false);
    expect(recs[0].kind).toBe("collect_more");
  });

  it("raet erst ab der Stop-Schwelle zum Wechsel, und nur bei null Positiven", () => {
    const zuFrueh = recommend([nische({ contacts: STOP_SAMPLE - 1, positives: 0 })], []);
    expect(zuFrueh.some((r) => r.kind === "stop_niche")).toBe(false);

    const befund = recommend(
      [nische({ label: "Restaurants AT", contacts: STOP_SAMPLE, replies: 2, positives: 0 })],
      []
    );
    expect(befund.some((r) => r.kind === "stop_niche" && r.niche === "Restaurants AT")).toBe(true);
  });

  it("nennt hoechstens EINE Stop-Nische, die groesste", () => {
    const recs = recommend(
      [
        nische({ key: "a", label: "Klein", contacts: 70, positives: 0 }),
        nische({ key: "b", label: "Gross", contacts: 200, positives: 0 }),
      ],
      []
    );
    const stops = recs.filter((r) => r.kind === "stop_niche");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ niche: "Gross" });
  });

  it("erkennt eine Gewinner-Fassung nur bei zwei belastbaren Schwestern", () => {
    const recs = recommend(
      [],
      [
        bucket({ campaignName: "K", step: 0, variant: 0, contacts: 80, interested: 2 }),
        bucket({ campaignName: "K", step: 0, variant: 1, contacts: 75, interested: 0 }),
        // Zu duenn: darf den Vergleich nicht ausloesen.
        bucket({ campaignName: "K2", step: 0, variant: 0, contacts: 10, interested: 1 }),
        bucket({ campaignName: "K2", step: 0, variant: 1, contacts: 8, interested: 0 }),
      ]
    );
    const winner = recs.find((r) => r.kind === "copy_winner");
    expect(winner).toMatchObject({ campaign: "K", winner: "A", loser: "B", interested: 2 });
  });

  it("kuert keinen Fassungs-Gewinner, wenn beide Positive haben", () => {
    // Beide sammeln Interessierte: der Unterschied kann Rauschen sein, und
    // eine Umstellung wuerde die funktionierende zweite Fassung abschalten.
    const recs = recommend(
      [],
      [
        bucket({ campaignName: "K", step: 0, variant: 0, contacts: 80, interested: 3 }),
        bucket({ campaignName: "K", step: 0, variant: 1, contacts: 75, interested: 1 }),
      ]
    );
    expect(recs.some((r) => r.kind === "copy_winner")).toBe(false);
  });

  it("liefert nie eine leere Liste", () => {
    expect(recommend([], []).length).toBeGreaterThan(0);
    expect(recommend([], [])[0]).toMatchObject({ kind: "collect_more" });
  });

  it("sagt bei Grundlage ohne Signal, wo die naechste Entscheidung faellt", () => {
    const recs = recommend([nische({ label: "Bau US", contacts: 40, positives: 0 })], []);
    expect(recs[0]).toMatchObject({ kind: "no_signal", niche: "Bau US", threshold: STOP_SAMPLE });
  });
});
