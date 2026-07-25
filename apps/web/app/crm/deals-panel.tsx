"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DEAL_STAGES,
  defaultProbability,
  formatMoney,
  weightedValue,
  type Deal,
  type DealStage,
} from "@/lib/crm/deals";
import { formatDay, toDateInputValue } from "@/lib/format-time";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

// Waehrung bewusst nicht mehr im UI waehlbar: deals.currency war frei
// editierbar, aber crm_pipeline_stats() summiert value ueber alle offenen
// Deals einer Firma OHNE nach Waehrung zu gruppieren, und ForecastCards zeigt
// das Ergebnis mit einem einzigen, angenommenen Symbol an. Bei zwei Deals mit
// unterschiedlicher Waehrung waere die Summe still falsch beschriftet. Fest
// auf EUR (der tatsaechliche Markt), zusaetzlich per Migration 0038 in der DB
// erzwungen -- die Aggregation muss dadurch nicht angefasst werden.
const DEAL_CURRENCY = "EUR";

type DraftDeal = {
  id: string | null;
  title: string;
  value: string;
  stage: DealStage;
  probability: string;
  expected_close_date: string;
};

function emptyDraft(): DraftDeal {
  const stage = DEAL_STAGES[0].id;
  return {
    id: null,
    title: "",
    value: "",
    stage,
    probability: String(defaultProbability(stage)),
    expected_close_date: "",
  };
}

/**
 * Deals einer Firma: anlegen, umstufen, gewinnen, verlieren.
 *
 * Deals haengen an der Firma (business_id ist not null in Migration 0034), weil
 * ein Abschluss mit dem Unternehmen zustande kommt und nicht mit einer einzelnen
 * Person -- der Ansprechpartner wird optional mitgespeichert, damit man weiss,
 * mit wem man verhandelt hat.
 */
