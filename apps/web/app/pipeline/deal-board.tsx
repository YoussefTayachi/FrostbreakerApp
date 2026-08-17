"use client";
import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEAL_STAGE_IDS, defaultProbability, formatMoney, type DealStage } from "@/lib/crm/deals";
import {
  dealSubtitle,
  dealValue,
  groupByStage,
  isDealStale,
  isOverdue,
  stageTotal,
  stageWeighted,
  type DealBoardRow,
} from "@/lib/crm/deal-board";
import { formatDay, formatRelative } from "@/lib/format-time";
import CompanyLogo from "../company-logo";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

/**
 * Das Deal-Board — die dritte Ansicht neben Liste und Kontakt-Board.
 *
 * Warum es das braucht: Fuer einen Pipedrive-Umsteiger IST das die Pipeline.
 * Deren Spalten fuehren Deals mit Wert und Abschlussdatum, nicht Kontakte mit
 * Status. Unsere Kontakt-Pipeline bleibt daneben bestehen, weil sie eine
 * andere Frage beantwortet:
 *
 *   Kontakt-Board  "wen spreche ich an"       -> contacts.outreach_status
 *   Deal-Board     "was kommt davon zurueck"  -> public.deals mit Wert
 *
 * Die Tabelle public.deals gibt es seit Migration 0034. Sichtbar war sie
 * bisher nur im Drawer eines einzelnen Kontakts — man musste also wissen, wo
 * ein Deal haengt, um ihn zu sehen.
 *
 * Aufbau und Verhalten sind bewusst dieselben wie im Kontakt-Board
 * (pipeline-board.tsx): Spaltenkopf mit Kennzahlen, Karten mit dem gruen/grauen
 * Naechster-Schritt-Kreis, Ziehen zwischen den Spalten. Wer das eine bedienen
 * kann, kann auch das andere.
 */
