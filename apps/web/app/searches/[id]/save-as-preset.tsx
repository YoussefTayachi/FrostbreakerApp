"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { searchRowToPresetConfig, type SearchRowForPreset } from "@/lib/search-presets";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";

/**
 * "Als Vorlage speichern" und "Suche wiederholen" — direkt an der Suche.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM HIER UND NICHT NUR IM FORMULAR
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ein Kunde am 2026-08-10: "Ich habe einen Test gemacht, der gut gelaufen ist.
 * Top waere, wenn man die Vorlage gleich von diesem Interface aus speichern
 * koennte — dann muesste ich nicht nochmal ueberlegen, was hatte ich nochmal
 * ausgewaehlt."
 *
 * Das trifft den Zeitpunkt, an dem man ueberhaupt WEISS, ob eine Filterkombi
 * etwas taugt: nicht beim Ausfuellen, sondern wenn die Leads dastehen. Vorher
 * ging es nur andersherum — speichern musste man, bevor man das Ergebnis
 * kannte.
 *
 * Ein Eingabefeld statt prompt(): Der Systemdialog des Browsers ist auf einer
 * Seite, die Kunden taeglich sehen, ein Fremdkoerper — und in manchen
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
    // (workspace_id, lower(trim(name))) — ein blindes insert liefe hier in
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {open ? (
        <div className="flex items-center gap-1.5">
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
            className="w-52 rounded-lg border border-edge2 bg-field px-2 py-1 text-xs text-ink outline-none focus:border-sky-500"
          />
          <button
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-60"
          >
            {saving ? t.common.saving : t.common.save}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg border border-edge2 px-2.5 py-1 text-xs text-soft transition-colors hover:text-ink"
          >
            {S.cancel}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title={S.saveTitle}
          className="rounded-lg border border-edge2 px-2.5 py-1 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink"
        >
          {S.save}
        </button>
      )}
      {/* Wiederholen braucht keine gespeicherte Vorlage: die Filter stehen in
          der Suche selbst. Wer nur "nochmal dasselbe" will, soll dafuer nichts
          benennen muessen. */}
      <Link
        href={`/?wiederholen=${searchId}`}
        className="rounded-lg border border-edge2 px-2.5 py-1 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink"
      >
        {S.repeat}
      </Link>
    </div>
  );
}
