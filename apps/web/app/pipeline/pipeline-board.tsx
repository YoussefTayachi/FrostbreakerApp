"use client";
import { useMemo, useState } from "react";
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

/** Pro Spalte gerendert -- bei 1000 Kontakten in einer Stufe waere das Board sonst unbenutzbar. */
const MAX_CARDS_PER_COLUMN = 50;

export default function PipelineBoard({ contacts }: { contacts: BoardContact[] }) {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const P = t.pipeline;

  // Lokale Status-Overrides: das Board reagiert sofort auf Drag and Drop, ohne
  // auf einen router.refresh() zu warten. Gleiches Muster wie in leads-table.tsx.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [onlyEmail, setOnlyEmail] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<OutreachStage | null>(null);
  const [detail, setDetail] = useState<BoardContact | null>(null);

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

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={P.searchPlaceholder}
            className="w-full rounded-lg border border-edge2 bg-field py-2.5 pl-9 pr-3 text-sm text-ink placeholder-mute outline-none transition-colors focus:border-sky-500"
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
      </div>

      {/* Spalten scrollen horizontal, damit alle sechs Stufen auch auf kleinen
          Bildschirmen erreichbar bleiben statt umzubrechen. */}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {OUTREACH_STAGES.map((stage) => {
          const items = byStage.get(stage) ?? [];
          const shown = items.slice(0, MAX_CARDS_PER_COLUMN);
          const isTarget = dragOverStage === stage;
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
                "flex w-64 shrink-0 flex-col rounded-lg border bg-panel transition-colors " +
                (isTarget ? "border-sky-500/60 bg-sky-500/5" : "border-edge/60")
              }
            >
              <header className="flex items-center gap-2 border-b border-edge/60 px-3 py-2.5">
                <span className={"h-2 w-2 shrink-0 rounded-full " + STAGE_DOT_CLS[stage]} />
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {t.leads.statusLabels[stage] ?? stage}
                </h2>
                <span className="shrink-0 text-[11px] text-faint">{items.length}</span>
              </header>

              <div className="flex-1 space-y-2 p-2">
                {shown.map((contact) => (
                  <article
                    key={contact.id}
                    draggable
                    onDragStart={() => setDragId(contact.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setDragOverStage(null);
                    }}
                    className={
                      "cursor-grab rounded-lg border border-edge/60 bg-surface/60 p-2.5 transition-opacity active:cursor-grabbing " +
                      (dragId === contact.id ? "opacity-40" : "hover:border-edge2")
                    }
                  >
                    <div className="flex items-start gap-2">
                      <CompanyLogo
                        name={contact.businesses?.name ?? contact.full_name ?? "?"}
                        website={contact.businesses?.website ?? null}
                        size={20}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-ink">
                          {contact.full_name ?? P.cardNoName}
                        </p>
                        <p className="truncate text-[11px] text-faint">{contact.businesses?.name}</p>
                      </div>
                    </div>
                    {contact.title && (
                      <p className="mt-1 truncate text-[10px] text-mute">{contact.title}</p>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-1.5">
                      {/* Touch- und Tastatur-Fallback: HTML5-Drag-and-Drop
                          funktioniert auf Mobilgeraeten nicht. */}
                      <StatusSelect
                        value={contact.outreach_status}
                        onChange={(next) => moveTo(contact, next)}
                        labels={t.leads.statusLabels}
                      />
                      <button
                        onClick={() => setDetail(contact)}
                        className="shrink-0 text-[10px] font-medium text-sky-600 transition-colors hover:text-sky-500 dark:text-sky-400"
                      >
                        {P.openLead}
                      </button>
                    </div>
                  </article>
                ))}

                {items.length === 0 && (
                  <p className="py-6 text-center text-[11px] text-mute">{P.columnEmpty}</p>
                )}
                {items.length > shown.length && (
                  <p className="pt-1 text-center text-[10px] text-mute">
                    {P.truncated(shown.length, items.length)}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {detail && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setDetail(null)}
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-edge/60 bg-panel p-6 shadow-2xl [animation:fadeUp_.25s_ease]">
            <div className="mb-5 flex items-start justify-between gap-3">
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

            <DealsPanel businessId={detail.business_id} contactId={detail.id} className="mb-5" />
            <ContactTimeline contactId={detail.id} businessId={detail.business_id} />
          </aside>
        </div>
      )}
    </>
  );
}
