"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { formatDay } from "@/lib/format-time";
import { primaryBtnSmCls, secondaryBtnSmCls } from "@/lib/ui";

type Contact = {
  id: string;
  name: string | null;
  email: string | null;
  business_name: string | null;
  business_id: string;
  ooo_until: string;
  ooo_estimated: boolean;
  campaign_name: string | null;
};
type Bucket = { week: string; kw: number; sender: "berat" | "ramy"; contacts: Contact[] };
type Created = { campaign_id: string; name: string; copied: number; existed: boolean };

/**
 * Die Wochen als Karten, je Absender eine, mit dem einen Knopf.
 *
 * Nach dem Anlegen verschwindet die Karte nicht sofort, sondern zeigt den
 * Link zur Kampagne: der naechste Schritt (Postfaecher pruefen, starten)
 * liegt dort, und wer gerade geklickt hat, will dorthin.
 */
export default function WiederkontaktList() {
  const { t, lang } = useT();
  const W = t.wiederkontakt;
  const { push } = useToast();
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, Created>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/wiederkontakt", { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { buckets?: Bucket[]; total?: number };
    setBuckets(body.buckets ?? []);
    setTotal(body.total ?? 0);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(b: Bucket) {
    const key = `${b.week}|${b.sender}`;
    setBusy(key);
    try {
      const res = await fetch("/api/wiederkontakt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: b.week, sender: b.sender }),
      });
      const body = (await res.json().catch(() => ({}))) as Created & { error?: string };
      if (!res.ok || body.error) {
        push(W.error(body.error ?? `HTTP ${res.status}`), "error");
        return;
      }
      setDone((d) => ({ ...d, [key]: body }));
      push(body.existed ? W.existed(body.name) : W.created(body.name, body.copied), body.existed ? "info" : "success");
    } finally {
      setBusy(null);
    }
  }

  if (buckets === null) {
    return <div className="h-24 animate-pulse rounded-xl border border-edge/70 bg-panel" />;
  }
  if (buckets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-edge bg-panel/60 p-8 text-center text-sm text-faint">
        {W.empty}
      </div>
    );
  }

  const heute = buckets[0].week;
  return (
    <div className="space-y-4">
      <div className="text-sm text-soft">{W.waitingTotal(total)}</div>
      {buckets.map((b) => {
        const key = `${b.week}|${b.sender}`;
        const fertig = done[key];
        return (
          <section key={key} className="rounded-xl border border-edge/70 bg-panel shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge/60 px-5 py-3.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-base font-semibold text-ink">
                  {W.week(b.kw, formatDay(b.week, lang))}
                </span>
                {b.week === heute && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                    {W.thisWeek}
                  </span>
                )}
                <span className="text-sm text-soft">
                  {W.sender[b.sender]} · {W.contacts(b.contacts.length)}
                </span>
              </div>
              {fertig ? (
                <Link href={`/instantly/campaigns/${fertig.campaign_id}`} className={secondaryBtnSmCls}>
                  {W.openCampaign}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => create(b)}
                  disabled={busy !== null}
                  className={primaryBtnSmCls}
                >
                  {busy === key ? W.creating : W.create}
                </button>
              )}
            </header>
            <ul className="divide-y divide-edge/60">
              {b.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads?business=${c.business_id}`} className="font-medium text-ink hover:underline">
                      {c.name ?? c.email ?? W.noEmail}
                    </Link>
                    {c.business_name && <span className="text-soft"> · {c.business_name}</span>}
                    {c.campaign_name && (
                      <span className="text-faint">
                        {" "}
                        {W.fromCampaign} {c.campaign_name}
                      </span>
                    )}
                  </div>
                  <div className="whitespace-nowrap text-soft tabular">
                    {W.back} {formatDay(c.ooo_until, lang)}
                    {c.ooo_estimated && (
                      <span title={W.estimatedTitle} className="ml-1.5 text-xs text-faint">
                        ({W.estimated})
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
