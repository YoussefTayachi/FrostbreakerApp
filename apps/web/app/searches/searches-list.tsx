"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { searchSourceBadgeClass, searchSourceLabel } from "@/lib/search-source";
import { matchesSearchFilter, type SearchListRow } from "@/lib/search-list";
import { groupScopeFilter } from "@/lib/search-group";
import LocalTime from "../local-time";
import { formatDate } from "@/lib/format-time";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import { useLang } from "../language-provider";
import { CancelButton, TrashButton } from "./search-actions";

/**
 * Die Suchliste mit Ordnern, Archiv und Mehrfachauswahl.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ES DAS GIBT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ein Kunde am 2026-08-10 wollte aufraeumen und griff zum Loeschen -- und
 * merkte dann, dass die Listen danach fuer LinkedIn und Instantly weg sind.
 * Was er nicht sehen konnte: eine geloeschte Suche nimmt auch ihre Firmen aus
 * dem Dublettenschutz, jede unkontaktierte davon ist danach wieder einkaufbar
 * (siehe Migration 0089). Aufraeumen kostete Geld.
 *
 * Deshalb drei Dinge, die es vorher nicht gab: archivieren statt loeschen,
 * Ordner fuer viele Listen, und eine Filterleiste -- bei dreissig Listen ist
 * die Textsuche mehr wert als jede Struktur.
 *
 * Client-Komponente, weil Filtern und Umsortieren ohne Serverrunde laufen
 * sollen. Die Zeilen kommen fertig vom Server (search_overview), hier wird
 * nur noch ausgewaehlt.
 */

export type Folder = { id: string; name: string; color: string | null };

type InstantlyStat = {
  emails_sent_count: number;
  bounced_count: number;
  reply_count_unique: number;
};

const ALLE = "__alle__";
const OHNE_ORDNER = "__ohne__";

