"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../../language-provider";
import { useWorkspace } from "../../workspace-provider";

export default function SearchSettings({
  searchId,
  scheduleTargetIds,
  initialName,
  initialSchedule,
  initialInstantlyCampaignId,
}: {
  searchId: string;
  /**
   * Wer das Abo traegt. Bei einer gewoehnlichen Suche sie selbst, bei einer
   * gebuendelten Mehrfach-Suche ihre Teilsuchen (Migration 0096): die
   * Gruppen-Huelle darf kein Abo bekommen, weil process_due_schedules im
   * Worker daraufhin einen Suchlauf ohne Ort einreihen wuerde.
   */
  scheduleTargetIds: string[];
  initialName: string;
  initialSchedule: string;
  initialInstantlyCampaignId: string | null;
}) {
  const router = useRouter();
  const { t } = useT();
  const { workspaceId } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [schedule, setSchedule] = useState(initialSchedule);
  const [editingInstantly, setEditingInstantly] = useState(false);
  const [instantlyCampaignId, setInstantlyCampaignId] = useState(initialInstantlyCampaignId ?? "");

  async function saveName() {
    await createClient()
      .from("searches")
      .update({ name: name.trim() || null })
      .eq("id", searchId)
      .eq("workspace_id", workspaceId);
    setEditing(false);
    router.refresh();
  }

  async function saveInstantlyCampaignId() {
    await createClient()
      .from("searches")
      .update({ instantly_campaign_id: instantlyCampaignId.trim() || null })
      .eq("id", searchId)
      .eq("workspace_id", workspaceId);
    setEditingInstantly(false);
    router.refresh();
  }

  async function saveSchedule(value: string) {
    setSchedule(value);
    const days: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14 };
    const nextRun = days[value] ? new Date(Date.now() + days[value] * 86400000).toISOString() : null;
    await createClient()
      .from("searches")
      .update({ schedule: value, next_run_at: nextRun })
      .in("id", scheduleTargetIds)
      .eq("workspace_id", workspaceId);
    router.refresh();
  }

  /* Gleiche Hoehe wie in save-as-preset.tsx: die beiden Reihen stehen
     untereinander und wirkten sonst wie zwei verschiedene Leisten. */
  const feldCls =
    "h-9 rounded-lg border border-edge2 bg-field px-2.5 text-xs text-soft outline-none " +
    "transition-[border-color,box-shadow] duration-150 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15";

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {editing ? (
        <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
            autoFocus
            className="w-full min-w-0 rounded-lg border border-edge2 bg-field px-3 py-1.5 text-xl font-semibold tracking-tight text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15 sm:w-80"
          />
          <button
            onClick={saveName}
            className="shrink-0 rounded-md px-1.5 py-1.5 text-xs font-medium text-sky-600 transition-colors hover:text-sky-500 dark:text-sky-300 dark:hover:text-sky-200"
          >
            {t.searchSettings.save}
          </button>
        </span>
      ) : (
        <button
          onClick={() => setEditing(true)}
          title={t.searchSettings.renameTitle}
          className="group flex items-center gap-2 text-left"
        >
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{name}</h1>
          <span className="text-xs text-mute opacity-0 transition-opacity group-hover:opacity-100">
            {t.searchSettings.renameHint}
          </span>
        </button>
      )}
      <select
        value={schedule}
        onChange={(e) => saveSchedule(e.target.value)}
        className={feldCls}
        title={t.searchSettings.scheduleTooltip}
      >
        <option value="none">{t.searchSettings.scheduleNone}</option>
        <option value="daily">{t.searchSettings.scheduleDaily}</option>
        <option value="weekly">{t.searchSettings.scheduleWeekly}</option>
        <option value="biweekly">{t.searchSettings.scheduleBiweekly}</option>
      </select>

      {editingInstantly ? (
        <span className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-nowrap">
          <input
            value={instantlyCampaignId}
            onChange={(e) => setInstantlyCampaignId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveInstantlyCampaignId()}
            autoFocus
            placeholder={t.searchSettings.instantlyPlaceholder}
            className={feldCls + " w-full min-w-0 text-ink sm:w-56"}
          />
          <button
            onClick={saveInstantlyCampaignId}
            className="shrink-0 rounded-md px-1.5 py-1.5 text-xs font-medium text-sky-600 transition-colors hover:text-sky-500 dark:text-sky-300 dark:hover:text-sky-200"
          >
            {t.searchSettings.save}
          </button>
        </span>
      ) : (
        <button
          onClick={() => setEditingInstantly(true)}
          title={t.searchSettings.instantlyTooltip}
          className={
            "inline-flex h-9 items-center rounded-lg border px-2.5 text-xs font-medium transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] " +
            (initialInstantlyCampaignId
              ? "border-sky-500/30 bg-sky-500/10 text-sky-600 hover:border-sky-500/60 dark:text-sky-300"
              : "border-dashed border-edge3 text-faint hover:border-sky-500/60 hover:text-sky-600 dark:hover:text-sky-400")
          }
        >
          {initialInstantlyCampaignId ? t.searchSettings.instantlyLinked : t.searchSettings.instantlyLink}
        </button>
      )}
    </div>
  );
}
