/**
 * Die Outreach-Pipeline (contacts.outreach_status) an genau einer Stelle.
 *
 * Lag vorher als STATUS_ORDER/statusRank/STATUS_SELECT_CLS lokal in
 * leads-table.tsx; mit dem Pipeline-Board und der Timeline waeren daraus drei
 * Kopien geworden. Labels bleiben absichtlich draussen (dict.ts, zweisprachig),
 * hier steht nur, was sprachunabhaengig ist: Reihenfolge, Rang und Farben.
 *
 * Muss synchron bleiben mit dem CHECK-Constraint in Migration 0018 und mit
 * STATUS_RANK in apps/worker/worker/pipelines/poll_instantly.py.
 */
/**
 * 'lead' steht zwischen 'replied' und 'meeting_booked'.
 *
 * 'replied' beantwortet nur "hat sich gemeldet" und wirft damit drei sehr
 * verschiedene Dinge zusammen: die Abwesenheitsnotiz, das "danke, kein
 * Bedarf" und den, mit dem man gerade schreibt und den man abschliessen
 * kann. Am 2026-09-12 standen 30 Kontakte auf 'replied', darunter jede
 * Urlaubsantwort. Wer morgens in die Pipeline sieht, will die dritte Sorte
 * sehen und nur die.
 *
 * Ein Termin ist dafuer die falsche Huerde: bei diesem Angebot laeuft der
 * Abschluss ueber einen Entwurf per Mail, nicht ueber einen Kalendereintrag.
 * Ohne diese Spalte gibt es zwischen "hat geantwortet" und "Termin steht"
 * keinen Platz, und genau dort spielt sich das Geschaeft ab.
 */
export const OUTREACH_STAGES = [
  "new",
  "contacted",
  "replied",
  "lead",
  "meeting_booked",
  "customer",
  "not_interested",
] as const;

export type OutreachStage = (typeof OUTREACH_STAGES)[number];

export function isOutreachStage(value: string): value is OutreachStage {
  return (OUTREACH_STAGES as readonly string[]).includes(value);
}

/**
 * Fortschritt der Stufe. Beim Zusammenfuehren mehrerer Rohkontakte gewinnt der
 * weiter fortgeschrittene Status, damit erreichter Fortschritt nie von einem
 * aelteren "new"-Datensatz ueberschrieben wird.
 *
 * "not_interested" liegt bewusst niedrig (gleichauf mit "contacted"): eine
 * spaetere echte Antwort soll den Status trotzdem noch auf "replied" anheben
 * koennen. Gleiche Logik wie STATUS_RANK im Worker.
 */
const STAGE_RANK: Record<OutreachStage, number> = {
  new: 0,
  contacted: 1,
  not_interested: 1,
  replied: 2,
  lead: 3,
  meeting_booked: 4,
  customer: 5,
};

export function stageRank(status: string): number {
  return isOutreachStage(status) ? STAGE_RANK[status] : 0;
}

/** Klassen fuer das Status-Dropdown in Tabellen und Drawer. */
export const STAGE_SELECT_CLS: Record<OutreachStage, string> = {
  new: "border-edge2 bg-chip text-soft",
  contacted:
    "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  replied:
    "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
  // Bernstein zwischen dem Blau der Antwort und dem Violett des Termins: eine
  // Stufe, an der etwas offen ist und auf einen zurueckwartet.
  lead:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  meeting_booked:
    "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
  customer:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  not_interested:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
};

/** Akzentfarbe der Spaltenkoepfe im Pipeline-Board (nur der farbige Punkt). */
export const STAGE_DOT_CLS: Record<OutreachStage, string> = {
  new: "bg-mute",
  contacted: "bg-blue-500",
  replied: "bg-sky-500",
  lead: "bg-amber-500",
  meeting_booked: "bg-violet-500",
  customer: "bg-emerald-500",
  not_interested: "bg-red-400",
};
