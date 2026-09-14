"use client";
import Link from "next/link";
import { formatMoney } from "@/lib/crm/deals";
import { useT } from "../language-provider";

export type PipelineStats = {
  deals_open: number;
  value_open: number;
  value_weighted: number;
  deals_won_30d: number;
  value_won_30d: number;
  deals_lost_30d: number;
  by_stage: Record<string, { count: number; value: number }>;
  activities_due: number;
  activities_overdue: number;
};

/**
 * Forecast- und Aufgabenkacheln fuers Dashboard, gefuettert von der RPC
 * crm_pipeline_stats (Migration 0035).
 *
 * Blendet sich komplett aus, solange es weder Deals noch faellige Aufgaben gibt:
 * ein Dashboard voller Nullen hilft niemandem, und Deals sind ein Feature, das
 * Nutzer erst ab einer gewissen Pipeline-Groesse anfassen.
 */
export default function ForecastCards({
  stats,
  currency = "EUR",
}: {
  stats: PipelineStats | null;
  currency?: string;
}) {
  const { t, lang } = useT();
  const D = t.dashboard;

  if (!stats) return null;
  const hasDeals = stats.deals_open > 0 || stats.deals_won_30d > 0 || stats.deals_lost_30d > 0;
  const hasTasks = stats.activities_due > 0;
  if (!hasDeals && !hasTasks) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-edge/70 bg-panel p-4 shadow-sm">
        <p className="text-2xs font-medium uppercase tracking-wider text-mute">{D.forecastOpen}</p>
        <p className="mt-0.5 text-xl font-semibold tabular text-ink">
          {formatMoney(Number(stats.value_open) || 0, currency, lang)}
        </p>
        <p className="text-2xs text-faint">
          {stats.deals_open} {D.forecastOpenDeals}
        </p>
      </div>

      <div className="rounded-xl border border-edge/70 bg-panel p-4 shadow-sm">
        <p className="text-2xs font-medium uppercase tracking-wider text-mute">{D.forecastWeighted}</p>
        <p className="mt-0.5 text-xl font-semibold tabular text-sky-600 dark:text-sky-400">
          {formatMoney(Number(stats.value_weighted) || 0, currency, lang)}
        </p>
        <p className="text-2xs text-faint">{D.forecastWeightedHint}</p>
      </div>

      <div className="rounded-xl border border-edge/70 bg-panel p-4 shadow-sm">
        <p className="text-2xs font-medium uppercase tracking-wider text-mute">{D.forecastWon}</p>
        <p className="mt-0.5 text-xl font-semibold tabular text-emerald-600 dark:text-emerald-400">
          {formatMoney(Number(stats.value_won_30d) || 0, currency, lang)}
        </p>
        <p className="text-2xs text-faint">
          {stats.deals_won_30d} {D.forecastWonDeals} · {stats.deals_lost_30d} {D.forecastLostDeals}
        </p>
      </div>

      <Link
        href="/calls"
        className={
          "rounded-xl border bg-panel p-4 shadow-sm transition-[border-color,box-shadow] duration-150 hover:shadow-md " +
          (stats.activities_overdue > 0
            ? "border-red-500/40 hover:border-red-500/60"
            : "border-edge/70 hover:border-edge2")
        }
      >
        <p className="text-2xs font-medium uppercase tracking-wider text-mute">{D.tasksDue}</p>
        <p
          className={
            "mt-0.5 text-xl font-semibold tabular " +
            (stats.activities_overdue > 0 ? "text-red-600 dark:text-red-400" : "text-ink")
          }
        >
          {stats.activities_due}
        </p>
        <p className="text-2xs text-faint">
          {stats.activities_overdue > 0 ? `${stats.activities_overdue} ${D.tasksOverdue}` : D.tasksAllOnTime}
        </p>
      </Link>
    </div>
  );
}
