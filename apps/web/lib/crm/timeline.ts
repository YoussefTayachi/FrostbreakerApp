import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityChannel, ActivityOutcome, ActivityType } from "./activities";
import type { DealStage, DealStatus } from "./deals";

/**
 * Typen zur RPC public.crm_timeline (Migration 0035). Die Funktion mischt
 * E-Mails, Notizen, Status-Wechsel, Aktivitaeten und Deals in eine nach Zeit
 * sortierte Liste — eine Query statt fuenf, und neue Quellen kommen kuenftig
 * nur in der SQL-Funktion dazu, nicht im Frontend.
 *
 * meta ist in der DB jsonb. Die Umwandlung in die typisierten Varianten unten
 * passiert genau einmal in fetchTimeline() — ab da ist der Rest der App
 * vollstaendig typsicher und der switch ueber `kind` erschoepfend pruefbar.
 */
export type TimelineKind = "email_in" | "email_out" | "note" | "status" | "activity" | "deal";

type BaseEvent = {
  id: string;
  at: string;
  contact_id: string | null;
  title: string | null;
  body: string | null;
};

export type EmailMeta = { ai_interest: string | null; status: string | null };
export type NoteMeta = {
  scope: "contact" | "business";
  author_email: string | null;
  edited: boolean;
};
export type StatusMeta = {
  old_status: string | null;
  new_status: string;
  /** true, wenn der Worker den Status automatisch angehoben hat (kein auth.uid()). */
  automatic: boolean;
};
export type ActivityMeta = {
  type: ActivityType;
  /** Medium der Kontaktaufnahme (Migration 0057). Null bei Altbestand und bei Aufgaben, die kein Medium haben. */
  channel: ActivityChannel | null;
  outcome: ActivityOutcome | null;
  duration_seconds: number | null;
  due_at: string | null;
  completed_at: string | null;
  scope: "contact" | "business";
};
export type DealMeta = {
  value: number;
  currency: string;
  stage: DealStage;
  status: DealStatus;
  probability: number;
  expected_close_date: string | null;
  closed_at: string | null;
};

export type TimelineEvent =
  | (BaseEvent & { kind: "email_in" | "email_out"; meta: EmailMeta })
  | (BaseEvent & { kind: "note"; meta: NoteMeta })
  | (BaseEvent & { kind: "status"; meta: StatusMeta })
  | (BaseEvent & { kind: "activity"; meta: ActivityMeta })
  | (BaseEvent & { kind: "deal"; meta: DealMeta });

export type TimelineScope = { contactId: string } | { businessId: string };

/**
 * Laedt die Timeline. Kontakt-Scope liefert diesen Kontakt plus firmenweite
 * Notizen und Deals, Firmen-Scope alle Kontakte der Firma.
 *
 * Fremde oder unbekannte IDs geben serverseitig eine leere Liste zurueck (die
 * Funktion prueft is_workspace_owner), hier braucht es also keine zweite Pruefung.
 */
export async function fetchTimeline(
  supabase: SupabaseClient,
  scope: TimelineScope
): Promise<TimelineEvent[]> {
  const { data, error } = await supabase.rpc("crm_timeline", {
    p_contact_id: "contactId" in scope ? scope.contactId : null,
    p_business_id: "businessId" in scope ? scope.businessId : null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TimelineEvent[];
}

/** Nur die Ereignisse, die der Vertriebler als "Verlauf" versteht (ohne Statuswechsel). */
export function isConversationEvent(event: TimelineEvent): boolean {
  return event.kind === "email_in" || event.kind === "email_out" || event.kind === "note";
}
