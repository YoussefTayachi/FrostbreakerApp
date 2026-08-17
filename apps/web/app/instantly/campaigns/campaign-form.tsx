"use client";
import { useEffect, useState } from "react";
import { useT } from "../../language-provider";
import { inputCls, primaryBtnCls } from "@/lib/ui";
import {
  INSTANTLY_TIMEZONE_OPTIONS,
  defaultInstantlyTimezone,
  type StepVariant,
} from "@/lib/instantly/campaigns";
import CampaignStepCard from "./campaign-step-card";

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
}) {
  const { t } = useT();
  const F = t.instantly.campaigns.form;
  const [accounts, setAccounts] = useState<Account[] | null>(null);

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
              className={
                "rounded-full border px-3 py-1 text-xs transition-colors " +
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
          />
        ))}
        <button type="button" onClick={addStep} className="text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400">
          {F.addStep}
        </button>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-faint">{F.scheduleLabel}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {DAY_LABELS.map((label, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={
                  "h-7 w-7 rounded-md border text-[11px] transition-colors " +
                  (value.days.includes(d)
                    ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                    : "border-edge2 text-faint hover:border-sky-500/50")
                }
              >
                {label}
              </button>
            ))}
          </div>
          <input type="time" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className={inputCls} />
          <span className="text-xs text-faint">{F.until}</span>
          <input type="time" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className={inputCls} />
          <select
            value={value.timezone}
            onChange={(e) => onChange({ ...value, timezone: e.target.value })}
            className={inputCls + " w-48"}
          >
            {INSTANTLY_TIMEZONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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

      <button onClick={onSubmit} disabled={submitting || submitDisabled} className={primaryBtnCls}>
        {submitting ? submittingLabel : submitLabel}
      </button>
    </div>
  );
}
