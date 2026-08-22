"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  FIELD_INSTRUCTION_MAX,
  FIELD_LABEL_MAX,
  MAX_CUSTOM_FIELDS,
  slugifyFieldKey,
  type CustomFieldValues,
  type FieldFillFrom,
  type OfferFieldDefRow,
} from "@/lib/copy/offer-custom-fields";
import { FIELD_DEF_COLUMNS } from "@/lib/offer-field-defs";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import Herkunft from "./herkunft";

/**
 * Der Abschnitt fuer die eigenen Angebotsfelder (Migration 0098).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ZUSAETZLICH UND NICHT STATT DER ZWOELF
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die zwoelf festen Felder tragen benannte Rollen in der Mail-Architektur:
 * friction eroeffnet Mail 1, cta ist der Micro-Yes, ein leeres proof verbietet
 * jede Referenz. Ein eigenes Feld hat keine solche Rolle, es ist eine
 * zusaetzliche Notiz desselben Absenders. Deshalb steht dieser Abschnitt NACH
 * den vier Stufen und nicht zwischen ihnen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIE VERWALTUNG HIER STEHT UND NICHT IN DEN EINSTELLUNGEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die Definitionen wirken unmittelbar auf die Felder daneben. Eine eigene
 * Einstellungsseite trennte Ursache von Wirkung: man aendert eine Anweisung
 * und sieht an einer anderen Stelle der App, was sie bewirkt.
 *
 * Sie gelten aber fuer den GANZEN Workspace und nicht fuer dieses eine
 * Angebot, und genau das muss dranstehen: wer in "Risk Reversal" denkt, denkt
 * bei jedem Angebot so, aber niemand erwartet, dass eine Aenderung im
 * Angebotsformular alle anderen Angebote betrifft. Die WERTE gehoeren dem
 * Angebot, die DEFINITIONEN dem Workspace.
 *
 * Ohne eine einzige Definition ist hier genau ein leerer, zugeklappter
 * Abschnitt: kein Backfill, keine Datenwanderung, kein Zwang.
 */

/** Der Wert eines eigenen Feldes im Formular. Ein Textfeld, nichts weiter:
 *  Feldtypen (Zahl, Datum, Auswahl) gibt es bewusst nicht, sonst wird aus
 *  diesem Abschnitt ein Formularbaukasten. */
const FILL_FROM_OPTIONS: FieldFillFrom[] = ["core", "aim", "both", "manual"];

