"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CompanyLogo from "../company-logo";
import ContactTimeline from "../crm/contact-timeline";
import DealsPanel from "../crm/deals-panel";
import StatusSelect from "../crm/status-select";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import PipelineBoard from "./pipeline-board";
import PipelineList from "./pipeline-list";
import ContactChannels from "./contact-channels";
import { displayName, type PipelineRow } from "@/lib/crm/pipeline";

/**
 * Klammer um beide Pipeline-Ansichten.
 *
 * Pipedrive haelt Liste und Board nebeneinander, statt sich fuer eine zu
 * entscheiden -- aus gutem Grund: sie beantworten verschiedene Fragen. Das
 * Board zeigt, wie der Trichter steht. Die Liste zeigt, wen man als naechstes
 * anfasst und wie man ihn erreicht. Beides wegzunehmen waere ein Rueckschritt,
 * also gibt es einen Umschalter.
 *
 * Statusaenderungen, Drawer und die lokalen Overrides liegen hier und nicht in
 * den Ansichten: sonst haetten beide ihre eigene Kopie derselben Logik, und
 * eine im Board verschobene Karte waere in der Liste noch am alten Platz.
 */

type ViewMode = "list" | "board";
const VIEW_KEY = "pipeline_view";

export default function PipelineView({ rows: initialRows }: { rows: PipelineRow[] }) {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const P = t.pipeline;

  const [view, setView] = useState<ViewMode>("list");
  const [rows, setRows] = useState(initialRows);
  // Lokale Status-Overrides: die Ansicht reagiert sofort, ohne auf einen
  // router.refresh() zu warten. Gleiches Muster wie in leads-table.tsx.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<PipelineRow | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "board" || saved === "list") setView(saved);
    } catch {}
  }, []);

  function chooseView(next: ViewMode) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  }

  async function moveTo(row: PipelineRow, stage: string) {
    const current = overrides[row.id] ?? row.outreach_status;
    if (current === stage) return;
    setOverrides((prev) => ({ ...prev, [row.id]: stage }));
    const { error } = await createClient()
      .from("contacts")
      .update({ outreach_status: stage })
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      // Zuruecknehmen, damit die Zeile nicht in einem Zustand steht, den die DB nicht kennt
      setOverrides((prev) => ({ ...prev, [row.id]: current }));
      push(t.common.error + error.message, "error");
      return;
    }
    push(P.moved(displayName(row, P.cardNoName), t.leads.statusLabels[stage] ?? stage), "success");
  }

  /** Teilaktualisierung einzelner Zeilen, z.B. nach einem geplanten Rueckruf. */
  function patchRows(patch: Record<string, Partial<PipelineRow>>) {
    setRows((prev) => prev.map((r) => (patch[r.id] ? { ...r, ...patch[r.id] } : r)));
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-edge/60 bg-panel px-5 py-14 text-center text-sm text-faint">
        {P.empty}
      </p>
    );
  }

  const detailStage = detail ? (overrides[detail.id] ?? detail.outreach_status) : null;

  return (
    <>
      <div className="mb-3 flex justify-end">
        <div className="flex overflow-hidden rounded-lg border border-edge2">
          {(["list", "board"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => chooseView(mode)}
              className={
                "px-3 py-1.5 text-xs font-medium transition-colors " +
                (view === mode ? "bg-sky-600 text-white" : "text-soft hover:bg-chip hover:text-ink")
              }
            >
              {mode === "list" ? P.viewList : P.viewBoard}
            </button>
          ))}
        </div>
      </div>

      {view === "list" ? (
        <PipelineList
          rows={rows}
          overrides={overrides}
          onStageChange={moveTo}
          onOpen={setDetail}
          onRowsChanged={patchRows}
        />
      ) : (
        <PipelineBoard
          rows={rows}
          overrides={overrides}
          onStageChange={moveTo}
          onOpen={setDetail}
        />
      )}

      {detail && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setDetail(null)}
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-edge/60 bg-panel p-6 shadow-2xl [animation:fadeUp_.25s_ease]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <CompanyLogo
                  name={detail.company_name ?? displayName(detail, "?")}
                  website={detail.company_website}
                  size={32}
                />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold tracking-tight text-ink">
                    {displayName(detail, P.cardNoName)}
                  </h2>
                  <p className="truncate text-xs text-faint">
                    {[detail.title, detail.company_name].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="rounded-lg border border-edge/60 px-2.5 py-1 text-sm text-faint transition-colors hover:border-edge2 hover:text-ink"
              >
                ✕
              </button>
            </div>

            {/* Kontaktwege auch hier, nicht nur in der Liste: wer den Drawer
                ueber das Board oeffnet, soll nicht schlechter dastehen. */}
            <div className="mb-4">
              <ContactChannels row={detail} />
            </div>

            <div className="mb-5 flex items-center gap-2 rounded-lg border border-edge/60 bg-surface/60 px-3 py-2">
              <span className="text-xs font-medium text-faint">{P.stageLabel}</span>
              <StatusSelect
                value={detailStage!}
                onChange={(next) => moveTo(detail, next)}
                labels={t.leads.statusLabels}
              />
            </div>

            <DealsPanel businessId={detail.business_id} contactId={detail.id} className="mb-5" />
            <ContactTimeline contactId={detail.id} businessId={detail.business_id} />
          </aside>
        </div>
      )}
    </>
  );
}
