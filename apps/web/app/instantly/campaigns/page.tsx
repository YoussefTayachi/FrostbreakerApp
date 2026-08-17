"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { STATUS_BADGE_CLS } from "@/lib/ui";

type CampaignListItem = {
  id: string;
  name: string;
  status: string;
  mailboxes: string[];
  searches: { name: string | null; query: string; location: string } | null;
  /** Ueber ALLE verknuepften Suchen aufaddiert, siehe api/instantly/campaigns. */
  stats: {
    leads_count: number;
    contacted_count: number;
    emails_sent_count: number;
    open_count: number;
    reply_count_unique: number;
    bounced_count: number;
  } | null;
};

export default function InstantlyCampaignsPage() {
  const { t } = useT();
  const { push } = useToast();
  const C = t.instantly.campaigns;
  const [items, setItems] = useState<CampaignListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteCampaign(c: CampaignListItem) {
    if (!confirm(C.deleteConfirm(c.name))) return;
    setDeletingId(c.id);
    try {
      const res = await fetch(`/api/instantly/campaigns/${c.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        push(C.deleteError + (body.error ?? res.status), "error");
        return;
      }
      setItems((prev) => (prev ?? []).filter((x) => x.id !== c.id));
      push(C.deleted, "success");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    fetch("/api/instantly/campaigns")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(body.error ?? String(r.status));
          return;
        }
        setItems(body.items ?? []);
      })
      .catch(() => setError(C.loadError));
  }, [C.loadError]);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{C.title}</h1>
          <p className="text-sm text-faint">{C.description}</p>
        </div>
        {items !== null && (
          <Link
            href="/instantly/campaigns/new"
            className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-sky-600/25 transition-all hover:bg-sky-500"
          >
            {C.newButton}
          </Link>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-edge/60 bg-panel p-6">
          <p className="text-sm text-faint">
            {C.needsKeyBody}{" "}
            <Link href="/instantly/connection" className="font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400">
              {t.instantly.subnav.connection} →
            </Link>
          </p>
        </div>
      )}

      {!error && items === null && <p className="text-sm text-faint">{t.common.saving}</p>}
      {!error && items !== null && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-edge2 p-6 text-center">
          <p className="text-sm text-faint">{C.empty}</p>
        </div>
      )}

      {!error && items !== null && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-edge/60">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-left text-xs text-faint">
              <tr>
                <th className="px-4 py-3 font-medium">{C.columnName}</th>
                <th className="px-4 py-3 font-medium">{C.columnStatus}</th>
                <th className="w-52 px-4 py-3 font-medium">{C.columnProgress}</th>
                <th className="px-4 py-3 text-right font-medium">{C.columnLeads}</th>
                <th className="px-4 py-3 text-right font-medium">{C.columnContacted}</th>
                <th className="px-4 py-3 text-right font-medium">{C.columnReplies}</th>
                <th className="px-4 py-3 text-right font-medium">{C.columnBounced}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t border-edge/60">
                  {/* Name und Lead-Liste uebereinander statt in zwei Spalten:
                      die Liste ist Zusatzinformation zum Namen, keine eigene
                      Groesse — und spart die Breite fuer die Kennzahlen. */}
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{c.name}</p>
                    <p className="mt-0.5 text-xs text-faint">
                      {c.searches?.name || c.searches?.query || "–"}
                      {c.mailboxes.length > 0 && ` · ${C.mailboxCount(c.mailboxes.length)}`}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={"rounded-full border px-2 py-0.5 text-[11px] " + (STATUS_BADGE_CLS[c.status] ?? "")}>
                      {t.instantly.statusLabels[c.status as keyof typeof t.instantly.statusLabels] ?? c.status}
                    </span>
                  </td>
                  {/* Fortschritt wie bei Instantly: wie viel der Liste ist
                      durch. Die Zahl allein ("115 von 260") beantwortet das
                      auch, aber der Balken beantwortet es ohne Rechnen. */}
                  <td className="px-4 py-3">
                    {c.stats && c.stats.leads_count > 0 ? (
                      <>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-medium text-ink">
                            {Math.round((c.stats.contacted_count / c.stats.leads_count) * 100)}%
                          </span>
                          <span className="text-mute">
                            {c.stats.contacted_count} / {c.stats.leads_count}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-chip">
                          <div
                            className="h-full rounded-full bg-sky-500 transition-[width]"
                            style={{
                              width: `${Math.min(100, Math.round((c.stats.contacted_count / c.stats.leads_count) * 100))}%`,
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-mute">–</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-soft">
                    {c.stats?.leads_count ?? "–"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-soft">
                    {c.stats?.contacted_count ?? "–"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {/* Antworten hervorgehoben: das ist die einzige Zahl in
                        dieser Zeile, die tatsaechlich etwas wert ist. */}
                    <span className={c.stats?.reply_count_unique ? "font-medium text-sky-600 dark:text-sky-400" : "text-soft"}>
                      {c.stats?.reply_count_unique ?? "–"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={c.stats?.bounced_count ? "font-medium text-red-500" : "text-mute"}>
                      {c.stats?.bounced_count ?? "–"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="flex items-center justify-end gap-3">
                      <Link href={`/instantly/campaigns/${c.id}`} className="text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400">
                        {C.manage}
                      </Link>
                      <button
                        type="button"
                        disabled={deletingId === c.id}
                        onClick={() => deleteCampaign(c)}
                        className="text-xs font-medium text-faint transition-colors hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                      >
                        {C.delete}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
