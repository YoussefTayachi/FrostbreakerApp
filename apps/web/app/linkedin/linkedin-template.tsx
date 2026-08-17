"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  LINKEDIN_VARIABLE_TOKENS,
  getDefaultLinkedInTemplate,
  renderLinkedInMessage,
  unknownPlaceholders,
  variableHighlightRanges,
  type LinkedInMessageValues,
} from "@/lib/crm/linkedin-message";
import HighlightedTextarea from "../highlighted-textarea";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

/**
 * Der Vorlagen-Editor, bewusst nach dem Vorbild des Kampagnen-Schritts
 * (instantly/campaigns/campaign-step-card.tsx) gebaut, damit sich beides
 * gleich anfuehlt: Variablen als Knoepfe, die an der Cursor-Position
 * einfuegen, farbig markiert im Text, darunter eine Vorschau.
 *
 * Der wesentliche Unterschied zum Kampagnen-Editor: dort faerbt
 * HighlightedTextarea Qualitaetsbefunde ein, hier die Variablen selbst:
 * blau, wenn sie ersetzt werden, rot, wenn sie sich niemand ausdenken kann
 * und der Text so beim Empfaenger landet.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MEHRERE VORLAGEN (Migration 0080)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Bis dahin gab es genau EINE Vorlage je Workspace, in einer Textspalte am
 * Workspace. Sie galt fuer jeden Kontakt in jeder Liste. Wer Agenturen anders
 * anschreiben wollte als Shops (der Normalfall, die Mail-Sequenzen sind ja
 * auch je Kampagne verschieden), musste den Text vor jeder Liste von Hand
 * austauschen und danach zurueckaendern.
 *
 * Die Auswahl steht bewusst UEBER dem Textfeld und nicht daneben: sie
 * entscheidet, was darunter steht. Eine Auswahl neben dem Feld, das sie
 * steuert, liest sich wie eine zweite Einstellung gleichen Ranges.
 */

export type LinkedInTemplateRow = {
  id: string;
  name: string;
  body: string;
  is_default: boolean;
};

