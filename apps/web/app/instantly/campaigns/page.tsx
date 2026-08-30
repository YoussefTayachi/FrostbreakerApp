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
  /**
   * Eine Kampagne, die es nur in Frostbreaker gibt: angelegt ueber den
   * Claude-Zugang (MCP-Werkzeug create_campaign), bei Instantly noch nicht
   * vorhanden. Sie steht hier, weil das der einzige Ort ist, an dem sie
   * jemand findet, und fuehrt ins vorbefuellte Kampagnenformular statt ins
   * Kampagnen-Detail: dessen Route braucht die Instantly-ID.
   */
  is_draft: boolean;
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
    if (!confirm(c.is_draft ? C.mcpDraftDeleteConfirm(c.name) : C.deleteConfirm(c.name))) return;
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

  const entwuerfe = (items ?? []).filter((c) => c.is_draft).length;

  return (
    // max-w-6xl statt 4xl: acht Spalten brauchen mehr als die 896 Pixel von
    // 4xl (siehe min-w an der Tabelle unten). Der Deckel ist damit hoeher als
    // der Platzbedarf der Tabelle, statt knapp darunter zu liegen -- sonst
    // stuende auf einem gewoehnlichen Bildschirm dauerhaft ein waagerechter
    // Scrollbalken, obwohl daneben Platz frei ist. `main` deckelt ohnehin bei
    // 1216, breiter wird die Seite dadurch nicht.
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{C.title}</h1>
          <p className="text-sm text-faint">{C.description}</p>
        </div>
        {items !== null && (
          /* w-full unter sm: die Kopfzeile bricht auf dem Handy ohnehin um,
             und ein 140 Pixel breiter Knopf allein in einer eigenen Zeile
             sieht aus wie ein Rest. In voller Breite ist er das, was er ist:
             die eine Handlung dieser Seite. */
          <Link
            href="/instantly/campaigns/new"
            className="w-full rounded-lg bg-sky-600 px-5 py-3 text-center text-sm font-medium text-white shadow-lg shadow-sky-600/25 transition-all hover:bg-sky-500 sm:w-auto sm:py-2.5"
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

      {/* Steht ueber der Tabelle, weil er der Grund ist, warum in ihr etwas
          Neues steht, das der Nutzer nie selbst angelegt hat. */}
      {!error && entwuerfe > 0 && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 px-4 py-3 text-sm text-faint">
          {C.mcpDraftsHint(entwuerfe)}
        </div>
      )}

      {!error && items === null && <p className="text-sm text-faint">{t.common.saving}</p>}
      {!error && items !== null && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-edge2 p-6 text-center">
          <p className="text-sm text-faint">{C.empty}</p>
        </div>
      )}

      {!error && items !== null && items.length > 0 && (
        /* overflow-x-auto statt overflow-hidden, und ein Mindestmass an der
           Tabelle.

           Gemessen am 2026-08-23 im Live-Stand bei 1568 Pixel Fensterbreite:
           acht Spalten passten nicht in die 896 Pixel des Containers, die
           Tabelle lief darueber hinaus, und overflow-hidden schnitt sie
           einfach ab -- die letzte Spalte endete mitten im Wort ("Dele"), und
           "Review and create" brach auf drei Zeilen um. Wegschneiden ist die
           schlechteste aller Antworten auf zu wenig Platz.

           Jetzt scrollt die Tabelle in ihrem eigenen Container, genau wie in
           pipeline-list und calls/call-list; der Seitenkoerper scrollt
           weiterhin nie waagerecht.

           UNTER md gibt es sie gar nicht mehr. Waagerecht scrollen ist die
           Antwort auf "ein bisschen zu wenig Platz", nicht auf "ein Drittel
           des Noetigen": auf einem 375er Bildschirm liegen 928 Pixel Tabelle
           hinter einem 343 Pixel breiten Fenster, und von den acht Spalten
           sind zwei zugleich sichtbar. Man wischt dann eine Zeile entlang und
           hat den Namen verloren, zu dem die Zahl gehoert. Darunter steht
           deshalb dieselbe Information als Karte -- eine Kampagne je Block,
           Kennzahlen im Raster, nichts abgeschnitten. */
        <div className="hidden overflow-x-auto rounded-lg border border-edge/60 md:block">
          <table className="w-full min-w-[58rem] text-sm">
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
                    {/* Eigenes Abzeichen und nicht statusLabels.draft: eine
                        Kampagne, die bei Instantly liegt und noch nicht
                        gestartet ist, steht dort ebenfalls auf "Entwurf". Die
                        beiden sind aber nicht dasselbe, und nur eine davon
                        muss noch angelegt werden. */}
                    {c.is_draft ? (
                      <span className="rounded-full border border-sky-500/40 px-2 py-0.5 text-[11px] text-sky-600 dark:text-sky-400">
                        {C.mcpDraftBadge}
                      </span>
                    ) : (
                      <span className={"rounded-full border px-2 py-0.5 text-[11px] " + (STATUS_BADGE_CLS[c.status] ?? "")}>
                        {t.instantly.statusLabels[c.status as keyof typeof t.instantly.statusLabels] ?? c.status}
                      </span>
                    )}
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
                  {/* whitespace-nowrap: "Review and create" ist die laengste
                      Aktion und darf nicht umbrechen -- in einer Aktionsspalte
                      ist ein dreizeiliger Link kein Link mehr, sondern ein
                      Absatz. Die Breite, die er dadurch beansprucht, steckt im
                      min-w der Tabelle. */}
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className="flex items-center justify-end gap-3">
                      <Link
                        href={c.is_draft ? `/instantly/campaigns/new?draft=${c.id}` : `/instantly/campaigns/${c.id}`}
                        className="text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400"
                      >
                        {c.is_draft ? C.mcpDraftReview : C.manage}
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

      {/* Dieselben Kampagnen als Karten, fuer alles unter md.
          Bewusst dieselbe Reihenfolge der Angaben wie in der Tabelle: Name,
          Zustand, Fortschritt, Zahlen, Handlungen. Wer beide Breiten benutzt,
          soll nicht zweimal suchen lernen. */}
      {!error && items !== null && items.length > 0 && (
        <div className="space-y-3 md:hidden">
          {items.map((c) => {
            const fortschritt =
              c.stats && c.stats.leads_count > 0
                ? Math.round((c.stats.contacted_count / c.stats.leads_count) * 100)
                : null;
            return (
              <div key={c.id} className="rounded-lg border border-edge/60 bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{c.name}</p>
                    <p className="mt-0.5 text-xs text-faint">
                      {c.searches?.name || c.searches?.query || "–"}
                      {c.mailboxes.length > 0 && ` · ${C.mailboxCount(c.mailboxes.length)}`}
                    </p>
                  </div>
                  {c.is_draft ? (
                    <span className="shrink-0 rounded-full border border-sky-500/40 px-2 py-0.5 text-[11px] text-sky-600 dark:text-sky-400">
                      {C.mcpDraftBadge}
                    </span>
                  ) : (
                    <span className={"shrink-0 rounded-full border px-2 py-0.5 text-[11px] " + (STATUS_BADGE_CLS[c.status] ?? "")}>
                      {t.instantly.statusLabels[c.status as keyof typeof t.instantly.statusLabels] ?? c.status}
                    </span>
                  )}
                </div>

                {fortschritt !== null && (
                  <div className="mt-3">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-medium text-ink">{fortschritt}%</span>
                      <span className="text-mute">
                        {c.stats!.contacted_count} / {c.stats!.leads_count}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-chip">
                      <div
                        className="h-full rounded-full bg-sky-500 transition-[width]"
                        style={{ width: `${Math.min(100, fortschritt)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Vier Zahlen im Raster statt vier Spalten: die Beschriftung
                    steht ueber dem Wert und nicht in einem Kopf zwei
                    Bildschirmhoehen weiter oben. */}
                <div className="mt-3 grid grid-cols-4 gap-2 border-t border-edge/60 pt-3">
                  {[
                    { label: C.columnLeads, wert: c.stats?.leads_count, cls: "text-soft" },
                    { label: C.columnContacted, wert: c.stats?.contacted_count, cls: "text-soft" },
                    {
                      label: C.columnReplies,
                      wert: c.stats?.reply_count_unique,
                      cls: c.stats?.reply_count_unique ? "font-medium text-sky-600 dark:text-sky-400" : "text-soft",
                    },
                    {
                      label: C.columnBounced,
                      wert: c.stats?.bounced_count,
                      cls: c.stats?.bounced_count ? "font-medium text-red-500" : "text-mute",
                    },
                  ].map((k) => (
                    <div key={k.label}>
                      <p className="text-[11px] text-mute">{k.label}</p>
                      <p className={"mt-0.5 text-sm tabular-nums " + k.cls}>{k.wert ?? "–"}</p>
                    </div>
                  ))}
                </div>

                {/* py-2.5 und ein Rahmen: in der Tabelle sind das zwei
                    Textlinks nebeneinander, mit dem Daumen trifft man die
                    nicht. */}
                <div className="mt-3 flex items-center gap-2">
                  <Link
                    href={c.is_draft ? `/instantly/campaigns/new?draft=${c.id}` : `/instantly/campaigns/${c.id}`}
                    className="flex-1 rounded-lg border border-edge2 px-3 py-2.5 text-center text-sm font-medium text-sky-600 transition-colors hover:border-sky-500 dark:text-sky-400"
                  >
                    {c.is_draft ? C.mcpDraftReview : C.manage}
                  </Link>
                  <button
                    type="button"
                    disabled={deletingId === c.id}
                    onClick={() => deleteCampaign(c)}
                    className="rounded-lg border border-edge2 px-3 py-2.5 text-sm font-medium text-faint transition-colors hover:border-red-500/50 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                  >
                    {C.delete}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
