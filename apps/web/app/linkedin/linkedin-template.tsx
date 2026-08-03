"use client";
import { useMemo, useRef, useState } from "react";
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
 * Der Vorlagen-Editor -- bewusst nach dem Vorbild des Kampagnen-Schritts
 * (instantly/campaigns/campaign-step-card.tsx) gebaut, damit sich beides
 * gleich anfuehlt: Variablen als Knoepfe, die an der Cursor-Position
 * einfuegen, farbig markiert im Text, darunter eine Vorschau.
 *
 * Der wesentliche Unterschied zum Kampagnen-Editor: dort faerbt
 * HighlightedTextarea Qualitaetsbefunde ein, hier die Variablen selbst --
 * blau, wenn sie ersetzt werden, rot, wenn sie sich niemand ausdenken kann
 * und der Text so beim Empfaenger landet.
 */
export default function LinkedInTemplate({
  template,
  onTemplateChange,
  isCustom,
  previewValues,
  previewLabel,
}: {
  template: string;
  onTemplateChange: (next: string) => void;
  /** false = es gilt noch die Vorgabe aus dem Code, nichts wurde je gespeichert. */
  isCustom: boolean;
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
  const [savedTemplate, setSavedTemplate] = useState(template);

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
   * man die geschweiften Klammern von Hand tippen -- und genau dabei entsteht
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

  async function save() {
    setSaving(true);
    const { error } = await createClient()
      .from("workspaces")
      .update({ linkedin_message_template: template.trim() || null })
      .eq("id", workspaceId);
    setSaving(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setSavedTemplate(template);
    push(L.templateSaved, "success");
  }

  return (
    <div className="rounded-xl border border-edge/60 bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">{L.templateHeading}</h2>
          <p className="text-xs text-faint">{L.templateHint}</p>
        </div>
        {!isCustom && !dirty && (
          <span className="rounded-full bg-chip px-2 py-0.5 text-[10px] text-mute">{L.templateIsDefault}</span>
        )}
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
          disabled={saving || !dirty}
          className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? t.common.saving : dirty ? L.templateSave : L.templateSavedState}
        </button>
        <button
          onClick={() => onTemplateChange(getDefaultLinkedInTemplate(lang))}
          className="rounded-lg border border-edge2 px-3 py-1.5 text-xs text-soft transition-colors hover:text-ink"
        >
          {L.templateReset}
        </button>
      </div>
    </div>
  );
}
