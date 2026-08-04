"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { inputCls, primaryBtnCls } from "@/lib/ui";
import type { IcebreakerState, IcebreakerVerdict, ReviewSummary } from "@/lib/personalization/review";

/**
 * Die 766 markierten Aufhaenger abarbeiten, ohne 766 Klicks.
 *
 * DIE DREI HANDGRIFFE, UND WARUM ES GENAU DIESE SIND
 *
 *   Sammelaktion  -- die veralteten Markierungen in einem Zug abraeumen. Nach
 *                    der Bindestrich-Korrektur vom 2026-08-02 ist der
 *                    Grossteil davon gegenstandslos; die einzeln
 *                    wegzuklicken waere Beschaeftigung, keine Arbeit.
 *   Neu erzeugen  -- der Regelfall bei "zu lang". Kostet einen Modellaufruf,
 *                    deshalb auswaehlbar und nicht automatisch.
 *   Selbst schreiben -- die Antwort auf "das Modell kriegt es nicht hin".
 *
 * Bewusst NICHT gebaut: ein automatisches Kuerzen. Ein Aufhaenger, den ein
 * Programm auf 22 Woerter stutzt, endet mitten im Gedanken -- und geht dann
 * genau so an einen Fremden raus.
 */
type ReviewResponse = {
  settings: { maxWords: number; bannedWords: string[] };
  summary: ReviewSummary;
  items: IcebreakerVerdict[];
  truncated: boolean;
};

const STATES: IcebreakerState[] = ["failing", "stale", "clean"];

