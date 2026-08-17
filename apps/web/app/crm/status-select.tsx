"use client";
import { OUTREACH_STAGES, STAGE_SELECT_CLS, isOutreachStage } from "@/lib/crm/stages";

/**
 * Status-Dropdown fuer einen Kontakt. Lag vorher lokal in leads-table.tsx und
 * wird inzwischen zusaetzlich vom Pipeline-Board und der Timeline genutzt,
 * auch als Touch-Fallback dort, wo Drag and Drop nicht funktioniert.
 *
 * Labels kommen von aussen (dict.ts), damit die Komponente sprachneutral bleibt.
 */
export default function StatusSelect({
  value,
  onChange,
  labels,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  labels: Record<string, string>;
  className?: string;
}) {
  const tone = isOutreachStage(value) ? STAGE_SELECT_CLS[value] : STAGE_SELECT_CLS.new;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      // Verhindert, dass ein Klick auf das Dropdown die Zeile darunter aufklappt
      // oder einen Drawer oeffnet.
      onClick={(e) => e.stopPropagation()}
      className={
        "rounded-md border px-2 py-1 text-[11px] font-medium outline-none transition-colors " +
        tone +
        (className ? " " + className : "")
      }
    >
      {OUTREACH_STAGES.map((stage) => (
        <option key={stage} value={stage}>
          {labels[stage] ?? stage}
        </option>
      ))}
    </select>
  );
}
