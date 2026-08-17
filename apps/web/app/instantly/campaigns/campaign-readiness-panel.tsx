"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "../../language-provider";
import type { CheckId, Readiness, ReadinessCheck, Severity } from "@/lib/campaign-readiness";
import type { Step } from "./campaign-form";

/**
 * Was gegen den Start dieser Kampagne spricht — bevor sie laeuft.
 *
 * Die Bewertung kommt fertig von api/campaigns/readiness (Schwellen und
 * Begruendungen in lib/campaign-readiness.ts). Diese Komponente entscheidet
 * nichts, sie formuliert nur: welcher Satz zu welcher Pruefung gehoert, und
 * dass Blocker anders aussehen als Hinweise.
 *
 * WARUM DER TROTZDEM-KNOPF EXISTIERT
 *
 * Weil er sonst umgangen wuerde. Ein Torwart, den man nicht passieren kann,
 * fuehrt dazu, dass die Kampagne direkt bei Instantly angelegt wird — und
 * dann sieht die App gar nichts mehr. Der Knopf kostet einen bewussten
 * zweiten Klick und zeigt vorher, was man in Kauf nimmt. Das ist der
 * Unterschied zwischen einer Entscheidung und einem Versehen.
 */
export type ReadinessResult = Readiness;

const SEVERITY_STYLE: Record<Severity, { dot: string; box: string }> = {
  blocker: {
    dot: "bg-red-500",
    box: "border-red-500/40 bg-red-500/5",
  },
  warning: {
    dot: "bg-amber-500",
    box: "border-amber-500/30 bg-amber-500/5",
  },
  ok: { dot: "bg-emerald-500", box: "border-edge2" },
};

