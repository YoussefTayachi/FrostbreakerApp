"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "../language-provider";
import LinkedInTemplate, { type LinkedInTemplateRow } from "./linkedin-template";
import SourceBadge from "./source-badge";
import type { LeadListSummary, LinkedInLead } from "./types";

/**
 * Erste Stufe: welche Lead-Listen gibt es und wie viel Arbeit steckt darin.
 *
 * Bewusst Zahlen statt einer Vorschau der Namen. Vor dem Hineinklicken ist
 * genau eine Frage relevant ("lohnt sich diese Liste als naechstes"), und
 * die beantwortet sich aus: wie viel ist offen, wie viel davon ist ohne
 * E-Mail-Adresse ausschliesslich hier erreichbar, wie viel hat schon einen
 * fertigen Icebreaker und kostet damit nur noch einen Klick.
 */
export default function LinkedInOverview({
  lists,
  template: initialTemplate,
  templates: initialTemplates,
  initialTemplateId,
  firstLead,
  truncated,
  maxRows,
}: {
  lists: LeadListSummary[];
  template: string;
  templates: LinkedInTemplateRow[];
  initialTemplateId: string | null;
  /** Fuer die Live-Vorschau im Vorlagen-Editor: echte Daten statt erfundener Beispielperson. */
  firstLead: LinkedInLead | null;
  truncated: boolean;
  maxRows: number;
}) {
  const { t } = useT();
  const L = t.linkedin;
  const [draft, setDraft] = useState(initialTemplate);
  const [templates, setTemplates] = useState(initialTemplates);
  const [templateId, setTemplateId] = useState(initialTemplateId);

  /** Vorlage wechseln: Auswahl merken UND den Text im Feld austauschen. */
  function selectTemplate(id: string) {
    setTemplateId(id);
    const next = templates.find((x) => x.id === id);
    if (next) setDraft(next.body);
  }

  /** Nach Anlegen, Umbenennen, Loeschen oder Standardwechsel. */
  function applyTemplates(next: LinkedInTemplateRow[], selectId: string | null) {
    setTemplates(next);
    setTemplateId(selectId);
    const chosen = next.find((x) => x.id === selectId);
    if (chosen) setDraft(chosen.body);
  }

  const totals = lists.reduce(
    (acc, l) => ({
      total: acc.total + l.total,
      open: acc.open + (l.total - l.contacted),
      withoutEmail: acc.withoutEmail + l.withoutEmail,
      followUpsDue: acc.followUpsDue + l.followUpsDue,
    }),
    { total: 0, open: 0, withoutEmail: 0, followUpsDue: 0 }
  );

  return (
    <div className="space-y-5">
      {truncated && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
          {L.truncatedRows(maxRows)}
        </p>
      )}

      {/* Die Zeile steht ueber allem anderen und nur dann, wenn wirklich etwas
          faellig ist: sie ist die einzige Auskunft auf dieser Seite, die
          einen Termin hat. */}
      {totals.followUpsDue > 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-500">
          {L.followUpsDueBanner(totals.followUpsDue)}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={L.statLists} value={lists.length} />
        <Stat label={L.statOpen} value={totals.open} sub={L.statOpenOf(totals.total)} />
        <Stat label={L.statOnlyLinkedIn} value={totals.withoutEmail} accent />
      </div>

      <LinkedInTemplate
        templates={templates}
        selectedId={templateId}
        onSelect={selectTemplate}
        onTemplatesChange={applyTemplates}
        template={draft}
        onTemplateChange={setDraft}
        previewValues={
          firstLead
            ? {
                firstName: firstLead.first_name,
                companyName: firstLead.company_name,
                personalization: firstLead.personalization,
              }
            : null
        }
        previewLabel={firstLead?.company_name ?? null}
      />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink">{L.listsHeading}</h2>
        {lists.length === 0 ? (
          <p className="rounded-xl border border-edge/60 bg-panel px-4 py-8 text-center text-sm text-faint">
            {L.emptyState}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {lists.map((list) => (
              <ListCard key={list.id} list={list} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-edge/60 bg-panel px-4 py-3">
      <p className="text-xs text-faint">{label}</p>
      <p
        className={
          "mt-0.5 text-2xl font-semibold tabular-nums " +
          (accent ? "text-sky-600 dark:text-sky-400" : "text-ink")
        }
      >
        {value.toLocaleString("de-DE")}
      </p>
      {sub && <p className="text-[11px] text-mute">{sub}</p>}
    </div>
  );
}

function ListCard({ list }: { list: LeadListSummary }) {
  const { t } = useT();
  const L = t.linkedin;
  const open = list.total - list.contacted;
  const donePercent = list.total > 0 ? Math.round((list.contacted / list.total) * 100) : 0;

  return (
    <Link
      href={`/linkedin?list=${encodeURIComponent(list.id)}`}
      className="group block rounded-xl border border-edge/60 bg-panel p-4 transition-colors hover:border-sky-500/50"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink group-hover:text-sky-600 dark:group-hover:text-sky-400">
            {list.name}
          </p>
          <p className="truncate text-xs text-faint">{list.location ?? "—"}</p>
        </div>
        <SourceBadge source={list.source} />
      </div>

      {list.note && <p className="mb-2 line-clamp-2 text-[11px] text-mute">{list.note}</p>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {/* Zuerst, weil es das Einzige ist, was heute dringend ist: hier
            wartet eine Antwort-Pruefung, die sonst nur auffaellt, wenn man
            die Liste zufaellig oeffnet. */}
        {list.followUpsDue > 0 && (
          <span className="font-medium text-amber-600 dark:text-amber-400">
            {L.cardFollowUpsDue(list.followUpsDue)}
          </span>
        )}
        <span className="font-medium text-ink">{L.cardOpen(open)}</span>
        {list.withoutEmail > 0 && (
          <span className="text-sky-600 dark:text-sky-400">{L.cardOnlyLinkedIn(list.withoutEmail)}</span>
        )}
        <span className="text-faint">{L.cardWithIcebreaker(list.withIcebreaker)}</span>
      </div>

      {/* Fortschritt statt nur Zahlen: bei 21 Listen sieht man so auf einen
          Blick, welche schon durch sind und welche noch unberuehrt liegen. */}
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-chip">
        <div
          className="h-full rounded-full bg-emerald-500/70 transition-[width]"
          style={{ width: `${donePercent}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-mute">{L.cardProgress(list.contacted, list.total)}</p>
    </Link>
  );
}
