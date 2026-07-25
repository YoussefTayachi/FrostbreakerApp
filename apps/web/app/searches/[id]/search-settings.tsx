"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../../language-provider";
import { useWorkspace } from "../../workspace-provider";

export default function SearchSettings({
  searchId,
  initialName,
  initialSchedule,
  initialInstantlyCampaignId,
}: {
  searchId: string;
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
      .eq("id", searchId)
      .eq("workspace_id", workspaceId);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {editing ? (
        <span className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
            autoFocus
            className="rounded-lg border border-edge2 bg-field px-3 py-1.5 text-lg font-semibold text-ink outline-none focus:border-sky-500"
          />
          <button onClick={saveName} className="text-xs text-sky-600 dark:text-sky-300 hover:text-sky-500 dark:hover:text-sky-200">
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
        className="rounded-lg border border-edge2 bg-field px-2.5 py-1.5 text-xs text-soft outline-none focus:border-sky-500"
        title={t.searchSettings.scheduleTooltip}
      >
        <option value="none">{t.searchSettings.scheduleNone}</option>
        <option value="daily">{t.searchSettings.scheduleDaily}</option>
        <option value="weekly">{t.searchSettings.scheduleWeekly}</option>
        <option value="biweekly">{t.searchSettings.scheduleBiweekly}</option>
      </select>

      {editingInstantly ? (
        <span className="flex items-center gap-1.5">
          <input
            value={instantlyCampaignId}
            onChange={(e) => setInstantlyCampaignId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveInstantlyCampaignId()}
            autoFocus
            placeholder={t.searchSettings.instantlyPlaceholder}
            className="w-56 rounded-lg border border-edge2 bg-field px-2.5 py-1.5 text-xs text-ink outline-none focus:border-sky-500"
          />
          <button onClick={saveInstantlyCampaignId} className="text-xs text-sky-600 dark:text-sky-300 hover:text-sky-500 dark:hover:text-sky-200">
            {t.searchSettings.save}
          </button>
        </span>
      ) : (
        <button
          onClick={() => setEditingInstantly(true)}
          title={t.searchSettings.instantlyTooltip}
          className={
            "rounded-lg border px-2.5 py-1.5 text-xs transition-colors " +
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
