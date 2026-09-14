import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import type { SearchListRow } from "@/lib/search-list";
import { parentByChild } from "@/lib/search-group";
import AutoRefresh from "../auto-refresh";
import SearchesList, { type Folder } from "./searches-list";
import { EmptyTrashButton, HardDeleteButton, RestoreButton } from "./search-actions";

export default async function SearchesPage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;
  const workspaceId = ws.workspace.id;

  const [{ data }, trashRes, instantlyStatsRes, failedJobsRes, foldersRes, groupLinksRes] = await Promise.all([
    supabase.rpc("search_overview", { p_workspace_id: workspaceId }),
    supabase
      .from("searches")
      .select("id, name, query, location, deleted_at")
      .eq("workspace_id", workspaceId)
      .not("deleted_at", "is", null)
      // Teilsuchen einer gebuendelten Mehrfach-Suche wandern mit ihrer Gruppe
      // in den Papierkorb (Migration 0096). Sie dort einzeln aufzufuehren
      // hiesse, aus einer geloeschten Liste einundsechzig Eintraege zu machen.
      .is("parent_search_id", null)
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
    supabase
      .from("search_folders")
      .select("id, name, color")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    // Nur die Teilsuchen: gebraucht, um den Fehlgrund eines Kind-Jobs an der
    // Gruppenzeile anzeigen zu koennen. Die Gruppe selbst hat keine Jobs.
    // status kommt mit, weil ein fehlgeschlagener Job NICHT heisst, dass die
    // Suche gescheitert ist -- siehe die Filterung weiter unten.
    supabase
      .from("searches")
      .select("id, parent_search_id, status")
      .eq("workspace_id", workspaceId)
      .not("parent_search_id", "is", null),
  ]);
  const searches = (data ?? []) as SearchListRow[];
  const folders = (foldersRes.data ?? []) as Folder[];
  const trash = trashRes.data ?? [];
  // Als einfache Objekte statt Map: alles zwischen Server- und
  // Client-Komponente muss durch die Serialisierung, und eine Map kommt
  // drueben als leeres Objekt an.
  const errorBySearch: Record<string, string> = {};
  // Ein fehlgeschlagener Job kennt nur die Teilsuche. Angezeigt wird aber die
  // Gruppe; ohne diese Umrechnung bliebe ihre Zeile kommentarlos rot.
  const elternVon = parentByChild(groupLinksRes.data ?? []);
  // EIN FEHLGESCHLAGENER JOB IST KEINE GESCHEITERTE SUCHE. Gemessen am
  // 2026-09-10: eine Maps-Gruppe aus drei Staedten stand mit 181 Firmen auf
  // "fertig", waehrend zwei ihrer get_businesses-Jobs auf 'failed' lagen --
  // sie hatten ihre Arbeit getan und waren erst danach an einem
  // Worker-Neustart gestorben (Rueckholung nach 15 Minuten, Migration 0047).
  // Die Zeile zeigte trotzdem den vollen roten Kasten mit "Worker hat den Job
  // nicht abgeschlossen", weil hier jeder failed-Job seines Workspace
  // angezeigt wurde, ohne den Zustand der Suche selbst anzusehen.
  // Deshalb: nur Suchen, die auch wirklich auf 'failed' stehen.
  const gescheiterteSuchen = new Set<string>([
    ...(groupLinksRes.data ?? [])
      .filter((r) => (r as { status?: string }).status === "failed")
      .map((r) => r.id as string),
    // Einzelsuchen ohne Gruppe: ihr Zustand steht in search_overview, dort
    // unveraendert der eigene (die Ableitung greift nur bei Huellen).
    ...((data ?? []) as SearchListRow[])
      .filter((s) => s.status === "failed" && !s.is_search_group)
      .map((s) => s.id),
  ]);
  for (const job of failedJobsRes.data ?? []) {
    const jobSearchId = (job.payload as { search_id?: string } | null)?.search_id;
    if (!jobSearchId || !gescheiterteSuchen.has(jobSearchId)) continue;
    const searchId = elternVon[jobSearchId] ?? jobSearchId;
    if (!errorBySearch[searchId]) errorBySearch[searchId] = job.last_error as string;
  }
  const statsBySearch = Object.fromEntries(
    (instantlyStatsRes.data ?? []).map((r) => [r.search_id as string, r])
  );
  const anyRunning = searches.some(
    (s) => s.status === "pending" || s.status === "running" || s.businesses_done < s.businesses
  );

  return (
    <div className="fade-up space-y-6">
      {anyRunning && <AutoRefresh />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.searches.title}</h1>
          <p className="text-sm text-faint">{t.searches.subtitle}</p>
        </div>
        {/* Zwei Wege zu einer Lead-Liste, gleichrangig nebeneinander: suchen
            oder mitbringen. Der Import stand vorher in den Einstellungen und
            landete dort nicht einmal in einer Liste. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/searches/import" className={secondaryBtnCls}>
            {t.importCsv.heading}
          </Link>
          <Link href="/" className={primaryBtnCls}>
            {t.searches.newSearch}
          </Link>
        </div>
      </div>

      <SearchesList
        searches={searches}
        folders={folders}
        statsBySearch={statsBySearch}
        errorBySearch={errorBySearch}
      />

      {trash.length > 0 && (
        <details className="overflow-hidden rounded-xl border border-edge/70 bg-panel shadow-sm">
          <summary className="cursor-pointer px-4 py-3.5 text-sm text-faint transition-colors hover:text-soft sm:px-5">
            {t.searches.trash} ({trash.length})
          </summary>
          {/* Sammelaktion oben, damit sie bei langem Papierkorb nicht erst
              hinter allen Eintraegen auftaucht. */}
          <div className="flex justify-end border-t border-edge/70 px-4 py-2.5 sm:px-5">
            <EmptyTrashButton searchIds={trash.map((tr) => tr.id)} />
          </div>
          {/* Umbrechend statt einzeilig: Name, Ort und zwei Knoepfe brauchen
              zusammen mehr als die 358 Pixel eines 390er Bildschirms. */}
          <div className="divide-y divide-edge/70 border-t border-edge/70">
            {trash.map((tr) => (
              <div key={tr.id} className="flex flex-wrap items-center gap-2 px-4 py-3 sm:flex-nowrap sm:gap-3 sm:px-5">
                <span className="min-w-0 flex-1 basis-full truncate text-sm text-soft sm:basis-auto">
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

