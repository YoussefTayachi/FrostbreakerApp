"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { OUTREACH_STAGES } from "@/lib/crm/stages";
import { formatRelative, formatDay } from "@/lib/format-time";
import CompanyLogo from "../company-logo";
import StatusSelect from "../crm/status-select";
import { IconSearch } from "../icons";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import ContactChannels from "./contact-channels";
import {
  daysInStage,
  displayName,
  hasNoNextStep,
  isStale,
  type PipelineRow,
} from "@/lib/crm/pipeline";

/**
 * Die Pipeline als Arbeitsliste, nach Lead-Liste gruppiert — dasselbe Muster
 * wie unter /linkedin.
 *
 * Das Board beantwortet "wie steht mein Trichter". Diese Ansicht beantwortet
 * "wen mache ich als naechstes und wie erreiche ich ihn" — und dafuer war das
 * Board das falsche Werkzeug: es zeigte Name, Titel und Firma, sonst nichts.
 * Wer anrufen wollte, musste die Nummer woanders suchen.
 *
 * Pipedrive haelt beide Ansichten nebeneinander, statt sich fuer eine zu
 * entscheiden. Genau das machen wir hier auch (siehe pipeline-view.tsx).
 */

/** Schnellauswahl fuer den Rueckruf, in Tagen ab heute. */
const CALLBACK_PRESETS = [1, 3, 7] as const;

