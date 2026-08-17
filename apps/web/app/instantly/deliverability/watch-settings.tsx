"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";
import { formatRelative } from "@/lib/format-time";

/**
 * Der Waechter, wie ihn der Nutzer sieht: Stand je Absender-Domain und der
 * Schalter fuers automatische Anhalten.
 *
 * Die Pruefung darueber auf derselben Seite ist die MANUELLE: man tippt
 * eine Domain ein und bekommt sofort eine Antwort. Hier steht das, was von
 * allein laeuft: einmal taeglich je verbundenem Postfach, mit Meldung bei
 * jedem Uebergang. Beides gehoert nebeneinander, weil sonst niemand merkt,
 * dass ueberhaupt etwas laeuft; ein stiller Waechter wird nicht als
 * Sicherheit wahrgenommen, sondern gar nicht.
 */
type DomainRow = { domain: string; spf: boolean; dkim: boolean; dmarc: boolean; checked_at: string };

export default function WatchSettings() {
  const { t, lang } = useT();
  const W = t.deliverability.watch;
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [rows, setRows] = useState<DomainRow[] | null>(null);
  const [autoPause, setAutoPause] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("domain_health")
      .select("domain, spf, dkim, dmarc, checked_at")
      .eq("workspace_id", workspaceId)
      .order("domain")
      .then(({ data }) => setRows(data ?? []));
    supabase
      .from("workspaces")
      .select("auto_pause_on_bounce")
      .eq("id", workspaceId)
      .single()
      .then(({ data }) => setAutoPause(data?.auto_pause_on_bounce ?? true));
  }, [workspaceId]);

  async function toggleAutoPause(next: boolean) {
    setSaving(true);
    setAutoPause(next);
    const { error } = await createClient()
      .from("workspaces")
      .update({ auto_pause_on_bounce: next })
      .eq("id", workspaceId);
    setSaving(false);
    if (error) {
      // Zuruecknehmen statt einen falschen Zustand stehen zu lassen: bei einem
      // Sicherheitsschalter ist die Anzeige "aus", waehrend er an ist, die
      // schlimmere von beiden Luegen.
      setAutoPause(!next);
      push(t.common.error + error.message, "error");
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-edge2 bg-panel p-5">
      <div>
        <h2 className="font-medium text-ink">{W.title}</h2>
        <p className="mt-0.5 text-sm text-faint">{W.subtitle}</p>
      </div>

      {rows === null && <p className="text-sm text-faint">{t.common.saving}</p>}
      {rows?.length === 0 && <p className="text-sm text-faint">{W.noneYet}</p>}

      {rows && rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((r) => {
            // SPF und DKIM entscheiden ueber die Zustellung, DMARC ist eine
            // Anforderung der Massenversand-Regeln; dieselbe Trennung wie im
            // Torwart und im Waechter selbst.
            const broken = !r.spf || !r.dkim;
            return (
              <div
                key={r.domain}
                className={
                  "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm " +
                  (broken ? "border-red-500/40 bg-red-500/5" : "border-edge2")
                }
              >
                <span className="font-medium text-ink">{r.domain}</span>
                <span className={r.spf ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-red-500"}>
                  SPF {r.spf ? "✓" : "✗"}
                </span>
                <span className={r.dkim ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-red-500"}>
                  DKIM {r.dkim ? "✓" : "✗"}
                </span>
                <span className={r.dmarc ? "text-xs text-emerald-600 dark:text-emerald-400" : "text-xs text-amber-500"}>
                  DMARC {r.dmarc ? "✓" : "✗"}
                </span>
                <span className="ml-auto text-xs text-mute">{formatRelative(r.checked_at, lang)}</span>
              </div>
            );
          })}
        </div>
      )}

      <label className="flex items-start gap-2 border-t border-edge2/60 pt-4 text-sm text-ink">
        <input
          type="checkbox"
          checked={autoPause ?? true}
          disabled={autoPause === null || saving}
          onChange={(e) => toggleAutoPause(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          {W.autoPause}
          <span className="block text-xs text-faint">{W.autoPauseHint}</span>
        </span>
      </label>
    </div>
  );
}
