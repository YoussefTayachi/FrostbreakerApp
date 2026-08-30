"use client";
import { useEffect, useState } from "react";
import { useT } from "../../language-provider";
import { inputCls, primaryBtnCls } from "@/lib/ui";
import {
  INSTANTLY_TIMEZONE_OPTIONS,
  defaultInstantlyTimezone,
  type StepVariant,
} from "@/lib/instantly/campaigns";
import type { PreviewSelection } from "@/lib/instantly/preview-selection";
import CampaignStepCard from "./campaign-step-card";
import MailPreview from "./mail-preview";

type Account = { email: string; status: number };
/** Ein Sequenzschritt im Formular. Mindestens eine Fassung, siehe StepVariant. */
export type Step = { variants: StepVariant[]; delayDays: number };
export type CampaignFormValue = {
  name: string;
  mailboxes: string[];
  steps: Step[];
  days: number[];
  from: string;
  to: string;
  timezone: string;
  dailyLimit: string;
  /** Zaehlpixel und Link-Umschreibung. Beide kosten Zustellbarkeit, deshalb
   *  aus (siehe die Erlaeuterung im Formular). */
  openTracking: boolean;
  linkTracking: boolean;
};

const DAY_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function emptyCampaignFormValue(): CampaignFormValue {
  return {
    name: "",
    mailboxes: [],
    steps: [{ variants: [{ subject: "", body: "" }], delayDays: 0 }],
    days: [1, 2, 3, 4, 5],
    from: "09:00",
    to: "17:00",
    timezone: defaultInstantlyTimezone(),
    dailyLimit: "50",
    openTracking: false,
    linkTracking: false,
  };
}

/**
 * Reines Formular fuer Kampagnen-Name/Mailboxen/Sequenz/Zeitplan; wird
 * sowohl beim Anlegen (campaigns/new) als auch beim Bearbeiten
 * (campaigns/[id]) verwendet. Haelt selbst keinen Server-State, der Aufrufer
 * kontrolliert `value`/`onChange` und entscheidet, was beim Submit passiert
 * (POST vs. PATCH): so bleibt die Logik fuer "anlegen" vs. "bearbeiten" an
 * einer Stelle je Seite, statt in einer gemeinsamen Komponente verzweigt zu
 * werden.
 */