export default function EigeneFelder({
  defs,
  onDefs,
  werte,
  onWert,
  vorschlaege,
  onUebernehmen,
  onVerwerfen,
  vorschlagFarbe,
  vorschlagLabel,
  feldBasis,
  textfeldCls,
}: {
  defs: OfferFieldDefRow[];
  /** Die neue Liste, nachdem in der Datenbank geschrieben wurde. Der Aufrufer
   *  haelt sie, weil auch die Uebernahme von Vorschlaegen sie braucht. */
  onDefs: (d: OfferFieldDefRow[]) => void;
  werte: CustomFieldValues;
  onWert: (key: string, value: string) => void;
  vorschlaege: CustomFieldValues;
  onUebernehmen: (key: string) => void;
  onVerwerfen: (key: string) => void;
  vorschlagFarbe: string;
  vorschlagLabel: string;
  /** Die Feldklassen kommen vom Aufrufer, damit sie EINE Definition bleiben
   *  (feldBasis in offers-editor.tsx). */
  feldBasis: string;
  textfeldCls: string;
}) {
  const { t } = useT();
  const C = t.offers.custom;
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [offen, setOffen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [neuLabel, setNeuLabel] = useState("");
  const [neuAnweisung, setNeuAnweisung] = useState("");
  const [neuQuelle, setNeuQuelle] = useState<FieldFillFrom>("core");

  const voll = defs.filter((d) => (werte[d.key] ?? "").trim().length > 0).length;

  async function anlegen() {
    const label = neuLabel.trim().slice(0, FIELD_LABEL_MAX);
    if (!label || busy || defs.length >= MAX_CUSTOM_FIELDS) return;
    setBusy(true);
    // Der Schluessel entsteht EINMAL und ist danach unveraenderlich: die
    // bereits geschriebenen Werte zeigen darauf (Migration 0098).
    const key = slugifyFieldKey(label, defs.map((d) => d.key));
    const { data, error } = await createClient()
      .from("offer_field_defs")
      .insert({
        workspace_id: workspaceId,
        key,
        label,
        instruction: neuAnweisung.trim().slice(0, FIELD_INSTRUCTION_MAX),
        fill_from: neuQuelle,
        sort_order: defs.length,
      })
      .select(FIELD_DEF_COLUMNS)
      .single();
    setBusy(false);
    if (error) return push(t.common.error + error.message, "error");
    setNeuLabel("");
    setNeuAnweisung("");
    onDefs([...defs, data as unknown as OfferFieldDefRow]);
  }

  /** Aendert eine Definition in der Datenbank und in der Anzeige. `key` ist
   *  nie dabei: er bleibt, was er beim Anlegen war. */
  async function aendern(id: string, patch: Partial<Omit<OfferFieldDefRow, "id" | "key">>) {
    const naechste = defs.map((d) => (d.id === id ? { ...d, ...patch } : d));
    onDefs(naechste);
    const { error } = await createClient()
      .from("offer_field_defs")
      .update(patch)
      .eq("id", id)
      // Workspace-Filter zusaetzlich zur RLS, siehe CLAUDE.md.
      .eq("workspace_id", workspaceId);
    if (error) push(t.common.error + error.message, "error");
  }

  /** Zwei Nachbarn tauschen. Geschrieben werden beide sort_order, sonst haengt
   *  die Reihenfolge an der Reihenfolge zweier Schreibvorgaenge. */
  async function verschieben(index: number, richtung: -1 | 1) {
    const ziel = index + richtung;
    if (ziel < 0 || ziel >= defs.length || busy) return;
    const naechste = [...defs];
    [naechste[index], naechste[ziel]] = [naechste[ziel], naechste[index]];
    const nummeriert = naechste.map((d, i) => ({ ...d, sort_order: i }));
    onDefs(nummeriert);
    setBusy(true);
    const supabase = createClient();
    for (const d of [nummeriert[index], nummeriert[ziel]]) {
      await supabase
        .from("offer_field_defs")
        .update({ sort_order: d.sort_order })
        .eq("id", d.id)
        .eq("workspace_id", workspaceId);
    }
    setBusy(false);
  }

  /**
   * Eine Definition loeschen.
   *
   * Der WERT am Angebot bleibt stehen. Das ist Absicht und kostet nichts: der
   * Prompt wird aus den Definitionen gebaut, ein Wert ohne Definition wird
   * also nirgends mehr gelesen. Dafuer ist das Loeschen umkehrbar, solange
   * derselbe Schluessel wieder entsteht.
   */
  async function loeschen(d: OfferFieldDefRow) {
    if (busy || !window.confirm(C.deleteConfirm(d.label))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("offer_field_defs")
      .delete()
      .eq("id", d.id)
      .eq("workspace_id", workspaceId);
    setBusy(false);
    if (error) return push(t.common.error + error.message, "error");
    onDefs(defs.filter((x) => x.id !== d.id));
  }

  return (
    <section className="fb-ticks relative rounded-xl border border-edge/60 bg-panel">
      <button
        type="button"
        onClick={() => setOffen((v) => !v)}
        aria-expanded={offen}
        className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
      >
        <span
          aria-hidden
          className="fb-num relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-panel text-[13px] font-semibold"
          style={{ borderColor: "var(--color-edge3)", color: "var(--color-edge3)" }}
        >
          {voll}/{defs.length}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-ink">{C.heading}</span>
          <span className="mt-0.5 block text-[13px] leading-relaxed text-faint">{C.hint}</span>
        </span>
        <span
          aria-hidden
          className="shrink-0 text-mute transition-transform duration-200"
          style={{ transform: offen ? "rotate(90deg)" : "none" }}
        >
          ›
        </span>
      </button>

      {offen && (
        <div className="space-y-5 border-t border-edge/60 px-4 pb-5 pt-4">
          {defs.length === 0 && (
            <p className="max-w-[60ch] text-[13px] leading-relaxed text-faint">{C.empty}</p>
          )}

          {/* ── Die Werte ────────────────────────────────────────────────
              Wie bei den zwoelf festen Feldern: Beschriftung, die Anweisung
              als Hinweis darunter, das Textfeld, und darunter der Vorschlag
              mit Uebernehmen/Verwerfen. */}
          {defs.map((d) => (
            <div key={d.id}>
              <label htmlFor={`eigen-${d.key}`} className="text-[15px] font-medium text-ink">
                {d.label}
              </label>
              {d.instruction.trim() && (
                <p className="mb-2 mt-0.5 text-[13px] leading-relaxed text-faint">
                  {d.instruction}
                </p>
              )}
              <textarea
                id={`eigen-${d.key}`}
                value={werte[d.key] ?? ""}
                onChange={(e) => onWert(d.key, e.target.value)}
                rows={3}
                className={textfeldCls}
              />
              {vorschlaege[d.key] && (
                <div
                  className="lock-pop mt-2 rounded-lg border-l-2 px-3.5 py-3"
                  style={{
                    borderColor: vorschlagFarbe,
                    background: `color-mix(in srgb, ${vorschlagFarbe} 7%, transparent)`,
                  }}
                >
                  <Herkunft farbe={vorschlagFarbe} label={vorschlagLabel} />
                  <p className="text-[15px] leading-relaxed text-ink">{vorschlaege[d.key]}</p>
                  <div className="mt-2.5 flex items-center gap-4 text-[13px]">
                    <button
                      type="button"
                      onClick={() => onUebernehmen(d.key)}
                      className="min-h-8 rounded font-medium transition-opacity hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                      style={{ color: vorschlagFarbe }}
                    >
                      {t.offers.applySuggestion}
                    </button>
                    <button
                      type="button"
                      onClick={() => onVerwerfen(d.key)}
                      className="min-h-8 rounded text-faint transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      {t.offers.discardSuggestion}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* ── Die Verwaltung ───────────────────────────────────────────
              Darunter und nicht darueber: im Alltag tippt man Werte, die
              Definitionen aendert man einmal. */}
          <div className="border-t border-edge/60 pt-4">
            <p className="text-[13px] font-medium text-soft">{C.manageHeading}</p>
            <p className="mb-3 mt-0.5 max-w-[60ch] text-[13px] leading-relaxed text-mute">
              {C.workspaceNote}
            </p>

            <div className="space-y-2.5">
              {defs.map((d, i) => (
                <div key={d.id} className="rounded-lg border border-edge2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={d.label}
                      maxLength={FIELD_LABEL_MAX}
                      onChange={(e) => onDefs(defs.map((x) => (x.id === d.id ? { ...x, label: e.target.value } : x)))}
                      onBlur={(e) => aendern(d.id, { label: e.target.value.trim() || d.key })}
                      aria-label={C.labelLabel}
                      className={feldBasis + " min-w-48 flex-1"}
                    />
                    <select
                      value={d.fill_from}
                      onChange={(e) => aendern(d.id, { fill_from: e.target.value as FieldFillFrom })}
                      aria-label={C.fillFromLabel}
                      className={feldBasis + " min-h-11"}
                    >
                      {FILL_FROM_OPTIONS.map((q) => (
                        <option key={q} value={q}>
                          {C.fillFrom[q]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => verschieben(i, -1)}
                      disabled={i === 0 || busy}
                      aria-label={C.moveUp}
                      className="min-h-9 rounded px-2 text-mute transition-colors hover:text-ink disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => verschieben(i, 1)}
                      disabled={i === defs.length - 1 || busy}
                      aria-label={C.moveDown}
                      className="min-h-9 rounded px-2 text-mute transition-colors hover:text-ink disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => loeschen(d)}
                      disabled={busy}
                      aria-label={C.deleteConfirm(d.label)}
                      className="min-h-9 rounded px-2 text-mute transition-colors hover:text-red-600 disabled:opacity-30 dark:hover:text-red-400"
                    >
                      ×
                    </button>
                  </div>
                  <textarea
                    value={d.instruction}
                    maxLength={FIELD_INSTRUCTION_MAX}
                    rows={2}
                    placeholder={C.instructionPlaceholder}
                    onChange={(e) =>
                      onDefs(defs.map((x) => (x.id === d.id ? { ...x, instruction: e.target.value } : x)))
                    }
                    onBlur={(e) => aendern(d.id, { instruction: e.target.value.trim() })}
                    aria-label={C.instructionLabel}
                    className={textfeldCls + " mt-2"}
                  />
                </div>
              ))}
            </div>

            {defs.length < MAX_CUSTOM_FIELDS ? (
              <div className="mt-3 rounded-lg border border-dashed border-edge2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={neuLabel}
                    maxLength={FIELD_LABEL_MAX}
                    onChange={(e) => setNeuLabel(e.target.value)}
                    placeholder={C.newLabelPlaceholder}
                    aria-label={C.labelLabel}
                    className={feldBasis + " min-w-48 flex-1"}
                  />
                  <select
                    value={neuQuelle}
                    onChange={(e) => setNeuQuelle(e.target.value as FieldFillFrom)}
                    aria-label={C.fillFromLabel}
                    className={feldBasis + " min-h-11"}
                  >
                    {FILL_FROM_OPTIONS.map((q) => (
                      <option key={q} value={q}>
                        {C.fillFrom[q]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={anlegen}
                    disabled={!neuLabel.trim() || busy}
                    className="min-h-10 rounded-lg border px-4 text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    style={{
                      borderColor: "color-mix(in srgb, var(--fb-frost) 45%, transparent)",
                      color: "var(--fb-frost)",
                      background: "color-mix(in srgb, var(--fb-frost) 8%, transparent)",
                    }}
                  >
                    {C.add}
                  </button>
                </div>
                <textarea
                  value={neuAnweisung}
                  maxLength={FIELD_INSTRUCTION_MAX}
                  rows={2}
                  onChange={(e) => setNeuAnweisung(e.target.value)}
                  placeholder={C.instructionPlaceholder}
                  aria-label={C.instructionLabel}
                  className={textfeldCls + " mt-2"}
                />
                <p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-mute">
                  {C.instructionHint}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[13px] leading-relaxed text-mute">{C.max(MAX_CUSTOM_FIELDS)}</p>
            )}

            <p className="mt-3 max-w-[60ch] text-[13px] leading-relaxed text-mute">
              {C.fillFromHint}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