const STATE_CLS: Record<IcebreakerState, string> = {
  failing: "border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400",
  stale: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-500",
  clean: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

export default function IcebreakerReview() {
  const { t, lang } = useT();
  const R = t.icebreakerReview;
  const { push } = useToast();

  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<IcebreakerState | "all">("failing");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/personalization/review?lang=${lang}`);
      const body = await res.json();
      if (!res.ok) {
        push(t.common.error + (body.error ?? res.status), "error");
        return;
      }
      setData(body);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [lang, push, t.common.error]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Nach jeder Aktion neu laden statt lokal nachzupflegen.
   *
   * Der Zustand einer Zeile haengt an den Vorgaben des Workspaces, und die
   * koennen sich in einem anderen Tab geaendert haben. Eine Liste, die aus
   * dem Ergebnis der eigenen Klicks weitergerechnet wird, driftet dabei
   * langsam von der Wahrheit weg -- und zwar genau in der Ansicht, deren
   * einziger Zweck es ist, die Wahrheit zu zeigen.
   */
  async function act(body: Record<string, unknown>, done: (n: number) => void) {
    setBusy(true);
    try {
      const res = await fetch("/api/personalization/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, lang }),
      });
      const result = await res.json();
      if (!res.ok) {
        push(t.common.error + (result.error ?? res.status), "error");
        return;
      }
      done(result.queued ?? result.accepted ?? 0);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/personalization/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text: draft, lang }),
      });
      const result = await res.json();
      if (!res.ok) {
        push(t.common.error + (result.error ?? res.status), "error");
        return;
      }
      // Ehrlich melden, wenn der eigene Text die Vorgaben auch nicht haelt --
      // sonst verschwindet die Zeile scheinbar und taucht beim Neuladen wieder auf.
      push(result.problems?.length ? R.savedWithProblems : R.saved, result.problems?.length ? "error" : "success");
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(
    () => (data?.items ?? []).filter((v) => filter === "all" || v.state === filter),
    [data, filter]
  );

  // Auswaehlbar sind nur die sichtbaren -- eine Sammelaktion darf nichts
  // anfassen, was gerade nicht auf dem Schirm steht.
  const selectedVisible = visible.filter((v) => selected.has(v.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading && !data) return <p className="text-sm text-faint">{t.common.saving}</p>;

  const summary = data?.summary;

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{R.title}</h1>
        <p className="mt-1 text-sm text-faint">{R.subtitle}</p>
        <p className="mt-2 text-xs text-mute">{R.explainer}</p>
        {data && (
          <p className="mt-1 text-xs text-mute">
            {R.settingsHint(data.settings.maxWords, data.settings.bannedWords.join(" "))}{" "}
            <Link href="/ai-agent" className="text-sky-600 hover:underline dark:text-sky-400">
              {R.settingsLink}
            </Link>
          </p>
        )}
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-2">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? "all" : s)}
              disabled={summary[s] === 0}
              className={
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 " +
                (filter === s ? STATE_CLS[s] : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
              }
            >
              {R.states[s]}
              <span className="tabular-nums">{summary[s]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Die Sammelaktion steht oben und nicht am Ende der Liste: sie ist der
          Grund, warum diese Seite ueberhaupt in vertretbarer Zeit zu
          bearbeiten ist. */}
      {summary && summary.stale > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-sm text-ink">{R.staleExplain}</p>
          <button
            onClick={() => act({ action: "acceptStale" }, (n) => push(R.accepted(n), "success"))}
            disabled={busy}
            className="mt-2 rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-500"
          >
            {R.acceptStale(summary.stale)}
          </button>
        </div>
      )}

      {selectedVisible.length > 0 && (
        <div className="sticky top-2 z-10 flex items-center gap-2 rounded-lg border border-edge2 bg-panel px-4 py-2 shadow-sm">
          <span className="text-xs text-soft">{selectedVisible.length}</span>
          <button
            onClick={() =>
              act({ action: "regenerate", ids: selectedVisible.map((v) => v.id) }, (n) =>
                push(n > 0 ? R.queued(n) : R.queuedNone, n > 0 ? "success" : "error")
              )
            }
            disabled={busy}
            className={primaryBtnCls + " !px-3 !py-1.5 !text-xs"}
          >
            {R.regenerateAll(selectedVisible.length)}
          </button>
          <button
            onClick={() =>
              act({ action: "accept", ids: selectedVisible.map((v) => v.id) }, (n) =>
                push(R.accepted(n), "success")
              )
            }
            disabled={busy}
            className="rounded-lg border border-edge2 px-3 py-1.5 text-xs font-medium text-soft transition-colors hover:text-ink disabled:opacity-40"
          >
            {R.accept}
          </button>
        </div>
      )}

      {data?.truncated && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
          {R.truncated}
        </p>
      )}

      {summary?.total === 0 && <p className="py-8 text-center text-sm text-faint">{R.empty}</p>}
      {summary && summary.total > 0 && summary.failing === 0 && summary.stale === 0 && filter === "failing" && (
        <p className="py-8 text-center text-sm text-faint">{R.allClean}</p>
      )}

      <div className="space-y-2">
        {visible.map((v) => (
          <div key={v.id} className="rounded-lg border border-edge/60 bg-panel px-4 py-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(v.id)}
                onChange={() => toggle(v.id)}
                className="mt-1 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{v.name ?? "—"}</span>
                  <span className={"rounded-full border px-2 py-0.5 text-[11px] font-medium " + STATE_CLS[v.state]}>
                    {R.states[v.state]}
                  </span>
                  <span className="text-[11px] tabular-nums text-mute">
                    {R.words(v.words, data!.settings.maxWords)}
                  </span>
                </div>

                {editing === v.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      className={inputCls + " w-full"}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => saveDraft(v.id)} disabled={busy} className={primaryBtnCls + " !px-3 !py-1.5 !text-xs"}>
                        {R.save}
                      </button>
                      <button onClick={() => setEditing(null)} className="text-xs text-faint hover:text-ink">
                        {R.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-soft">{v.text}</p>
                )}

                {v.problems.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {v.problems.map((p) => (
                      <li key={p} className="text-xs text-red-600 dark:text-red-400">
                        {p}
                      </li>
                    ))}
                  </ul>
                )}

                {editing !== v.id && (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <button
                      onClick={() => {
                        setEditing(v.id);
                        setDraft(v.text);
                      }}
                      className="font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400"
                    >
                      {R.edit}
                    </button>
                    <button
                      onClick={() =>
                        act({ action: "regenerate", ids: [v.id] }, (n) =>
                          push(n > 0 ? R.queued(n) : R.queuedNone, n > 0 ? "success" : "error")
                        )
                      }
                      disabled={busy}
                      className="text-faint transition-colors hover:text-ink disabled:opacity-40"
                    >
                      {R.regenerate}
                    </button>
                    {v.state !== "clean" && (
                      <button
                        onClick={() => act({ action: "accept", ids: [v.id] }, (n) => push(R.accepted(n), "success"))}
                        disabled={busy}
                        className="text-faint transition-colors hover:text-ink disabled:opacity-40"
                      >
                        {R.accept}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