export default function DealsPanel({
  businessId,
  contactId,
  className = "",
}: {
  businessId: string;
  /** Ansprechpartner, der beim Anlegen als Deal-Kontakt hinterlegt wird. */
  contactId?: string;
  className?: string;
}) {
  const { t, lang } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const C = t.crm;

  const [deals, setDeals] = useState<Deal[]>([]);
  const [draft, setDraft] = useState<DraftDeal | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("deals")
      .select(
        "id, business_id, contact_id, title, value, currency, stage, probability, status, expected_close_date, closed_at, lost_reason, created_at, updated_at"
      )
      .eq("workspace_id", workspaceId)
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    setDeals((data ?? []) as Deal[]);
  }, [workspaceId, businessId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveDraft() {
    if (!draft || saving) return;
    const title = draft.title.trim();
    if (!title) {
      push(C.dealTitleRequired, "error");
      return;
    }
    setSaving(true);
    const payload = {
      workspace_id: workspaceId,
      business_id: businessId,
      contact_id: contactId ?? null,
      title,
      value: Number(draft.value) || 0,
      currency: DEAL_CURRENCY,
      stage: draft.stage,
      probability: Math.min(100, Math.max(0, Number(draft.probability) || 0)),
      expected_close_date: draft.expected_close_date || null,
    };
    const supabase = createClient();
    const { error } = draft.id
      ? await supabase.from("deals").update(payload).eq("id", draft.id).eq("workspace_id", workspaceId)
      : await supabase.from("deals").insert(payload);
    setSaving(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setDraft(null);
    push(C.dealSaved, "success");
    load();
  }

  /** status und closed_at haengen zusammen (CHECK-Constraint deals_closed_at_check). */
  async function setStatus(deal: Deal, status: Deal["status"]) {
    const lostReason =
      status === "lost" ? (window.prompt(C.dealLostReasonPrompt) ?? "").trim() || null : null;
    const { error } = await createClient()
      .from("deals")
      .update({
        status,
        closed_at: status === "open" ? null : new Date().toISOString(),
        lost_reason: status === "lost" ? lostReason : null,
      })
      .eq("id", deal.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    load();
  }

  async function remove(deal: Deal) {
    if (!confirm(C.dealDeleteConfirm)) return;
    const { error } = await createClient()
      .from("deals")
      .delete()
      .eq("id", deal.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    push(C.dealDeleted, "success");
    load();
  }

  const openDeals = deals.filter((d) => d.status === "open");
  const openValue = openDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
  const weighted = weightedValue(deals);
  const fieldCls =
    "rounded-lg border border-edge2 bg-field px-2.5 py-1.5 text-xs text-ink placeholder-mute outline-none transition-colors focus:border-sky-500";

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-faint">{C.dealsHeading}</p>
        {openDeals.length > 0 && (
          <span className="text-[10px] text-faint">
            {formatMoney(openValue, openDeals[0].currency, lang)} ·{" "}
            {C.dealWeighted(formatMoney(weighted, openDeals[0].currency, lang))}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {deals.length === 0 && !draft && (
          <p className="rounded-lg border border-edge/60 bg-surface/60 px-3 py-4 text-center text-xs text-faint">
            {C.dealsEmpty}
          </p>
        )}

        {deals.map((deal) => (
          <div
            key={deal.id}
            className={
              "rounded-lg border px-3 py-2.5 " +
              (deal.status === "won"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : deal.status === "lost"
                ? "border-red-500/25 bg-red-500/5"
                : "border-edge/60 bg-surface/60")
            }
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{deal.title}</p>
                <p className="text-[11px] text-faint">
                  {C.dealStageLabels[deal.stage] ?? deal.stage} · {deal.probability}% ·{" "}
                  {C.dealStatusLabels[deal.status] ?? deal.status}
                  {deal.expected_close_date && " · " + formatDay(deal.expected_close_date, lang)}
                </p>
                {deal.lost_reason && <p className="mt-0.5 text-[11px] text-red-500">{deal.lost_reason}</p>}
              </div>
              <span className="shrink-0 text-sm font-semibold text-ink">
                {formatMoney(Number(deal.value) || 0, deal.currency, lang)}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-medium">
              <button
                onClick={() =>
                  setDraft({
                    id: deal.id,
                    title: deal.title,
                    value: String(deal.value ?? ""),
                    stage: deal.stage,
                    probability: String(deal.probability),
                    expected_close_date: toDateInputValue(deal.expected_close_date),
                  })
                }
                className="text-sky-600 transition-colors hover:text-sky-500 dark:text-sky-400"
              >
                {C.dealEdit}
              </button>
              {deal.status === "open" ? (
                <>
                  <button
                    onClick={() => setStatus(deal, "won")}
                    className="text-emerald-600 transition-colors hover:text-emerald-500 dark:text-emerald-400"
                  >
                    {C.dealWin}
                  </button>
                  <button
                    onClick={() => setStatus(deal, "lost")}
                    className="text-red-600 transition-colors hover:text-red-500 dark:text-red-400"
                  >
                    {C.dealLose}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setStatus(deal, "open")}
                  className="text-soft transition-colors hover:text-ink"
                >
                  {C.dealReopen}
                </button>
              )}
              <button
                onClick={() => remove(deal)}
                className="ml-auto text-mute transition-colors hover:text-red-500"
              >
                {C.noteDelete}
              </button>
            </div>
          </div>
        ))}

        {draft ? (
          <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3">
            <input
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={C.dealTitlePlaceholder}
              className={fieldCls + " mb-2 w-full"}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[10px] font-medium text-faint sm:col-span-2">
                {C.dealValueLabel} ({DEAL_CURRENCY})
                <input
                  type="number"
                  min={0}
                  step="100"
                  value={draft.value}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                  className={fieldCls + " mt-0.5 w-full"}
                />
              </label>
              <label className="text-[10px] font-medium text-faint">
                {C.dealStageLabel}
                <select
                  value={draft.stage}
                  onChange={(e) => {
                    const stage = e.target.value as DealStage;
                    // Wahrscheinlichkeit zieht mit der Stufe mit, bleibt aber
                    // ueberschreibbar (siehe Kommentar in lib/crm/deals.ts).
                    setDraft({ ...draft, stage, probability: String(defaultProbability(stage)) });
                  }}
                  className={fieldCls + " mt-0.5 w-full"}
                >
                  {DEAL_STAGES.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {C.dealStageLabels[stage.id] ?? stage.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-medium text-faint">
                {C.dealProbabilityLabel}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.probability}
                  onChange={(e) => setDraft({ ...draft, probability: e.target.value })}
                  className={fieldCls + " mt-0.5 w-full"}
                />
              </label>
              <label className="text-[10px] font-medium text-faint sm:col-span-2">
                {C.dealExpectedCloseLabel}
                <input
                  type="date"
                  value={draft.expected_close_date}
                  onChange={(e) => setDraft({ ...draft, expected_close_date: e.target.value })}
                  className={fieldCls + " mt-0.5 w-full"}
                />
              </label>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setDraft(null)}
                className="rounded-lg border border-edge2 px-3 py-1.5 text-xs text-soft transition-colors hover:text-ink"
              >
                {C.dealCancel}
              </button>
              <button
                onClick={saveDraft}
                disabled={saving}
                className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
              >
                {saving ? C.dealSaving : C.dealSave}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setDraft(emptyDraft())}
            className="w-full rounded-lg border border-dashed border-edge3 px-3 py-2 text-xs font-medium text-faint transition-colors hover:border-sky-500/60 hover:text-sky-600 dark:hover:text-sky-400"
          >
            {C.dealNew}
          </button>
        )}
      </div>
    </div>
  );
}
