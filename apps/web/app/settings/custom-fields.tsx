"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  FIELD_ENTITIES,
  FIELD_TYPES,
  uniqueKey,
  type CustomFieldDef,
  type FieldEntity,
  type FieldType,
} from "@/lib/crm/custom-fields";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

/**
 * Eigene Felder anlegen und verwalten.
 *
 * Die erste Frage jedes CRM-Umsteigers. Pipedrives Deal-Detail fordert sogar
 * ausdruecklich dazu auf ("Ihr Detailbereich ist leer. Fuegen Sie
 * benutzerdefinierte Felder hinzu").
 *
 * Bewusst schlicht gehalten: Beschriftung, Typ, bei Auswahlfeldern die
 * Moeglichkeiten. Kein Drag & Drop zum Sortieren wie bei Pipedrive: die
 * Reihenfolge ergibt sich aus dem Anlegen und laesst sich spaeter ergaenzen,
 * ohne dass sich am Datenmodell etwas aendert.
 */
export default function CustomFields() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const F = t.customFields;

  const [entity, setEntity] = useState<FieldEntity>("contact");
  const [defs, setDefs] = useState<CustomFieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await createClient()
      .from("custom_field_defs")
      .select("id, entity, key, label, field_type, options, position")
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true });
    setDefs((data ?? []) as CustomFieldDef[]);
    setLoading(false);
  }

  useEffect(() => {
    if (workspaceId) load();
    // load haengt nur am Workspace; push/t sind stabil genug
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const forEntity = defs.filter((d) => d.entity === entity);

  async function add() {
    const trimmed = label.trim();
    if (!trimmed || busy) return;

    // Auswahlfeld ohne Moeglichkeiten waere ein Dropdown ohne Eintraege:
    // anlegbar, aber nutzlos, deshalb hier abgefangen statt spaeter zu
    // verwirren.
    const optionList = options
      .split(/[\n,]/)
      .map((o) => o.trim())
      .filter(Boolean);
    if (fieldType === "select" && optionList.length === 0) {
      push(F.needsOptions, "error");
      return;
    }

    setBusy(true);
    const { error } = await createClient().from("custom_field_defs").insert({
      workspace_id: workspaceId,
      entity,
      // Schluessel einmalig aus der Beschriftung, danach unveraenderlich;
      // wer umbenennt, soll nicht die vorhandenen Werte verlieren.
      key: uniqueKey(trimmed, forEntity.map((d) => d.key)),
      label: trimmed,
      field_type: fieldType,
      options: fieldType === "select" ? optionList : [],
      position: forEntity.length,
    });
    setBusy(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setLabel("");
    setOptions("");
    push(F.added, "success");
    load();
  }

  async function remove(def: CustomFieldDef) {
    if (!confirm(F.removeConfirm(def.label))) return;
    const { error } = await createClient()
      .from("custom_field_defs")
      .delete()
      .eq("id", def.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    push(F.removed, "success");
    load();
  }

  if (loading) return null;

  const inputCls =
    "rounded-lg border border-edge2 bg-field px-3 py-2 text-sm text-ink placeholder-mute outline-none transition-colors focus:border-sky-500";

  return (
    <div className="space-y-4">
      {/* Objektart zuerst: ein Feld gehoert zu Kontakt, Firma ODER Deal, und
          diese Wahl bestimmt alles Weitere. */}
      <div className="flex flex-wrap gap-1.5">
        {FIELD_ENTITIES.map((e) => (
          <button
            key={e}
            onClick={() => setEntity(e)}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
              (entity === e
                ? "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
            }
          >
            {F.entityLabels[e]}
            <span className="ml-1.5 tabular-nums text-mute">
              {defs.filter((d) => d.entity === e).length}
            </span>
          </button>
        ))}
      </div>

      {forEntity.length > 0 && (
        <div className="divide-y divide-edge2/50 overflow-hidden rounded-lg border border-edge2">
          {forEntity.map((def) => (
            <div key={def.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{def.label}</p>
                <p className="truncate text-[11px] text-mute">
                  {F.typeLabels[def.field_type]}
                  {def.field_type === "select" && def.options.length > 0 && (
                    <> · {def.options.join(", ")}</>
                  )}
                  {" · "}
                  <span className="font-mono">{def.key}</span>
                </p>
              </div>
              <button
                onClick={() => remove(def)}
                className="shrink-0 text-xs text-red-600 transition-colors hover:text-red-500 dark:text-red-400"
              >
                {t.common.delete}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={F.labelPlaceholder}
          className={inputCls + " min-w-48 flex-1"}
        />
        <select
          value={fieldType}
          onChange={(e) => setFieldType(e.target.value as FieldType)}
          className={inputCls}
        >
          {FIELD_TYPES.map((ft) => (
            <option key={ft} value={ft}>
              {F.typeLabels[ft]}
            </option>
          ))}
        </select>
        {fieldType === "select" && (
          <input
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder={F.optionsPlaceholder}
            className={inputCls + " min-w-48 flex-1"}
          />
        )}
        <button
          onClick={add}
          disabled={busy || !label.trim()}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {F.add}
        </button>
      </div>

      <p className="text-[11px] text-mute">{F.footnote}</p>
    </div>
  );
}
