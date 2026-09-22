import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import {
  byCampaign,
  monthsPresent,
  replies,
  sumUp,
  type CommissionRow,
} from "@/lib/report/commission";
import CsvButton from "./csv-button";

/**
 * Der Nachweis, welche Antworten auf die eigene Kampagne gingen.
 *
 * WOFUER ES DIESE SEITE GIBT
 *
 * Wer Kaltakquise fuer eine fremde Firma macht und nach Ergebnis bezahlt
 * wird, sendet aus DEREN Instantly-Konto: dort sitzen die Postfaecher und
 * die Zustellbarkeit. Der Antwort-Sync holt damit zwangslaeufig auch alles
 * herein, was die Firma selbst verschickt, und im Posteingang liegen beide
 * Stroeme nebeneinander.
 *
 * Welche Kampagne die eigene ist, entscheidet commission_campaigns
 * (Migration 0117). Gesetzt wird die Markierung beim Veroeffentlichen, also
 * als Nebenprodukt der Handlung, die sie belegt, und nicht als Haken, den
 * jemand spaeter anders setzen koennte.
 *
 * Die Seite ist serverseitig gerechnet und hat keinen eigenen Zustand ausser
 * dem Monat in der Adresszeile. Das ist Absicht: ein Beleg, dessen Zahlen
 * von einem Klickpfad abhaengen, laesst sich nicht weiterschicken.
 */
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>
): Promise<T[]> {
  // PostgREST deckelt JEDE Antwort bei 1.000 Zeilen, ein groesseres .limit()
  // aendert daran nichts. Dieselbe Falle wie in app/wirkung, wo die Seite
  // deshalb monatelang auf den ersten 1.000 von 6.176 Mails rechnete.
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await query(from, from + PAGE - 1);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

export default async function ProvisionPage({
  searchParams,
}: {
  searchParams: Promise<{ monat?: string }>;
}) {
  const lang = await getLangServer();
  const t = dict[lang];
  const P = t.commission;

  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;

  const { data: markedRows } = await supabase
    .from("commission_campaigns")
    .select("instantly_campaign_id, label, created_at")
    .eq("workspace_id", ws.workspace.id);

  const marked = new Map<string, string>(
    (markedRows ?? []).map((r) => [r.instantly_campaign_id as string, r.label as string])
  );

  /**
   * Der leere Zustand ist hier kein Randfall, sondern der Normalfall beim
   * ersten Besuch. Er erklaert deshalb, wie eine Kampagne markiert wird,
   * statt nur "keine Daten" zu sagen.
   */
  if (marked.size === 0) {
    return (
      <div className="fade-up space-y-5">
        <Kopf title={P.title} subtitle={P.subtitle} />
        <div className="rounded-xl border border-edge/70 bg-panel p-8 text-center shadow-sm">
          <p className="text-sm text-ink">{P.emptyTitle}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-faint">{P.emptyHint}</p>
        </div>
      </div>
    );
  }

  const rows = await fetchAll<CommissionRow>((from, to) =>
    supabase
      .from("messages")
      .select("direction, from_email, instantly_campaign_id, ai_interest, sent_at, created_at")
      .eq("workspace_id", ws.workspace.id)
      .in("instantly_campaign_id", [...marked.keys()])
      // Ohne feste Reihenfolge darf PostgREST Zeilen zwischen zwei Seiten
      // wiederholen oder auslassen.
      .order("id")
      .range(from, to)
  );

  const monate = monthsPresent(rows, marked);
  const gewaehlt = (await searchParams).monat ?? null;
  // Ein Monat aus der Adresszeile, den es nicht gibt, zeigt alles statt einer
  // leeren Seite: die Adresse kann aus einer Mail von letztem Quartal stammen.
  const monat = gewaehlt && monate.includes(gewaehlt) ? gewaehlt : null;

  const kampagnen = byCampaign(rows, marked, monat);
  const gesamt = sumUp(kampagnen);
  const liste = replies(rows, marked, monat);

  return (
    <div className="fade-up space-y-5">
      <Kopf title={P.title} subtitle={P.subtitle} />

      {/* Monatswahl als Links und nicht als Auswahlfeld: der gewaehlte Monat
          steht damit in der Adresse und laesst sich so weitergeben, wie man
          ihn sieht. Genau das braucht ein Beleg. */}
      <div className="flex flex-wrap items-center gap-2">
        <Monat href="/provision" label={P.allMonths} aktiv={monat === null} />
        {monate.map((m) => (
          <Monat key={m} href={`/provision?monat=${m}`} label={m} aktiv={monat === m} />
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Zahl label={P.contacted} wert={gesamt.contacted} />
        <Zahl label={P.replied} wert={gesamt.replied} />
        <Zahl label={P.human} wert={gesamt.human} hint={P.humanHint} betont />
        <Zahl label={P.positive} wert={gesamt.positive} betont />
      </div>

      <div className="overflow-hidden rounded-xl border border-edge/70 bg-panel shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-edge/70 text-left text-xs uppercase tracking-wide text-faint">
            <tr>
              <th className="px-4 py-3 font-medium">{P.campaign}</th>
              <th className="px-4 py-3 text-right font-medium">{P.contacted}</th>
              <th className="px-4 py-3 text-right font-medium">{P.replied}</th>
              <th className="px-4 py-3 text-right font-medium">{P.human}</th>
              <th className="px-4 py-3 text-right font-medium">{P.positive}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge/70">
            {kampagnen.map((c) => (
              <tr key={c.instantlyCampaignId}>
                <td className="px-4 py-3 text-ink">{c.label}</td>
                <td className="px-4 py-3 text-right tabular-nums text-soft">{c.totals.contacted}</td>
                <td className="px-4 py-3 text-right tabular-nums text-soft">{c.totals.replied}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-ink">{c.totals.human}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-ink">{c.totals.positive}</td>
              </tr>
            ))}
            {kampagnen.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-faint">
                  {P.noneInMonth}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Die Zahlen oben sind die Zusammenfassung. Strittig wird eine
          Abrechnung immer an einer einzelnen Zeile, deshalb steht sie hier
          und laesst sich mitnehmen. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">{P.repliesTitle(liste.length)}</h2>
          {liste.length > 0 && (
            <CsvButton rows={liste} label={P.csv} filename={`provision-${monat ?? "alle"}.csv`} />
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-edge/70 bg-panel shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-edge/70 text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-3 font-medium">{P.contact}</th>
                <th className="px-4 py-3 font-medium">{P.campaign}</th>
                <th className="px-4 py-3 font-medium">{P.interest}</th>
                <th className="px-4 py-3 text-right font-medium">{P.date}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/70">
              {liste.map((r) => (
                <tr key={r.email + r.at}>
                  <td className="px-4 py-3 text-ink">{r.email}</td>
                  <td className="px-4 py-3 text-soft">{r.campaignLabel}</td>
                  <td className="px-4 py-3 text-soft">
                    {r.interest ? (t.inbox.aiInterestLabels[r.interest] ?? r.interest) : P.unclassified}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-faint">{r.at.slice(0, 10)}</td>
                </tr>
              ))}
              {liste.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-faint">
                    {P.noReplies}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kopf({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-faint">{subtitle}</p>
    </div>
  );
}

function Monat({ href, label, aktiv }: { href: string; label: string; aktiv: boolean }) {
  return (
    <a
      href={href}
      aria-current={aktiv ? "page" : undefined}
      className={
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 " +
        (aktiv
          ? "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300"
          : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
      }
    >
      {label}
    </a>
  );
}

/**
 * Eine Zahl mit ihrer Beschriftung.
 *
 * `betont` hebt die beiden Zahlen hervor, um die es bei einer Abrechnung
 * tatsaechlich geht. "Angeschrieben" und "geantwortet" sind Kontext; wer
 * nach Ergebnis bezahlt wird, streitet ueber "Mensch" und "positiv".
 */
function Zahl({
  label,
  wert,
  hint,
  betont,
}: {
  label: string;
  wert: number;
  hint?: string;
  betont?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border bg-panel p-4 shadow-sm " +
        (betont ? "border-sky-500/40" : "border-edge/70")
      }
    >
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{wert}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}
