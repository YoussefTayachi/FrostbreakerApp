"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OUTCOME_TO_STAGE, type ActivityOutcome } from "@/lib/crm/activities";
import { formatDateTime, formatRelative } from "@/lib/format-time";
import {
  fetchTimeline,
  isConversationEvent,
  type TimelineEvent,
} from "@/lib/crm/timeline";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import ActivityComposer from "./activity-composer";
import NoteComposer from "./note-composer";

/**
 * Der vereinheitlichte Verlauf eines Kontakts oder einer Firma: E-Mails,
 * Notizen, Status-Wechsel, Aktivitaeten und Deals chronologisch gemischt.
 *
 * Laedt genau eine RPC (crm_timeline, Migration 0035) statt fuenf Tabellen
 * einzeln -- neue Ereignisquellen kommen kuenftig in der SQL-Funktion dazu und
 * erscheinen hier automatisch, sobald sie im Rendering-Switch bedacht sind.
 *
 * Wird von der Inbox (Kontakt-Scope) und vom Lead-Drawer (Firmen-Scope) genutzt.
 */
export default function ContactTimeline({
  contactId,
  businessId,
  className = "",
}: {
  /** Kontakt-Scope: dieser Kontakt plus firmenweite Notizen und Deals. */
  contactId?: string;
  /** Firmen-Scope: alle Kontakte dieser Firma. Immer mitgeben, damit
   *  firmenweite Notizen geschrieben werden koennen. */
  businessId?: string;
  className?: string;
}) {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const C = t.crm;

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [conversationOnly, setConversationOnly] = useState(false);

  const load = useCallback(async () => {
    if (!contactId && !businessId) return;
    try {
      const data = await fetchTimeline(
        createClient(),
        contactId ? { contactId } : { businessId: businessId! }
      );
      setEvents(data);
    } catch (e) {
      push(t.common.error + (e as Error).message, "error");
    } finally {
      setLoading(false);
    }
    // push/t sind stabil genug; absichtlich nur an den Scope gebunden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, businessId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const visible = useMemo(
    () => (conversationOnly ? events.filter(isConversationEvent) : events),
    [events, conversationOnly]
  );

  async function deleteNote(id: string) {
    if (!confirm(C.noteDeleteConfirm)) return;
    const { error } = await createClient()
      .from("notes")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setEvents((prev) => prev.filter((e) => !(e.kind === "note" && e.id === id)));
    push(C.noteDeleted, "success");
  }

  async function toggleActivityDone(event: TimelineEvent) {
    if (event.kind !== "activity") return;
    const done = Boolean(event.meta.completed_at);
    const { error } = await createClient()
      .from("activities")
      .update({ completed_at: done ? null : new Date().toISOString() })
      .eq("id", event.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    push(done ? C.activityReopen : C.activityCompletedToast, "success");
    load();
  }

  /**
   * Ein Anrufergebnis mit klarer Aussage zieht den Kontaktstatus mit -- sonst
   * muesste der Vertriebler nach jedem Telefonat zusaetzlich das Dropdown
   * anfassen, und die Pipeline waere binnen Tagen unbrauchbar. Der Status-Trigger
   * aus 0032 schreibt die Bewegung dann automatisch in denselben Verlauf.
   */
  async function syncStageFromOutcome(outcome: ActivityOutcome | null) {
    if (!contactId || !outcome) return;
    const nextStage = OUTCOME_TO_STAGE[outcome];
    if (!nextStage) return;
    const { error } = await createClient()
      .from("contacts")
      .update({ outreach_status: nextStage })
      .eq("id", contactId)
      .eq("workspace_id", workspaceId);
    if (!error) {
      push(C.activityStatusSynced(t.leads.statusLabels[nextStage] ?? nextStage), "info");
    }
  }

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-faint">{C.timelineHeading}</p>
        <div className="flex overflow-hidden rounded-md border border-edge2 text-[10px]">
          {[
            { on: false, label: C.filterAll },
            { on: true, label: C.filterConversation },
          ].map((option) => (
            <button
              key={option.label}
              onClick={() => setConversationOnly(option.on)}
              className={
                "px-2 py-0.5 font-medium transition-colors " +
                (conversationOnly === option.on
                  ? "bg-sky-600 text-white"
                  : "text-soft hover:bg-chip hover:text-ink")
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          <p className="rounded-lg border border-edge/60 bg-surface/60 px-3 py-6 text-center text-xs text-faint">
            {C.timelineLoading}
          </p>
        ) : visible.length === 0 ? (
          <p className="rounded-lg border border-edge/60 bg-surface/60 px-3 py-6 text-center text-xs text-faint">
            {C.timelineEmpty}
          </p>
        ) : (
          visible.map((event) => (
            <TimelineRow
              key={event.kind + event.id}
              event={event}
              onDeleteNote={deleteNote}
              onToggleActivity={toggleActivityDone}
            />
          ))
        )}
      </div>

      <div className="mt-4 space-y-3">
        <NoteComposer
          contactId={contactId}
          businessId={businessId}
          onSaved={load}
        />
        <ActivityComposer
          contactId={contactId}
          businessId={businessId}
          onSaved={(outcome) => {
            syncStageFromOutcome(outcome);
            load();
          }}
        />
      </div>
    </div>
  );
}

function TimelineRow({
  event,
  onDeleteNote,
  onToggleActivity,
}: {
  event: TimelineEvent;
  onDeleteNote: (id: string) => void;
  onToggleActivity: (event: TimelineEvent) => void;
}) {
  const { t, lang } = useT();
  const C = t.crm;

  switch (event.kind) {
    case "email_in":
    case "email_out": {
      const inbound = event.kind === "email_in";
      return (
        <EventShell
          at={event.at}
          lang={lang}
          badge={inbound ? C.eventEmailIn : C.eventEmailOut}
          tone={inbound ? "sky" : "neutral"}
          title={event.title || C.noSubject}
          extra={
            event.meta.ai_interest ? (
              <InterestBadge value={event.meta.ai_interest} labels={t.inbox.aiInterestLabels} />
            ) : null
          }
        >
          {event.body && (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-soft">{event.body}</p>
          )}
        </EventShell>
      );
    }

    case "note":
      return (
        <EventShell
          at={event.at}
          lang={lang}
          badge={event.meta.scope === "business" ? C.eventNoteBusiness : C.eventNote}
          tone="amber"
          title={event.meta.author_email ?? C.authorUnknown}
          extra={
            <div className="flex items-center gap-2">
              {event.meta.edited && <span className="text-[10px] text-mute">{C.edited}</span>}
              <button
                onClick={() => onDeleteNote(event.id)}
                className="text-[10px] text-mute transition-colors hover:text-red-500"
              >
                {C.noteDelete}
              </button>
            </div>
          }
        >
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{event.body}</p>
        </EventShell>
      );

    case "status": {
      const from = event.meta.old_status ? t.leads.statusLabels[event.meta.old_status] : null;
      const to = t.leads.statusLabels[event.meta.new_status] ?? event.meta.new_status;
      return (
        <EventShell
          at={event.at}
          lang={lang}
          badge={C.eventStatus}
          tone="neutral"
          title={from ? C.eventStatusChange(from, to) : C.eventStatusInitial(to)}
          extra={
            event.meta.automatic ? (
              <span className="text-[10px] text-mute">{C.eventStatusAutomatic}</span>
            ) : null
          }
        />
      );
    }

    case "activity": {
      const done = Boolean(event.meta.completed_at);
      const overdue = !done && event.meta.due_at && new Date(event.meta.due_at) < new Date();
      const minutes = event.meta.duration_seconds ? Math.round(event.meta.duration_seconds / 60) : null;
      return (
        <EventShell
          at={event.at}
          lang={lang}
          badge={C.activityTypeLabels[event.meta.type] ?? event.meta.type}
          tone={overdue ? "red" : "violet"}
          title={event.title || C.activityTypeLabels[event.meta.type] || event.meta.type}
          extra={
            <div className="flex items-center gap-2">
              {event.meta.outcome && (
                <span className="rounded-full bg-chip px-1.5 py-0.5 text-[10px] text-soft">
                  {C.activityOutcomeLabels[event.meta.outcome] ?? event.meta.outcome}
                </span>
              )}
              {minutes !== null && <span className="text-[10px] text-mute">{C.activityDuration(minutes)}</span>}
              <button
                onClick={() => onToggleActivity(event)}
                className={
                  "text-[10px] font-medium transition-colors " +
                  (done ? "text-mute hover:text-ink" : "text-sky-600 hover:text-sky-500 dark:text-sky-400")
                }
              >
                {done ? C.activityReopen : C.activityComplete}
              </button>
            </div>
          }
        >
          {event.body && (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-soft">{event.body}</p>
          )}
          {event.meta.due_at && !done && (
            <p className={"mt-1 text-[10px] " + (overdue ? "text-red-500" : "text-faint")}>
              {overdue ? C.activityOverdue : C.activityDue}: {formatDateTime(event.meta.due_at, lang)}
            </p>
          )}
          {done && <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">{C.activityCompleted}</p>}
        </EventShell>
      );
    }

    case "deal":
      return (
        <EventShell
          at={event.at}
          lang={lang}
          badge={C.eventDeal}
          tone={event.meta.status === "won" ? "emerald" : event.meta.status === "lost" ? "red" : "sky"}
          title={event.title ?? ""}
          extra={
            <span className="text-[10px] font-medium text-soft">
              {C.dealStageLabels[event.meta.stage] ?? event.meta.stage} ·{" "}
              {C.dealStatusLabels[event.meta.status] ?? event.meta.status}
            </span>
          }
        >
          {event.body && <p className="text-xs text-faint">{event.body}</p>}
        </EventShell>
      );
  }
}

const TONE_CLS = {
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  red: "bg-red-500/10 text-red-600 dark:text-red-300",
  neutral: "bg-edge2 text-faint",
} as const;

function EventShell({
  at,
  lang,
  badge,
  tone,
  title,
  extra,
  children,
}: {
  at: string;
  lang: "de" | "en";
  badge: string;
  tone: keyof typeof TONE_CLS;
  title: string;
  extra?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-edge/60 bg-surface/60 px-3 py-2.5">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span
          className={
            "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide " +
            TONE_CLS[tone]
          }
        >
          {badge}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{title}</span>
        {extra}
        <span className="shrink-0 text-[10px] text-mute" title={formatDateTime(at, lang)}>
          {formatRelative(at, lang)}
        </span>
      </div>
      {children}
    </div>
  );
}

function InterestBadge({ value, labels }: { value: string; labels: Record<string, string> }) {
  const cls =
    value === "interested"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
      : value === "not_interested"
      ? "bg-red-500/10 text-red-600 dark:text-red-300"
      : "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return (
    <span className={"shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium " + cls}>
      {labels[value] ?? value}
    </span>
  );
}
