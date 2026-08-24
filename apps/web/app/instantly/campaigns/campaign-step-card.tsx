"use client";
import { useRef, useState } from "react";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";
import { inputCls } from "@/lib/ui";
import { plainTextToInstantlyHtml, variantLabel, WEBSITE_FINDING_FIELD } from "@/lib/instantly/campaigns";
import EmailQualityPanel from "./email-quality-panel";
import HighlightedTextarea from "../../highlighted-textarea";
import type { Highlights } from "@/lib/email-quality";
import type { StepVariant } from "@/lib/instantly/campaigns";
import type { Dictionary } from "@/lib/i18n/dict";
import type { Step } from "./campaign-form";

// Eine Karte der Sequenz: Betreff, Text, Variablen-Buttons und die
// Qualitaetspruefung. Eigene Komponente, weil Textfeld und Pruef-Panel sich
// den Analysestand teilen (die Markierungen im Text kommen aus demselben
// Befund wie die Liste darunter); in der Schleife ueber alle Schritte in
// campaign-form.tsx liesse sich dafuer kein State halten.

/**
 * Die Merge-Tags mit ihrer Beschriftung.
 *
 * Namen/Syntax ({{firstName}} etc.) muessen exakt Instantlys vordefinierten
 * Lead-Variablen entsprechen (siehe https://help.instantly.ai/en/articles/6135930),
 * sonst wird beim Versand nichts ersetzt.
 *
 * {{websiteFinding}} ist die eine Ausnahme: keine vordefinierte Variable,
 * sondern ein Feld, das mit dem Lead hochgeladen wird (WEBSITE_FINDING_FIELD
 * in lib/instantly/campaigns.ts). Der Name steht deshalb nicht doppelt hier,
 * sondern kommt aus derselben Konstante wie der Upload-Schluessel.
 *
 * Als Funktion und exportiert, weil die Mail-Vorschau (mail-preview.tsx)
 * dieselbe Zuordnung braucht: sie benennt die Variable, die bei einem Lead
 * leer geblieben ist. Zwei Listen wuerden auseinanderlaufen, und dann hiesse
 * derselbe Tag im Editor "Website-Mangel" und in der Vorschau anders.
 */
export function mergeTagOptions(
  F: Dictionary["instantly"]["campaigns"]["form"]
): { token: string; label: string }[] {
  return [
    { token: "{{firstName}}", label: F.variableFirstName },
    { token: "{{lastName}}", label: F.variableLastName },
    { token: "{{companyName}}", label: F.variableCompanyName },
    { token: "{{email}}", label: F.variableEmail },
    { token: "{{personalization}}", label: F.variablePersonalization },
    { token: `{{${WEBSITE_FINDING_FIELD}}}`, label: F.variableWebsiteFinding },
  ];
}

