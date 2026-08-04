import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import {
  MIN_SAMPLE,
  byHourBlock,
  bySearch,
  byWeekday,
  overview,
  type Bucket,
  type OutboundRow,
} from "@/lib/report/effectiveness";

/**
 * Was tatsaechlich Antworten bringt.
 *
 * Die Seite, die es erst geben kann, seit die Daten vollstaendig sind: bis
 * zum Nachlauf am 2026-08-04 kannte die App 184 von 312 versendeten Mails,
 * und jede Auswertung darauf haette zuverlaessig in die Irre gefuehrt.
 *
 * Serverseitig gerechnet, weil alles in einer Abfrage liegt und niemand
 * darauf klickt -- die Seite ist ein Bericht, keine Anwendung.
 *
 * Die Auswertung selbst steht in lib/report/effectiveness.ts (mit Tests). Der
 * wichtigste Teil davon ist, was NICHT angezeigt wird: unter 30
 * angeschriebenen Kontakten je Gruppe gibt es keine Quote, sondern den
 * Hinweis, dass die Grundlage fehlt.
 */
export default async function WirkungPage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const W = t.effectiveness;

  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;

  /**
   * Ausgehende Mails mit ihrer Lead-Liste, eingehende als reine Kontaktmenge.
   *
   * Der Weg zur Suche fuehrt ueber die Firma des Kontakts und nicht ueber die
   * Kampagne: eine Kampagne kann aus mehreren Suchen gespeist werden
   * (Migration 0050), und die Frage lautet hier "welche Nische antwortet",
   * nicht "welche Kampagne".
   */
  const [{ data: outbound }, { data: inbound }] = await Promise.all([
    supabase
      .from("messages")
      .select("contact_id, sent_at, contacts(businesses(search_id, searches(name, query)))")
      .eq("workspace_id", ws.workspace.id)
      .eq("direction", "outbound")
      .not("contact_id", "is", null)
      .limit(20000),
    supabase
      .from("messages")
      .select("contact_id")
      .eq("workspace_id", ws.workspace.id)
      .eq("direction", "inbound")
      .not("contact_id", "is", null)
      .limit(20000),
  ]);

  type Row = {
    contact_id: string | null;
    sent_at: string | null;
    contacts: { businesses: { search_id: string | null; searches: { name: string | null; query: string } | null } | null } | null;
  };

  const rows: OutboundRow[] = ((outbound ?? []) as unknown as Row[]).map((m) => {
    const search = m.contacts?.businesses?.searches;
    return {
      contactId: m.contact_id,
      sentAt: m.sent_at,
      searchId: m.contacts?.businesses?.search_id ?? null,
      searchName: search?.name || search?.query || null,
    };
  });

  const replies = new Set(((inbound ?? []) as { contact_id: string | null }[]).map((m) => m.contact_id!).filter(Boolean));

  const total = overview(rows, replies);
  const searches = bySearch(rows, replies);
  const weekdays = byWeekday(rows, replies, lang);
  const hours = byHourBlock(rows, replies);

  return (
    <div className="fade-up max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{W.title}</h1>
        <p className="text-sm text-faint">{W.subtitle}</p>
      </div>

      <div className="rounded-xl border border-edge2 bg-panel p-5">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Stat label={W.contacted} value={String(total.contacted)} />
          <Stat label={W.replied} value={String(total.replied)} />
          <Stat
            label={W.rate}
            value={total.rate === null ? "—" : `${(total.rate * 100).toFixed(1)} %`}
            strong
          />
        </div>
        {/* Der wichtigste Satz der Seite, solange er zutrifft: eine Quote aus
            zu wenigen Kontakten sieht praezise aus und bedeutet nichts. */}
        {total.rate === null && <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">{W.tooEarly(total.missing)}</p>}
      </div>

      <Section title={W.bySearch} hint={W.bySearchHint} buckets={searches} empty={W.noData} labels={W} />
      <Section title={W.byWeekday} hint={W.byWeekdayHint} buckets={weekdays} empty={W.noData} labels={W} />
      <Section title={W.byHour} hint={W.byHourHint} buckets={hours} empty={W.noData} labels={W} />

      <p className="text-xs text-mute">{W.methodNote(MIN_SAMPLE)}</p>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-mute">{label}</p>
      <p className={"tabular-nums " + (strong ? "text-2xl font-semibold text-ink" : "text-2xl text-soft")}>{value}</p>
    </div>
  );
}

function Section({
  title,
  hint,
  buckets,
  empty,
  labels,
}: {
  title: string;
  hint: string;
  buckets: Bucket[];
  empty: string;
  labels: { thin: (n: number) => string };
}) {
  return (
    <div className="rounded-xl border border-edge2 bg-panel p-5">
      <h2 className="font-medium text-ink">{title}</h2>
      <p className="mt-0.5 text-xs text-faint">{hint}</p>

      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-faint">{empty}</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {buckets.map((b) => (
            <div key={b.key} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-sm text-ink">{b.label}</span>
              {/* Der Balken zeigt die Quote nur dort, wo es eine gibt. Bei
                  duenner Grundlage bleibt die Flaeche leer statt einen
                  zufaelligen Ausschlag zu zeichnen. */}
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-chip">
                {b.rate !== null && (
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{ width: `${Math.min(100, b.rate * 100 * 5)}%` }}
                  />
                )}
              </div>
              <span className="w-28 shrink-0 text-right text-xs tabular-nums text-soft">
                {b.rate === null ? (
                  <span className="text-mute">{labels.thin(b.contacts)}</span>
                ) : (
                  `${(b.rate * 100).toFixed(1)} % · ${b.replies}/${b.contacts}`
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
