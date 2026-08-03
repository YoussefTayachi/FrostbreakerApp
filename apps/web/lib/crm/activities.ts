/**
 * Aktivitaeten: geloggte Anrufe, Nachrichten, Meetings und Aufgaben.
 *
 * Muss synchron bleiben mit den CHECK-Constraints auf activities.type,
 * activities.outcome und activities.channel in Migration 0033 bzw. 0057.
 */
export const ACTIVITY_TYPES = ["call", "message", "meeting", "task"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * Der Kanal ist das Medium, der Typ die Form der Interaktion. Bewusst
 * getrennt: eine Aufgabe bleibt eine Aufgabe, egal ob sie per LinkedIn oder
 * Telefon erledigt wird (siehe ausfuehrliche Begruendung in Migration 0057).
 *
 * Versendet wird auf keinem dieser Kanaele automatisch. LinkedIn hat keine
 * API fuer Nachrichten, WhatsApp verlangt fuer geschaeftlich initiierte
 * Nachrichten ein Opt-in, Instagram erlaubt sie nur als Antwort binnen 24
 * Stunden. Die App bereitet vor und protokolliert, gesendet wird von Hand.
 */
export const ACTIVITY_CHANNELS = [
  "email",
  "phone",
  "linkedin",
  "whatsapp",
  "instagram",
  "x",
  "in_person",
] as const;
export type ActivityChannel = (typeof ACTIVITY_CHANNELS)[number];

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
  channel: ActivityChannel | null;
  subject: string | null;
  note: string | null;
  outcome: ActivityOutcome | null;
  duration_seconds: number | null;
  due_at: string | null;
  completed_at: string | null;
  occurred_at: string | null;
  created_at: string;
};

/**
 * Welche Ergebnisse bei diesem Typ ueberhaupt vorkommen koennen.
 *
 * Frueher gab es dafuer nur supportsOutcome() mit der Regel "nur beim Anruf".
 * Mit 'message' als Typ reicht das nicht mehr: eine Direktnachricht hat sehr
 * wohl ein Ergebnis, aber nicht dasselbe wie ein Anruf. "Mailbox" ergibt bei
 * einer LinkedIn-DM keinen Sinn, und "erreicht" auch nicht -- verschickt ist
 * nicht gelesen. Uebrig bleibt, was man an einer Antwort ablesen kann, plus
 * "keine Antwort" fuer den haeufigsten Ausgang.
 *
 * Ein leeres Array heisst: dieser Typ kennt kein Ergebnis, das Dropdown wird
 * gar nicht erst gezeigt.
 */
export function outcomesFor(type: ActivityType): readonly ActivityOutcome[] {
  switch (type) {
    case "call":
      return ACTIVITY_OUTCOMES;
    case "message":
      return ["no_answer", "interested", "not_interested", "meeting_booked"];
    case "meeting":
      return ["interested", "not_interested", "meeting_booked"];
    case "task":
      return [];
  }
}

/** Kurzform fuer "hat dieser Typ ueberhaupt ein Ergebnisfeld". */
export function supportsOutcome(type: ActivityType): boolean {
  return outcomesFor(type).length > 0;
}

/** Die Gespraechsdauer ist nur beim Anruf eine sinnvolle Angabe. */
export function supportsDuration(type: ActivityType): boolean {
  return type === "call";
}

/**
 * Naheliegender Kanal fuer einen Typ, als Vorbelegung im Formular.
 * Ein Anruf laeuft ueber das Telefon; bei allen anderen Typen waere jede
 * Vorgabe geraten, deshalb null (der Nutzer waehlt).
 */
export function defaultChannelFor(type: ActivityType): ActivityChannel | null {
  return type === "call" ? "phone" : null;
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

// Bewusst KEINE Funktion "welche Kanaele hat dieser Kontakt hinterlegt":
// Der Composer protokolliert, was tatsaechlich passiert ist. Wer jemanden auf
// einer Messe getroffen oder unter einer anderswo gefundenen Nummer angerufen
// hat, muss das eintragen koennen -- eine Einschraenkung auf gespeicherte
// Felder wuerde genau diese Faelle blockieren. Die Auswahl bleibt vollstaendig.
