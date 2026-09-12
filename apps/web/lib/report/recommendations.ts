/**
 * Was die App aus den eigenen Zahlen empfiehlt.
 *
 * REGELN STATT MODELL
 *
 * Jede Empfehlung hier ist eine feste, testbare Regel ueber gemessene
 * Zahlen; kein Sprachmodell raet mit. Der Grund ist derselbe wie ueberall
 * auf der Wirkungs-Seite: eine Empfehlung ohne nachvollziehbaren Beleg
 * daneben ist eine Meinung, und Meinungen hat der Nutzer selbst genug.
 * Die Oberflaeche zeigt zu jeder Empfehlung die Zahlen, aus der sie folgt.
 *
 * DIE SCHWELLEN
 *
 *   MIN_SAMPLE (30)   ab hier darf eine Nische ueberhaupt bewertet werden;
 *                     dieselbe Faustregel wie in effectiveness.ts.
 *   STOP_SAMPLE (60)  ab hier ist "keine einzige interessierte Antwort"
 *                     ein Befund und kein Pech mehr. Das Doppelte der
 *                     Mindestmenge, bewusst konservativ: der Rat "Nische
 *                     aufgeben" ist teuer, wenn er falsch ist, waehrend
 *                     "noch etwas warten" fast nichts kostet.
 *
 * POSITIV = INTERESSIERT ODER TERMIN, wie in copy-outcomes.ts: die Antwort,
 * auf die es ankommt, nicht irgendeine. Eine Nische, die zuverlaessig
 * Absagen produziert, ist keine gute Nische.
 */

import { MIN_SAMPLE } from "./effectiveness";
import type { OutboundRow } from "./effectiveness";
import { variantLabel, type CopyBucket } from "./copy-outcomes";

export const STOP_SAMPLE = MIN_SAMPLE * 2;

export type NicheOutcome = {
  key: string;
  label: string;
  contacts: number;
  replies: number;
  /** Interessierte Antworten oder Termine, je Kontakt einmal. */
  positives: number;
};

export type Recommendation =
  /** Die Nische traegt: mehr Leads genau daraus nachlegen. */
  | { kind: "double_down"; niche: string; positives: number; contacts: number }
  /** Genug Kontakte, null positives Signal: Nische oder Angebot wechseln. */
  | { kind: "stop_niche"; niche: string; contacts: number; replies: number }
  /** Eine Fassung schlaegt ihre Schwester messbar: auf sie umstellen. */
  | {
      kind: "copy_winner";
      campaign: string;
      step: number;
      winner: string;
      loser: string;
      interested: number;
      loserContacts: number;
    }
  /** Noch nirgends genug Grundlage: weiter sammeln, so viel fehlt noch. */
  | { kind: "collect_more"; niche: string | null; missing: number }
  /** Grundlage da, aber noch kein positives Signal und noch kein Stop-Befund. */
  | { kind: "no_signal"; niche: string; contacts: number; threshold: number };

/**
 * Positives Ergebnis je Nische, gemessen an Kontakten.
 *
 * bySearch aus effectiveness.ts liefert Kontakte und Antworten; hier kommt
 * die dritte Zahl dazu, die dort fehlt: wie viele der Angeschriebenen
 * INTERESSIERT reagiert haben. Ein Kontakt zaehlt einmal, egal wie oft er
 * schreibt (dasselbe Set-Prinzip wie ueberall).
 */
export function nicheOutcomes(
  rows: OutboundRow[],
  replies: Set<string>,
  positiveContacts: Set<string>
): NicheOutcome[] {
  const groups = new Map<string, { label: string; contacts: Set<string> }>();
  for (const row of rows) {
    if (!row.contactId || !row.searchId) continue;
    let g = groups.get(row.searchId);
    if (!g) {
      g = { label: row.searchName ?? row.searchId, contacts: new Set() };
      groups.set(row.searchId, g);
    }
    if (row.searchName && g.label === row.searchId) g.label = row.searchName;
    g.contacts.add(row.contactId);
  }
  return [...groups.entries()].map(([key, g]) => {
    let answered = 0;
    let positive = 0;
    for (const id of g.contacts) {
      if (replies.has(id)) answered++;
      if (positiveContacts.has(id)) positive++;
    }
    return { key, label: g.label, contacts: g.contacts.size, replies: answered, positives: positive };
  });
}