export default function SearchesList({
  searches,
  folders,
  statsBySearch,
  errorBySearch,
}: {
  searches: SearchListRow[];
  folders: Folder[];
  statsBySearch: Record<string, InstantlyStat>;
  errorBySearch: Record<string, string>;
}) {
  const router = useRouter();
  const { t } = useT();
  const { lang } = useLang();
  const S = t.searches;
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [q, setQ] = useState("");
  const [quelle, setQuelle] = useState("");
  const [status, setStatus] = useState("");
  const [ordner, setOrdner] = useState(ALLE);
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const sichtbar = useMemo(
    () => searches.filter((s) => matchesSearchFilter(s, { q, quelle, status, ordner })),
    [searches, q, quelle, status, ordner]
  );
  const aktiv = sichtbar.filter((s) => !s.archived_at);
  const archiviert = sichtbar.filter((s) => s.archived_at);

  function toggle(id: string) {
    setGewaehlt((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Eine Aenderung auf die ausgewaehlten Listen -- und auf ihre Teilsuchen.
   *
   * groupScopeFilter statt .in("id", ids): eine gebuendelte Mehrfach-Suche ist
   * eine Zeile in der Anzeige, aber n+1 Zeilen in der Datenbank (Migration
   * 0096). Ohne die Kinder wuerde Archivieren das Abo der Gruppe nur scheinbar
   * anhalten und der Papierkorb sechzig weiterlaufende Teilsuchen zuruecklassen.
   */
  async function aktualisieren(ids: string[], patch: Record<string, unknown>, meldung: string) {
    if (ids.length === 0) return;
    setBusy(true);
    const { error } = await createClient()
      .from("searches")
      .update(patch)
      .or(groupScopeFilter(ids))
      .eq("workspace_id", workspaceId);
    setBusy(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setGewaehlt(new Set());
    router.refresh();
    push(meldung, "success");
  }

  /**
   * Archivieren haelt das Abo an.
   *
   * Eine Liste, die man aus den Augen haben will und die nachts weiter
   * Credits verbraucht, waere die unangenehmste Ueberraschung dieser
   * Funktion. Anders als beim Loeschen steht das hier aber in der Meldung --
   * und beim Zurueckholen sagt die Zeile, dass das Abo aus ist.
   */
  const archivieren = (ids: string[]) =>
    aktualisieren(
      ids,
      { archived_at: new Date().toISOString(), schedule: "none" },
      S.archivedToast(ids.length)
    );

  const zurueckholen = (ids: string[]) =>
    aktualisieren(ids, { archived_at: null }, S.unarchivedToast(ids.length));

  /**
   * Mehrere Listen in einem Zug in den Papierkorb.
   *
   * Auswaehlen konnte man hier schon immer, loeschen nur einzeln ueber den
   * Knopf in der Zeile -- bei zwoelf Listen also zwoelf Klicks und zwoelf
   * Rueckfragen. Gemeldet am 2026-08-14.
   *
   * Dieselbe Wirkung wie TrashButton (search-actions.tsx), inklusive
   * schedule: "none": eine Abo-Suche im Papierkorb wuerde sonst nachts
   * weiterlaufen und Credits verbrauchen. Die Rueckfrage nennt die Anzahl --
   * der Unterschied zwischen 2 und 40 Listen sollte vor dem Klick klar sein.
   */
  async function loeschen(ids: string[]) {
    if (ids.length === 0) return;
    if (!confirm(S.deleteConfirm(ids.length))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("searches")
      .update({ deleted_at: new Date().toISOString(), schedule: "none" })
      // Teilsuchen mit, siehe aktualisieren().
      .or(groupScopeFilter(ids))
      .eq("workspace_id", workspaceId);
    setBusy(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setGewaehlt(new Set());
    router.refresh();
    // Ruecknahme wie beim Einzelknopf. schedule bleibt dabei bewusst auf
    // "none": ein Abo muss nach dem Zurueckholen neu gesetzt werden.
    push(S.deletedToast(ids.length), "success", {
      label: t.searchActions.undo,
      onClick: async () => {
        await createClient()
          .from("searches")
          .update({ deleted_at: null })
          .or(groupScopeFilter(ids))
          .eq("workspace_id", workspaceId);
        router.refresh();
        push(S.restoredToast(ids.length), "success");
      },
    });
  }

  const verschieben = (ids: string[], folderId: string | null) =>
    aktualisieren(ids, { folder_id: folderId }, S.movedToast(ids.length));

  async function ordnerAnlegen() {
    const name = prompt(S.folderNamePrompt)?.trim();
    if (!name) return;
    const { error } = await createClient()
      .from("search_folders")
      .insert({ workspace_id: workspaceId, name });
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    router.refresh();
    push(S.folderCreated(name), "success");
  }

  async function ordnerUmbenennen(f: Folder) {
    const name = prompt(S.folderRenamePrompt, f.name)?.trim();
    if (!name || name === f.name) return;
    const { error } = await createClient()
      .from("search_folders")
      .update({ name })
      .eq("id", f.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    router.refresh();
  }

  async function ordnerLoeschen(f: Folder) {
    const drin = searches.filter((s) => s.folder_id === f.id).length;
    if (!confirm(S.folderDeleteConfirm(f.name, drin))) return;
    const { error } = await createClient()
      .from("search_folders")
      .delete()
      .eq("id", f.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setOrdner(ALLE);
    router.refresh();
    push(S.folderDeleted(f.name), "success");
  }

  const eingabeCls =
    "rounded-lg border border-edge2 bg-field px-2.5 py-1.5 text-xs text-ink outline-none focus:border-sky-500";
  const reiterCls = (an: boolean) =>
    "rounded-lg border px-2.5 py-1 text-xs transition-colors " +
    (an
      ? "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300"
      : "border-edge2 text-faint hover:border-edge3 hover:text-ink");

  return (
    <div className="space-y-4">
      {/* Filterleiste. Bei dreissig Listen beantwortet die Textsuche die
          haeufigste Frage ("wo war nochmal die niederlaendische") schneller
          als jede Ordnerstruktur. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={S.filterPlaceholder}
          className={eingabeCls + " w-56"}
        />
        <select value={quelle} onChange={(e) => setQuelle(e.target.value)} className={eingabeCls}>
          <option value="">{S.filterAllSources}</option>
          {["apollo", "prospeo", "maps", "corporate", "csv"].map((src) => (
            <option key={src} value={src}>
              {searchSourceLabel(src)}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={eingabeCls}>
          <option value="">{S.filterAllStatuses}</option>
          <option value="running">{S.searchingBusinesses}</option>
          <option value="completed">{S.done}</option>
          <option value="failed">{S.failed}</option>
        </select>
        {(q || quelle || status) && (
          <button
            onClick={() => {
              setQ("");
              setQuelle("");
              setStatus("");
            }}
            className="text-xs text-faint underline underline-offset-2 hover:text-ink"
          >
            {S.filterReset}
          </button>
        )}
        <span className="ml-auto text-xs text-mute">
          {S.countShown(aktiv.length, searches.filter((s) => !s.archived_at).length)}
        </span>
      </div>

      {/* Ordner-Reiter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setOrdner(ALLE)} className={reiterCls(ordner === ALLE)}>
          {S.folderAll}
        </button>
        <button onClick={() => setOrdner(OHNE_ORDNER)} className={reiterCls(ordner === OHNE_ORDNER)}>
          {S.folderNone}
        </button>
        {folders.map((f) => (
          <span key={f.id} className="group relative inline-flex items-center">
            <button onClick={() => setOrdner(f.id)} className={reiterCls(ordner === f.id)}>
              {f.name}
              <span className="ml-1 text-mute">
                {searches.filter((s) => s.folder_id === f.id && !s.archived_at).length}
              </span>
            </button>
            {/* Umbenennen und Loeschen nur am gerade offenen Ordner: sonst
                stehen bei zehn Ordnern zwanzig Miniaturknoepfe in der Zeile. */}
            {ordner === f.id && (
              <>
                <button
                  onClick={() => void ordnerUmbenennen(f)}
                  title={S.folderRename}
                  className="ml-1 text-[11px] text-faint hover:text-ink"
                >
                  ✎
                </button>
                <button
                  onClick={() => void ordnerLoeschen(f)}
                  title={S.folderDelete}
                  className="ml-1 text-[11px] text-faint hover:text-red-500"
                >
                  ✕
                </button>
              </>
            )}
          </span>
        ))}
        <button
          onClick={() => void ordnerAnlegen()}
          className="rounded-lg border border-dashed border-edge2 px-2.5 py-1 text-xs text-faint transition-colors hover:border-edge3 hover:text-ink"
        >
          {S.folderNew}
        </button>
      </div>

      {/* Sammelaktionen. Erscheinen erst mit der Auswahl -- eine Leiste, die
          immer da ist und meistens nichts tut, kostet nur Platz. */}
      {gewaehlt.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/5 px-3 py-2">
          <span className="text-xs font-medium text-ink">{S.selectedCount(gewaehlt.size)}</span>
          <select
            value=""
            disabled={busy}
            onChange={(e) => {
              const wert = e.target.value;
              if (!wert) return;
              void verschieben([...gewaehlt], wert === OHNE_ORDNER ? null : wert);
            }}
            className={eingabeCls}
          >
            <option value="">{S.moveTo}</option>
            <option value={OHNE_ORDNER}>{S.folderNone}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            onClick={() => void archivieren([...gewaehlt])}
            className="rounded-lg border border-edge2 px-2.5 py-1 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink disabled:opacity-60"
          >
            {S.archive}
          </button>
          {/* Loeschen steht rechts und als einziges in Rot: es ist die
              einzige Aktion hier, die Leads aus Kampagnen und dem
              Dublettenschutz nimmt. */}
          <button
            disabled={busy}
            onClick={() => void loeschen([...gewaehlt])}
            title={t.searchActions.trashTitle}
            className="rounded-lg border border-red-300 px-2.5 py-1 text-xs text-red-600 transition-colors hover:border-red-500 hover:text-red-500 disabled:opacity-60 dark:border-red-900/60 dark:text-red-400 dark:hover:text-red-500"
          >
            {t.searchActions.delete}
          </button>
          <button
            onClick={() => setGewaehlt(new Set())}
            className="text-xs text-faint underline underline-offset-2 hover:text-ink"
          >
            {S.clearSelection}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {aktiv.map((s, idx) => (
          <SearchRow
            key={s.id}
            s={s}
            idx={idx}
            lang={lang}
            folders={folders}
            stat={statsBySearch[s.id]}
            error={errorBySearch[s.id]}
            gewaehlt={gewaehlt.has(s.id)}
            onToggle={() => toggle(s.id)}
            onArchive={() => void archivieren([s.id])}
            onMove={(folderId) => void verschieben([s.id], folderId)}
          />
        ))}
        {aktiv.length === 0 && (
          <div className="rounded-lg border border-edge/60 bg-panel p-10 text-center text-faint">
            {searches.length === 0 ? S.emptyState : S.noMatches}
          </div>
        )}
      </div>

      {archiviert.length > 0 && (
        <details className="rounded-lg border border-edge/60 bg-panel">
          <summary className="cursor-pointer px-5 py-3 text-sm text-faint hover:text-soft">
            {S.archiveSection} ({archiviert.length})
          </summary>
          <p className="border-t border-edge/60 px-5 py-2 text-xs text-mute">{S.archiveHint}</p>
          <div className="divide-y divide-edge/60 border-t border-edge/60">
            {archiviert.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                <Link
                  href={"/searches/" + s.id}
                  className="min-w-0 flex-1 truncate text-sm text-soft hover:text-ink"
                >
                  {s.name}
                  <span className="ml-2 text-xs text-mute">{s.location}</span>
                </Link>
                <span className="text-xs text-mute">
                  {s.contacts} {S.metricContacts}
                </span>
                <button
                  disabled={busy}
                  onClick={() => void zurueckholen([s.id])}
                  className="rounded-lg border border-edge2 px-2.5 py-1 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink disabled:opacity-60"
                >
                  {S.unarchive}
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function SearchRow({
  s,
  idx,
  lang,
  folders,
  stat,
  error,
  gewaehlt,
  onToggle,
  onArchive,
  onMove,
}: {
  s: SearchListRow;
  idx: number;
  lang: "de" | "en";
  folders: Folder[];
  stat?: InstantlyStat;
  error?: string;
  gewaehlt: boolean;
  onToggle: () => void;
  onArchive: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const { t } = useT();
  const S = t.searches;
  const progress = s.businesses > 0 ? Math.round((s.businesses_done / s.businesses) * 100) : 0;
  const enriching = s.status === "completed" && s.businesses_done < s.businesses;
  const bounceRate =
    stat && stat.emails_sent_count > 0 ? (stat.bounced_count / stat.emails_sent_count) * 100 : null;
  const folder = folders.find((f) => f.id === s.folder_id);
  /** Gruppe, bei der einzelne Teilsuchen ausgefallen sind -- der Rest der
   *  Liste ist vollstaendig und soll nicht wie ein Totalausfall aussehen. */
  const teilausfall = s.is_search_group && s.children_failed > 0 && s.status !== "failed";

  // Die ganze Zeile bleibt ein Link auf die Liste -- das ist der Weg, den
  // jemand neunmal von zehn geht. Alles, was daneben klickbar ist, muss den
  // Klick deshalb ausdruecklich anhalten.
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <Link
      href={"/searches/" + s.id}
      className={
        "fade-up block rounded-lg border bg-panel p-5 transition-all duration-300 hover:shadow-sm " +
        (gewaehlt ? "border-sky-500/60" : "border-edge/60 hover:border-edge2")
      }
      style={{ animationDelay: idx * 50 + "ms" }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <input
          type="checkbox"
          checked={gewaehlt}
          onClick={stop}
          onChange={onToggle}
          aria-label={S.selectRow}
          className="h-3.5 w-3.5 shrink-0 accent-sky-600"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="truncate font-medium text-ink">{s.name}</span>
            <span
              className={"rounded-full border px-2 py-0.5 text-[11px] " + searchSourceBadgeClass(s.source)}
            >
              {searchSourceLabel(s.source)}
            </span>
            {folder && (
              <span className="rounded-full border border-edge2 bg-chip px-2 py-0.5 text-[11px] text-soft">
                {folder.name}
              </span>
            )}
            {/* Gebuendelte Mehrfach-Suche: eine Zeile, die fuer n Teilsuchen
                steht. Ohne diesen Hinweis waere nicht erklaerbar, warum eine
                einzelne "Suche" Leads aus fuenfzehn Staedten enthaelt --
                sichtbar bleiben soll die Buendelung, nur eben nicht als
                sechzig Eintraege. */}
            {s.is_search_group && s.child_count > 0 && (
              <span
                title={S.groupProgress(s.children_done, s.child_count)}
                className="rounded-full border border-edge2 bg-chip px-2 py-0.5 text-[11px] text-soft"
              >
                {S.groupBadge(s.child_count)}
              </span>
            )}
            {s.schedule !== "none" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-600 dark:text-sky-300">
                {S.subscriptionPrefix} ·{" "}
                {s.schedule === "weekly"
                  ? S.subscriptionWeekly
                  : s.schedule === "biweekly"
                    ? S.subscriptionBiweekly
                    : S.subscriptionDaily}
              </span>
            )}
            {bounceRate !== null && (
              <span
                title={S.instantlyBadgeTitle}
                className={
                  "rounded-full border px-2 py-0.5 text-[11px] " +
                  (bounceRate > 3
                    ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                    : "border-edge2 bg-chip text-soft")
                }
              >
                {S.instantlyBadge(stat!.emails_sent_count, bounceRate)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-faint">
            {s.location} ·{" "}
            <LocalTime
              iso={s.created_at}
              lang={lang}
              serverFormatted={formatDate(s.created_at, lang)}
            />
          </p>
        </div>
        <Metric value={s.businesses} label={S.metricBusinesses} />
        <Metric value={s.contacts} label={S.metricContacts} />
        <Metric
          value={s.target_email_count ? `${s.with_email}/${s.target_email_count}` : s.with_email}
          label={S.metricWithEmail}
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
              {S.failed}
            </span>
          ) : s.status === "cancelled" ? (
            <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-500">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {S.cancelled}
            </span>
          ) : s.status !== "completed" ? (
            // Bei einer Gruppe sagt "Firmen werden gesucht" allein nichts: das
            // steht bei sechzig Teilsuchen unter Umstaenden eine Stunde lang
            // da. Der Balken zaehlt die fertigen Teilsuchen -- die einzige
            // Zahl, die sich hier sichtbar bewegt.
            s.is_search_group && s.child_count > 0 ? (
              <div title={S.groupProgress(s.children_done, s.child_count)}>
                <div className="mb-1 flex justify-between text-[11px] text-faint">
                  <span>{S.searchingBusinesses}</span>
                  <span>
                    {s.children_done}/{s.child_count}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-chip">
                  <div
                    className="h-full rounded-full bg-blue-400 transition-all"
                    style={{ width: Math.round((s.children_done / s.child_count) * 100) + "%" }}
                  />
                </div>
              </div>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                {S.searchingBusinesses}
              </span>
            )
          ) : enriching ? (
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-faint">
                <span>{S.enriching}</span>
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
              {S.done}
            </span>
          )}
        </div>
        <select
          value={s.folder_id ?? ""}
          onClick={stop}
          onChange={(e) => {
            onMove(e.target.value || null);
          }}
          title={S.moveTo}
          className="max-w-28 rounded-lg border border-edge2 bg-field px-1.5 py-1 text-[11px] text-soft outline-none focus:border-sky-500"
        >
          <option value="">{S.folderNone}</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {(s.status === "pending" || s.status === "running") && <CancelButton searchId={s.id} />}
        <button
          onClick={(e) => {
            stop(e);
            onArchive();
          }}
          title={S.archiveTitle}
          className="rounded-lg border border-edge2 px-2 py-1 text-[11px] text-soft transition-colors hover:border-edge3 hover:text-ink"
        >
          {S.archive}
        </button>
        <TrashButton searchId={s.id} />
      </div>
      {/* Ausgefallene Teilsuchen als Zahl, nicht als roter Kasten: bei sechzig
          Kombinationen ist eine Stadt ohne Treffer der Normalfall, und der
          Grund der einen gilt fuer die anderen neunundfuenfzig nicht
          (Migration 0096). Deshalb steht die Gruppe auch nur dann auf
          "fehlgeschlagen", wenn ALLE Teilsuchen gescheitert sind. Der Grund
          aus jobs.last_error haengt hinten dran -- er stammt von einer der
          ausgefallenen Teilsuchen und erklaert in der Regel alle. */}
      {teilausfall ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {S.groupFailed(s.children_failed, s.child_count)}
          {error && (
            <>
              {" "}
              <span className="font-medium">{S.failureReason}</span> {error}
            </>
          )}
        </p>
      ) : (
        error && (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            <span className="font-medium">{S.failureReason}</span> {error}
          </p>
        )
      )}
      {s.note && !error && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-medium">{S.noResultReason}</span> {s.note}
        </p>
      )}
    </Link>
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
