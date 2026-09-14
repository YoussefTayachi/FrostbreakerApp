"use client";
import { useEffect, useState } from "react";
import { useT } from "../../../language-provider";
import { useToast } from "../../../toast-provider";
import { variantLabel } from "@/lib/instantly/campaigns";
import type { StepAssessment, VariantVerdict } from "@/lib/instantly/variant-winner";

/**
 * Welche Textfassung Antworten bringt, und ob man das schon sagen darf.
 *
 * Die eigentliche Arbeit macht lib/instantly/variant-winner.ts. Hier steht
 * nur, wie das Ergebnis aussieht, mit einer Gestaltungsentscheidung: der
 * Zustand "collecting" wird genauso deutlich angezeigt wie ein Gewinner.
 * Eine Oberflaeche, die bei duenner Datenlage einfach die hoechste Zahl
 * hervorhebt, erzeugt genau den Fehler, gegen den die Logik dahinter gebaut
 * ist: der Nutzer sieht "5 % gegen 2 %" und schaltet ab, obwohl das bei 40
 * Mails je Fassung reines Rauschen ist.
 */
type Response = { steps: StepAssessment[]; openTracking: boolean | null };

const VERDICT_CLS: Record<VariantVerdict, string> = {
  winner: "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  leading: "border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  behind: "border-edge2 bg-chip text-mute",
  collecting: "border-edge2 bg-chip text-soft",
};

export default function VariantPanel({ campaignId }: { campaignId: string }) {
  const { t } = useT();
  const V = t.instantly.campaigns.variants;
  const { push } = useToast();

  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/instantly/campaigns/${campaignId}/steps`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          push(t.common.error + (body.error ?? r.status), "error");
          return;
        }
        setData(body);
      })
      .finally(() => setLoading(false));
    // Einmal beim Oeffnen. Die Zahlen bewegen sich im Tagesrhythmus, nicht im
    // Sekundentakt; ein Dauerabruf waere Last ohne Erkenntnis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  if (loading) return <div className="skeleton h-32" aria-hidden />;
  if (!data || data.steps.length === 0) {
    return <p className="py-10 text-center text-sm text-faint">{V.empty}</p>;
  }

  return (
    <div className="space-y-4">
      {/* Ohne Zaehlpixel ist "0 Oeffnungen" keine Beobachtung, sondern eine
          fehlende Messung. Das muss dabeistehen, sonst liest man die Spalte
          als Aussage ueber die Mail. */}
      {data.openTracking === false && <p className="text-xs text-faint">{V.openTrackingOff}</p>}

      {data.steps.map((step) => (
        <div key={step.step} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-base font-semibold text-ink">{V.stepLabel(step.step + 1)}</p>
            {step.variants.length < 2 ? (
              <span className="text-xs text-mute">{V.singleVariant}</span>
            ) : step.winner === null ? (
              <span className="text-xs text-mute">
                {step.missingSends > 0 ? V.needMore(step.missingSends) : V.tooClose}
              </span>
            ) : (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {V.winnerIs(variantLabel(step.winner))}
              </span>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-edge/70">
            <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-edge/70 bg-panel2 text-2xs font-medium uppercase tracking-wider text-mute">
                  <th className="px-3 py-2">{V.colVariant}</th>
                  <th className="px-3 py-2 text-right">{V.colSent}</th>
                  <th className="px-3 py-2 text-right">{V.colOpened}</th>
                  <th className="px-3 py-2 text-right">{V.colReplies}</th>
                  <th className="px-3 py-2 text-right">{V.colRate}</th>
                </tr>
              </thead>
              <tbody>
                {step.variants.map((v) => (
                  <tr key={v.variant} className="border-b border-edge/70 transition-colors duration-150 last:border-0 hover:bg-wash">
                    <td className="px-3 py-2.5">
                      <span className={"rounded-full border px-2.5 py-0.5 text-xs font-medium " + VERDICT_CLS[v.verdict]}>
                        {variantLabel(v.variant)}
                      </span>
                      <span className="ml-2 text-xs text-faint">{V.verdicts[v.verdict]}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-soft">{v.sent}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-soft">
                      {data.openTracking === false ? <span className="text-mute">—</span> : v.opened}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-soft">{v.unique_replies}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">
                      {(v.replyRate * 100).toFixed(1)} %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <p className="text-xs text-faint">{V.methodNote}</p>
    </div>
  );
}