/**
 * Die Empfehlungen, wichtigste zuerst, hoechstens vier.
 *
 * Reihenfolge mit Absicht: erst wohin mit dem naechsten Budget
 * (double_down), dann welcher Text gewinnt (copy_winner), dann was Geld
 * verbrennt (stop_niche), zuletzt der Zustand der Datenlage. Es gibt immer
 * mindestens eine Empfehlung: eine leere Karte saehe aus wie ein Fehler,
 * und "weiter sammeln, es fehlen N" ist eine ehrliche Antwort.
 */
export function recommend(niches: NicheOutcome[], copy: CopyBucket[]): Recommendation[] {
  const out: Recommendation[] = [];
  const measured = niches.filter((n) => n.contacts >= MIN_SAMPLE);

  const winners = measured
    .filter((n) => n.positives > 0)
    .sort((a, b) => b.positives - a.positives || b.positives / b.contacts - a.positives / a.contacts);
  if (winners[0]) {
    out.push({
      kind: "double_down",
      niche: winners[0].label,
      positives: winners[0].positives,
      contacts: winners[0].contacts,
    });
  }

  const copyWinner = findCopyWinner(copy);
  if (copyWinner) out.push(copyWinner);

  // Nur die schlechteste Stop-Kandidatin, nicht alle: drei "aufgeben"-Zeilen
  // untereinander lesen sich wie ein Abgesang auf das ganze Angebot, und die
  // Entscheidung faellt ohnehin eine Nische nach der anderen.
  const stop = niches
    .filter((n) => n.contacts >= STOP_SAMPLE && n.positives === 0)
    .sort((a, b) => b.contacts - a.contacts)[0];
  if (stop) {
    out.push({ kind: "stop_niche", niche: stop.label, contacts: stop.contacts, replies: stop.replies });
  }

  if (measured.length === 0) {
    // Die groesste Nische ist am dichtesten an der Schwelle dran.
    const biggest = [...niches].sort((a, b) => b.contacts - a.contacts)[0];
    out.push({
      kind: "collect_more",
      niche: biggest?.label ?? null,
      missing: MIN_SAMPLE - (biggest?.contacts ?? 0),
    });
  } else if (out.length === 0) {
    // Gemessen, aber weder Gewinner noch Stop-Befund: sagen, wo die
    // naechste Entscheidung faellt, statt gar nichts zu sagen.
    const closest = [...measured].sort((a, b) => b.contacts - a.contacts)[0];
    out.push({
      kind: "no_signal",
      niche: closest.label,
      contacts: closest.contacts,
      threshold: STOP_SAMPLE,
    });
  }

  return out.slice(0, 4);
}

/**
 * Gewinnt eine Fassung gegen ihre Schwester im selben Schritt?
 *
 * Nur ein echter Vergleich zaehlt: beide Fassungen desselben Schritts
 * derselben Kampagne, beide mit belastbarer Grundlage, die eine mit
 * interessierten Antworten, die andere ohne. Alles darunter ist Rauschen,
 * und ein "Gewinner" aus Rauschen wuerde genau die Sorte Umstellung
 * ausloesen, vor der die Warnung auf der Seite steht.
 */
function findCopyWinner(copy: CopyBucket[]): Recommendation | null {
  const bySibling = new Map<string, CopyBucket[]>();
  for (const b of copy) {
    const key = `${b.campaignName}|${b.step}`;
    const list = bySibling.get(key);
    if (list) list.push(b);
    else bySibling.set(key, [b]);
  }
  let best: Extract<Recommendation, { kind: "copy_winner" }> | null = null;
  for (const list of bySibling.values()) {
    if (list.length < 2) continue;
    const solid = list.filter((b) => b.contacts >= MIN_SAMPLE);
    if (solid.length < 2) continue;
    const sorted = [...solid].sort((a, b) => b.interested - a.interested);
    const [winner, runnerUp] = sorted;
    if (winner.interested === 0 || runnerUp.interested > 0) continue;
    if (!best || winner.interested > best.interested) {
      best = {
        kind: "copy_winner",
        campaign: winner.campaignName,
        step: winner.step,
        winner: variantLabel(winner.variant),
        loser: variantLabel(runnerUp.variant),
        interested: winner.interested,
        loserContacts: runnerUp.contacts,
      };
    }
  }
  return best;
}
