import { Fragment } from "react";
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
import {
  byCopy,
  summarize,
  variantLabel,
  type CopyBucket,
  type OutboundRow as CopyRow,
  type ReplyRow,
} from "@/lib/report/copy-outcomes";

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
  const [{ data: outbound }, { data: inbound }, { data: meetingRows }] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "contact_id, sent_at, campaign_id, step_order, variant_index, campaigns(name), contacts(businesses(search_id, searches(name, query)))"
      )
      .eq("workspace_id", ws.workspace.id)
      .eq("direction", "outbound")
      .not("contact_id", "is", null)
      .limit(20000),
    /**
     * Abwesenheitsnotizen zaehlen NICHT als Antwort.
     *
     * Beim ersten Blick auf die fertige Seite stand hier 7 -- Instantly
     * meldete 1. Der Unterschied waren die 5 automatischen Antworten und
     * damit eine Quote von 2,4 statt 0,3 Prozent. Ein Autoresponder ist kein
     * Mensch, der reagiert hat; ihn mitzuzaehlen macht ausgerechnet die
     * Ansicht unehrlich, die es gibt, um ehrlich zu sein.
     *
     * Ueber ai_interest, das der Inbox-Sync ohnehin setzt (Migration 0064).
     * Nachrichten ohne Einstufung bleiben drin: das sind die aelteren, und
     * eine echte Antwort faelschlich zu verwerfen waere der schlimmere
     * Fehler.
     */
    /**
     * Hier bewusst OHNE den out_of_office-Filter, anders als bei den drei
     * Aufschluesselungen darunter.
     *
     * Die Text-Auswertung weist Abwesenheitsnotizen als eigene Spalte aus,
     * statt sie zu verwerfen -- ein Autoresponder ist keine Antwort, aber die
     * Zahl gehoert sichtbar dorthin, wo sonst der Eindruck entstuende, es sei
     * gar nichts zurueckgekommen. Das Aussortieren passiert in byCopy.
     */
    supabase
      .from("messages")
      .select("contact_id, campaign_id, step_order, variant_index, ai_interest")
      .eq("workspace_id", ws.workspace.id)
      .eq("direction", "inbound")
      .not("contact_id", "is", null)
      .limit(20000),
    /**
     * Wer es bis zu einem Termin gebracht hat.
     *
     * `customer` zaehlt mit: wer gekauft hat, hatte den Termin erst recht.
     * Ihn hier auszulassen wuerde ausgerechnet die erfolgreichsten Kontakte
     * aus der Erfolgsspalte streichen.
     */
    supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", ws.workspace.id)
      .in("outreach_status", ["meeting_booked", "customer"])
      .limit(20000),
  ]);

  type Row = {
    contact_id: string | null;
    sent_at: string | null;
    campaign_id: string | null;
    step_order: number | null;
    variant_index: number | null;
    campaigns: { name: string | null } | null;
    contacts: { businesses: { search_id: string | null; searches: { name: string | null; query: string } | null } | null } | null;
  };
  type InRow = {
    contact_id: string | null;
    campaign_id: string | null;
    step_order: number | null;
    variant_index: number | null;
    ai_interest: string | null;
  };

  const outboundRows = (outbound ?? []) as unknown as Row[];
  const inboundRows = (inbound ?? []) as unknown as InRow[];

  const rows: OutboundRow[] = outboundRows.map((m) => {
    const search = m.contacts?.businesses?.searches;
    return {
      contactId: m.contact_id,
      sentAt: m.sent_at,
      searchId: m.contacts?.businesses?.search_id ?? null,
      searchName: search?.name || search?.query || null,
    };
  });

  // Fuer die drei Aufschluesselungen zaehlt nur, DASS geantwortet wurde --
  // und Abwesenheitsnotizen zaehlen dort nicht mit (siehe Kommentar oben).
  const replies = new Set(
    inboundRows.filter((m) => m.ai_interest !== "out_of_office").map((m) => m.contact_id!).filter(Boolean)
  );

  const total = overview(rows, replies);
  const searches = bySearch(rows, replies);
  const weekdays = byWeekday(rows, replies, lang);
  const hours = byHourBlock(rows, replies);

  const copyRows: CopyRow[] = outboundRows.map((m) => ({
    contactId: m.contact_id!,
    campaignId: m.campaign_id,
    campaignName: m.campaigns?.name ?? null,
    step: m.step_order,
    variant: m.variant_index,
  }));
  const replyRows: ReplyRow[] = inboundRows.map((m) => ({
    contactId: m.contact_id!,
    campaignId: m.campaign_id,
    step: m.step_order,
    variant: m.variant_index,
    interest: m.ai_interest,
  }));
  const meetings = new Set(((meetingRows ?? []) as { id: string }[]).map((c) => c.id));
  const copy = byCopy(copyRows, replyRows, meetings);
  const copySummary = summarize(copyRows, copy);

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

      <CopySection buckets={copy} unattributed={copySummary.unattributed} labels={W} />

      <Section title={W.bySearch} hint={W.bySearchHint} buckets={searches} empty={W.noData} labels={W} />
      <Section title={W.byWeekday} hint={W.byWeekdayHint} buckets={weekdays} empty={W.noData} labels={W} />
      <Section title={W.byHour} hint={W.byHourHint} buckets={hours} empty={W.noData} labels={W} />

      <p className="text-xs text-mute">{W.methodNote(MIN_SAMPLE)}</p>
    </div>
  );
}

