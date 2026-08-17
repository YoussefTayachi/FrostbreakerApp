"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  coerceValue,
  visibleValues,
  type CustomFieldDef,
  type CustomValues,
  type FieldEntity,
} from "@/lib/crm/custom-fields";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

/**
 * Eigene Felder eines Datensatzes anzeigen und ausfuellen.
 *
 * Ohne diesen Teil waeren eigene Felder nur eine Tabelle in der Datenbank.
 * Sie sitzen dort, wo bei Pipedrive der "Detailbereich" eines Deals oder
 * Kontakts steht: neben dem Verlauf, im aufgeklappten Datensatz.
 *
 * Gespeichert wird pro Feld beim Verlassen (onBlur), nicht ueber einen
 * Speichern-Knopf. Bei einer Handvoll Zusatzangaben ist ein Knopf mehr
 * Zeremonie als Nutzen — und wer ihn vergisst, verliert seine Eingabe.
 *
 * Die Typpruefung liegt in lib/crm/custom-fields.ts und nicht hier: die Werte
 * stehen als jsonb am Objekt, die Datenbank prueft sie also NICHT. Eine Zahl,
 * in der "abc" steht, faellt erst auf, wenn jemand danach sortiert.
 */
export default function CustomFieldValues({
  entity,
  table,
  recordId,
  className = "",
}: {
  entity: FieldEntity;
  /** Tabelle, in der die jsonb-Spalte "custom" liegt. */
  table: "contacts" | "businesses" | "deals";
  recordId: string;
  className?: string;
}) {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const F = t.customFields;

  const [defs, setDefs] = useState<CustomFieldDef[]>([]);
  const [values, setValues] = useState<CustomValues>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId || !recordId) return;
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase
        .from("custom_field_defs")
        .select("id, entity, key, label, field_type, options, position")
        .eq("workspace_id", workspaceId)
        .eq("entity", entity)
        .order("position", { ascending: true }),
      supabase.from(table).select("custom").eq("id", recordId).single(),
    ]).then(([defsRes, recRes]) => {
      if (cancelled) return;
      setDefs((defsRes.data ?? []) as CustomFieldDef[]);
      const custom = ((recRes.data?.custom ?? {}) as CustomValues) || {};
      setValues(custom);
      setDrafts(
        Object.fromEntries(
          Object.entries(custom).map(([k, v]) => [k, v === null ? "" : String(v)])
        )
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, entity, table, recordId]);

  /**
   * Einen Wert speichern.
   *
   * Gelesen und geschrieben wird das ganze jsonb-Objekt, nicht nur der eine
   * Schluessel. Das ist bei einer Handvoll Feldern unkritisch und vermeidet
   * die Fallstricke von jsonb_set (fehlende Pfade, Typkonflikte). Wer zwei
   * Felder gleichzeitig in zwei Browsern aendert, ueberschreibt sich — ein
   * Fall, der bei persoenlichen Zusatzangaben nicht vorkommt.
   */
  async function save(def: CustomFieldDef, raw: string) {
    const result = coerceValue(def, raw);
    if ("error" in result) {
      push(F.errors[result.error], "error");
      // Eingabe stehen lassen, damit der Nutzer sie korrigieren kann statt
      // sie neu tippen zu muessen.
      return;
    }
    if ((values[def.key] ?? null) === result.value) return; // nichts geaendert

    const next = { ...values, [def.key]: result.value };
    // Null-Werte gar nicht erst speichern: ein geleertes Feld soll aus dem
    // Datensatz verschwinden und nicht als "null" darin stehen bleiben.
    if (result.value === null) delete next[def.key];

    const { error } = await createClient()
      .from(table)
      .update({ custom: next })
      .eq("id", recordId)
      .eq("workspace_id", workspaceId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setValues(next);
  }

  if (loading || defs.length === 0) return null;

  const fieldCls =
    "w-full rounded-lg border border-edge2 bg-field px-2.5 py-1.5 text-xs text-ink placeholder-mute outline-none transition-colors focus:border-sky-500";

  return (
    <div className={"rounded-lg border border-edge/60 bg-surface/60 p-3 " + className}>
      <p className="mb-2 text-xs font-medium text-ink">{F.detailsHeading}</p>
      <div className="space-y-2">
        {visibleValues(defs, values).map(({ def }) => (
          <label key={def.id} className="block">
            <span className="mb-0.5 block text-[10px] font-medium text-faint">{def.label}</span>
            {def.field_type === "select" ? (
              <select
                value={drafts[def.key] ?? ""}
                onChange={(e) => {
                  setDrafts((p) => ({ ...p, [def.key]: e.target.value }));
                  // Auswahlfelder sofort speichern: hier gibt es kein
                  // "fertig getippt", der Klick IST die Entscheidung.
                  save(def, e.target.value);
                }}
                className={fieldCls}
              >
                <option value="">{F.notSet}</option>
                {def.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={def.field_type === "date" ? "date" : def.field_type === "number" ? "text" : "text"}
                value={drafts[def.key] ?? ""}
                onChange={(e) => setDrafts((p) => ({ ...p, [def.key]: e.target.value }))}
                onBlur={(e) => save(def, e.target.value)}
                placeholder={F.notSet}
                className={fieldCls}
              />
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