export default function CampaignReadinessPanel({
  searchIds,
  mailboxes,
  steps,
  onResult,
}: {
  searchIds: string[];
  mailboxes: string[];
  steps: Step[];
  onResult: (r: ReadinessResult | null) => void;
}) {
  const { t } = useT();
  const G = t.campaignReadiness;
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassed, setShowPassed] = useState(false);

  /**
   * Erst pruefen, wenn ueberhaupt etwas zu pruefen ist.
   *
   * Ohne Suche und ohne Postfach waere jede Antwort "keine Leads, kein SPF"
   * — also eine rote Wand, bevor der Nutzer das erste Feld ausgefuellt hat.
   * Der Torwart soll am Ende des Formulars stehen, nicht am Anfang.
   *
   * Die Verzoegerung fasst das Tippen in der Sequenz zusammen: die Route
   * fragt das DNS ab, und das soll nicht bei jedem Buchstaben passieren.
   */
  useEffect(() => {
    if (searchIds.length === 0 || mailboxes.length === 0) {
      setResult(null);
      onResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch("/api/campaigns/readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Geprueft wird Variante A: sie geht an jeden Empfaenger raus, die
        // weiteren nur an einen Teil. Was hier auffaellt, faellt damit bei
        // allen auf.
        body: JSON.stringify({
          searchIds,
          mailboxes,
          steps: steps.map((s) => ({ body: s.variants[0]?.body ?? "" })),
        }),
      })
        .then((r) => r.json())
        .then((body: ReadinessResult & { error?: string }) => {
          if (cancelled || body.error) return;
          setResult(body);
          onResult(body);
        })
        .catch(() => {})
        .finally(() => !cancelled && setLoading(false));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // onResult ist beim Aufrufer stabil; mit in der Liste wuerde jeder
    // Render eine neue DNS-Abfrage ausloesen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchIds, mailboxes, steps]);

  if (!result && !loading) return null;

  const failing = result?.checks.filter((c) => c.severity !== "ok") ?? [];
  const passed = result?.checks.filter((c) => c.severity === "ok") ?? [];

  return (
    <div className="space-y-2 rounded-xl border border-edge2 bg-panel2 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">{G.title}</p>
        {loading && <span className="text-xs text-faint">{G.checking}</span>}
      </div>

      {result && failing.length === 0 && <p className="text-sm text-emerald-600 dark:text-emerald-400">{G.allGood}</p>}

      {result && result.blockers > 0 && (
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{G.blockedTitle(result.blockers)}</p>
      )}

      <div className="space-y-1.5">
        {failing.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </div>

      {passed.length > 0 && (
        <>
          <button
            onClick={() => setShowPassed(!showPassed)}
            className="text-xs text-faint transition-colors hover:text-ink"
          >
            {showPassed ? G.hidePassed : G.showPassed(passed.length)}
          </button>
          {showPassed && (
            <div className="space-y-1.5">
              {passed.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  const { t } = useT();
  const G = t.campaignReadiness;
  const style = SEVERITY_STYLE[check.severity];
  const label = describe(check, G.checks);

  return (
    <div className={"rounded-lg border px-3 py-2 " + style.box}>
      <div className="flex items-start gap-2">
        <span className={"mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full " + style.dot} />
        <div className="min-w-0">
          <p className={"text-sm " + (check.severity === "ok" ? "text-soft" : "text-ink")}>{label.text}</p>
          {/* Die Begruendung nur dort, wo etwas nicht stimmt: bei einer
              bestandenen Pruefung ist sie Fuellmaterial, das die drei
              wichtigen Zeilen optisch untergehen laesst. */}
          {check.severity !== "ok" && label.why && <p className="mt-0.5 text-xs text-faint">{label.why}</p>}
          {check.severity !== "ok" && label.href && label.action && (
            <Link
              href={label.href}
              className="mt-1 inline-block text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
            >
              {label.action}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Von der Pruefung zum Satz.
 *
 * Die Fallunterscheidung steht hier und nicht in lib/campaign-readiness.ts:
 * dort wird gerechnet, und eine reine Rechenfunktion soll keine Saetze in
 * zwei Sprachen kennen. Die Zahlen kommen als values mit, damit hier nichts
 * nachgerechnet werden muss — eine zweite Rechnung waere eine zweite
 * Wahrheit.
 */
type Labels = ReturnType<typeof useT>["t"]["campaignReadiness"]["checks"];

function describe(check: ReadinessCheck, L: Labels): { text: string; why?: string; href?: string; action?: string } {
  const v = check.values;
  const ok = check.severity === "ok";

  switch (check.id as CheckId) {
    case "leads":
      return { text: ok ? L.leads.ok(Number(v.sendable)) : L.leads.bad };
    case "spf":
      return { text: ok ? L.spf.ok : L.spf.bad(String(v.domains)), why: L.spf.why, href: "/instantly/deliverability", action: t_deliverability() };
    case "dkim":
      return { text: ok ? L.dkim.ok : L.dkim.bad(String(v.domains)), why: L.dkim.why, href: "/instantly/deliverability", action: t_deliverability() };
    case "dmarc":
      return { text: ok ? L.dmarc.ok : L.dmarc.bad(String(v.domains)), why: L.dmarc.why, href: "/instantly/deliverability", action: t_deliverability() };
    case "bounce":
      return {
        text: ok ? L.bounce.ok(Number(v.percent)) : L.bounce.bad(Number(v.percent), Number(v.bounced), Number(v.sent)),
        why: L.bounce.why,
      };
    case "verification":
      return {
        text: ok ? L.verification.ok : L.verification.bad(Number(v.count), Number(v.total), Number(v.percent)),
        why: L.verification.why,
      };
    case "icebreakerMissing":
      return {
        text: ok
          ? L.icebreakerMissing.ok
          : L.icebreakerMissing.bad(Number(v.count), Number(v.total), Number(v.percent)),
        why: L.icebreakerMissing.why,
      };
    case "icebreakerFailing":
      return {
        text: ok
          ? L.icebreakerFailing.ok
          : L.icebreakerFailing.bad(Number(v.count), Number(v.total), Number(v.percent)),
        why: L.icebreakerFailing.why,
        href: "/icebreaker",
        action: L.icebreakerFailing.action,
      };
    case "sequence":
      return { text: ok ? L.sequence.ok(Number(v.steps)) : L.sequence.bad, why: L.sequence.why };
    case "firstMailLength":
      return {
        text: ok ? L.firstMailLength.ok(Number(v.words)) : L.firstMailLength.bad(Number(v.words), Number(v.max)),
        why: L.firstMailLength.why,
      };
    case "firstMailLink":
      return { text: ok ? L.firstMailLink.ok : L.firstMailLink.bad, why: L.firstMailLink.why };
  }
}

// Die Zustellbarkeits-Seite heisst in beiden Sprachen gleich; ein eigener
// Text dafuer waere ein Eintrag, den man beim naechsten Umbenennen vergisst.
function t_deliverability(): string {
  return "SPF / DKIM / DMARC";
}
