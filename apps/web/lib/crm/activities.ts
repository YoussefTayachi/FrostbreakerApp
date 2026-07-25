/**
 * Aktivitaeten: geloggte Anrufe, Meetings und Aufgaben.
 *
 * Muss synchron bleiben mit den CHECK-Constraints auf activities.type und
 * activities.outcome in Migration 0033.
 */
export const ACTIVITY_TYPES = ["call", "meeting", "task"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_OUTCOMES = [
  "reached",
  "voicemail",
  "no_answer",
  "not_interested",
  "interested",
  "meeting_booked",
] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

export type Activity = {
  id: string;
  contact_id: string | null;
  business_id: string | null;
  type: ActivityType;
  subject: string | null;
  note: string | null;
  outcome: ActivityOutcome | null;
  duration_seconds: number | null;
  due_at: string | null;
  completed_at: string | null;
  occurred_at: string | null;
  created_at: string;
};

/** Ergebnis-Auswahl ist nur beim Anruf sinnvoll -- eine Aufgabe hat kein Gespraechsergebnis. */
export function supportsOutcome(type: ActivityType): boolean {
  return type === "call";
}

/**
 * Ordnet ein Gespraechsergebnis der Outreach-Stufe zu, auf die der Kontakt
 * dadurch springen soll. Nur Ergebnisse mit klarer Aussage sind hier gelistet --
 * "voicemail"/"no_answer" sagen nichts ueber das Interesse und aendern nichts.
 */
export const OUTCOME_TO_STAGE: Partial<Record<ActivityOutcome, string>> = {
  interested: "replied",
  not_interested: "not_interested",
  meeting_booked: "meeting_booked",
};

export function isOverdue(activity: Pick<Activity, "due_at" | "completed_at">, now = new Date()): boolean {
  if (activity.completed_at || !activity.due_at) return false;
  return new Date(activity.due_at) < now;
}
