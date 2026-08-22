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

/**
 * Die Herkunft ist eine Auswahl und kein Text, also sieht sie auch nicht wie
 * ein Textfeld aus: kleiner als feldBasis und in Chipfarbe statt Feldfarbe.
 * Vorher stand sie als nacktes select in derselben Groesse neben dem
 * Feldnamen und las sich wie ein zweites Eingabefeld.
 */
const auswahlCls =
  "min-h-9 rounded-lg border border-edge2 bg-chip px-2.5 text-[13px] text-soft " +
  "outline-none transition-colors focus:border-sky-500";

/** Zeilenknoepfe der Verwaltung: gleich gross, ruhig, erst beim Zeigen
 *  gefaerbt. text-faint statt text-mute, weil ein Bedienelement mindestens
 *  3:1 gegen seinen Grund braucht und text-mute darunter liegt. */
const zeilenBtnCls =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-faint transition-colors " +
  "hover:bg-chip hover:text-ink disabled:pointer-events-none disabled:opacity-30 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

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

  /**
   * Das Formular fuer ein neues Feld. Als Variable und nicht als eigene
   * Komponente: eine im Rendern definierte Komponente waere bei jedem
   * Tastendruck eine neue und wuerde den Fokus aus dem Feld werfen.
   *
   * Es steht im leeren Zustand direkt unter der Erklaerung und sonst am Ende
   * der Verwaltung, beide Male an der Stelle, an der man es sucht.
   */
  const neuesFeld =
    defs.length < MAX_CUSTOM_FIELDS ? (
      <div className="rounded-lg border border-dashed border-edge2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={neuLabel}
            maxLength={FIELD_LABEL_MAX}
            onChange={(e) => setNeuLabel(e.target.value)}
            placeholder={C.newLabelPlaceholder}
            aria-label={C.labelLabel}
            className={feldBasis + " min-w-48 flex-1"}
          />
          {/* Ruhiger als der Knopf der vier Stufen: ein Feld anzulegen ist
              Einrichtung, nicht der Weg zur Kampagne. In Frost stand er
              vorher so laut da wie "Angebot pruefen" in der Seitenspalte. */}
          <button
            type="button"
            onClick={anlegen}
            disabled={!neuLabel.trim() || busy}
            className="min-h-10 shrink-0 rounded-lg border border-edge2 px-4 text-sm font-medium text-soft transition-colors hover:border-edge3 hover:text-ink disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="eigen-neu-quelle" className="text-[13px] text-faint">
            {C.fillFromLabel}
          </label>
          <select
            id="eigen-neu-quelle"
            value={neuQuelle}
            onChange={(e) => setNeuQuelle(e.target.value as FieldFillFrom)}
            className={auswahlCls}
          >
            {FILL_FROM_OPTIONS.map((q) => (
              <option key={q} value={q}>
                {C.fillFrom[q]}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-2.5 max-w-[60ch] text-[13px] leading-relaxed text-faint">
          {C.instructionHint}
        </p>
      </div>
    ) : (
      <p className="max-w-[60ch] text-[13px] leading-relaxed text-faint">{C.max(MAX_CUSTOM_FIELDS)}</p>
    );

  return (
    <section className="fb-ticks relative rounded-xl border border-edge/60 bg-panel">
      <button
        type="button"
        onClick={() => setOffen((v) => !v)}
        aria-expanded={offen}
        className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
      >
        {/* Derselbe Knoten wie bei den vier Stufen, mit demselben Zaehler.
            Ohne eine einzige Definition stuende dort "0/0", eine Zahl ohne
            Aussage, die aussieht, als fehle etwas. Stattdessen ein
            gestrichelter Ring mit einem Pluszeichen: gestrichelt heisst in
            dieser Flaeche ueberall "hier steht noch nichts". */}
        <span
          aria-hidden
          className={
            "fb-num relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-panel text-[13px] font-semibold transition-colors " +
            (defs.length === 0 ? "border-dashed" : "")
          }
          style={{
            borderColor:
              defs.length > 0 && voll === defs.length ? "var(--fb-ready)" : "var(--color-edge3)",
            color:
              defs.length > 0 && voll === defs.length ? "var(--fb-ready)" : "var(--color-edge3)",
          }}
        >
          {defs.length === 0 ? "+" : `${voll}/${defs.length}`}
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

      {offen && defs.length === 0 && (
        /* Der Normalfall fuer alle bestehenden Angebote: keine Definition.
           Hier steht dann genau zweierlei: wofuer das gut ist, und wie man
           anfaengt. Keine leere Werteliste, keine Ueberschrift "Felder
           verwalten" ueber einer leeren Liste, keine Trennlinie zwischen
           nichts und nichts.

           Der Hinweis auf die Reichweite steht schon HIER und nicht erst bei
           der Verwaltung: dass diese Felder allen Angeboten gehoeren, muss
           man wissen, bevor man das erste anlegt. */
        <div className="space-y-3 border-t border-edge/60 px-4 pb-5 pt-4">
          <p className="max-w-[60ch] text-[13px] leading-relaxed text-soft">{C.empty}</p>
          <p className="max-w-[60ch] text-[13px] leading-relaxed text-faint">{C.workspaceNote}</p>
          {neuesFeld}
        </div>
      )}

      {offen && defs.length > 0 && (
        <div className="space-y-5 border-t border-edge/60 px-4 pb-5 pt-4">
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
              Definitionen aendert man einmal.

              Und auf einer EIGENEN FLAECHE, nicht nur hinter einer Linie.
              Oben steht, was zu diesem einen Angebot gehoert; hier unten
              steht, was allen Angeboten dieses Workspaces gehoert. Das ist
              der Unterschied, an dem man sich sonst versieht, und eine
              Ueberschrift allein traegt ihn nicht, also traegt ihn der
              Grund: abgesetzt (bg-wash), randlos bis an die Kanten des
              Abschnitts, als Sockel unter dem Formular.

              Die -mx-4/-mb-5 heben genau die Innenabstaende des Elternteils
              auf (px-4 pb-5). Der untere Radius ist 11px und nicht 12:
              innerhalb eines 1px-Rahmens ist der Innenradius um genau diese
              Linie kleiner, sonst blitzt sie in der Ecke durch. */}
          <div className="-mx-4 -mb-5 rounded-b-[11px] border-t border-edge/60 bg-wash px-4 pb-5 pt-4">
            <p className="text-[13px] font-medium text-soft">{C.manageHeading}</p>
            <p className="mb-3 mt-0.5 max-w-[60ch] text-[13px] leading-relaxed text-faint">
              {C.workspaceNote}
            </p>

            <div className="space-y-2.5">
              {defs.map((d, i) => (
                /* Die Zeile liegt auf bg-panel, der Sockel auf bg-wash. Im
                   Hellen hebt sie sich dadurch ab, im Dunklen liegt sie
                   tiefer, in beiden Faellen ist sie ein eigenes Stueck.
                   Die Kante traegt border-edge2, damit die Trennung nicht
                   allein an der Fuellung haengt. */
                <div key={d.id} className="rounded-lg border border-edge2 bg-panel p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={d.label}
                      maxLength={FIELD_LABEL_MAX}
                      onChange={(e) => onDefs(defs.map((x) => (x.id === d.id ? { ...x, label: e.target.value } : x)))}
                      onBlur={(e) => aendern(d.id, { label: e.target.value.trim() || d.key })}
                      aria-label={C.labelLabel}
                      className={feldBasis + " min-w-0 flex-1"}
                    />
                    {/* Die drei Zeilenknoepfe stehen zusammen und rechts:
                        sie gehoeren zur Zeile, nicht zum Namen. */}
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => verschieben(i, -1)}
                        disabled={i === 0 || busy}
                        aria-label={C.moveUp}
                        title={C.moveUp}
                        className={zeilenBtnCls}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => verschieben(i, 1)}
                        disabled={i === defs.length - 1 || busy}
                        aria-label={C.moveDown}
                        title={C.moveDown}
                        className={zeilenBtnCls}
                      >
                        ↓
                      </button>
                      {/* Der Name des Knopfes ist "Loeschen" und nicht die
                          ganze Rueckfrage. Vorher stand der komplette
                          Bestaetigungssatz als aria-label darin, eine
                          Vorlesehilfe las damit drei Zeilen vor, bevor klar
                          war, dass es ein Knopf ist. Welches Feld gemeint
                          ist, sagt die Rueckfrage selbst. */}
                      <button
                        type="button"
                        onClick={() => loeschen(d)}
                        disabled={busy}
                        aria-label={t.common.delete}
                        title={t.common.delete}
                        className={zeilenBtnCls + " hover:text-red-600 dark:hover:text-red-400"}
                      >
                        ×
                      </button>
                    </div>
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
                  {/* Die Herkunft zuletzt und klein: sie wird einmal gesetzt
                      und danach nie wieder angefasst. Mit sichtbarer
                      Beschriftung statt nur einem aria-label. "Core: aus
                      deiner Website" allein sagt niemandem, welche Frage hier
                      beantwortet wird. */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label htmlFor={`eigen-quelle-${d.id}`} className="text-[13px] text-faint">
                      {C.fillFromLabel}
                    </label>
                    <select
                      id={`eigen-quelle-${d.id}`}
                      value={d.fill_from}
                      onChange={(e) => aendern(d.id, { fill_from: e.target.value as FieldFillFrom })}
                      className={auswahlCls}
                    >
                      {FILL_FROM_OPTIONS.map((q) => (
                        <option key={q} value={q}>
                          {C.fillFrom[q]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3">{neuesFeld}</div>

            <p className="mt-3 max-w-[60ch] text-[13px] leading-relaxed text-faint">
              {C.fillFromHint}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
