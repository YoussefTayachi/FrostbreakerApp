"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { renderLinkedInMessage } from "@/lib/crm/linkedin-message";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import LinkedInTemplate from "./linkedin-template";
import SourceBadge from "./source-badge";
import type { LeadListSummary, LinkedInLead } from "./types";

/**
 * Zweite Stufe: die Profile genau einer Lead-Liste.
 *
 * Der Ablauf bricht bewusst nicht aus der App aus: kopieren -> Profil im
 * neuen Tab oeffnen -> zurueckkommen und abhaken. Ein "senden"-Knopf existiert
 * aus gutem Grund nicht (siehe Dateikopf von page.tsx).
 */
export default function LinkedInList({
  list,
  leads,
  template: initialTemplate,
  isCustomTemplate,
}: {
  list: LeadListSummary;
  leads: LinkedInLead[];
  template: string;
  isCustomTemplate: boolean;
}) {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const L = t.linkedin;

  const [template, setTemplate] = useState(initialTemplate);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [hideContacted, setHideContacted] = useState(false);
  const [onlyWithoutEmail, setOnlyWithoutEmail] = useState(false);
  // Lokal abgehakt: die Serverdaten werden nicht neu geladen, damit die Zeile
  // nicht unter dem Cursor wegspringt, waehrend man die Liste abarbeitet.
  const [justLogged, setJustLogged] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  // Arbeitsreihenfolge: offen vor erledigt, fertiger Icebreaker vor keinem,
  // und ohne E-Mail-Adresse zuerst -- fuer die ist LinkedIn der einzige Weg.
  const ordered = useMemo(
    () =>
      [...leads].sort((a, b) => {
        const aDone = a.alreadyContacted ? 1 : 0;
        const bDone = b.alreadyContacted ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        const aReady = a.personalization ? 0 : 1;
        const bReady = b.personalization ? 0 : 1;
        if (aReady !== bReady) return aReady - bReady;
        return (a.email ? 1 : 0) - (b.email ? 1 : 0);
      }),
    [leads]
  );

  const visible = useMemo(
    () =>
      ordered.filter((lead) => {
        if (onlyWithoutEmail && lead.email) return false;
        if (hideContacted && (lead.alreadyContacted || justLogged.has(lead.id))) return false;
        return true;
      }),
    [ordered, onlyWithoutEmail, hideContacted, justLogged]
  );

  const doneCount = leads.filter((l) => l.alreadyContacted || justLogged.has(l.id)).length;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      push(L.copied, "success");
    } catch {
      // Kann fehlschlagen, wenn die Seite nicht ueber HTTPS laeuft oder der
      // Browser die Berechtigung verweigert. Wortlos scheitern waere hier
      // besonders unangenehm: der Nutzer wechselt zu LinkedIn und fuegt einen
      // alten Zwischenablage-Inhalt ein.
      push(L.copyFailed, "error");
    }
  }

  /**
   * Kontaktaufnahme festhalten: eine erledigte Aktivitaet mit Kanal 'linkedin'
   * (Migration 0057) und der tatsaechlich verschickte Text als Notiz -- damit
   * spaeter nachvollziehbar ist, was dieser Kontakt gelesen hat, nicht nur
   * dass irgendetwas gesendet wurde.
   */
  async function logSent(lead: LinkedInLead, message: string) {
    if (busyId) return;
    setBusyId(lead.id);
    const now = new Date().toISOString();
    const supabase = createClient();

    const { error } = await supabase.from("activities").insert({
      workspace_id: workspaceId,
      contact_id: lead.id,
      business_id: null,
      type: "message",
      channel: "linkedin",
      subject: L.activitySubject,
      note: message,
      occurred_at: now,
      completed_at: now,
    });

    if (error) {
      setBusyId(null);
      push(t.common.error + error.message, "error");
      return;
    }

    // Status nachziehen wie beim Mailversand: ein angeschriebener Kontakt ist
    // nicht mehr "neu". Nur anheben, nie zurueckstufen -- wer bereits
    // geantwortet hat, faellt sonst durch eine spaetere LinkedIn-Nachricht
    // wieder auf "kontaktiert" zurueck.
    if (lead.outreach_status === "new") {
      const { error: statusError } = await supabase
        .from("contacts")
        .update({ outreach_status: "contacted" })
        .eq("id", lead.id);
      if (statusError) push(t.common.error + statusError.message, "error");
    }

    setJustLogged((prev) => new Set(prev).add(lead.id));
    setBusyId(null);
    push(L.logged, "success");
  }

  return (
    <div className="space-y-4">
      {/* Kopf: wo bin ich, und wie weit bin ich hier */}
      <div className="rounded-xl border border-edge/60 bg-panel p-4">
        <Link
          href="/linkedin"
          className="text-xs text-faint transition-colors hover:text-ink"
        >
          ← {L.backToLists}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink">{list.name}</h2>
            <p className="text-xs text-faint">{list.location ?? "—"}</p>
          </div>
          <SourceBadge source={list.source} />
        </div>
        {list.note && <p className="mt-2 text-xs text-mute">{list.note}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge2/60 pt-3 text-xs">
          <span className="text-soft">{L.progress(doneCount, leads.length)}</span>
          <label className="flex items-center gap-1.5 text-faint">
            <input
              type="checkbox"
              checked={onlyWithoutEmail}
              onChange={(e) => setOnlyWithoutEmail(e.target.checked)}
            />
            {L.filterOnlyWithoutEmail}
          </label>
          <label className="flex items-center gap-1.5 text-faint">
            <input
              type="checkbox"
              checked={hideContacted}
              onChange={(e) => setHideContacted(e.target.checked)}
            />
            {L.filterHideContacted}
          </label>
          <button
            onClick={() => setTemplateOpen((v) => !v)}
            className="ml-auto text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400"
          >
            {templateOpen ? L.templateHide : L.templateShow}
          </button>
        </div>
      </div>

      {templateOpen && (
        <LinkedInTemplate
          template={template}
          onTemplateChange={setTemplate}
          isCustom={isCustomTemplate}
          previewValues={
            ordered[0]
              ? {
                  firstName: ordered[0].first_name,
                  companyName: ordered[0].company_name,
                  personalization: ordered[0].personalization,
                }
              : null
          }
          previewLabel={ordered[0]?.company_name ?? null}
        />
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-edge/60 bg-panel px-4 py-8 text-center text-sm text-faint">
          {leads.length === 0 ? L.emptyState : L.emptyFiltered}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              template={template}
              done={lead.alreadyContacted || justLogged.has(lead.id)}
              busy={busyId === lead.id}
              onCopy={copy}
              onLog={logSent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LeadRow({
  lead,
  template,
  done,
  busy,
  onCopy,
  onLog,
}: {
  lead: LinkedInLead;
  template: string;
  done: boolean;
  busy: boolean;
  onCopy: (text: string) => void;
  onLog: (lead: LinkedInLead, message: string) => void;
}) {
  const { t } = useT();
  const L = t.linkedin;

  const rendered = useMemo(
    () =>
      renderLinkedInMessage(template, {
        firstName: lead.first_name,
        companyName: lead.company_name,
        personalization: lead.personalization,
      }),
    [template, lead]
  );

  // Der Text ist pro Zeile aenderbar, ohne die Vorlage anzufassen -- fuer den
  // einen Kontakt, bei dem der Icebreaker nicht ganz passt. Wird die Vorlage
  // geaendert, gewinnt wieder die Vorlage.
  const [edited, setEdited] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(rendered);
  if (baseline !== rendered) {
    setBaseline(rendered);
    setEdited(null);
  }
  const message = edited ?? rendered;

  const name = lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "—";

  return (
    <div
      className={
        "rounded-xl border bg-panel p-4 transition-opacity " +
        (done ? "border-edge/40 opacity-60" : "border-edge/60")
      }
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {name}
            {lead.title && <span className="font-normal text-faint"> · {lead.title}</span>}
          </p>
          <p className="truncate text-xs text-faint">{lead.company_name ?? "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!lead.email && (
            <span
              className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-300"
              title={L.badgeNoEmailTitle}
            >
              {L.badgeNoEmail}
            </span>
          )}
          {!lead.personalization && (
            <span className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-mute">
              {L.badgeNoIcebreaker}
            </span>
          )}
          {done && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              {L.badgeContacted}
            </span>
          )}
        </div>
      </div>

      <textarea
        value={message}
        onChange={(e) => setEdited(e.target.value)}
        rows={message.split("\n").length + 1}
        className="w-full resize-y rounded-lg border border-edge2 bg-field px-3 py-2 text-xs leading-relaxed text-ink outline-none transition-colors focus:border-sky-500"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => onCopy(message)}
          className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:brightness-110 active:scale-[0.98]"
        >
          {L.copyButton}
        </button>
        <a
          href={lead.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-edge2 px-3 py-1.5 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink"
        >
          {L.openProfile}
        </a>
        <button
          onClick={() => onLog(lead, message)}
          disabled={busy}
          className="rounded-lg border border-edge2 px-3 py-1.5 text-xs text-soft transition-colors hover:border-emerald-500/60 hover:text-emerald-600 disabled:opacity-40 dark:hover:text-emerald-400"
        >
          {busy ? t.common.saving : done ? L.logAgain : L.logSent}
        </button>
        {lead.business_id && (
          <Link
            href={`/leads?business=${lead.business_id}`}
            className="ml-auto text-[11px] text-faint transition-colors hover:text-ink"
          >
            {L.openLead}
          </Link>
        )}
      </div>
    </div>
  );
}