/**
 * Was welcher Text gebracht hat.
 *
 * Als Tabelle und nicht als Balken wie die drei Abschnitte darunter: dort
 * steht je Zeile EINE Quote, hier stehen sechs Zahlen, die man
 * nebeneinanderlegen muss. Ein Balken je Zeile wuerde eine davon zur
 * Hauptsache erklaeren -- und genau diese Verkuerzung ist der Fehler, vor dem
 * der Hinweis ueber der Tabelle warnt.
 *
 * Die Sequenz steht in ihrer eigenen Reihenfolge, nicht nach Erfolg sortiert:
 * die Frage lautet "wo bricht es ab".
 */
function CopySection({
  buckets,
  unattributed,
  labels: L,
}: {
  buckets: CopyBucket[];
  unattributed: number;
  labels: {
    byCopy: string;
    byCopyHint: string;
    copyWarning: string;
    noAttribution: string;
    unattributed: (n: number) => string;
    step: string;
    variant: string;
    contacts: string;
    replies: string;
    interested: string;
    notInterested: string;
    questions: string;
    meetings: string;
    autoReplies: string;
    thin: (n: number) => string;
  };
}) {
  // Mehrere Kampagnen: die Zwischenueberschrift verhindert, dass "Schritt 0"
  // aus zwei Kampagnen wie derselbe Text aussieht.
  const groups = new Map<string, CopyBucket[]>();
  for (const b of buckets) {
    const list = groups.get(b.campaignName);
    if (list) list.push(b);
    else groups.set(b.campaignName, [b]);
  }

  return (
    <div className="rounded-xl border border-edge2 bg-panel p-5">
      <h2 className="font-medium text-ink">{L.byCopy}</h2>
      <p className="mt-0.5 text-xs text-faint">{L.byCopyHint}</p>

      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-faint">{L.noAttribution}</p>
      ) : (
        <>
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
            {L.copyWarning}
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-edge2 text-[11px] uppercase tracking-wide text-mute">
                  <th className="py-1.5 pr-3 text-left font-normal">{L.step}</th>
                  <th className="px-2 py-1.5 text-right font-normal">{L.contacts}</th>
                  <th className="px-2 py-1.5 text-right font-normal">{L.replies}</th>
                  <th className="px-2 py-1.5 text-right font-normal">{L.interested}</th>
                  <th className="px-2 py-1.5 text-right font-normal">{L.notInterested}</th>
                  <th className="px-2 py-1.5 text-right font-normal">{L.autoReplies}</th>
                  {/* Die Spalte, auf die es ankommt, steht rechts aussen und
                      traegt als einzige Farbe. */}
                  <th className="py-1.5 pl-2 text-right font-normal text-ink">{L.meetings}</th>
                </tr>
              </thead>
              <tbody>
                {[...groups.entries()].map(([campaign, list]) => (
                  <Fragment key={campaign}>
                    <tr>
                      <td colSpan={7} className="pt-3 pb-1 text-xs font-medium text-soft">
                        {campaign}
                      </td>
                    </tr>
                    {list.map((b) => (
                      <tr key={b.key} className="border-t border-edge2/60">
                        <td className="py-1.5 pr-3 text-ink">
                          {L.step} {b.step + 1}
                          {/* Der Buchstabe nur, wo es ueberhaupt mehrere
                              Fassungen gibt -- sonst suggeriert ein "A" an
                              jeder Zeile einen Test, den es nicht gibt. */}
                          {list.some((o) => o.step === b.step && o.variant !== b.variant) && (
                            <span className="ml-1.5 rounded bg-chip px-1.5 py-0.5 text-[11px] text-soft">
                              {variantLabel(b.variant)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-soft">{b.contacts}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-soft">
                          {b.replies}
                          {b.replyRate !== null && (
                            <span className="ml-1 text-xs text-mute">
                              {(b.replyRate * 100).toFixed(1)} %
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-soft">{b.interested || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-soft">{b.notInterested || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-mute">{b.autoReplies || "—"}</td>
                        <td className="py-1.5 pl-2 text-right tabular-nums">
                          {b.meetings > 0 ? (
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">{b.meetings}</span>
                          ) : (
                            <span className="text-mute">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {/* Die Grundlage je Zeile, wo sie noch zu duenn fuer eine
                        Quote ist -- statt die Prozentzahl wegzulassen und
                        nicht zu sagen, warum. */}
                    {list.some((b) => b.replyRate === null) && (
                      <tr>
                        <td colSpan={7} className="pb-1 text-[11px] text-mute">
                          {list
                            .filter((b) => b.replyRate === null)
                            .map((b) => `${L.step} ${b.step + 1}${
                              list.some((o) => o.step === b.step && o.variant !== b.variant)
                                ? " " + variantLabel(b.variant)
                                : ""
                            }: ${L.thin(b.contacts)}`)
                            .join(" · ")}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {unattributed > 0 && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">{L.unattributed(unattributed)}</p>
          )}
        </>
      )}
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