export default function PipelineList({
  rows,
  overrides,
  onStageChange,
  onOpen,
  onRowsChanged,
}: {
  rows: PipelineRow[];
  overrides: Record<string, string>;
  onStageChange: (row: PipelineRow, stage: string) => void;
  onOpen: (row: PipelineRow) => void;
  /** Nach dem Planen eines Rueckrufs, damit die Zeile ihn sofort zeigt. */
  onRowsChanged: (patch: Record<string, Partial<PipelineRow>>) => void;
}) {
  const { t, lang } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const P = t.pipeline;

  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [listFilter, setListFilter] = useState<string>("");
  /**
   * Welche Gruppen sind AUFgeklappt — bewusst herum statt "welche sind zu".
   * Vorher waren alle offen, und man musste bei 21 Lead-Listen erst zwanzigmal
   * zuklappen, um ueberhaupt eine Uebersicht zu bekommen. Zugeklappt ist der
   * nuetzlichere Ausgangspunkt: erst sehen, was es gibt, dann eines oeffnen.
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * Pipedrives zentraler Reflex als Filter.
   *
   * "needsStep" ist die Frage, die ein Pipedrive-Nutzer als erstes stellt:
   * wo habe ich nichts geplant? Gemessen am 2026-08-03 traf das auf 569 von
   * 570 Kontakten zu — ohne diesen Filter ist die Antwort unbrauchbar, mit
   * ihm ist sie die Arbeitsliste des Tages.
   */
  const [focus, setFocus] = useState<"" | "needsStep" | "stale">("");

  const lists = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const id = r.list_id ?? "";
      if (!seen.has(id)) seen.set(id, r.list_name ?? P.noList);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [rows, P.noList]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .map((r) => ({ ...r, outreach_status: overrides[r.id] ?? r.outreach_status }))
      .filter((r) => {
        if (stageFilter && r.outreach_status !== stageFilter) return false;
        if (listFilter && (r.list_id ?? "") !== listFilter) return false;
        if (focus === "needsStep" && !hasNoNextStep(r)) return false;
        if (focus === "stale" && !isStale(r)) return false;
        if (!needle) return true;
        return [r.full_name, r.first_name, r.last_name, r.title, r.email, r.phone, r.company_name]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(needle));
      });
  }, [rows, overrides, query, stageFilter, listFilter, focus]);

  // Zaehler an den Reitern: eine Schaltflaeche, die auf 0 fuehrt, ist eine
  // Sackgasse — die Zahl davor beantwortet, ob sich der Klick lohnt.
  const needsStepCount = useMemo(() => rows.filter(hasNoNextStep).length, [rows]);
  const staleCount = useMemo(() => rows.filter((r) => isStale(r)).length, [rows]);

  /** Gruppiert, Reihenfolge nach Groesse — wo am meisten liegt, steht oben. */
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; location: string | null; rows: PipelineRow[] }>();
    for (const r of filtered) {
      const id = r.list_id ?? "";
      let g = map.get(id);
      if (!g) {
        g = { id, name: r.list_name ?? P.noList, location: r.list_location, rows: [] };
        map.set(id, g);
      }
      g.rows.push(r);
    }
    return [...map.values()].sort((a, b) => b.rows.length - a.rows.length);
  }, [filtered, P.noList]);

  function toggleGroup(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Sucht oder filtert jemand, will er Treffer sehen und nicht Gruppenkoepfe.
  // Dann sind alle offen, unabhaengig davon, was vorher aufgeklappt war.
  const filtersActive = Boolean(query.trim() || stageFilter || focus);

  /**
   * Rueckruf planen. Legt genau die Aktivitaet an, die /calls anzeigt --
   * offen, mit Faelligkeit. Damit ist die Verbindung zwischen den beiden
   * Ansichten nicht nur behauptet, sondern dieselbe Zeile in derselben
   * Tabelle.
   *
   * Ende des gewaehlten Tages, wie im ActivityComposer: sonst gilt der Termin
   * ab 00:00 schon als ueberfaellig.
   */
  async function planCallback(row: PipelineRow, days: number) {
    if (busyId) return;
    setBusyId(row.id);
    const due = new Date();
    due.setDate(due.getDate() + days);
    const dueAt = new Date(
      `${due.toISOString().slice(0, 10)}T23:59:59`
    ).toISOString();

    const { error } = await createClient().from("activities").insert({
      workspace_id: workspaceId,
      contact_id: row.id,
      type: "call",
      channel: "phone",
      subject: P.callbackSubject,
      due_at: dueAt,
    });
    setBusyId(null);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    onRowsChanged({
      [row.id]: { next_due_at: dueAt, next_due_subject: P.callbackSubject, next_due_channel: "phone" },
    });
    push(P.callbackPlanned(formatDay(dueAt, lang)), "success");
  }

  const focusTabs: { key: typeof focus; label: string; count?: number; tone?: string }[] = [
    { key: "", label: P.focusAll },
    { key: "needsStep", label: P.focusNeedsStep, count: needsStepCount, tone: "text-amber-700 dark:text-amber-400" },
    { key: "stale", label: P.focusStale, count: staleCount, tone: "text-red-600 dark:text-red-400" },
  ];

  return (
    <div className="space-y-4">
      {/* Die zwei Fragen, die Pipedrive einem antrainiert — wo fehlt der
          naechste Schritt, und was liegt zu lange. Als Reiter statt als
          Dropdown, weil sie der Einstieg in den Arbeitstag sind und nicht
          eine Einstellung unter anderen. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {focusTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFocus(tab.key)}
            className={
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
              (focus === tab.key
                ? "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
            }
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={"tabular-nums " + (focus === tab.key ? "" : (tab.tone ?? ""))}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={P.searchPlaceholder}
            className="w-full rounded-lg border border-edge2 bg-field py-2 pl-9 pr-3 text-sm text-ink placeholder-mute outline-none transition-colors focus:border-sky-500"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-lg border border-edge2 bg-field px-2.5 py-2 text-sm text-ink outline-none focus:border-sky-500"
        >
          <option value="">{P.allStages}</option>
          {OUTREACH_STAGES.map((s) => (
            <option key={s} value={s}>
              {t.leads.statusLabels[s] ?? s}
            </option>
          ))}
        </select>
        <select
          value={listFilter}
          onChange={(e) => setListFilter(e.target.value)}
          className="max-w-56 rounded-lg border border-edge2 bg-field px-2.5 py-2 text-sm text-ink outline-none focus:border-sky-500"
        >
          <option value="">{P.allLists}</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-edge/60 bg-panel px-4 py-10 text-center text-sm text-faint">
          {P.noResults}
        </p>
      ) : (
        /*
          EINE Tabelle ueber alle Gruppen, nicht eine je Gruppe. Nur so fluchten
          die Spalten ueber Gruppengrenzen hinweg — bei getrennten Tabellen
          bestimmt jede ihre Spaltenbreiten selbst, und die Liste saehe bei
          jedem Aufklappen anders aus. Die Gruppenkoepfe sind deshalb Zeilen
          mit colSpan innerhalb derselben Tabelle.

          Vorbild ist Pipedrives Listenansicht: Kopfzeile, feste Spalten, von
          links nach rechts lesbar.
        */
        <div className="overflow-x-auto rounded-xl border border-edge/60 bg-panel">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-edge2/60 text-[11px] font-medium uppercase tracking-wide text-mute">
                <th className="px-4 py-2">{P.colContact}</th>
                <th className="w-32 px-3 py-2">{P.colChannels}</th>
                <th className="w-44 px-3 py-2">{P.colLastTouch}</th>
                <th className="w-40 px-3 py-2">{P.colNextStep}</th>
                <th className="w-36 px-3 py-2">{P.colStage}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const isOpen = filtersActive || expanded.has(group.id);
                return (
                  <Fragment key={group.id}>
                    <tr
                      onClick={() => toggleGroup(group.id)}
                      className="cursor-pointer border-b border-edge2/60 bg-surface/40 transition-colors hover:bg-chip/50"
                    >
                      <td colSpan={5} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              "text-[10px] text-mute transition-transform " + (isOpen ? "rotate-90" : "")
                            }
                          >
                            &#9654;
                          </span>
                          <span className="truncate text-sm font-medium text-ink">{group.name}</span>
                          {group.location && (
                            <span className="truncate text-xs text-faint">{group.location}</span>
                          )}
                          <span className="ml-auto text-xs tabular-nums text-faint">
                            {group.rows.length}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {isOpen &&
                      group.rows.map((row) => (
                        <Row
                          key={row.id}
                          row={row}
                          busy={busyId === row.id}
                          onOpen={() => onOpen(row)}
                          onStageChange={(stage) => onStageChange(row, stage)}
                          onPlanCallback={(days) => planCallback(row, days)}
                        />
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-faint">{P.columnCount(filtered.length)}</p>
    </div>
  );
}

function Row({
  row,
  busy,
  onOpen,
  onStageChange,
  onPlanCallback,
}: {
  row: PipelineRow;
  busy: boolean;
  onOpen: () => void;
  onStageChange: (stage: string) => void;
  onPlanCallback: (days: number) => void;
}) {
  const { t, lang } = useT();
  const P = t.pipeline;
  const [callbackOpen, setCallbackOpen] = useState(false);

  const overdue = row.next_due_at ? new Date(row.next_due_at) < new Date() : false;
  const stale = isStale(row);
  const days = daysInStage(row);

  return (
    <tr className="border-b border-edge2/40 transition-colors last:border-0 hover:bg-chip/40">
      <td className="px-4 py-2">
        <button onClick={onOpen} className="flex min-w-0 items-center gap-2.5 text-left">
          <CompanyLogo
            name={row.company_name ?? displayName(row, "?")}
            website={row.company_website}
            size={26}
          />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm text-ink">
              {displayName(row, P.cardNoName)}
              {/* Pipedrives "rotting deal": liegt zu lange auf derselben Stufe.
                  Nur der Punkt, kein Text — die Zeile ist schon voll, und die
                  Erklaerung steht im Tooltip. */}
              {stale && (
                <span
                  title={P.staleTitle(days ?? 0)}
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                />
              )}
            </p>
            <p className="truncate text-[11px] text-faint">
              {[row.company_name, row.title].filter(Boolean).join(" · ")}
            </p>
          </div>
        </button>
      </td>

      <td className="px-3 py-2">
        <ContactChannels row={row} />
      </td>

      <td className="px-3 py-2 text-[11px] leading-tight">
        {row.last_reply_at ? (
          <span className="text-sky-600 dark:text-sky-400">
            {P.repliedAgo(formatRelative(row.last_reply_at, lang))}
          </span>
        ) : row.last_touch_at ? (
          <span className="text-faint">
            {P.touchedAgo(
              t.crm.activityChannelLabels[row.last_touch_channel ?? ""] ?? P.channelUnknown,
              formatRelative(row.last_touch_at, lang)
            )}
          </span>
        ) : (
          <span className="text-mute">{P.neverTouched}</span>
        )}
      </td>

      <td className="px-3 py-2 text-[11px] leading-tight">
        {row.next_due_at ? (
          <Link
            href="/calls"
            className={
              "transition-colors hover:underline " +
              (overdue ? "text-red-500" : "text-emerald-600 dark:text-emerald-400")
            }
            title={P.openInCallList}
          >
            {overdue
              ? P.dueOverdue(formatDay(row.next_due_at, lang))
              : P.dueOn(formatDay(row.next_due_at, lang))}
          </Link>
        ) : callbackOpen ? (
          <div className="flex items-center gap-1">
            {CALLBACK_PRESETS.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setCallbackOpen(false);
                  onPlanCallback(d);
                }}
                disabled={busy}
                className="rounded border border-edge2 px-1.5 py-0.5 text-[10px] text-soft transition-colors hover:border-sky-500/60 hover:text-sky-600 disabled:opacity-40 dark:hover:text-sky-400"
              >
                {P.inDays(d)}
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setCallbackOpen(true)}
            className="text-mute transition-colors hover:text-sky-600 dark:hover:text-sky-400"
          >
            + {P.planCallback}
          </button>
        )}
      </td>

      <td className="px-3 py-2">
        <StatusSelect value={row.outreach_status} onChange={onStageChange} labels={t.leads.statusLabels} />
      </td>
    </tr>
  );
}
