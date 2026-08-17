"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

/**
 * Was der Kunde monatlich fuer seine Tarife zahlt.
 *
 * WARUM DAS EINGETRAGEN WIRD STATT GEMESSEN
 *
 * Der Verbrauch in api_usage ist der kleinere Teil der Wahrheit. Instantly
 * taucht dort ueberhaupt nicht auf (ein Abo hat keinen zaehlbaren Aufruf),
 * und bei Apollo und Hunter steht bewusst kein Betrag, weil der Wert eines
 * Credits am gebuchten Paket haengt (siehe Migration 0054).
 *
 * Die App kann von aussen nicht sehen, welches Paket jemand gebucht hat. Also
 * wird gefragt statt geraten. Das ist dieselbe Entscheidung wie ueberall
 * sonst hier: lieber eine ehrliche Luecke als eine erfundene Zahl.
 *
 * Ausloeser war das Dashboard: dort stand "22998 EUR Nutzen bei 0,33 $
 * API-Kosten": ein behaupteter Faktor von siebzigtausend, weil die Tarife
 * fehlten.
 */

/** Die Anbieter mit ihrem ueblichen Einstiegstarif als Platzhalter: eine
 *  Orientierung, kein voreingetragener Wert. Wer nichts eintraegt, bekommt
 *  auch keine erfundene Zahl.
 *
 *  `measured` markiert die drei Anbieter mit echtem Stueckpreis: ihr Verbrauch
 *  steht ohnehin schon in api_usage. Wer hier zusaetzlich einen Monatsbetrag
 *  eintraegt, zahlt in der Summe doppelt. Genau so passiert: 5 $/Monat fuer
 *  OpenAI eingetragen, waehrend die 0,11 $ tatsaechlicher Tokenverbrauch
 *  bereits gemessen danebenstanden. Das Feld bleibt trotzdem bedienbar
 *  (eine Grundgebuehr neben dem Verbrauch gibt es wirklich), aber es sagt
 *  jetzt dazu, was es anrichtet. */
const PROVIDERS: { key: string; label: string; hint: string; measured?: boolean }[] = [
  { key: "instantly", label: "Instantly", hint: "~37" },
  { key: "apollo", label: "Apollo.io", hint: "~49" },
  { key: "prospeo", label: "Prospeo", hint: "~39" },
  { key: "hunter", label: "Hunter.io", hint: "~34" },
  { key: "neverbounce", label: "NeverBounce", hint: "~0", measured: true },
  { key: "openai", label: "OpenAI", hint: "~0", measured: true },
  { key: "google_maps", label: "Google Maps", hint: "~0", measured: true },
];

export default function Subscriptions({
  initial,
}: {
  initial: Record<string, number>;
}) {
  const { t } = useT();
  const C = t.costs;
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p.key, initial[p.key] != null ? String(initial[p.key]) : ""]))
  );
  const [saving, setSaving] = useState(false);

  const total = PROVIDERS.reduce((sum, p) => {
    const n = Number(values[p.key]);
    return sum + (Number.isFinite(n) && values[p.key] !== "" ? n : 0);
  }, 0);

  // Anbieter, die pro Aufruf gemessen werden und trotzdem einen Monatsbetrag
  // tragen; ihre Kosten stecken dann zweimal in der Summe.
  const doppelt = PROVIDERS.filter(
    (p) => p.measured && values[p.key] !== "" && Number(values[p.key]) > 0
  ).map((p) => p.label);

  async function save() {
    setSaving(true);
    const supabase = createClient();

    /**
     * Leeres Feld heisst "nicht eingetragen", nicht "kostet null".
     *
     * Der Unterschied ist der ganze Zweck der Sache: eine 0 ist die Aussage
     * "ich habe den Free-Plan", ein leeres Feld die Aussage "weiss ich nicht".
     * Nur bei der zweiten darf das Dashboard warnen, dass die Kosten
     * unvollstaendig sind.
     */
    const rows = PROVIDERS.filter((p) => values[p.key] !== "" && Number.isFinite(Number(values[p.key])))
      .map((p) => ({
        workspace_id: workspaceId,
        provider: p.key,
        monthly_usd: Number(values[p.key]),
        updated_at: new Date().toISOString(),
      }));
    const leer = PROVIDERS.filter((p) => values[p.key] === "").map((p) => p.key);

    const { error } = rows.length
      ? await supabase.from("provider_subscriptions").upsert(rows, { onConflict: "workspace_id,provider" })
      : { error: null };

    // Geleerte Felder muessen die Zeile entfernen; sonst laesst sich ein
    // gekuendigtes Abo nie wieder loswerden.
    const { error: delError } = leer.length
      ? await supabase
          .from("provider_subscriptions")
          .delete()
          .eq("workspace_id", workspaceId)
          .in("provider", leer)
      : { error: null };

    setSaving(false);
    if (error || delError) push(t.common.error + (error ?? delError)!.message, "error");
    else push(C.subsSaved, "success");
  }

  return (
    <div className="rounded-lg border border-edge/60 bg-panel p-5">
      <h2 className="font-medium text-strong">{C.subsTitle}</h2>
      <p className="mt-0.5 text-xs leading-relaxed text-mute">{C.subsHint}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((p) => (
          <label key={p.key} className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-soft">
              {p.label}
              {p.measured && (
                <span
                  title={C.subsMeasuredWarning}
                  className="rounded border border-amber-500/40 bg-amber-500/10 px-1 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400"
                >
                  {C.subsMeasuredBadge}
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-mute">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={values[p.key]}
                placeholder={p.hint}
                onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                className="w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-sm text-ink outline-none focus:border-sky-500"
              />
              <span className="whitespace-nowrap text-[11px] text-mute">{C.subsPerMonth}</span>
            </div>
          </label>
        ))}
      </div>

      {/* Ein Hinweis am Feld reicht nicht, wenn der Betrag schon drinsteht --
          dann ist die Doppelzaehlung bereits passiert und muss benannt
          werden, nicht bloss angedeutet. */}
      {doppelt.length > 0 && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          {C.subsMeasuredWarning} ({doppelt.join(", ")})
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-soft">
          {C.subsTotal} <span className="font-semibold text-strong">${total.toFixed(2)}</span> {C.subsPerMonth}
        </p>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-60"
        >
          {saving ? t.common.saving : t.common.save}
        </button>
      </div>
    </div>
  );
}
