"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

/**
 * Notizfeld des Vertrieblers. Schreibt direkt per RLS in public.notes; kein
 * API-Route noetig, weil kein serverseitiges Geheimnis im Spiel ist (anders als
 * beim Instantly-Reply, der den BYOK-Key braucht). author_user_id setzt die DB
 * selbst per default auth.uid(), der Client kann den Autor also nicht faelschen.
 *
 * Scope-Umschalter nur, wenn beide IDs vorliegen: eine Notiz gehoert entweder
 * zur Person oder zur ganzen Firma (CHECK-Constraint in Migration 0031).
 */
export default function NoteComposer({
  contactId,
  businessId,
  onSaved,
}: {
  contactId?: string;
  businessId?: string;
  onSaved: () => void;
}) {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const C = t.crm;

  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [businessWide, setBusinessWide] = useState(!contactId);

  const canChooseScope = Boolean(contactId && businessId);
  const targetIsBusiness = businessWide || !contactId;

  async function save() {
    const text = body.trim();
    if (!text || saving) return;
    if (targetIsBusiness && !businessId) return;
    setSaving(true);
    const { error } = await createClient().from("notes").insert({
      workspace_id: workspaceId,
      contact_id: targetIsBusiness ? null : contactId,
      business_id: targetIsBusiness ? businessId : null,
      body: text,
    });
    setSaving(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setBody("");
    push(C.noteSaved, "success");
    onSaved();
  }

  return (
    <div className="rounded-xl border border-edge/70 bg-panel p-3 shadow-sm">
      <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">{C.noteHeading}</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={C.notePlaceholder}
        rows={3}
        className="w-full rounded-lg border border-edge2 bg-field px-3 py-2 text-sm text-ink placeholder-mute outline-none transition-[border-color,box-shadow] duration-150 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
      />
      {canChooseScope && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-soft">
            <input
              type="radio"
              checked={!businessWide}
              onChange={() => setBusinessWide(false)}
              className="h-4 w-4 accent-sky-500"
            />
            {C.noteScopeContact}
          </label>
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-soft" title={C.noteScopeHint}>
            <input
              type="radio"
              checked={businessWide}
              onChange={() => setBusinessWide(true)}
              className="h-4 w-4 accent-sky-500"
            />
            {C.noteScopeBusiness}
          </label>
        </div>
      )}
      <div className="mt-2 flex justify-end">
        <button
          onClick={save}
          disabled={saving || !body.trim()}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-sky-500 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
        >
          {saving ? C.noteSaving : C.noteSave}
        </button>
      </div>
    </div>
  );
}
