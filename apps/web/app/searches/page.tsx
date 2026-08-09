import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer, formatDate } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { searchSourceBadgeClass, searchSourceLabel } from "@/lib/search-source";
import AutoRefresh from "../auto-refresh";
import {
  CancelButton,
  EmptyTrashButton,
  HardDeleteButton,
  RestoreButton,
  TrashButton,
} from "./search-actions";

type SearchRow = {
  id: string;
  name: string;
  query: string;
  schedule: string;
  location: string;
  source: string;
  status: string;
  error: string | null;
  /** Durchgelaufen, aber es gibt etwas zu sagen -- typisch: null Treffer samt
   *  Grund. Kein Fehlschlag, deshalb getrennt von error (siehe 0053). */
  note: string | null;
  max_results: number;
  target_email_count: number | null;
  created_at: string;
  businesses: number;
  businesses_done: number;
  contacts: number;
  with_email: number;
};

export default async function SearchesPage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;
  const workspaceId = ws.workspace.id;

  const [{ data }, trashRes, instantlyStatsRes, failedJobsRes] = await Promise.all([
    supabase.rpc("search_overview", { p_workspace_id: workspaceId }),
    supabase
      .from("searches")
      .select("id, name, query, location, deleted_at")
      .eq("workspace_id", workspaceId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }),
    supabase
      .from("instantly_campaign_stats")
      .select("search_id, emails_sent_count, bounced_count, reply_count_unique")
      .eq("workspace_id", workspaceId),
    // "Fehlgeschlagen" stand bisher ohne Begruendung da. Der Grund liegt in
    // jobs.last_error; die Zuordnung laeuft ueber payload->>search_id, weil
    // jobs keine eigene search_id-Spalte hat.
    supabase
      .from("jobs")
      .select("payload, last_error, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "failed")
      .not("last_error", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const searches = (data ?? []) as SearchRow[];
  const trash = trashRes.data ?? [];
  const errorBySearch = new Map<string, string>();
  for (const job of failedJobsRes.data ?? []) {
    const searchId = (job.payload as { search_id?: string } | null)?.search_id;
    if (searchId && !errorBySearch.has(searchId)) errorBySearch.set(searchId, job.last_error as string);
  }
  const instantlyBySearch = new Map(
    (instantlyStatsRes.data ?? []).map((r) => [r.search_id, r])
  );
  const anyRunning = searches.some(
    (s) => s.status === "pending" || s.status === "running" || s.businesses_done < s.businesses
  );

  return (
    <div className="fade-up space-y-6">
      {anyRunning && <AutoRefresh />}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.searches.title}</h1>
          <p className="text-sm text-faint">{t.searches.subtitle}</p>
        </div>
        {/* Zwei Wege zu einer Lead-Liste, gleichrangig nebeneinander: suchen
            oder mitbringen. Der Import stand vorher in den Einstellungen und
            landete dort nicht einmal in einer Liste. */}
        <div className="flex items-center gap-2">
          <Link
            href="/searches/import"
            className="rounded-lg border border-edge2 px-4 py-2.5 text-sm font-medium text-soft transition-colors hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400"
          >
            {t.importCsv.heading}
          </Link>
          <Link
            href="/"
            className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-surface shadow-sm transition-all hover:opacity-85 active:scale-[0.98]"
          >
            {t.searches.newSearch}
          </Link>
        </div>
      </div>

      <div className="space-y-3">
        {searches.map((s, idx) => {
          const progress =
            s.businesses > 0 ? Math.round((s.businesses_done / s.businesses) * 100) : 0;
          const enriching = s.status === "completed" && s.businesses_done < s.businesses;
          const instantlyStats = instantlyBySearch.get(s.id);
          const bounceRate = instantlyStats && instantlyStats.emails_sent_count > 0
            ? (instantlyStats.bounced_count / instantlyStats.emails_sent_count) * 100
            : null;
          return (
            <Link
              key={s.id}
              href={"/searches/" + s.id}
              className="fade-up block rounded-lg border border-edge/60 bg-panel p-5 transition-all duration-300 hover:border-edge2 hover:shadow-sm"
              style={{ animationDelay: idx * 50 + "ms" }}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="truncate font-medium text-ink">{s.name}</span>
                    <span
                      className={
                        "rounded-full border px-2 py-0.5 text-[11px] " +
                        searchSourceBadgeClass(s.source)
                      }
                    >
                      {searchSourceLabel(s.source)}
                    </span>
                    {s.schedule !== "none" && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-600 dark:text-sky-300">
                        {t.searches.subscriptionPrefix} ·{" "}
                        {s.schedule === "weekly"
                          ? t.searches.subscriptionWeekly
                          : s.schedule === "biweekly"
                            ? t.searches.subscriptionBiweekly
                            : t.searches.subscriptionDaily}
                        <span
                          title={t.searches.subscriptionHelp}
                          aria-label={t.searches.subscriptionHelp}
                          className="flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-sky-500/40 text-[9px] font-bold"
                        >
                          ?
                        </span>
                      </span>
                    )}
                    {bounceRate !== null && (
                      <span
                        title={t.searches.instantlyBadgeTitle}
                        className={
                          "rounded-full border px-2 py-0.5 text-[11px] " +
                          (bounceRate > 3
                            ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                            : "border-edge2 bg-chip text-soft")
                        }
                      >
                        {t.searches.instantlyBadge(instantlyStats!.emails_sent_count, bounceRate)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-faint">
                    {s.location} · {formatDate(s.created_at, lang)}
                  </p>
                </div>
                <Metric value={s.businesses} label={t.searches.metricBusinesses} />
                <Metric value={s.contacts} label={t.searches.metricContacts} />
                <Metric
                  value={s.target_email_count ? `${s.with_email}/${s.target_email_count}` : s.with_email}
                  label={t.searches.metricWithEmail}
                />
                <div className="w-32">
                  {s.status === "failed" ? (
                    <span
                      className={
                        "text-xs text-red-600 dark:text-red-400" +
                        (s.error ? " underline decoration-dotted underline-offset-2" : "")
                      }
                      title={s.error ?? undefined}
                    >
                      {t.searches.failed}
                    </span>
                  ) : s.status === "cancelled" ? (
                    // Muss VOR dem !== "completed"-Zweig stehen, sonst zeigt
                    // eine abgebrochene Suche fuer immer "wird gesucht" an.
                    <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      {t.searches.cancelled}
                    </span>
                  ) : s.status !== "completed" ? (
                    <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-300">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                      {t.searches.searchingBusinesses}
                    </span>
                  ) : enriching ? (
                    <div>
                      <div className="mb-1 flex justify-between text-[11px] text-faint">
                        <span>{t.searches.enriching}</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-chip">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-sky-500 to-sky-500 transition-all"
                          style={{ width: progress + "%" }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {t.searches.done}
                    </span>
                  )}
                </div>
                {/* Nur solange etwas laeuft -- danach gibt es nichts mehr
                    abzubrechen, und ein Knopf, der immer nur "zu spaet"
                    meldet, ist eine Falle. */}
                {(s.status === "pending" || s.status === "running") && (
                  <CancelButton searchId={s.id} />
                )}
                <TrashButton searchId={s.id} />
              </div>
              {errorBySearch.has(s.id) && (
                <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <span className="font-medium">{t.searches.failureReason}</span>{" "}
                  {errorBySearch.get(s.id)}
                </p>
              )}
              {/* Bernstein statt rot: die Suche ist nicht fehlgeschlagen, sie
                  hat nur nichts gefunden. Nur zeigen, wenn nicht ohnehin schon
                  ein echter Fehler dasteht -- zwei Kaesten uebereinander
                  waeren mehr Laerm als Auskunft. */}
              {s.note && !errorBySearch.has(s.id) && (
                <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <span className="font-medium">{t.searches.noResultReason}</span> {s.note}
                </p>
              )}
            </Link>
          );
        })}
        {searches.length === 0 && (
          <div className="rounded-lg border border-edge/60 bg-panel p-10 text-center text-faint">
            {t.searches.emptyState}
          </div>
        )}
      </div>

      {trash.length > 0 && (
        <details className="rounded-lg border border-edge/60 bg-panel">
          <summary className="cursor-pointer px-5 py-3 text-sm text-faint hover:text-soft">
            {t.searches.trash} ({trash.length})
          </summary>
          {/* Sammelaktion oben, damit sie bei langem Papierkorb nicht erst
              hinter allen Eintraegen auftaucht. */}
          <div className="flex justify-end border-t border-edge/60 px-5 py-2.5">
            <EmptyTrashButton searchIds={trash.map((tr) => tr.id)} />
          </div>
          <div className="divide-y divide-edge/60 border-t border-edge/60">
            {trash.map((tr) => (
              <div key={tr.id} className="flex items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1 truncate text-sm text-soft">
                  {tr.name ?? tr.query}
                  <span className="ml-2 text-xs text-mute">{tr.location}</span>
                </span>
                <RestoreButton searchId={tr.id} />
                <HardDeleteButton searchId={tr.id} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="w-20 text-center">
      <p className="text-lg font-semibold text-ink">{value}</p>
      <p className="text-[11px] text-faint">{label}</p>
    </div>
  );
}
