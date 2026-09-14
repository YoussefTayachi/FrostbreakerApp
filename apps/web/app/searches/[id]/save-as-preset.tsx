"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { searchRowToPresetConfig, type SearchRowForPreset } from "@/lib/search-presets";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";

/**
 * "Als Vorlage speichern" und "Suche wiederholen", direkt an der Suche.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM HIER UND NICHT NUR IM FORMULAR
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ein Kunde am 2026-08-10: "Ich habe einen Test gemacht, der gut gelaufen ist.
 * Top waere, wenn man die Vorlage gleich von diesem Interface aus speichern
 * koennte. Dann muesste ich nicht nochmal ueberlegen, was hatte ich nochmal
 * ausgewaehlt."
 *
 * Das trifft den Zeitpunkt, an dem man ueberhaupt WEISS, ob eine Filterkombi
 * etwas taugt: nicht beim Ausfuellen, sondern wenn die Leads dastehen. Vorher
 * ging es nur andersherum: speichern musste man, bevor man das Ergebnis
 * kannte.
 *
 * Ein Eingabefeld statt prompt(): Der Systemdialog des Browsers ist auf einer
 * Seite, die Kunden taeglich sehen, ein Fremdkoerper, und in manchen
 * Browsern unterdrueckt.
 */
export default function SaveAsPreset({
  searchId,
  row,
  suggestedName,
}: {
  searchId: string;
  /** Genau die Spalten, aus denen die Vorlage entsteht. */
  row: SearchRowForPreset;
  suggestedName: string;
}) {
  const { t } = useT();
  const S = t.searchDetail.preset;
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [saving, setSaving] = useState(false);

  async function save() {
    const sauber = name.trim();
    if (!sauber) return;
    setSaving(true);
    const supabase = createClient();
    const config = searchRowToPresetConfig(row);

    // Gleicher Name = ueberschreiben, wie im Formular. Der Abgleich laeuft
    // hier und nicht per ilike in der Abfrage: ein Name wie "50% mehr"
    // enthaelt Platzhalterzeichen und wuerde dort die falsche Zeile treffen.
    // Ausserdem liegt in der Datenbank ein eindeutiger Index auf
    // (workspace_id, lower(trim(name))); ein blindes insert liefe hier in
    // einen Fehler, den der Nutzer nicht deuten koennte.
    const { data: vorhandene } = await supabase
      .from("search_presets")
      .select("id, name")
      .eq("workspace_id", workspaceId);
    const treffer = (vorhandene ?? []).find(
      (p: { id: string; name: string }) =>
        p.name.trim().toLowerCase() === sauber.toLowerCase()
    );

    const { error } = treffer
      ? await supabase
          .from("search_presets")
          .update({ config, updated_at: new Date().toISOString() })
          .eq("id", treffer.id)
          .eq("workspace_id", workspaceId)
      : await supabase
          .from("search_presets")
          .insert({ workspace_id: workspaceId, name: sauber, config });

    setSaving(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setOpen(false);
    push(treffer ? S.savedOverwritten(sauber) : S.saved(sauber), "success");
  }

  /* Dieselbe Groesse wie die Knoepfe in der Kopfzeile darueber (Abo-Auswahl,
     Kampagnenverknuepfung): drei Zeilen Kleinkram in drei Hoehen war der
     unruhigste Teil dieser Seite. */
  const chipCls =
    "inline-flex h-9 shrink-0 items-center rounded-lg border border-edge2 bg-panel px-3 text-xs " +
    "font-medium text-soft transition-[background-color,border-color,transform] duration-150 " +
    "hover:bg-chip hover:text-ink active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {open ? (
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-nowrap">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setOpen(false);
            }}
            maxLength={80}
            placeholder={S.namePlaceholder}
            className="h-9 w-full min-w-0 rounded-lg border border-edge2 bg-field px-3 text-xs text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15 sm:w-52"
          />
          <button
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="inline-flex h-9 shrink-0 items-center rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-sky-500 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
          >
            {saving ? t.common.saving : t.common.save}
          </button>
          <button
            onClick={() => setOpen(false)}
            className={chipCls}
          >
            {S.cancel}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title={S.saveTitle}
          className={chipCls}
        >
          {S.save}
        </button>
      )}
      {/* Wiederholen braucht keine gespeicherte Vorlage: die Filter stehen in
          der Suche selbst. Wer nur "nochmal dasselbe" will, soll dafuer nichts
          benennen muessen. */}
      <Link
        href={`/?wiederholen=${searchId}`}
        className={chipCls}
      >
        {S.repeat}
      </Link>
    </div>
  );
}