export default function CampaignStepCard({
  index,
  step,
  onChange,
  onRemove,
  canRemove,
  offerId,
  onActive,
}: {
  index: number;
  step: Step;
  onChange: (patch: Partial<Step>) => void;
  onRemove: () => void;
  canRemove: boolean;
  /** Zusammenhang fuers Nachschaerfen. Optional: ohne Angebot kennt das
   *  Modell nur den vorhandenen Text. */
  offerId?: string | null;
  /** "An dieser Karte wird gerade gearbeitet", mit der Nummer der Fassung.
   *  Die Mail-Vorschau unter dem Formular folgt dem: sonst muesste man jeden
   *  Wechsel zweimal machen, einmal im Editor und einmal in der Vorschau. */
  onActive?: (variantIndex: number) => void;
}) {
  const { t } = useT();
  const F = t.instantly.campaigns.form;
  const R = t.copyGen.refine;
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  /**
   * Nachschaerfen: eine Anweisung, eine Fassung zurueck.
   *
   * `vorher` haelt den letzten Stand fuer den Zurueck-Schritt. Ohne ihn traut
   * sich niemand, eine fertige Fassung noch einmal anzufassen, und genau
   * dann bleibt der erste Entwurf stehen, obwohl er besser sein koennte.
   */
  const [anweisung, setAnweisung] = useState("");
  const [schaerft, setSchaerft] = useState(false);
  const [vorher, setVorher] = useState<StepVariant | null>(null);

  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeField, setActiveField] = useState<"subject" | "body">("body");
  const [highlights, setHighlights] = useState<Highlights | null>(null);
  /**
   * Welche Fassung gerade bearbeitet wird.
   *
   * Reiter statt untereinander: zwei Fassungen desselben Schritts sind
   * Alternativen, keine Fortsetzung. Untereinander gestellt liest man sie
   * unwillkuerlich als zwei aufeinanderfolgende Mails, und genau das sind
   * sie nicht.
   */
  const [activeVariant, setActiveVariant] = useState(0);

  // Nach dem Loeschen der letzten Fassung zeigt der Index sonst ins Leere.
  const vi = Math.min(activeVariant, step.variants.length - 1);
  const variant = step.variants[vi] ?? { subject: "", body: "" };

  function patchVariant(patch: Partial<StepVariant>) {
    onChange({ variants: step.variants.map((v, i) => (i === vi ? { ...v, ...patch } : v)) });
  }

  function addVariant() {
    // Leer statt als Kopie: eine kopierte Fassung, an der man zwei Woerter
    // aendert, misst nichts; der Sinn des Vergleichs ist ein echter
    // Gegenentwurf.
    onChange({ variants: [...step.variants, { subject: "", body: "" }] });
    setActiveVariant(step.variants.length);
    onActive?.(step.variants.length);
  }

  function removeVariant() {
    onChange({ variants: step.variants.filter((_, i) => i !== vi) });
    setActiveVariant(Math.max(0, vi - 1));
  }

  /**
   * Abschalten statt loeschen: der Handgriff, wenn ein Gewinner feststeht.
   *
   * Eine geloeschte Verliererin nimmt ihre Zahlen mit ins Grab, und die
   * naechste Kampagne wiederholt denselben Fehler. Abgeschaltet bleibt sie in
   * der Auswertung stehen und wird nur nicht mehr versendet (Instantlys
   * v_disabled).
   *
   * Die letzte aktive Fassung laesst sich nicht abschalten: ein Schritt ohne
   * eine einzige sendbare Variante verschickt nichts, und zwar still.
   */
  const activeVariants = step.variants.filter((v) => !v.disabled).length;
  const canDisable = !variant.disabled ? activeVariants > 1 : true;

  function toggleDisabled() {
    if (!canDisable) return;
    onChange({
      variants: step.variants.map((v, i) => (i === vi ? { ...v, disabled: !v.disabled } : v)),
    });
  }

  // Variablen per Klick einfuegen statt selbst tippen zu muessen: fuegt im
  // zuletzt fokussierten Feld an der Cursor-Position ein. Die Liste steht in
  // mergeTagOptions (oben), weil die Mail-Vorschau dieselbe Zuordnung braucht.
  const VARIABLES = mergeTagOptions(F);

  // Eigener Opt-out-Link statt eines weiteren Instantly-Merge-Tags: die
  // Workspace-ID ist schon zum Einfuegezeitpunkt bekannt und wird direkt in
  // die URL geschrieben, nur {{email}} bleibt als echtes Instantly-Merge-Tag
  // stehen (das ersetzt Instantly beim Versand pro Empfaenger). Der Klick
  // landet auf /api/unsubscribe, das die Adresse ohne Login in die Sperrliste
  // eintraegt; CAN-SPAM verlangt einen Opt-out ohne zusaetzliche Huerden.
  function optOutLink(): string {
    return `${window.location.origin}/api/unsubscribe?ws=${workspaceId}&email={{email}}`;
  }

  async function nachschaerfen() {
    if (!anweisung.trim() || !variant.body.trim()) return;
    setSchaerft(true);
    const res = await fetch("/api/copy/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offerId,
        stepNumber: index + 1,
        subject: variant.subject,
        body: variant.body,
        instruction: anweisung.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSchaerft(false);
    if (!res.ok) return push(t.common.error + (body.error ?? res.status), "error");
    setVorher({ subject: variant.subject, body: variant.body });
    patchVariant(body.variant as StepVariant);
    setAnweisung("");
    if ((body.unknownTags ?? []).length > 0) {
      // Nicht still entfernen: ein herausgeschnittener Platzhalter zerreisst
      // den Satz. Der Nutzer soll sehen, was gebaut wurde.
      push(R.unknownTags((body.unknownTags as string[]).join(", ")), "error");
    }
  }

  function zurueck() {
    if (!vorher) return;
    patchVariant(vorher);
    setVorher(null);
  }

  function insertVariable(token: string) {
    const el = activeField === "subject" ? subjectRef.current : bodyRef.current;
    const current = variant[activeField];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    patchVariant({ [activeField]: current.slice(0, start) + token + current.slice(end) } as Partial<StepVariant>);
    // Cursor hinter das eingefuegte Token setzen, nachdem React den neuen Wert gerendert hat.
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  return (
    // onFocusCapture statt onClick: es meldet die Karte auch dann als aktiv,
    // wenn man mit der Tabulatortaste hineinwandert, und feuert nicht bei
    // jedem Klick daneben.
    <div className="rounded-lg border border-edge2 p-3" onFocusCapture={() => onActive?.(vi)}>
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

      {/* Reiter nur zeigen, wenn es etwas zu waehlen gibt — bei einer
          einzigen Fassung waere ein Reiter "A" ohne Nachbarn eine Frage ohne
          Antwortmoeglichkeit. Der Knopf zum Hinzufuegen steht trotzdem da. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {step.variants.length > 1 &&
          step.variants.map((v, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setActiveVariant(i);
                onActive?.(i);
              }}
              className={
                "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors " +
                (i === vi
                  ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                  : "border-edge2 text-faint hover:border-sky-500/50") +
                (v.disabled ? " line-through opacity-60" : "")
              }
            >
              {F.variantLabel(variantLabel(i))}
            </button>
          ))}
        <button
          type="button"
          onClick={addVariant}
          className="rounded-md border border-dashed border-edge2 px-2.5 py-1 text-[11px] text-faint transition-colors hover:border-sky-500/50 hover:text-sky-600 dark:hover:text-sky-400"
        >
          {F.addVariant}
        </button>
        {step.variants.length > 1 && (
          <>
            <button
              type="button"
              onClick={toggleDisabled}
              disabled={!canDisable}
              title={canDisable ? undefined : F.lastVariantHint}
              className="text-[11px] text-faint transition-colors hover:text-ink disabled:opacity-40"
            >
              {variant.disabled ? F.enableVariant(variantLabel(vi)) : F.disableVariant(variantLabel(vi))}
            </button>
            <button type="button" onClick={removeVariant} className="text-[11px] text-red-500 hover:text-red-400">
              {F.removeVariant(variantLabel(vi))}
            </button>
          </>
        )}
      </div>
      {step.variants.length > 1 && (
        <p className="mb-2 text-[11px] text-mute">
          {variant.disabled ? F.variantDisabledHint(variantLabel(vi)) : F.variantHint}
        </p>
      )}

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
        value={variant.subject}
        onChange={(e) => patchVariant({ subject: e.target.value })}
        onFocus={() => setActiveField("subject")}
        className={inputCls + " mb-2 w-full"}
      />
      <HighlightedTextarea
        textareaRef={bodyRef}
        placeholder={F.bodyPlaceholder}
        value={variant.body}
        onChange={(body) => patchVariant({ body })}
        onFocus={() => setActiveField("body")}
        rows={4}
        highlights={highlights}
      />
      {/* Vorschau auf das, was tatsaechlich rausgeht.
          Das Textfeld zeigt Klartext, versendet wird aber HTML — und wie die
          Absaetze dort ankommen, sah man bisher erst NACH dem Versand. Hier
          wird genau derselbe Aufruf gerendert, der auch an Instantly geht
          (plainTextToInstantlyHtml), inklusive der Merge-Tags: die bleiben
          bewusst als {{firstName}} stehen, weil pro Empfaenger etwas anderes
          eingesetzt wird und eine erfundene Beispielperson hier mehr
          verspraeche, als die Vorschau halten kann.
          dangerouslySetInnerHTML ist unkritisch: plainTextToInstantlyHtml
          maskiert &, < und > und setzt danach ausschliesslich eigene Tags. */}
      {variant.body.trim().length > 0 && (
        <details className="mt-2 rounded-lg border border-edge2/70">
          <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-faint hover:text-soft">
            {F.previewToggle}
          </summary>
          <div
            className="border-t border-edge2/70 px-3 py-2.5 text-sm leading-relaxed text-soft [&_div]:min-h-[1em]"
            dangerouslySetInnerHTML={{ __html: plainTextToInstantlyHtml(variant.body) }}
          />
        </details>
      )}
      {/* Nachschaerfen — am Text angedockt, nicht in einem eigenen
          Chatfenster. Ein leeres Chatfeld ist dasselbe leere Blatt wie ein
          leeres Textfeld, nur mit blinkendem Cursor; hier hat die Anweisung
          einen Gegenstand, und der letzte Stand steht immer darueber.

          Erscheint erst, wenn ueberhaupt Text da ist: an einer leeren Fassung
          gibt es nichts nachzuschaerfen, dafuer ist der Sequenzgenerator
          zustaendig. */}
      {variant.body.trim().length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            value={anweisung}
            onChange={(e) => setAnweisung(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                nachschaerfen();
              }
            }}
            placeholder={R.placeholder}
            className={inputCls + " min-w-48 flex-1 px-2.5 py-1 text-[13px]"}
          />
          <button
            type="button"
            onClick={nachschaerfen}
            disabled={schaerft || !anweisung.trim()}
            className="rounded-md border border-edge2 px-2.5 py-1 text-[11px] text-soft transition-colors hover:border-sky-500/50 hover:text-sky-600 disabled:opacity-40 dark:hover:text-sky-400"
          >
            {schaerft ? R.working : R.apply}
          </button>
          {vorher && (
            <button
              type="button"
              onClick={zurueck}
              className="text-[11px] text-faint transition-colors hover:text-ink"
            >
              {R.undo}
            </button>
          )}
        </div>
      )}

      <EmailQualityPanel subject={variant.subject} body={variant.body} onHighlightsChange={setHighlights} />
    </div>
  );
}
