"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { inputCls, primaryBtnSmCls, secondaryBtnSmCls } from "@/lib/ui";
import { reviewReason, type PersonReviewRow } from "@/lib/person-finding/review";

/**
 * Die Kontakt-Prueflliste fuer den Personen-Befund.
 *
 * Eigene Seite und nicht ein dritter Reiter in /icebreaker: die dortige
 * Liste liest aus businesses, dieser Text lebt am Kontakt, und der
 * wichtigste Teil hier ist nicht der Text, sondern die Provenienz darunter.
 * Wer freigibt, bestaetigt eine Bindung zwischen einer Quelle und einem
 * Menschen; das muss man sehen koennen, bevor man klickt.
 */
type Response = { items: PersonReviewRow[]; truncated: boolean };

export default function PersonFindingReview() {
  const { t, lang } = useT();
  const R = t.personFindingReview;
  const { push } = useToast();

  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/person-finding/review");
    if (res.ok) setData((await res.json()) as Response);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: "approve" | "discard" | "save", text?: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/person-finding/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, text, lang }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? res.statusText);
      const problems = (json?.problems ?? []) as string[];
      if (action === "save" && problems.length > 0) {
        push(`${R.saved}: ${R.problems(problems.length)}`, "error");
      } else {
        push(action === "approve" ? R.approved : action === "discard" ? R.discarded : R.saved, "success");
      }
      setEditing(null);
      await load();
    } catch (e) {
      push((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="fade-up space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{R.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-faint">{R.subtitle}</p>
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden>
          <div className="skeleton h-28" />
          <div className="skeleton h-28" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-edge/70 bg-panel p-8 text-center text-sm text-faint shadow-sm">
          {R.empty}
        </div>
      ) : (
        <>
          <p className="text-xs text-faint">{R.count(items.length)}</p>
          <ul className="space-y-3">
            {items.map((row) => {
              const src = row.person_finding_source;
              const reason = reviewReason(src);
              const isEditing = editing === row.id;
              return (
                <li key={row.id} className="rounded-xl border border-edge/70 bg-panel p-4 shadow-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {row.full_name ?? row.email}
                        {row.businesses?.name ? <span className="font-normal text-soft"> · {row.businesses.name}</span> : null}
                      </p>
                      {row.title && <p className="truncate text-xs text-faint">{row.title}</p>}
                    </div>
                    <span
                      className={
                        "rounded-full px-2.5 py-0.5 text-xs font-medium " +
                        (reason === "unverified_anchor"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "bg-red-500/10 text-red-600 dark:text-red-300")
                      }
                    >
                      {reason === "unverified_anchor" ? R.reasonAnchor : R.reasonRules}
                    </span>
                  </div>

                  {isEditing ? (
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={4}
                      className={inputCls + " mt-3 w-full"}
                    />
                  ) : (
                    <p className="mt-3 whitespace-pre-line text-sm text-ink">{row.person_finding}</p>
                  )}

                  {/* Die Provenienz: das, worueber jemand hier entscheidet. */}
                  {src && (
                    <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-soft sm:grid-cols-[auto_1fr]">
                      {src.angle && (
                        <>
                          <dt className="text-faint">{R.angle}</dt>
                          <dd>{src.angle}</dd>
                        </>
                      )}
                      {src.source_url && (
                        <>
                          <dt className="text-faint">{R.source}</dt>
                          <dd className="truncate">
                            {src.source_label ? `${src.source_label} · ` : ""}
                            <a href={src.source_url} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline dark:text-sky-300">
                              {src.source_url}
                            </a>
                            {typeof src.age_months === "number" && src.age_months >= 0 ? ` · ${R.age(src.age_months)}` : ""}
                          </dd>
                        </>
                      )}
                      {src.claim && (
                        <>
                          <dt className="text-faint">{R.evidence}</dt>
                          <dd>
                            {src.claim}
                            {src.identity_evidence ? ` · ${src.identity_evidence}` : ""}
                          </dd>
                        </>
                      )}
                    </dl>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {isEditing ? (
                      <>
                        <button
                          disabled={busy === row.id || !draft.trim()}
                          onClick={() => act(row.id, "save", draft)}
                          className={primaryBtnSmCls}
                        >
                          {R.save}
                        </button>
                        <button onClick={() => setEditing(null)} className={secondaryBtnSmCls}>
                          {R.cancel}
                        </button>
                      </>
                    ) : (
                      <>
                        <button disabled={busy === row.id} onClick={() => act(row.id, "approve")} className={primaryBtnSmCls}>
                          {R.approve}
                        </button>
                        <button
                          disabled={busy === row.id}
                          onClick={() => {
                            setEditing(row.id);
                            setDraft(row.person_finding ?? "");
                          }}
                          className={secondaryBtnSmCls}
                        >
                          {R.edit}
                        </button>
                        <button disabled={busy === row.id} onClick={() => act(row.id, "discard")} className={secondaryBtnSmCls}>
                          {R.discard}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
