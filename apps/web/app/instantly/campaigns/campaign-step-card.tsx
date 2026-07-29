"use client";
import { useRef, useState } from "react";
import { useT } from "../../language-provider";
import { useWorkspace } from "../../workspace-provider";
import { inputCls } from "@/lib/ui";
import EmailQualityPanel from "./email-quality-panel";
import HighlightedTextarea from "./highlighted-textarea";
import type { Highlights } from "@/lib/email-quality";
import type { Step } from "./campaign-form";

// Eine Karte der Sequenz: Betreff, Text, Variablen-Buttons und die
// Qualitaetspruefung. Eigene Komponente, weil Textfeld und Pruef-Panel sich
// den Analysestand teilen (die Markierungen im Text kommen aus demselben
// Befund wie die Liste darunter) -- in der Schleife ueber alle Schritte in
// campaign-form.tsx liesse sich dafuer kein State halten.

export default function CampaignStepCard({
  index,
  step,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  step: Step;
  onChange: (patch: Partial<Step>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { t } = useT();
  const F = t.instantly.campaigns.form;
  const { workspaceId } = useWorkspace();

  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeField, setActiveField] = useState<"subject" | "body">("body");
  const [highlights, setHighlights] = useState<Highlights | null>(null);

  // Variablen per Klick einfuegen statt selbst tippen zu muessen: fuegt im
  // zuletzt fokussierten Feld an der Cursor-Position ein. Namen/Syntax
  // ({{firstName}} etc.) muessen exakt Instantlys vordefinierten
  // Lead-Variablen entsprechen (siehe https://help.instantly.ai/en/articles/6135930),
  // sonst wird beim Versand nichts ersetzt.
  const VARIABLES: { token: string; label: string }[] = [
    { token: "{{firstName}}", label: F.variableFirstName },
    { token: "{{lastName}}", label: F.variableLastName },
    { token: "{{companyName}}", label: F.variableCompanyName },
    { token: "{{email}}", label: F.variableEmail },
    { token: "{{personalization}}", label: F.variablePersonalization },
  ];

  // Eigener Opt-out-Link statt eines weiteren Instantly-Merge-Tags: die
  // Workspace-ID ist schon zum Einfuegezeitpunkt bekannt und wird direkt in
  // die URL geschrieben, nur {{email}} bleibt als echtes Instantly-Merge-Tag
  // stehen (das ersetzt Instantly beim Versand pro Empfaenger). Der Klick
  // landet auf /api/unsubscribe, das die Adresse ohne Login in die Sperrliste
  // eintraegt -- CAN-SPAM verlangt einen Opt-out ohne zusaetzliche Huerden.
  function optOutLink(): string {
    return `${window.location.origin}/api/unsubscribe?ws=${workspaceId}&email={{email}}`;
  }

  function insertVariable(token: string) {
    const el = activeField === "subject" ? subjectRef.current : bodyRef.current;
    const current = step[activeField];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    onChange({ [activeField]: current.slice(0, start) + token + current.slice(end) } as Partial<Step>);
    // Cursor hinter das eingefuegte Token setzen, nachdem React den neuen Wert gerendert hat.
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="rounded-lg border border-edge2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-soft">{F.stepLabel(index + 1)}</span>
        <div className="flex items-center gap-2">
          {index > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] text-faint">
              {F.delayLabel}
              <input
                type="number"
                min={0}
                value={step.delayDays}
                onChange={(e) => onChange({ delayDays: Number(e.target.value) || 0 })}
                className={inputCls + " w-16 px-2 py-1"}
              />
            </label>
          )}
          {canRemove && (
            <button type="button" onClick={onRemove} className="text-[11px] text-red-500 hover:text-red-400">
              {t.common.delete}
            </button>
          )}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-faint">{F.insertVariable}</span>
        {VARIABLES.map((v) => (
          <button
            key={v.token}
            type="button"
            onClick={() => insertVariable(v.token)}
            className="rounded-full border border-edge2 px-2 py-0.5 text-[11px] text-faint transition-colors hover:border-sky-500/50 hover:text-sky-600 dark:hover:text-sky-400"
          >
            {v.label}
          </button>
        ))}
        {/* Optisch abgesetzt: kein Lead-Datenfeld wie die anderen, sondern
            ein Sicherheits-/Compliance-Baustein. */}
        <span className="mx-0.5 h-3.5 w-px bg-edge2" aria-hidden />
        <button
          type="button"
          onClick={() => insertVariable(optOutLink())}
          className="rounded-full border border-edge2 px-2 py-0.5 text-[11px] text-faint transition-colors hover:border-sky-500/50 hover:text-sky-600 dark:hover:text-sky-400"
        >
          {F.variableOptOut}
        </button>
      </div>

      <input
        ref={subjectRef}
        placeholder={F.subjectPlaceholder}
        value={step.subject}
        onChange={(e) => onChange({ subject: e.target.value })}
        onFocus={() => setActiveField("subject")}
        className={inputCls + " mb-2 w-full"}
      />
      <HighlightedTextarea
        textareaRef={bodyRef}
        placeholder={F.bodyPlaceholder}
        value={step.body}
        onChange={(body) => onChange({ body })}
        onFocus={() => setActiveField("body")}
        rows={4}
        highlights={highlights}
      />
      <EmailQualityPanel subject={step.subject} body={step.body} onHighlightsChange={setHighlights} />
    </div>
  );
}
