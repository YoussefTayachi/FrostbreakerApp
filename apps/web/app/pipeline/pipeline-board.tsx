"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OUTREACH_STAGES, STAGE_DOT_CLS, type OutreachStage } from "@/lib/crm/stages";
import CompanyLogo from "../company-logo";
import ContactTimeline from "../crm/contact-timeline";
import DealsPanel from "../crm/deals-panel";
import StatusSelect from "../crm/status-select";
import { IconSearch } from "../icons";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

export type BoardContact = {
  id: string;
  full_name: string | null;
  title: string | null;
  email: string | null;
  outreach_status: string;
  business_id: string;
  businesses: { name: string; website: string | null } | null;
};

/**
 * Wie viele Karten pro Spalte gerendert werden. Der Nutzer entscheidet das
 * selbst, die Wahl wird lokal gemerkt -- eine feste Obergrenze war entweder zu
 * klein (man sieht seine Leads nicht) oder zu gross (endloses Scrollen).
 */
const PAGE_SIZES = [15, 30, 60, 0] as const; // 0 = alle
const DEFAULT_PAGE_SIZE = 15;
const PAGE_SIZE_KEY = "pipeline_page_size";

export default function PipelineBoard({ contacts }: { contacts: BoardContact[] }) {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const P = t.pipeline;

  // Lokale Status-Overrides: das Board reagiert sofort, ohne auf einen
  // router.refresh() zu warten. Gleiches Muster wie in leads-table.tsx.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [onlyEmail, setOnlyEmail] = useState(false);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  // Pro Spalte zusaetzlich nachgeladene Karten, damit "Mehr laden" nicht die
  // globale Einstellung aller Spalten veraendert.
  const [extra, setExtra] = useState<Record<string, number>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<OutreachStage | null>(null);
  const [detail, setDetail] = useState<BoardContact | null>(null);
  // Die ganze Karte ist klickbar UND ziehbar. Endet ein Zug auf derselben Karte,
  // feuert je nach Browser noch ein click -- das darf nicht den Drawer aufreissen.
  const draggedRef = useRef(false);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
      if (PAGE_SIZES.includes(saved as (typeof PAGE_SIZES)[number])) setPageSize(saved);
    } catch {}
  }, []);

  function choosePageSize(size: number) {
    setPageSize(size);
    setExtra({});
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {}
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts
      .map((c) => ({ ...c, outreach_status: overrides[c.id] ?? c.outreach_status }))
      .filter((c) => {
        if (onlyEmail && !c.email) return false;
        if (!needle) return true;
        return [c.full_name, c.title, c.email, c.businesses?.name]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(needle));
      });
  }, [contacts, overrides, query, onlyEmail]);

  const byStage = useMemo(() => {
    const groups = new Map<string, BoardContact[]>();
    for (const stage of OUTREACH_STAGES) groups.set(stage, []);
    for (const contact of filtered) {
      // Unbekannte Status (falls je ein neuer Wert dazukommt) landen in "new",
      // statt lautlos aus dem Board zu verschwinden.
      const key = groups.has(contact.outreach_status) ? contact.outreach_status : "new";
      groups.get(key)!.push(contact);
    }
    return groups;
  }, [filtered]);

  async function moveTo(contact: BoardContact, stage: string) {
    if (contact.outreach_status === stage) return;
    setOverrides((prev) => ({ ...prev, [contact.id]: stage }));
    const { error } = await createClient()
      .from("contacts")
      .update({ outreach_status: stage })
      .eq("id", contact.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      // Zuruecknehmen, damit die Karte nicht in einer Spalte liegt, die die DB nicht kennt
      setOverrides((prev) => ({ ...prev, [contact.id]: contact.outreach_status }));
      push(t.common.error + error.message, "error");
      return;
    }
    push(P.moved(contact.full_name ?? P.cardNoName, t.leads.statusLabels[stage] ?? stage), "success");
  }

  function onDrop(stage: OutreachStage) {
    setDragOverStage(null);
    const contact = filtered.find((c) => c.id === dragId);
    setDragId(null);
    if (contact) moveTo(contact, stage);
  }

  if (contacts.length === 0) {
    return (
      <p className="rounded-lg border border-edge/60 bg-panel px-5 py-14 text-center text-sm text-faint">
        {P.empty}
      </p>
    );
  }

  const totalShown = filtered.length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={P.searchPlaceholder}
            className="w-full rounded-lg border border-edge2 bg-field py-2 pl-9 pr-3 text-sm text-ink placeholder-mute outline-none transition-colors focus:border-sky-500"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-soft">
          <input
            type="checkbox"
            checked={onlyEmail}
            onChange={(e) => setOnlyEmail(e.target.checked)}
            className="h-4 w-4 rounded accent-sky-500"
          />
          {P.onlyWithEmail}
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-faint">{P.cardsPerColumn}</span>
          <div className="flex overflow-hidden rounded-lg border border-edge2">
            {PAGE_SIZES.map((size) => (
              <button
                key={size}
                onClick={() => choosePageSize(size)}
                className={
                  "px-2 py-1 text-xs font-medium transition-colors " +
                  (pageSize === size
                    ? "bg-sky-600 text-white"
                    : "text-soft hover:bg-chip hover:text-ink")
                }
              >
                {size === 0 ? P.cardsAll : size}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/*
        Feste Board-Hoehe, jede Spalte scrollt intern. Vorher wuchs der Container
        mit den Spalten, dadurch lag die horizontale Scrollleiste am Seitenende --
        man musste erst ganz nach unten scrollen, um zur Seite scrollen zu koennen.
        Jetzt sitzt sie direkt unter den Spalten (Trello-/Pipedrive-Verhalten).
        Das -mx-* holt die Breite zurueck, die das Seiten-Padding kostet.
      */}
      <div className="-mx-8 mt-4 h-[calc(100vh-15rem)] min-h-[22rem] overflow-x-auto px-8 pb-1">
        <div className="flex h-full gap-2.5">
          {OUTREACH_STAGES.map((stage) => {
            const items = byStage.get(stage) ?? [];
            const limit = pageSize === 0 ? items.length : pageSize + (extra[stage] ?? 0);
            const shown = items.slice(0, limit);
            const isTarget = dragOverStage === stage && dragId !== null;
            return (
              <section
                key={stage}
                onDragOver={(e) => {
                  // Ohne preventDefault laesst der Browser kein Drop zu.
                  e.preventDefault();
                  setDragOverStage(stage);
                }}
                onDragLeave={() => setDragOverStage((prev) => (prev === stage ? null : prev))}
                onDrop={() => onDrop(stage)}
                className={
                  "flex h-full w-60 shrink-0 flex-col overflow-hidden rounded-xl border transition-colors " +
                  (isTarget ? "border-sky-500/70 bg-sky-500/5" : "border-edge/60 bg-panel2/60")
                }
              >
                <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
                  <span className={"h-2 w-2 shrink-0 rounded-full " + STAGE_DOT_CLS[stage]} />
                  <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                    {t.leads.statusLabels[stage] ?? stage}
                  </h2>
                  <span className="shrink-0 rounded-full bg-chip px-1.5 py-0.5 text-[10px] font-medium text-soft">
                    {items.length}
                  </span>
                </header>

                <div className="flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
                  {shown.map((contact) => (
                    <article
                      key={contact.id}
                      draggable
                      onDragStart={() => {
                        draggedRef.current = true;
                        setDragId(contact.id);
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
                        setDetail(contact);
                      }}
                      title={[contact.full_name, contact.title, contact.businesses?.name, contact.email]
                        .filter(Boolean)
                        .join(" · ")}
                      className={
                        "group cursor-grab rounded-lg border border-edge/60 bg-panel px-2.5 py-2 shadow-sm transition-all hover:border-sky-500/50 hover:shadow-md active:cursor-grabbing " +
                        (dragId === contact.id ? "opacity-40" : "")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <CompanyLogo
                          name={contact.businesses?.name ?? contact.full_name ?? "?"}
                          website={contact.businesses?.website ?? null}
                          size={18}
                        />
                        <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-tight text-ink">
                          {contact.full_name ?? P.cardNoName}
                        </p>
                        {contact.email && (
                          <span
                            title={P.hasEmail}
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                          />
                        )}
                      </div>
                      {/* Firma und Position in einer Zeile: zwei getrennte Zeilen
                          machten die Karte fast doppelt so hoch. */}
                      <p className="mt-0.5 truncate pl-[26px] text-[11px] leading-tight text-faint">
                        {[contact.businesses?.name, contact.title].filter(Boolean).join(" · ")}
                      </p>
                    </article>
                  ))}

                  {items.length === 0 && (
                    <p className="py-8 text-center text-[11px] text-mute">
                      {isTarget ? P.dropHere : query || onlyEmail ? P.noResults : P.columnEmpty}
                    </p>
                  )}

                  {items.length > shown.length && (
                    <button
                      onClick={() => setExtra((prev) => ({ ...prev, [stage]: (prev[stage] ?? 0) + 30 }))}
                      className="w-full rounded-lg border border-dashed border-edge3 py-1.5 text-[11px] font-medium text-faint transition-colors hover:border-sky-500/60 hover:text-sky-600 dark:hover:text-sky-400"
                    >
                      {P.loadMore} · {P.truncated(shown.length, items.length)}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <p className="mt-1 text-xs text-faint">{P.columnCount(totalShown)}</p>

      {detail && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setDetail(null)}
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-edge/60 bg-panel p-6 shadow-2xl [animation:fadeUp_.25s_ease]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <CompanyLogo
                  name={detail.businesses?.name ?? detail.full_name ?? "?"}
                  website={detail.businesses?.website ?? null}
                  size={32}
                />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold tracking-tight text-ink">
                    {detail.full_name ?? P.cardNoName}
                  </h2>
                  <p className="truncate text-xs text-faint">
                    {[detail.title, detail.businesses?.name, detail.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="rounded-lg border border-edge/60 px-2.5 py-1 text-sm text-faint transition-colors hover:border-edge2 hover:text-ink"
              >
                ✕
              </button>
            </div>

            {/* Stufe wird hier gewechselt, nicht mehr auf jeder Karte -- das
                Dropdown auf 328 Karten war der Hauptgrund fuer die Bauhoehe.
                Gleichzeitig der Touch- und Tastatur-Weg, wo Drag and Drop nicht geht. */}
            {(() => {
              // Aktueller Stand kann von dem abweichen, mit dem der Drawer geoeffnet
              // wurde (z.B. nach einem Drag). moveTo braucht den aktuellen Wert fuer
              // die Frueh-Rueckkehr und fuer das Zuruecknehmen im Fehlerfall.
              const current = overrides[detail.id] ?? detail.outreach_status;
              return (
                <div className="mb-5 flex items-center gap-2 rounded-lg border border-edge/60 bg-surface/60 px-3 py-2">
                  <span className="text-xs font-medium text-faint">{P.stageLabel}</span>
                  <StatusSelect
                    value={current}
                    onChange={(next) => moveTo({ ...detail, outreach_status: current }, next)}
                    labels={t.leads.statusLabels}
                  />
                </div>
              );
            })()}

            <DealsPanel businessId={detail.business_id} contactId={detail.id} className="mb-5" />
            <ContactTimeline contactId={detail.id} businessId={detail.business_id} />
          </aside>
        </div>
      )}
    </>
  );
}
