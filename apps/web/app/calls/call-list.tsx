"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ACTIVITY_OUTCOMES,
  OUTCOME_TO_STAGE,
  supportsOutcome,
  type ActivityOutcome,
  type ActivityType,
} from "@/lib/crm/activities";
import { formatDay } from "@/lib/format-time";
import CompanyLogo from "../company-logo";
import { IconPhone } from "../icons";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

type Company = {
  name: string;
  website: string | null;
  phone_national: string | null;
  company_summary: string | null;
} | null;

export type CallTask = {
  id: string;
  type: ActivityType;
  subject: string | null;
  note: string | null;
  due_at: string;
  contact_id: string | null;
  business_id: string | null;
  contacts: {
    id: string;
    full_name: string | null;
    title: string | null;
    phone: string | null;
    email: string | null;
    outreach_status: string;
    business_id: string | null;
    businesses: Company;
  } | null;
  businesses: Company;
};

/** Firma und Nummer koennen an der Aktivitaet selbst (business_id) oder am
 *  Kontakt haengen -- fuer die Anzeige ist das derselbe Fall. Die persoenliche
 *  Durchwahl des Kontakts gewinnt vor der Firmennummer. */
function resolve(task: CallTask) {
  const company = task.contacts?.businesses ?? task.businesses;
  const phone = task.contacts?.phone || company?.phone_national || null;
  return {
    company,
    phone,
    name: task.contacts?.full_name ?? null,
    title: task.contacts?.title ?? null,
  };
}

/** Ende des heutigen Tages -- Faelligkeiten werden auf 23:59:59 gesetzt
 *  (siehe ActivityComposer), deshalb ist "heute" alles bis zu dieser Grenze. */
