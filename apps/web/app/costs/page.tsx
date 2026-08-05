import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import Link from "next/link";
import Subscriptions from "./subscriptions";

// Aufschluesselung der tatsaechlich verbrauchten API-Mengen.
//
// Vorher zeigte das Dashboard eine einzige Zahl, die aus Job-Zaehlern
// hochgerechnet war: Apollo und NeverBounce fehlten darin komplett, die
// "Hunter-Credits" waren die Anzahl erledigter Jobs statt echter Verbrauch,
// und ein Job mit zwei OpenAI-Aufrufen zaehlte wie einer. Seit api_usage
// (Migration 0054) schreibt jeder kostenpflichtige Aufruf eine Zeile mit der
// wirklich verbrauchten Menge.
//
// Diese Seite trennt bewusst zwischen MENGE und BETRAG. Die Menge ist
// gemessen. Der Betrag existiert nur dort, wo ein Stueckpreis oeffentlich und
// tarifunabhaengig ist -- bei Apollo und Hunter haengt der Wert eines Credits
// am gebuchten Paket, deshalb steht dort bewusst kein Euro-Betrag statt eines
// geratenen.

const RANGE_DAYS = [7, 30, 90, 365] as const;
const DEFAULT_RANGE = 30;

type ProviderRow = {
  provider: string;
  cost_usd: number;
  calls: number;
  units: Record<string, number> | null;
};
type Summary = { total_usd: number; providers: ProviderRow[] };

const UNIT_LABEL: Record<string, Record<"de" | "en", string>> = {
  credits: { de: "Credits", en: "credits" },
  checks: { de: "Prüfungen", en: "checks" },
  tokens: { de: "Tokens", en: "tokens" },
  requests: { de: "Aufrufe", en: "requests" },
};

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  hunter: "Hunter.io",
  apollo: "Apollo.io",
  prospeo: "Prospeo",
  neverbounce: "NeverBounce",
  google_maps: "Google Maps",
};

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const lang = await getLangServer();
  const t = dict[lang];
  const C = t.costs;
  const params = await searchParams;
  const rangeDays = RANGE_DAYS.includes(Number(params.range) as (typeof RANGE_DAYS)[number])
    ? Number(params.range)
    : DEFAULT_RANGE;

  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return null;

  const from = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase.rpc("api_usage_summary", {
    p_workspace_id: ws.workspace.id,
    p_from: from,
    p_to: null,
  });
  const summary = (data as Summary | null) ?? { total_usd: 0, providers: [] };

  // Die eingetragenen Monatstarife (Migration 0077). Sie sind der Teil der
  // Kosten, den kein Zaehler messen kann -- Instantly hat gar keinen Aufruf,
  // und was ein Apollo-Credit wert ist, haengt am gebuchten Paket.
  const { data: subsRows } = await supabase
    .from("provider_subscriptions")
    .select("provider, monthly_usd")
    .eq("workspace_id", ws.workspace.id);
  const subs = Object.fromEntries(
    ((subsRows ?? []) as { provider: string; monthly_usd: number }[]).map((r) => [
      r.provider,
      Number(r.monthly_usd),
    ])
  );
  const subsMonthly = Object.values(subs).reduce((a, b) => a + b, 0);
  // Anteilig auf denselben Zeitraum wie der gemessene Verbrauch darueber --
  // sonst stuenden in einer Summe ein Monat und sieben Tage nebeneinander.
  const subsInRange = subsMonthly * (rangeDays / 30);

  function formatUnits(units: Record<string, number> | null): string {
    if (!units) return "—";
    return Object.entries(units)
      .map(([kind, amount]) => {
        const label = UNIT_LABEL[kind]?.[lang] ?? kind;
        return `${Math.round(amount).toLocaleString(lang === "de" ? "de-DE" : "en-US")} ${label}`;
      })
      .join(" · ");
  }

  return (
    <div className="fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-strong">{C.title}</h1>
          <p className="text-sm text-faint">{C.subtitle}</p>
        </div>
        <div className="flex gap-1.5">
          {RANGE_DAYS.map((d) => (
            <Link
              key={d}
              href={d === DEFAULT_RANGE ? "/costs" : `/costs?range=${d}`}
              className={
                "rounded-lg border px-2.5 py-1 text-xs transition-colors " +
                (d === rangeDays
                  ? "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                  : "border-edge2 text-faint hover:text-soft")
              }
            >
              {C.rangeLabel(d)}
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-edge/60 bg-panel p-5">
        <div className="text-xs uppercase tracking-wide text-faint">{C.totalLabel}</div>
        <div className="mt-1 text-3xl font-semibold text-strong">
          ${(summary.total_usd + subsInRange).toFixed(2)}
        </div>
        {/* Die Summe getrennt ausweisen, nicht nur addieren: das eine ist
            gemessen, das andere eingetragen. Wer sie nicht auseinanderhalten
            kann, weiss nicht, welchem Teil er trauen darf. */}
        <p className="mt-1 text-xs text-soft">
          {C.splitUsage} <span className="tabular-nums text-strong">${summary.total_usd.toFixed(2)}</span>
          {" · "}
          {C.splitPlans} <span className="tabular-nums text-strong">${subsInRange.toFixed(2)}</span>
          {subsMonthly > 0 && (
            <span className="text-mute"> ({C.splitProRated(subsMonthly, rangeDays)})</span>
          )}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-mute">{C.totalHint}</p>
      </div>

      <Subscriptions initial={subs} />

      {summary.providers.length === 0 ? (
        <div className="rounded-lg border border-edge/60 bg-panel p-10 text-center text-faint">
          {C.empty}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-edge/60 bg-panel">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge/60 text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-5 py-3 font-medium">{C.colProvider}</th>
                <th className="px-5 py-3 font-medium">{C.colUnits}</th>
                <th className="px-5 py-3 font-medium">{C.colCalls}</th>
                <th className="px-5 py-3 text-right font-medium">{C.colCost}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60">
              {summary.providers.map((p) => (
                <tr key={p.provider}>
                  <td className="px-5 py-3 text-strong">
                    {PROVIDER_LABEL[p.provider] ?? p.provider}
                  </td>
                  <td className="px-5 py-3 text-soft">{formatUnits(p.units)}</td>
                  <td className="px-5 py-3 text-mute">{p.calls}</td>
                  <td className="px-5 py-3 text-right text-strong">
                    {p.cost_usd > 0 ? (
                      "$" + Number(p.cost_usd).toFixed(2)
                    ) : (
                      // Kein Betrag heisst nicht "kostenlos", sondern "haengt
                      // am Tarif" -- das muss dastehen, sonst liest sich eine
                      // leere Zelle wie eine Null.
                      <span className="text-xs text-mute">{C.tariffDependent}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs leading-relaxed text-mute">{C.methodNote}</p>
    </div>
  );
}
