/**
 * Was die Mail-Vorschau gerade zeigt, und wo in der Sequenz noch Loecher sind.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DAS NICHT IN DER KOMPONENTE STEHT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die Vorschau haengt an einem Formular, in dem sich waehrend des Ansehens
 * alles aendern kann: eine Stufe wird geloescht, eine Fassung entfernt, eine
 * neue kommt dazu. Ein Index, der ins Leere zeigt, ist dort der Normalfall und
 * nicht die Ausnahme -- und er faellt nicht als Fehler auf, sondern als leere
 * Karte, die aussieht, als waere die Sequenz leer.
 *
 * Genau diese Randfaelle lassen sich ohne DOM pruefen, deshalb stehen sie hier
 * und nicht in der Komponente (das Vitest-Setup hat kein jsdom, siehe
 * CLAUDE.md).
 */
import {
  allVariants,
  usesWebsiteFinding,
  type MergeTagSource,
  type SequenceStep,
  type StepVariant,
} from "./campaigns";
import { hasWebsiteFinding, renderVariablesForLead } from "./preview";

/**
 * Wie viele Leads die Vorschau zum Blaettern holt.
 *
 * PREVIEW_LEAD_COUNT (preview.ts) ist 2: das kontrastierende Paar, mehr
 * braucht es nicht, um beide Faelle nebeneinander zu stellen. Zum Blaettern
 * ist das zu wenig -- nach dem zweiten Klick waere Schluss, und wer sehen
 * will, ob der Icebreaker bei mehr als zwei Firmen sitzt, kaeme nicht weiter.
 *
 * Zwoelf, weil pickPreviewLeads das Paar nach vorn holt und der Rest die
 * urspruengliche Reihenfolge behaelt: die ersten beiden sind die Aussage, die
 * restlichen zehn sind die Stichprobe. Eine groessere Zahl wuerde nur die
 * Antwort der Route aufblaehen; durchgeblaettert wird sie ohnehin nicht.
 */
export const PREVIEW_BROWSE_LIMIT = 12;

/** Welche Stufe und welche Fassung die Vorschau zeigt. Beide 0-basiert, wie
 *  campaign_steps.step_order und der Index in campaign_steps.variants
 *  (Migration 0001/0071, siehe auch step-ref.ts). */
export type PreviewSelection = { step: number; variant: number };

/**
 * Eine Auswahl auf das begrenzen, was es tatsaechlich gibt.
 *
 * Nicht abweisen, sondern auf den naechstgelegenen gueltigen Wert ziehen: wer
 * Stufe 4 ansieht und Stufe 3 loescht, will die Vorschau nicht verlieren,
 * sondern auf der letzten verbliebenen Stufe stehen. Dasselbe fuer Fassungen.
 */
export function clampPreviewSelection(
  steps: SequenceStep[],
  sel: PreviewSelection
): PreviewSelection {
  if (steps.length === 0) return { step: 0, variant: 0 };
  const step = Math.min(Math.max(Math.trunc(sel.step) || 0, 0), steps.length - 1);
  const anzahl = steps[step]?.variants?.length ?? 0;
  const variant =
    anzahl === 0 ? 0 : Math.min(Math.max(Math.trunc(sel.variant) || 0, 0), anzahl - 1);
  return { step, variant };
}

/**
 * Die ausgewaehlte Fassung, immer eine echte.
 *
 * Der Rueckfall auf leere Felder ist derselbe wie in primaryVariant
 * (campaigns.ts): ein Schritt ohne jede Fassung soll eine leere Vorschau
 * ergeben und keinen Absturz mitten im Tippen.
 */
export function selectedVariant(steps: SequenceStep[], sel: PreviewSelection): StepVariant {
  const s = clampPreviewSelection(steps, sel);
  return steps[s.step]?.variants?.[s.variant] ?? { subject: "", body: "" };
}

/** Steht irgendwo in der Sequenz ueberhaupt Text? Sonst zeigt die Vorschau
 *  einen Hinweis statt einer leeren Mail, die wie ein Fehler aussieht. */
export function hasSequenceText(steps: SequenceStep[]): boolean {
  return allVariants(steps).some(
    (v) => (v.subject ?? "").trim() !== "" || (v.body ?? "").trim() !== ""
  );
}

/**
 * Wuerde dieser Lead beim Kampagnenstart zurueckgehalten?
 *
 * Wortgleich die Bedingung aus splitByWebsiteFinding (create-campaign.ts):
 * die Sequenz benutzt {{websiteFinding}} und dieser Lead hat keinen Befund.
 * Beides ueber dieselben Funktionen wie dort, nicht nachgebaut -- eine
 * Vorschau, die einen Lead als "geht mit" zeigt, den der Start wegwirft, ist
 * schlimmer als gar keine.
 *
 * ABGESCHALTETE FASSUNGEN ZAEHLEN MIT, weil usesWebsiteFinding ueber
 * allVariants laeuft und create-campaign.ts genau denselben Aufruf macht. Das
 * ist grosszuegig zugunsten der Warnung: eine abgeschaltete Fassung geht nicht
 * raus, aber sie wird wieder eingeschaltet, und dann waere der Lead ohne
 * Vorwarnung draussen.
 */
export function isHeldBack(steps: SequenceStep[], lead: MergeTagSource): boolean {
  return usesWebsiteFinding(allVariants(steps)) && !hasWebsiteFinding(lead);
}

/** Eine Stufe/Fassung, in der bei diesem Lead etwas fehlt. */
export type SequenceGap = {
  step: number;
  variant: number;
  /** Bekannte Tags ohne Wert: beim Empfaenger steht dort nichts. */
  empty: string[];
  /** Tags, die Instantly nicht kennt: sie gehen woertlich raus. */
  unknown: string[];
};

/**
 * Alle Stellen der Sequenz, an denen dieser Lead ein Loch bekommt.
 *
 * Die Vorschau zeigt immer nur EINE Fassung. Ohne diese Liste muesste man
 * acht Karten einzeln durchklicken, um zu merken, dass das Loch nicht in
 * Stufe 1 sitzt, sondern in Stufe 3 Fassung B -- und genau das tut niemand.
 *
 * Nur Stufen mit Befund kommen in die Liste; die Oberflaeche zaehlt sie nicht,
 * sie benennt sie.
 */
export function sequenceGaps(steps: SequenceStep[], lead: MergeTagSource): SequenceGap[] {
  const gaps: SequenceGap[] = [];
  steps.forEach((s, si) => {
    (s.variants ?? []).forEach((v, vi) => {
      const r = renderVariablesForLead(v, lead);
      if (r.empty.length > 0 || r.unknown.length > 0) {
        gaps.push({ step: si, variant: vi, empty: r.empty, unknown: r.unknown });
      }
    });
  });
  return gaps;
}
