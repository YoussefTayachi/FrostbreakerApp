"use client";
import { useEffect, useMemo, useState } from "react";
import {
  LEAD_FILTERS,
  countLeads,
  hasProblem,
  isContacted,
  matchesFilter,
  sortLeads,
  type CampaignLead,
  type LeadFilter,
} from "@/lib/instantly/campaign-leads";
import { formatRelative } from "@/lib/format-time";
import { useT } from "../../../language-provider";

/**
 * Wer aus dieser Kampagne wurde schon angeschrieben, wer noch nicht.
 *
 * Das Gegenstueck zu Instantlys Leads-Reiter. Die Daten kommen ueber
 * api/instantly/campaigns/[id]/leads direkt von Instantly und bewusst NICHT
 * aus unseren eigenen: contacts.outreach_status haengt daran, dass der
 * Inbox-Sync die ausgehende Mail gesehen hat, und der holt nur, was seit
 * seinem Wasserstand entstand. Gemessen am 2026-08-04 meldete Instantly fuer
 * eine Kampagne 45 kontaktierte Leads, unsere Daten kannten 10.
 *
 * Erst auf Klick geladen, nicht beim Oeffnen der Seite: der Abruf kostet je
 * nach Groesse mehrere Anfragen an Instantly, und wer nur den Zeitplan
 * aendern will, braucht ihn nicht.
 */
export default function CampaignLeadsPanel({ campaignId }: { campaignId: string }) {
  const { t, lang } = useT();
  const L = t.instantly.campaigns.detail.leadsPanel;

  const [leads, setLeads] = useState<CampaignLead[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/instantly/campaigns/${campaignId}/leads`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? String(res.status));
        return;
      }
      setLeads(body.items ?? []);
      setTruncated(Boolean(body.truncated));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Beim ersten Anzeigen einmal laden. Die Komponente wird nur gerendert,
  // wenn der Reiter offen ist — der Abruf haengt damit am Klick, ohne dass
  // hier eine zweite Zustandsvariable dafuer noetig waere.
  useEffect(() => {
    load();
    // load haengt nur an der Kampagne
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const counts = useMemo(() => (leads ? countLeads(leads) : null), [leads]);

  const visible = useMemo(() => {
    if (!leads) return [];
    const needle = query.trim().toLowerCase();
    return sortLeads(
      leads.filter((l) => {
        if (!matchesFilter(l, filter)) return false;
        if (!needle) return true;
        return [l.name, l.email, l.company]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(needle));
      })
    );
  }, [leads, filter, query]);

  if (loading && !leads) {
    return <p className="py-6 text-center text-sm text-faint">{t.common.saving}</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3">
        <p className="text-sm text-red-600 dark:text-red-400">{t.common.error + error}</p>
        <button onClick={load} className="mt-1.5 text-xs font-medium text-sky-600 dark:text-sky-400">
          {L.retry}
        </button>
      </div>
    );
  }

  if (!leads || leads.length === 0) {
    return <p className="py-6 text-center text-sm text-faint">{L.empty}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {LEAD_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              disabled={counts![f] === 0 && f !== "all"}
              className={
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 " +
                (filter === f
                  ? "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                  : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
              }
            >
              {L.filters[f]}
              <span className="tabular-nums text-mute">{counts![f]}</span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={L.searchPlaceholder}
          className="ml-auto min-w-44 flex-1 rounded-lg border border-edge2 bg-field px-3 py-1.5 text-sm text-ink placeholder-mute outline-none transition-colors focus:border-sky-500 sm:flex-none"
        />
      </div>

      {truncated && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
          {L.truncated}
        </p>
      )}

      {/* max-h + overflow-y-auto begrenzt den scrollbaren Bereich auf die
          sichtbare Flaeche: ohne das sitzt der horizontale Scrollbalken von
          overflow-x-auto bei 293 Zeilen ganz unten auf der Seite, weit
          hinter dem letzten Eintrag — praktisch unerreichbar, ohne vorher
          durch die ganze Liste zu scrollen. sticky auf dem Kopf haelt die
          Spaltenueberschriften waehrend des Scrollens sichtbar. */}
      <div className="max-h-[28rem] overflow-x-auto overflow-y-auto rounded-lg border border-edge/60">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-edge2/60 bg-panel2 text-[11px] font-medium uppercase tracking-wide text-mute">
              <th className="px-4 py-2.5">{L.colContact}</th>
              <th className="px-3 py-2.5">{L.colCompany}</th>
              <th className="px-3 py-2.5">{L.colStatus}</th>
              <th className="w-28 px-3 py-2.5 text-right">{L.colOpens}</th>
              <th className="w-32 px-3 py-2.5">{L.colContacted}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((lead) => (
              <tr key={lead.id} className="border-b border-edge2/40 last:border-0 hover:bg-chip/40">
                <td className="px-4 py-2.5">
                  <p className="truncate text-ink">{lead.name ?? "—"}</p>
                  <p className="truncate text-[11px] text-faint">{lead.email ?? "—"}</p>
                </td>
                <td className="px-3 py-2.5 text-xs text-soft">{lead.company ?? "—"}</td>
                <td className="px-3 py-2.5">
                  {/* Reihenfolge der Pruefungen ist die Reihenfolge der
                      Wichtigkeit: eine Antwort schlaegt alles, ein Problem
                      schlaegt "kontaktiert". */}
                  {lead.replies > 0 ? (
                    <Badge tone="sky">{L.states.replied}</Badge>
                  ) : hasProblem(lead) ? (
                    <Badge tone="red">
                      {lead.bounced ? L.states.bounced : L.states.unsubscribed}
                    </Badge>
                  ) : isContacted(lead) ? (
                    <Badge tone="emerald">{L.states.contacted}</Badge>
                  ) : (
                    <Badge tone="mute">{L.states.pending}</Badge>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-xs tabular-nums text-soft">
                  {lead.opens > 0 ? lead.opens : <span className="text-mute">—</span>}
                </td>
                <td className="px-3 py-2.5 text-xs text-faint">
                  {lead.contacted_at ? formatRelative(lead.contacted_at, lang) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-faint">
        <span>{L.showing(visible.length, leads.length)}</span>
        <button onClick={load} disabled={loading} className="transition-colors hover:text-ink disabled:opacity-40">
          {loading ? t.common.saving : L.refresh}
        </button>
      </div>
    </div>
  );
}

const TONES: Record<string, string> = {
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  red: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  mute: "border-edge2 bg-chip text-mute",
};

function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={"rounded-full border px-2 py-0.5 text-[11px] font-medium " + TONES[tone]}>
      {children}
    </span>
  );
}