export default function LinkedInTemplate({
  templates,
  selectedId,
  onSelect,
  onTemplatesChange,
  template,
  onTemplateChange,
  previewValues,
  previewLabel,
}: {
  templates: LinkedInTemplateRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Nach Anlegen, Umbenennen oder Loeschen: die frische Liste plus die Auswahl. */
  onTemplatesChange: (next: LinkedInTemplateRow[], selectId: string | null) => void;
  template: string;
  onTemplateChange: (next: string) => void;
  /** Erster Lead der aktuellen Liste, damit die Vorschau echte Daten zeigt statt Platzhaltertext. */
  previewValues: LinkedInMessageValues | null;
  previewLabel: string | null;
}) {
  const { t, lang } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const L = t.linkedin;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState(template);

  /**
   * Vorlage aus dem hinterlegten Angebot.
   *
   * Der billigste zusaetzliche Kanal, den es gibt: die Kontakte sind schon
   * gekauft, ein zweiter Anlauf ueber LinkedIn kostet keinen Credit. Gefehlt
   * hat immer nur der Text: die Arbeitsliste startete mit einem leeren
   * Feld, genau wie die Mail-Kampagne vor dem Sequenzgenerator.
   *
   * Genommen wird das Standardangebot. Wer mehrere hat, waehlt sie unter
   * /offers; eine zweite Auswahlliste hier waere dieselbe Frage an einer
   * zweiten Stelle.
   */
  const [offerId, setOfferId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    createClient()
      .from("offers")
      .select("id, is_default")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const rows = (data ?? []) as { id: string; is_default: boolean }[];
        setOfferId(rows.find((o) => o.is_default)?.id ?? rows[0]?.id ?? null);
      });
  }, [workspaceId]);

  async function ausAngebot() {
    if (!offerId) return;
    setGenerating(true);
    const res = await fetch("/api/copy/linkedin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId }),
    });
    const body = await res.json().catch(() => ({}));
    setGenerating(false);
    if (!res.ok) return push(t.common.error + (body.error ?? res.status), "error");
    onTemplateChange(body.message as string);
    // Die geschaetzte Endlaenge zaehlt den eingesetzten Aufhaenger mit, nicht
    // die 19 Zeichen des Platzhalters; sonst gilt eine Nachricht als kurz,
    // die LinkedIn spaeter mitten im Satz abschneidet.
    if (body.estimatedLength > body.maxLength) {
      push(L.templateTooLong(body.estimatedLength, body.maxLength), "error");
    }
  }

  const current = templates.find((x) => x.id === selectedId) ?? null;

  const bad = useMemo(() => unknownPlaceholders(template), [template]);
  const highlights = useMemo(
    () => ({ ranges: variableHighlightRanges(template), forText: template }),
    [template]
  );
  const preview = useMemo(
    () => (previewValues ? renderLinkedInMessage(template, previewValues) : null),
    [template, previewValues]
  );

  const dirty = template !== savedTemplate;

  const VARIABLES: { token: string; label: string }[] = [
    { token: LINKEDIN_VARIABLE_TOKENS.firstName, label: L.variableFirstName },
    { token: LINKEDIN_VARIABLE_TOKENS.companyName, label: L.variableCompanyName },
    { token: LINKEDIN_VARIABLE_TOKENS.personalization, label: L.variablePersonalization },
  ];

  /**
   * Einfuegen an der Cursor-Position, wie im Kampagnen-Editor. Ohne das muesste
   * man die geschweiften Klammern von Hand tippen, und genau dabei entsteht
   * der Fehler, den die rote Markierung hinterher anzeigt.
   */
  function insertVariable(token: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? template.length;
    const end = el?.selectionEnd ?? template.length;
    onTemplateChange(template.slice(0, start) + token + template.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  /** Frisch laden nach jeder Aenderung: Reihenfolge und Standardmarkierung
   *  kommen aus der Datenbank, nicht aus dem Gedaechtnis der Oberflaeche. */
  async function reload(selectId: string | null) {
    const { data } = await createClient()
      .from("linkedin_templates")
      .select("id, name, body, is_default")
      .eq("workspace_id", workspaceId)
      .order("created_at");
    const rows = (data ?? []) as LinkedInTemplateRow[];
    const fallback = rows.find((r) => r.is_default)?.id ?? rows[0]?.id ?? null;
    onTemplatesChange(rows, selectId ?? fallback);
  }

  async function save() {
    setSaving(true);
    const supabase = createClient();

    /**
     * Noch gar keine Vorlage? Dann ist Speichern zugleich das Anlegen der
     * ersten. Sonst muesste der Nutzer erst "Neu" druecken, um etwas zu
     * sichern, das er gerade geschrieben hat, und der Knopf, den er
     * intuitiv sucht, waere der falsche.
     */
    if (!current) {
      const { data, error } = await supabase
        .from("linkedin_templates")
        .insert({
          workspace_id: workspaceId,
          name: L.templateFirstName,
          body: template,
          is_default: true,
        })
        .select("id")
        .single();
      setSaving(false);
      if (error) return push(t.common.error + error.message, "error");
      setSavedTemplate(template);
      await reload(data.id);
      push(L.templateSaved, "success");
      return;
    }

    const { error } = await supabase
      .from("linkedin_templates")
      .update({ body: template, updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .eq("workspace_id", workspaceId);
    setSaving(false);
    if (error) return push(t.common.error + error.message, "error");
    setSavedTemplate(template);
    push(L.templateSaved, "success");
  }

  async function createTemplate() {
    const name = window.prompt(L.templateNamePrompt, L.templateNewName);
    if (!name?.trim()) return;
    setBusy(true);
    const { data, error } = await createClient()
      .from("linkedin_templates")
      .insert({
        workspace_id: workspaceId,
        name: name.trim().slice(0, 80),
        // Startet mit dem, was gerade im Feld steht: fast immer will man eine
        // Abwandlung, kein leeres Blatt.
        body: template,
        is_default: templates.length === 0,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) return push(t.common.error + error.message, "error");
    setSavedTemplate(template);
    await reload(data.id);
    push(L.templateCreated, "success");
  }

  async function renameTemplate() {
    if (!current) return;
    const name = window.prompt(L.templateNamePrompt, current.name);
    if (!name?.trim() || name.trim() === current.name) return;
    setBusy(true);
    const { error } = await createClient()
      .from("linkedin_templates")
      .update({ name: name.trim().slice(0, 80), updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .eq("workspace_id", workspaceId);
    setBusy(false);
    if (error) return push(t.common.error + error.message, "error");
    await reload(current.id);
  }

  async function removeTemplate() {
    if (!current) return;
    if (!window.confirm(L.templateDeleteConfirm(current.name))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("linkedin_templates")
      .delete()
      .eq("id", current.id)
      .eq("workspace_id", workspaceId);
    setBusy(false);
    if (error) return push(t.common.error + error.message, "error");
    await reload(null);
    push(L.templateDeleted, "success");
  }

  /**
   * Standard umschalten: erst die alte loeschen, dann die neue setzen.
   *
   * Der Teilindex aus Migration 0080 laesst hoechstens eine Standardvorlage
   * je Workspace zu. Die umgekehrte Reihenfolge liefe in eine
   * Eindeutigkeitsverletzung.
   */
  async function makeDefault() {
    if (!current || current.is_default) return;
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("linkedin_templates")
      .update({ is_default: false })
      .eq("workspace_id", workspaceId)
      .eq("is_default", true);
    const { error } = await supabase
      .from("linkedin_templates")
      .update({ is_default: true })
      .eq("id", current.id)
      .eq("workspace_id", workspaceId);
    setBusy(false);
    if (error) return push(t.common.error + error.message, "error");
    await reload(current.id);
  }

  /** Wechseln mit ungesicherten Aenderungen wuerde sie stillschweigend
   *  wegwerfen, deshalb einmal nachfragen. */
  function switchTo(id: string) {
    if (dirty && !window.confirm(L.templateSwitchUnsaved)) return;
    const next = templates.find((x) => x.id === id);
    setSavedTemplate(next?.body ?? "");
    onSelect(id);
  }

  return (
    <div className="rounded-xl border border-edge/60 bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">{L.templateHeading}</h2>
          <p className="text-xs text-faint">{L.templateHint}</p>
        </div>
        {!current && !dirty && (
          <span className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-mute">{L.templateIsDefault}</span>
        )}
      </div>

      {/* Die Auswahl. Bei genau einer Vorlage waere ein Reiter ohne Alternative
          nur Zierde — deshalb erscheint die Leiste erst ab der zweiten, der
          Anlegen-Knopf aber immer. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {templates.map((tpl) => {
          const active = tpl.id === selectedId;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => switchTo(tpl.id)}
              className={
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors " +
                (active
                  ? "border-sky-500/60 bg-sky-500/10 font-medium text-sky-700 dark:text-sky-300"
                  : "border-edge2 text-soft hover:border-edge3 hover:text-ink")
              }
            >
              {tpl.name}
              {tpl.is_default && (
                <span title={L.templateDefaultTitle} className="text-[10px] text-amber-500">
                  ★
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={createTemplate}
          disabled={busy}
          className="rounded-lg border border-dashed border-edge2 px-2.5 py-1 text-xs text-faint transition-colors hover:border-sky-500/50 hover:text-sky-600 disabled:opacity-40 dark:hover:text-sky-400"
        >
          + {L.templateNew}
        </button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-faint">{L.insertVariable}</span>
        {VARIABLES.map((v) => (
          <button
            key={v.token}
            type="button"
            onClick={() => insertVariable(v.token)}
            className="rounded-full border border-edge2 px-2 py-0.5 font-mono text-[11px] text-faint transition-colors hover:border-sky-500/50 hover:text-sky-600 dark:hover:text-sky-400"
          >
            {v.label}
          </button>
        ))}
      </div>

      <HighlightedTextarea
        textareaRef={textareaRef}
        value={template}
        onChange={onTemplateChange}
        rows={10}
        highlights={highlights}
      />

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="flex items-center gap-1 text-faint">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500/40" aria-hidden />
          {L.legendValid}
        </span>
        {bad.length > 0 && (
          <span className="flex items-center gap-1 text-red-500">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500/40" aria-hidden />
            {L.templateUnknownPlaceholders(bad.join(", "))}
          </span>
        )}
      </div>

      {preview && (
        <details className="mt-3 rounded-lg border border-edge2/70" open>
          <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-faint hover:text-soft">
            {previewLabel ? L.previewWith(previewLabel) : L.previewToggle}
          </summary>
          <div className="whitespace-pre-wrap border-t border-edge2/70 px-3 py-2.5 text-xs leading-relaxed text-soft">
            {preview}
          </div>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={saving || (!dirty && Boolean(current))}
          className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? t.common.saving : dirty || !current ? L.templateSave : L.templateSavedState}
        </button>
        {/* Steht vor dem Zuruecksetzen: der haeufigere Handgriff gehoert
            nach vorn, und "aus dem Angebot" ist fuer ein leeres Feld die
            bessere Antwort als eine allgemeine Beispielvorlage. */}
        {offerId && (
          <button
            onClick={ausAngebot}
            disabled={generating}
            className="rounded-lg border border-sky-500/40 px-3 py-1.5 text-xs text-sky-600 transition-colors hover:bg-sky-500/10 disabled:opacity-40 dark:text-sky-400"
          >
            {generating ? L.templateGenerating : L.templateFromOffer}
          </button>
        )}
        <button
          onClick={() => onTemplateChange(getDefaultLinkedInTemplate(lang))}
          className="rounded-lg border border-edge2 px-3 py-1.5 text-xs text-soft transition-colors hover:text-ink"
        >
          {L.templateReset}
        </button>

        {/* Verwalten nur, wenn es etwas zu verwalten gibt. */}
        {current && (
          <span className="ml-auto flex items-center gap-2 text-[11px]">
            {!current.is_default && (
              <button onClick={makeDefault} disabled={busy} className="text-faint transition-colors hover:text-ink disabled:opacity-40">
                {L.templateMakeDefault}
              </button>
            )}
            <button onClick={renameTemplate} disabled={busy} className="text-faint transition-colors hover:text-ink disabled:opacity-40">
              {L.templateRename}
            </button>
            <button
              onClick={removeTemplate}
              disabled={busy}
              className="text-faint transition-colors hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
            >
              {t.common.delete}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
