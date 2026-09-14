"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

/**
 * Automatisierungen als Vorlagen zum Einschalten.
 *
 * Bewusst KEIN Baukasten mit Ausloeser und Aktion. Pipedrive zeigt seinen
 * Nutzern sechs fertige Karten mit Vorschau statt eines leeren Editors, und
 * das aus gutem Grund: niemand baut sich eine Automatisierung aus dem Nichts
 * zusammen. Man erkennt eine, die man haben will, und schaltet sie ein.
 *
 * Der Anlass steht im Pipeline-Board: am 2026-08-03 hatten 515 von 515
 * Kontakten in "Neu" und 53 von 54 in "Kontaktiert" keinen geplanten
 * naechsten Schritt. Ohne solche Regeln bleibt das so, weil niemand fuer
 * fuenfhundert Kontakte von Hand Aufgaben anlegt.
 *
 * Die Regeln selbst laufen in der Datenbank (Migration 0066) und nicht hier:
 * ein Statuswechsel kann auch vom Inbox-Sync kommen, also ohne dass ein
 * Browser offen ist.
 */

/** Muss synchron bleiben mit dem CHECK auf automation_rules.kind. */
const RULE_KINDS = [
  "reply_followup",
  "meeting_prep",
  "stale_reminder",
  // Die Kette (Migration 0074), in der Reihenfolge, in der sie greift:
  // Mail -> nach n Tagen ohne Antwort LinkedIn -> nach m Tagen Anruf.
  "no_reply_linkedin",
  "no_reply_call",
] as const;
type RuleKind = (typeof RULE_KINDS)[number];

type Rule = { kind: RuleKind; enabled: boolean; config: { days?: number } };

/** Wie lange etwas liegen darf, bevor es wieder hochkommt. */
const STALE_DAY_OPTIONS = [14, 30, 60, 90] as const;

/**
 * Wartezeiten der Kettenregeln.
 *
 * Kurz gehalten und getrennt je Regel: 2 bis 3 Tage sind bei LinkedIn
 * ueblich, beim Anruf ist mehr Abstand angebracht: wer am dritten Tag nach
 * einer kalten Mail anruft, wirkt wie ein Verfolger. Die Voreinstellungen (3
 * und 7) stehen in der Datenbankfunktion und gelten, solange hier nichts
 * gewaehlt wurde.
 */
const CHAIN_DAY_OPTIONS: Record<string, readonly number[]> = {
  no_reply_linkedin: [2, 3, 5, 7],
  no_reply_call: [5, 7, 10, 14],
};

const CHAIN_DEFAULT_DAYS: Record<string, number> = {
  no_reply_linkedin: 3,
  no_reply_call: 7,
};

export default function AutomationRules() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const A = t.automations;

  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    createClient()
      .from("automation_rules")
      .select("kind, enabled, config")
      .eq("workspace_id", workspaceId)
      .then(({ data }) => {
        const map: Record<string, Rule> = {};
        for (const r of (data ?? []) as Rule[]) map[r.kind] = r;
        setRules(map);
        setLoading(false);
      });
  }, [workspaceId]);

  /**
   * Ein- und Ausschalten in einem Zug anlegen oder aendern.
   *
   * upsert statt insert-oder-update im Code: die Zeile existiert erst, wenn
   * die Regel zum ersten Mal eingeschaltet wird. Ein Workspace startet ohne
   * jede Regel; Automatisierungen, die ungefragt laufen, sind das Gegenteil
   * von Vertrauen.
   */
  async function toggle(kind: RuleKind, enabled: boolean, config?: { days?: number }) {
    if (busy) return;
    setBusy(kind);
    const next = { ...(rules[kind] ?? { kind, config: {} }), enabled, config: config ?? rules[kind]?.config ?? {} };
    const { error } = await createClient()
      .from("automation_rules")
      .upsert(
        { workspace_id: workspaceId, kind, enabled, config: next.config },
        { onConflict: "workspace_id,kind" }
      );
    setBusy(null);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setRules((prev) => ({ ...prev, [kind]: next as Rule }));
    push(enabled ? A.enabled : A.disabled, "success");
  }

  // Platzhalter in der Form der Regelliste: fuenf Zeilen, gleiche Hoehe.
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-[74px] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {RULE_KINDS.map((kind) => {
        const rule = rules[kind];
        const on = Boolean(rule?.enabled);
        const days = rule?.config?.days ?? 30;
        return (
          <div
            key={kind}
            className={
              "rounded-xl border px-4 py-3.5 transition-colors duration-150 " +
              (on ? "border-sky-500/40 bg-sky-500/5" : "border-edge/70 bg-surface/40")
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{A.ruleTitles[kind]}</p>
                <p className="mt-1 text-sm leading-relaxed text-faint">{A.ruleBodies[kind]}</p>
              </div>
              <button
                onClick={() => toggle(kind, !on)}
                disabled={busy === kind}
                role="switch"
                aria-checked={on}
                aria-label={A.ruleTitles[kind]}
                className={
                  "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 " +
                  (on ? "bg-sky-600" : "bg-edge3")
                }
              >
                {/* left-0.5 ist Pflicht, nicht Kosmetik.
                    Ohne waagrechten Anker nimmt der Browser fuer ein
                    absolut positioniertes Element seine Fliessposition, und
                    translate-x rechnet von DORT weiter. Gemessen am
                    2026-08-04: im eingeschalteten Zustand stand der Knopf bei
                    1104..1120, die Pille endete bei 1106 — also 14 px
                    ausserhalb, sichtbar als weisser Fleck neben dem blauen
                    Schalter. Mit festem left sitzt er in beiden Zustaenden
                    2 px innerhalb: aus bei 0, an um 20 px verschoben, bei
                    44 px Pille und 20 px Knopf (Systemmass von iOS, und der
                    einzige Tipppunkt dieser Zeile). */}
                <span
                  className={
                    "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 " +
                    (on ? "translate-x-5" : "translate-x-0")
                  }
                />
              </button>
            </div>

            {/* Nur die Wiedervorlage hat eine Einstellung. Die anderen beiden
                haengen an einem Ereignis und brauchen keine. */}
            {kind === "stale_reminder" && on && (
              <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-faint">
                {A.staleAfter}
                <select
                  value={days}
                  onChange={(e) => toggle(kind, true, { days: Number(e.target.value) })}
                  className="rounded-lg border border-edge2 bg-field px-2.5 py-1.5 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
                >
                  {STALE_DAY_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {A.days(d)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* Die Kettenregeln warten ab dem Versand, nicht ab dem letzten
                Kontakt — deshalb eine eigene Beschriftung. */}
            {CHAIN_DAY_OPTIONS[kind] && on && (
              <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-faint">
                {A.chainAfter}
                <select
                  value={rules[kind]?.config?.days ?? CHAIN_DEFAULT_DAYS[kind]}
                  onChange={(e) => toggle(kind, true, { days: Number(e.target.value) })}
                  className="rounded-lg border border-edge2 bg-field px-2.5 py-1.5 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
                >
                  {CHAIN_DAY_OPTIONS[kind].map((d) => (
                    <option key={d} value={d}>
                      {A.days(d)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      })}

      <p className="pt-1 text-xs leading-relaxed text-faint">{A.footnote}</p>
    </div>
  );
}