export default function DealBoard({
  rows: initialRows,
  onOpenContact,
}: {
  rows: DealBoardRow[];
  /** Klick auf eine Karte oeffnet den Kontakt-Drawer — dort liegen Verlauf,
   *  Notizen und die Gewonnen/Verloren-Knoepfe bereits. */
  onOpenContact: (businessId: string, contactId: string | null) => void;
}) {
  const { t, lang } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const D = t.crm;
  const P = t.pipeline;

  const [rows, setRows] = useState(initialRows);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);
  // Die ganze Karte ist klickbar UND ziehbar. Endet ein Zug auf derselben
  // Karte, feuert je nach Browser noch ein click — dieselbe Falle wie im
  // Kontakt-Board, deshalb dieselbe Loesung.
  const draggedRef = useRef(false);

  const groups = useMemo(() => groupByStage(rows), [rows]);

  /**
   * Stufenwechsel per Ziehen.
   *
   * Die Wahrscheinlichkeit wird mitgezogen: sie haengt in unserem Modell an
   * der Stufe (siehe DEAL_STAGES in lib/crm/deals.ts). Wer sie im Einzelfall
   * uebersteuert hat, verliert diese Uebersteuerung damit — das ist bewusst
   * so, weil ein Stufenwechsel die groessere Aussage ist.
   */
  async function moveTo(deal: DealBoardRow, stage: DealStage) {
    if (deal.stage === stage) return;
    const probability = defaultProbability(stage);
    const before = rows;
    setRows((prev) => prev.map((r) => (r.id === deal.id ? { ...r, stage, probability } : r)));

    const { error } = await createClient()
      .from("deals")
      .update({ stage, probability, updated_at: new Date().toISOString() })
      .eq("id", deal.id)
      .eq("workspace_id", workspaceId);

    if (error) {
      setRows(before); // zurueck auf den Stand, den die Datenbank kennt
      push(t.common.error + error.message, "error");
      return;
    }
    push(P.moved(deal.title, D.dealStageLabels[stage] ?? stage), "success");
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-edge/60 bg-panel px-5 py-14 text-center">
        <p className="text-sm text-faint">{P.dealsEmpty}</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-mute">{P.dealsEmptyHint}</p>
      </div>
    );
  }

  return (
    <>
      {/* Gleiche Board-Mechanik wie im Kontakt-Board: feste Hoehe, jede Spalte
          scrollt intern, die waagerechte Leiste sitzt direkt unter den Spalten
          statt am Seitenende. */}
      <div className="-mx-8 mt-4 h-[calc(100vh-15rem)] min-h-[22rem] overflow-x-auto px-8 pb-1">
        <div className="flex h-full gap-0">
          {DEAL_STAGE_IDS.map((stage) => {
            const items = groups[stage] ?? [];
            const isTarget = dragOverStage === stage && dragId !== null;
            const total = stageTotal(items);
            const weighted = stageWeighted(items);
            return (
              <section
                key={stage}
                onDragOver={(e) => {
                  // Ohne preventDefault laesst der Browser kein Drop zu.
                  e.preventDefault();
                  setDragOverStage(stage);
                }}
                onDragLeave={() => setDragOverStage((prev) => (prev === stage ? null : prev))}
                onDrop={() => {
                  setDragOverStage(null);
                  const deal = rows.find((r) => r.id === dragId);
                  setDragId(null);
                  if (deal) moveTo(deal, stage);
                }}
                className={
                  "flex h-full w-72 shrink-0 flex-col overflow-hidden border-l transition-colors first:border-l-0 " +
                  (isTarget ? "border-sky-500/70 bg-sky-500/5" : "border-edge2/60")
                }
              >
                {/* Spaltenkopf wie bei Pipedrive: Stufe fett, darunter die
                    Summe. Hier steht sie im Gegensatz zum Kontakt-Board
                    woertlich so wie dort — ein Deal HAT einen Wert, es muss
                    nichts uebersetzt werden. Die gewichtete Summe kommt
                    dazu, weil sie die ehrlichere Prognose ist. */}
                <header className="shrink-0 px-3 pb-2 pt-3">
                  <h2 className="truncate text-base font-semibold leading-tight text-ink">
                    {D.dealStageLabels[stage] ?? stage}
                  </h2>
                  <p className="mt-1 truncate text-xs text-faint">
                    {formatMoney(total, "EUR", lang)} · {P.dealCount(items.length)}
                  </p>
                  {weighted > 0 && (
                    <p className="truncate text-[11px] text-mute" title={P.weightedHint}>
                      {P.weighted(formatMoney(weighted, "EUR", lang))}
                    </p>
                  )}
                </header>

                <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
                  {items.map((deal) => {
                    const stale = isDealStale(deal);
                    const overdue = isOverdue(deal);
                    return (
                      <article
                        key={deal.id}
                        draggable
                        onDragStart={() => {
                          draggedRef.current = true;
                          setDragId(deal.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOverStage(null);
                        }}
                        onClick={() => {
                          if (draggedRef.current) {
                            draggedRef.current = false;
                            return;
                          }
                          onOpenContact(deal.business_id, deal.contact_id);
                        }}
                        className={
                          "group cursor-grab rounded-lg border border-edge/40 bg-panel px-3.5 py-3 shadow-sm transition-all hover:shadow-md active:cursor-grabbing " +
                          (dragId === deal.id ? "opacity-40" : "")
                        }
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 truncate text-sm font-semibold leading-snug text-ink">
                              {deal.title}
                              {/* Liegt zu lange unberuehrt — Pipedrives
                                  "rotting deal", hier aus updated_at
                                  abgeleitet. */}
                              {stale && (
                                <span
                                  title={P.dealStaleTitle(deal.days_idle ?? 0)}
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                                />
                              )}
                            </p>
                            <p className="mt-1 truncate text-xs leading-snug text-faint">
                              {dealSubtitle(deal)}
                            </p>
                          </div>

                          {/* Derselbe Kreis wie im Kontakt-Board: gruen, wenn
                              ein naechster Schritt geplant ist, grau wenn
                              nicht, rot wenn der Termin verstrichen ist. */}
                          <span
                            title={
                              deal.next_due_at
                                ? P.dueOn(formatRelative(deal.next_due_at, lang))
                                : P.noNextStepTitle
                            }
                            className={
                              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white " +
                              (!deal.next_due_at
                                ? "bg-mute/50"
                                : new Date(deal.next_due_at) < new Date()
                                  ? "bg-red-500"
                                  : "bg-emerald-500")
                            }
                          >
                            &#8250;
                          </span>
                        </div>

                        <div className="mt-2 flex items-center gap-2">
                          <CompanyLogo
                            name={deal.company_name ?? deal.title}
                            website={deal.company_website}
                            size={14}
                          />
                          <span className="text-[13px] font-medium tabular-nums text-ink">
                            {formatMoney(dealValue(deal), deal.currency, lang)}
                          </span>
                          {deal.expected_close_date && (
                            <span
                              className={
                                "ml-auto text-[11px] " + (overdue ? "text-red-500" : "text-mute")
                              }
                              title={P.expectedClose}
                            >
                              {formatDay(deal.expected_close_date, lang)}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}

                  {items.length === 0 && (
                    <p className="py-8 text-center text-[11px] text-mute">
                      {isTarget ? P.dropHere : P.columnEmpty}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <p className="mt-1 text-xs text-faint">
        {P.dealCount(rows.length)} · {formatMoney(stageTotal(rows), "EUR", lang)}
      </p>
    </>
  );
}