export default function CampaignForm({
  value,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  submittingLabel,
  beforeSubmit,
  submitDisabled,
  offerId,
  previewSearchIds,
}: {
  value: CampaignFormValue;
  onChange: (v: CampaignFormValue) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  submittingLabel: string;
  /** Platz direkt ueber dem Absenden-Knopf: beim Anlegen sitzt dort der
   *  Torwart (campaign-readiness-panel). Beim Bearbeiten bleibt er leer: die
   *  Kampagne laeuft dann schon, und eine Startbedingung waere zu spaet. */
  beforeSubmit?: React.ReactNode;
  submitDisabled?: boolean;
  /** Das gewaehlte Angebot, nur fuers Nachschaerfen je Stufe. Ohne es
   *  funktioniert das Nachschaerfen weiter, das Modell kennt dann nur den
   *  vorhandenen Text und nicht das Geschaeft dahinter. */
  offerId?: string | null;
  /**
   * Die Lead-Listen, aus denen die Mail-Vorschau echte Empfaenger holt.
   *
   * UNDEFINED heisst: keine Vorschau. Genau das ist der Fall auf der
   * Detailseite einer laufenden Kampagne ([id]/campaign-detail.tsx): an
   * campaigns haengen keine searchIds, und eine Vorschau ohne Empfaenger waere
   * dort eine leere Karte, die nach einem Fehler aussieht. Ein leeres Array
   * ist etwas anderes -- es heisst "es gibt eine Auswahl, sie ist nur noch
   * leer", und dazu sagt die Vorschau einen Satz.
   */
  previewSearchIds?: string[];
}) {
  const { t } = useT();
  const F = t.instantly.campaigns.form;
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  /**
   * Welche Stufe/Fassung die Mail-Vorschau zeigt.
   *
   * Liegt hier und nicht in der Vorschau, weil sie von zwei Seiten gesetzt
   * wird: von den Stufenkarten (wer eine Karte anfasst, will sie unten sehen)
   * und von der Vorschau selbst. Zwei Zustaende dafuer waeren zwei
   * Wahrheiten, und eine davon waere immer die falsche.
   */
  const [previewSel, setPreviewSel] = useState<PreviewSelection>({ step: 0, variant: 0 });

  useEffect(() => {
    fetch("/api/instantly/accounts")
      .then((r) => r.json())
      .then((body) => setAccounts(body.items ?? []))
      .catch(() => setAccounts([]));
  }, []);

  function toggleDay(d: number) {
    onChange({ ...value, days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort() });
  }

  function toggleMailbox(email: string) {
    onChange({
      ...value,
      mailboxes: value.mailboxes.includes(email) ? value.mailboxes.filter((x) => x !== email) : [...value.mailboxes, email],
    });
  }

  function updateStep(i: number, patch: Partial<Step>) {
    onChange({ ...value, steps: value.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  }

  function addStep() {
    onChange({ ...value, steps: [...value.steps, { variants: [{ subject: "", body: "" }], delayDays: 3 }] });
  }

  function removeStep(i: number) {
    onChange({ ...value, steps: value.steps.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="space-y-4">
      <input
        placeholder={F.namePlaceholder}
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        className={inputCls + " w-full"}
      />

      <div>
        <p className="mb-1.5 text-xs font-medium text-faint">{F.mailboxesLabel}</p>
        {accounts === null && <p className="text-xs text-faint">{t.common.saving}</p>}
        {accounts !== null && accounts.length === 0 && <p className="text-xs text-faint">{F.noMailboxes}</p>}
        <div className="flex flex-wrap gap-2">
          {(accounts ?? []).map((a) => (
            <button
              key={a.email}
              type="button"
              onClick={() => toggleMailbox(a.email)}
              // max-w-full + truncate: eine Adresse wie
              // "kontakt@sehr-lange-agentur-domain.de" ist breiter als ein
              // 375er Bildschirm. Ohne die Begrenzung schiebt genau ein
              // Postfach die ganze Seite waagerecht auf. py-2 statt py-1: das
              // Ding wird angetippt, nicht angeklickt. title traegt die
              // vollstaendige Adresse fuer den abgeschnittenen Fall.
              title={a.email}
              className={
                "max-w-full truncate rounded-full border px-3 py-2 text-xs transition-colors sm:py-1 " +
                (value.mailboxes.includes(a.email)
                  ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                  : "border-edge2 text-faint hover:border-sky-500/50")
              }
            >
              {a.email}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium text-faint">{F.sequenceLabel}</p>
        {value.steps.map((s, i) => (
          <CampaignStepCard
            key={i}
            index={i}
            step={s}
            onChange={(patch) => updateStep(i, patch)}
            onRemove={() => removeStep(i)}
            canRemove={value.steps.length > 1}
            offerId={offerId}
            onActive={(variant) => setPreviewSel({ step: i, variant })}
            inlinePreview={previewSearchIds === undefined}
          />
        ))}
        <button type="button" onClick={addStep} className="text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400">
          {F.addStep}
        </button>
      </div>

      {/* UNTER den Stufenkarten und in voller Breite, nicht neben ihnen: die
          Vorschau ist das Ergebnis der Karten darueber, und wer sie liest,
          liest eine Mail und keine Spalte. Sie steht ausserdem vor dem
          Zeitplan, weil sie zum Text gehoert -- zwischen Absenden-Knopf und
          Text waere sie das, was man nach dem Schreiben ueberspringt. */}
      {previewSearchIds !== undefined && (
        <MailPreview
          searchIds={previewSearchIds}
          steps={value.steps}
          selection={previewSel}
          onSelectionChange={setPreviewSel}
        />
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-faint">{F.scheduleLabel}</p>
        {/* Drei Bloecke untereinander statt einer einzigen umbrechenden Reihe.

            Die alte Reihe war `flex flex-wrap` ueber sieben Tagesknoepfe, zwei
            Uhrzeiten, ein 192 Pixel breites Zeitzonenfeld und das Tageslimit.
            Bei 343 Pixeln nutzbarer Breite brach das an unvorhersehbaren
            Stellen um: das Wort "bis" landete am Zeilenende ohne die Uhrzeit,
            zu der es gehoerte, und das Zeitzonenfeld stand allein in einer
            Zeile mit einem halben Tagesknopf darueber. Umbrechen ist keine
            Ordnung, es ist nur das Fehlen einer Ordnung.

            Gestapelt gehoert jede Zeile zu einer Frage: an welchen Tagen, zu
            welchen Zeiten, wie viele. Ab sm stehen Zeit und Zeitzone wieder
            nebeneinander -- dort ist der Platz da. */}
        <div className="space-y-3">
          {/* grid-cols-7 statt flex: sieben gleich breite Knoepfe ueber die
              volle Breite. h-10 auf dem Handy (die 28px von h-7 sind unter dem
              Daumen ein Zielfehler, kein Ziel), ab sm zurueck auf die
              kompakten Quadrate der Schreibtischansicht. */}
          <div className="grid grid-cols-7 gap-1 sm:flex sm:gap-1">
            {DAY_LABELS.map((label, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={
                  "h-10 rounded-md border text-xs transition-colors sm:h-7 sm:w-7 sm:text-[11px] " +
                  (value.days.includes(d)
                    ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                    : "border-edge2 text-faint hover:border-sky-500/50")
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* min-w-0 flex-1 an den Zeitfeldern: ohne das behaelt ein
                type=time seine eigene Wunschbreite, und die beiden zusammen
                mit dem "bis" passen auf 343 Pixel nicht in eine Zeile. */}
            <input
              type="time"
              value={value.from}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className={inputCls + " min-w-0 flex-1 sm:flex-none"}
            />
            <span className="shrink-0 text-xs text-faint">{F.until}</span>
            <input
              type="time"
              value={value.to}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className={inputCls + " min-w-0 flex-1 sm:flex-none"}
            />
            {/* Volle Breite in einer eigenen Zeile auf dem Handy: die
                Zeitzonennamen sind lang, und ein 192-Pixel-Feld schneidet sie
                mitten im Wort ab. */}
            <select
              value={value.timezone}
              onChange={(e) => onChange({ ...value, timezone: e.target.value })}
              className={inputCls + " w-full sm:w-48"}
            >
              {INSTANTLY_TIMEZONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Beschriftet, nicht nur per Platzhalter: das Feld ist mit "50"
              vorbelegt, dadurch war der Platzhalter nie sichtbar und daneben
              stand eine nackte Zahl ohne jede Erklaerung. Die Uhrzeit- und
              Zeitzonenfelder erklaeren sich von selbst, diese Zahl nicht. */}
          <label className="flex items-center gap-2 text-xs text-faint">
            {F.dailyLimitLabel}
            <input
              type="number"
              min={1}
              value={value.dailyLimit}
              onChange={(e) => onChange({ ...value, dailyLimit: e.target.value })}
              className={inputCls + " w-24"}
              placeholder={F.dailyLimitPlaceholder}
            />
          </label>
        </div>
        <p className="mt-1.5 text-xs text-mute">{F.dailyLimitHint}</p>
      </div>

      {/* Bewusste Entscheidung statt Instantlys Vorgabe.
          instantly_campaign_stats meldete am 2026-08-04 ueber alle Kampagnen
          open_count = 0 — damit liess sich "gar nicht zugestellt" nicht von
          "gelesen, aber uninteressant" unterscheiden. Beides einzuschalten
          ist trotzdem nicht die Standardantwort: der Zaehlpixel und
          umgeschriebene Links sind zwei der Merkmale, an denen Spamfilter
          kalte Massenmails erkennen. */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-faint">{F.trackingLabel}</p>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={value.openTracking}
              onChange={(e) => onChange({ ...value, openTracking: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              {F.openTracking}
              <span className="block text-xs text-faint">{F.openTrackingHint}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={value.linkTracking}
              onChange={(e) => onChange({ ...value, linkTracking: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              {F.linkTracking}
              <span className="block text-xs text-faint">{F.linkTrackingHint}</span>
            </span>
          </label>
        </div>
      </div>

      {beforeSubmit}

      {/* Volle Breite auf dem Handy. Er steht am Ende eines langen
          Formulars, das man mit dem Daumen durchgescrollt hat -- der letzte
          Handgriff soll kein 130 Pixel breites Ziel am linken Rand sein. */}
      <button
        onClick={onSubmit}
        disabled={submitting || submitDisabled}
        className={primaryBtnCls + " w-full sm:w-auto"}
      >
        {submitting ? submittingLabel : submitLabel}
      </button>
    </div>
  );
}
