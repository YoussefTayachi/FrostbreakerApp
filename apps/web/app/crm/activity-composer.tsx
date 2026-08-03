"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ACTIVITY_CHANNELS,
  ACTIVITY_TYPES,
  defaultChannelFor,
  outcomesFor,
  supportsDuration,
  supportsOutcome,
  type ActivityChannel,
  type ActivityOutcome,
  type ActivityType,
} from "@/lib/crm/activities";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

/**
 * Kontaktaufnahme loggen oder Aufgabe planen.
 *
 * Zwei Faelle in einem Formular, unterschieden ueber die Faelligkeit:
 *   - Faelligkeit leer  -> bereits passiert, wird sofort als erledigt gespeichert
 *                          (occurred_at + completed_at = jetzt)
 *   - Faelligkeit gesetzt -> geplante Aufgabe, bleibt offen und taucht im
 *                          "Heute faellig"-Widget auf
 *
 * Typ und Kanal sind getrennt (Migration 0057): der Typ ist die Form der
 * Interaktion, der Kanal das Medium. Welche Ergebnisse zur Auswahl stehen,
 * haengt am Typ -- "Mailbox" ergibt bei einer LinkedIn-DM keinen Sinn, siehe
 * outcomesFor() in lib/crm/activities.ts.
 */
export default function ActivityComposer({
  contactId,
  businessId,
  onSaved,
}: {
  contactId?: string;
  businessId?: string;
  /** Ergebnis wird mitgegeben, damit der Aufrufer den Kontaktstatus nachziehen kann. */
  onSaved: (outcome: ActivityOutcome | null) => void;
}) {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const C = t.crm;

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ActivityType>("call");
  const [channel, setChannel] = useState<ActivityChannel | null>(defaultChannelFor("call"));
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<ActivityOutcome | "">("");
  const [minutes, setMinutes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  /**
   * Typwechsel zieht Kanal und Ergebnis mit: ein beim Anruf gewaehltes
   * "Mailbox" bliebe sonst stehen, wenn danach auf "Nachricht" umgestellt
   * wird -- und waere dort ein Wert, den das Dropdown gar nicht mehr anbietet.
   */
  function changeType(next: ActivityType) {
    setType(next);
    setChannel(defaultChannelFor(next));
    setOutcome((current) =>
      current && outcomesFor(next).includes(current as ActivityOutcome) ? current : ""
    );
  }

  function reset() {
    setType("call");
    setChannel(defaultChannelFor("call"));
    setSubject("");
    setNote("");
    setOutcome("");
    setMinutes("");
    setDueDate("");
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    const now = new Date().toISOString();
    const planned = Boolean(dueDate);
    const parsedMinutes = Number(minutes);

    const { error } = await createClient()
      .from("activities")
      .insert({
        workspace_id: workspaceId,
        contact_id: contactId ?? null,
        business_id: contactId ? null : (businessId ?? null),
        type,
        channel,
        subject: subject.trim() || null,
        note: note.trim() || null,
        outcome: supportsOutcome(type) && outcome ? outcome : null,
        duration_seconds:
          supportsDuration(type) && Number.isFinite(parsedMinutes) && parsedMinutes > 0
            ? Math.round(parsedMinutes * 60)
            : null,
        // Ende des gewaehlten Tages, damit eine Aufgabe nicht um 00:00 schon
        // als ueberfaellig gilt.
        due_at: planned ? new Date(dueDate + "T23:59:59").toISOString() : null,
        occurred_at: planned ? null : now,
        completed_at: planned ? null : now,
      });

    setSaving(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    const savedOutcome = supportsOutcome(type) && outcome ? outcome : null;
    reset();
    setOpen(false);
    push(C.activitySaved, "success");
    onSaved(savedOutcome);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-edge3 px-3 py-2 text-xs font-medium text-faint transition-colors hover:border-sky-500/60 hover:text-sky-600 dark:hover:text-sky-400"
      >
        + {C.activityHeading}
      </button>
    );
  }

  const fieldCls =
    "rounded-lg border border-edge2 bg-field px-2.5 py-1.5 text-xs text-ink placeholder-mute outline-none transition-colors focus:border-sky-500";

  return (
    <div className="rounded-lg border border-edge/60 bg-panel p-3">
      <p className="mb-2 text-xs font-medium text-ink">{C.activityHeading}</p>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {ACTIVITY_TYPES.map((option) => (
          <button
            key={option}
            onClick={() => changeType(option)}
            className={
              "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors " +
              (type === option
                ? "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
            }
          >
            {C.activityTypeLabels[option] ?? option}
          </button>
        ))}
      </div>

      {/* Kanal: bei einer Aufgabe optional (sie hat kein Medium), sonst die
          Angabe, die spaeter in der Timeline und in Auswertungen zeigt, ueber
          welchen Weg der Kontakt entstanden ist. */}
      <div className="mb-2">
        <p className="mb-1 text-[10px] font-medium text-faint">{C.activityChannelLabel}</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setChannel(null)}
            className={
              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors " +
              (channel === null
                ? "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
            }
          >
            {C.activityChannelNone}
          </button>
          {ACTIVITY_CHANNELS.map((option) => (
            <button
              key={option}
              onClick={() => setChannel(option)}
              className={
                "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors " +
                (channel === option
                  ? "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                  : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
              }
            >
              {C.activityChannelLabels[option] ?? option}
            </button>
          ))}
        </div>
      </div>

      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={C.activitySubjectPlaceholder}
        className={fieldCls + " mb-2 w-full"}
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={C.activityNotePlaceholder}
        rows={2}
        className={fieldCls + " mb-2 w-full"}
      />

      <div className="grid gap-2 sm:grid-cols-3">
        {supportsOutcome(type) && (
          <label className="text-[10px] font-medium text-faint">
            {C.activityOutcomeLabel}
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as ActivityOutcome | "")}
              className={fieldCls + " mt-0.5 w-full"}
            >
              <option value="">{C.activityOutcomeNone}</option>
              {outcomesFor(type).map((option) => (
                <option key={option} value={option}>
                  {C.activityOutcomeLabels[option] ?? option}
                </option>
              ))}
            </select>
          </label>
        )}
        {supportsDuration(type) && (
          <label className="text-[10px] font-medium text-faint">
            {C.activityDurationLabel}
            <input
              type="number"
              min={0}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className={fieldCls + " mt-0.5 w-full"}
            />
          </label>
        )}
        <label className="text-[10px] font-medium text-faint" title={C.activityDueHint}>
          {C.activityDueLabel}
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={fieldCls + " mt-0.5 w-full"}
          />
        </label>
      </div>

      <p className="mt-1.5 text-[10px] text-mute">{C.activityDueHint}</p>

      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded-lg border border-edge2 px-3 py-1.5 text-xs text-soft transition-colors hover:text-ink"
        >
          {C.dealCancel}
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? C.activitySaving : C.activitySave}
        </button>
      </div>
    </div>
  );
}