function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function CallList({ tasks }: { tasks: CallTask[] }) {
  const { t, lang } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const router = useRouter();
  const C = t.calls;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, ActivityOutcome | "">>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Lokal abgehakte Aufgaben sofort ausblenden, statt auf den Reload zu warten --
  // sonst steht ein erledigter Anruf noch sichtbar in der Liste.
  const [done, setDone] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const dayStart = startOfToday();
    const dayEnd = endOfToday();
    const open = tasks.filter((task) => !done.has(task.id));
    return {
      overdue: open.filter((task) => new Date(task.due_at).getTime() < dayStart),
      today: open.filter((task) => {
        const at = new Date(task.due_at).getTime();
        return at >= dayStart && at <= dayEnd;
      }),
      later: open.filter((task) => new Date(task.due_at).getTime() > dayEnd),
    };
  }, [tasks, done]);

  async function complete(task: CallTask) {
    if (busyId) return;
    setBusyId(task.id);
    const outcome = supportsOutcome(task.type) ? outcomes[task.id] || null : null;
    const extraNote = notes[task.id]?.trim();
    const now = new Date().toISOString();
    const supabase = createClient();

    const { error } = await supabase
      .from("activities")
      .update({
        completed_at: now,
        occurred_at: now,
        outcome: outcome || null,
        // Gespraechsnotiz an die bestehende Notiz anhaengen, statt die
        // Vorbereitungsnotiz ("nochmal Donnerstag versuchen") zu ueberschreiben.
        ...(extraNote ? { note: [task.note, extraNote].filter(Boolean).join("\n\n") } : {}),
      })
      .eq("id", task.id)
      .eq("workspace_id", workspaceId);

    if (error) {
      setBusyId(null);
      push(t.common.error + error.message, "error");
      return;
    }

    // Gleiche Regel wie im Kontakt-Verlauf: ein Ergebnis mit klarer Aussage
    // zieht den Kontaktstatus nach (lib/crm/activities.ts). Der Trigger aus
    // 0032 schreibt die Bewegung selbst in den Verlauf.
    const nextStage = outcome ? OUTCOME_TO_STAGE[outcome] : undefined;
    if (nextStage && task.contact_id) {
      await supabase
        .from("contacts")
        .update({ outreach_status: nextStage })
        .eq("id", task.contact_id)
        .eq("workspace_id", workspaceId);
    }

    setDone((prev) => new Set(prev).add(task.id));
    setBusyId(null);
    setOpenId(null);
    push(C.completed, "success");
    router.refresh();
  }

  async function reschedule(task: CallTask, days: number) {
    if (busyId) return;
    setBusyId(task.id);
    const next = new Date();
    next.setDate(next.getDate() + days);
    next.setHours(23, 59, 59, 0);
    const { error } = await createClient()
      .from("activities")
      .update({ due_at: next.toISOString() })
      .eq("id", task.id)
      .eq("workspace_id", workspaceId);
    setBusyId(null);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    push(C.rescheduled(formatDay(next.toISOString(), lang)), "success");
    router.refresh();
  }

  function Row({ task, overdue }: { task: CallTask; overdue: boolean }) {
    const { company, phone, name, title } = resolve(task);
    const expanded = openId === task.id;
    const searchTarget = company?.name ?? name ?? "";

    return (
      <div className="border-b border-edge/60 last:border-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <CompanyLogo name={company?.name ?? "?"} website={company?.website ?? null} size={28} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-ink">
                {name ?? company?.name ?? "—"}
              </span>
              {task.type !== "call" && (
                <span className="rounded-full border border-edge2 bg-chip px-2 py-0.5 text-[10px] text-soft">
                  {t.crm.activityTypeLabels[task.type] ?? task.type}
                </span>
              )}
              {overdue && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  {C.overdueBadge}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-faint">
              {[title, company?.name].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>

          {/* tel:-Link, kein App-Dialer: gewaehlt wird mit dem Firmentelefon,
              die App liefert nur die Nummer klickbar mit. */}
          {phone ? (
            <a
              href={"tel:" + phone.replace(/\s/g, "")}
              className="flex items-center gap-1.5 rounded-lg border border-edge2 bg-field px-2.5 py-1.5 font-mono text-xs text-ink transition-colors hover:border-sky-500"
              title={C.phoneTitle}
            >
              <IconPhone className="h-3.5 w-3.5 text-mute" />
              {phone}
            </a>
          ) : (
            <span className="text-xs text-mute">{C.noPhone}</span>
          )}

          <span className="w-24 text-right text-xs text-faint">{formatDay(task.due_at, lang)}</span>

          <button
            onClick={() => setOpenId(expanded ? null : task.id)}
            className="rounded-lg border border-edge2 px-2.5 py-1.5 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink"
          >
            {expanded ? C.collapse : C.prepare}
          </button>
        </div>

        {expanded && (
          <div className="space-y-3 border-t border-edge/60 bg-surface/60 px-4 py-3">
            {task.subject && (
              <p className="text-sm font-medium text-ink">{task.subject}</p>
            )}
            {task.note && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-faint">
                  {C.plannedNote}
                </p>
                <p className="whitespace-pre-wrap rounded-lg border border-edge/60 bg-panel p-2.5 text-xs leading-relaxed text-soft">
                  {task.note}
                </p>
              </div>
            )}
            {company?.company_summary && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-faint">
                  {C.companySummary}
                </p>
                <p className="rounded-lg border border-edge/60 bg-panel p-2.5 text-xs leading-relaxed text-soft">
                  {company.company_summary}
                </p>
              </div>
            )}

            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-faint">
                {C.callNote}
              </p>
              <textarea
                rows={2}
                value={notes[task.id] ?? ""}
                onChange={(e) => setNotes((prev) => ({ ...prev, [task.id]: e.target.value }))}
                placeholder={C.callNotePlaceholder}
                className="w-full rounded-lg border border-edge2 bg-field px-2.5 py-1.5 text-xs text-ink placeholder-mute outline-none transition-colors focus:border-sky-500"
              />
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-2">
                {supportsOutcome(task.type) && (
                <label className="text-[10px] font-medium text-faint">
                  {C.outcomeLabel}
                  <select
                    value={outcomes[task.id] ?? ""}
                    onChange={(e) =>
                      setOutcomes((prev) => ({
                        ...prev,
                        [task.id]: e.target.value as ActivityOutcome | "",
                      }))
                    }
                    className="mt-0.5 block rounded-lg border border-edge2 bg-field px-2.5 py-1.5 text-xs text-ink outline-none focus:border-sky-500"
                  >
                    <option value="">{C.outcomeNone}</option>
                    {ACTIVITY_OUTCOMES.map((option) => (
                      <option key={option} value={option}>
                        {t.crm.activityOutcomeLabels[option] ?? option}
                      </option>
                    ))}
                  </select>
                </label>
                )}
                <button
                  onClick={() => complete(task)}
                  disabled={busyId === task.id}
                  className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
                >
                  {busyId === task.id ? C.saving : C.markDone}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-mute">{C.rescheduleLabel}</span>
                <button
                  onClick={() => reschedule(task, 1)}
                  disabled={busyId === task.id}
                  className="rounded-lg border border-edge2 px-2.5 py-1.5 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink disabled:opacity-40"
                >
                  {C.tomorrow}
                </button>
                <button
                  onClick={() => reschedule(task, 7)}
                  disabled={busyId === task.id}
                  className="rounded-lg border border-edge2 px-2.5 py-1.5 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink disabled:opacity-40"
                >
                  {C.nextWeek}
                </button>
                {searchTarget && (
                  <Link
                    href={"/leads?q=" + encodeURIComponent(searchTarget)}
                    className="rounded-lg border border-edge2 px-2.5 py-1.5 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink"
                  >
                    {C.openLead}
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function Section({
    label,
    items,
    overdue = false,
    tone = "",
  }: {
    label: string;
    items: CallTask[];
    overdue?: boolean;
    tone?: string;
  }) {
    if (items.length === 0) return null;
    return (
      <section className="overflow-hidden rounded-lg border border-edge/60 bg-panel">
        <div className="flex items-center justify-between border-b border-edge/60 px-4 py-2.5">
          <h2 className={"text-sm font-medium " + (tone || "text-ink")}>{label}</h2>
          <span className="text-xs text-faint">{items.length}</span>
        </div>
        {items.map((task) => (
          <Row key={task.id} task={task} overdue={overdue} />
        ))}
      </section>
    );
  }

  const total = groups.overdue.length + groups.today.length + groups.later.length;
  if (total === 0) {
    return (
      <div className="rounded-lg border border-edge/60 bg-panel p-10 text-center">
        <p className="text-faint">{C.emptyState}</p>
        <p className="mt-1 text-xs text-mute">{C.emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Section
        label={C.sectionOverdue}
        items={groups.overdue}
        overdue
        tone="text-amber-700 dark:text-amber-300"
      />
      <Section label={C.sectionToday} items={groups.today} />
      <Section label={C.sectionLater} items={groups.later} />
    </div>
  );
}
