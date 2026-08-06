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
  bestBucket,
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

      <Funnel total={total} meetings={meetings.size} labels={W} />

      <CopySection
        buckets={copy}
        unattributed={copySummary.unattributed}
        orphaned={copySummary.orphaned}
        labels={W}
      />

      <Section title={W.bySearch} hint={W.bySearchHint} buckets={searches} empty={W.noData} labels={W} />
      <Section title={W.byWeekday} hint={W.byWeekdayHint} buckets={weekdays} empty={W.noData} labels={W} />
      <Section title={W.byHour} hint={W.byHourHint} buckets={hours} empty={W.noData} labels={W} />

      <p className="text-xs text-mute">{W.methodNote(MIN_SAMPLE)}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Gestaltung
   ══════════════════════════════════════════════════════════════════════

   Die Zahlen dieser Seite sind klein und die Quoten winzig -- ein bis zwei
   Antworten auf zweihundert Kontakte. Das ist die eigentliche gestalterische
   Aufgabe hier: ein Balken, der 1 % massstabsgetreu zeichnet, ist ein
   unsichtbarer Strich, und eine Tabelle voller Striche liest niemand.

   Deshalb zwei Kunstgriffe, beide bewusst:

     1. Balken sind fuenffach ueberhoeht (RATE_SCALE). Sie taugen damit zum
        VERGLEICHEN zweier Zeilen, nicht zum Ablesen -- die Zahl steht
        daneben. Dieselbe Ueberhoehung wie in der Lead-Listen-Ansicht, damit
        die Balken der Seite untereinander vergleichbar bleiben.

     2. Die Zusammensetzung steht als farbige Chips daneben, nicht als
        Balkenabschnitte. Bei zwei Absagen auf 149 Kontakte waere ein
        Abschnitt 1,3 % breit und nicht erkennbar; als Chip mit einer Zwei
        ist er sofort lesbar.

   Farben tragen Bedeutung, nicht Dekoration: gruen = etwas Gutes ist
   passiert, rot = ausdrueckliches Nein, grau = Maschine. Sie stehen nie
   allein -- daneben steht immer die Zahl und das Wort.
   ══════════════════════════════════════════════════════════════════════ */

/** Ueberhoehung der Balken. Siehe Kommentar oben. */
const RATE_SCALE = 5;

function barWidth(rate: number): string {
  return `${Math.max(2, Math.min(100, rate * 100 * RATE_SCALE))}%`;
}

/**
 * Der Trichter: angeschrieben, geantwortet, Termin.
 *
 * Drei Zahlen, die zusammengehoeren und einzeln nichts sagen. Als Kacheln
 * nebeneinander wirkten sie wie drei unabhaengige Messwerte -- mit Pfeilen
 * dazwischen sieht man, dass es dieselben Menschen sind, die schmaler werden.
 */
function Funnel({
  total,
  meetings,
  labels: L,
}: {
  total: { contacted: number; replied: number; rate: number | null; missing: number };
  meetings: number;
  labels: { contacted: string; replied: string; meetings: string; rate: string; tooEarly: (n: number) => string };
}) {
  const steps = [
    { label: L.contacted, value: total.contacted, tone: "text-ink" },
    { label: L.replied, value: total.replied, tone: "text-sky-600 dark:text-sky-400" },
    { label: L.meetings, value: meetings, tone: "text-emerald-600 dark:text-emerald-400" },
  ];
  return (
    <div className="rounded-xl border border-edge2 bg-gradient-to-br from-panel to-panel2/40 p-5">
      <div className="flex items-stretch gap-2">
        {steps.map((s, i) => (
          <Fragment key={s.label}>
            {i > 0 && (
              <div className="flex items-center text-mute" aria-hidden>
                <svg viewBox="0 0 12 24" className="h-5 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 5l5 7-5 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] uppercase tracking-wide text-mute">{s.label}</p>
              <p className={"mt-0.5 text-3xl font-semibold tabular-nums " + s.tone}>{s.value}</p>
            </div>
          </Fragment>
        ))}
        <div className="hidden min-w-0 flex-1 border-l border-edge2 pl-4 sm:block">
          <p className="truncate text-[11px] uppercase tracking-wide text-mute">{L.rate}</p>
          <p className="mt-0.5 text-3xl font-semibold tabular-nums text-soft">
            {total.rate === null ? "—" : `${(total.rate * 100).toFixed(1)} %`}
          </p>
        </div>
      </div>
      {total.rate === null && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">{L.tooEarly(total.missing)}</p>
      )}
    </div>
  );
}

/** Eine farbige Zahl mit Wort. Null wird zu einem Strich in Grau -- eine
 *  grosse bunte 0 zieht Aufmerksamkeit auf ein Nichtereignis. */
function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  if (n === 0) {
    return (
      <span className="whitespace-nowrap text-[11px] text-mute">
        — {label}
      </span>
    );
  }
  return (
    <span className={"whitespace-nowrap text-[11px] font-medium " + tone}>
      {n} {label}
    </span>
  );
}

/**
 * Was welcher Text gebracht hat -- je Kampagne eine Karte.
 *
 * Vorher stand hier EINE Tabelle ueber alle Kampagnen, mit
 * Zwischenueberschriften als Zeilen. Das las sich wie eine Kontoauszugsliste:
 * sieben Spalten, alles gleich gewichtet, kein Anhaltspunkt, wo man
 * hinschauen soll. Jetzt ist jede Kampagne eine Karte, jeder Schritt eine
 * Zeile mit Balken, und die beste Zeile je Kampagne ist hervorgehoben.
 */
function CopySection({
  buckets,
  unattributed,
  orphaned,
  labels: L,
}: {
  buckets: CopyBucket[];
  unattributed: number;
  orphaned: number;
  labels: {
    byCopy: string;
    byCopyHint: string;
    copyWarning: string;
    noAttribution: string;
    unattributed: (n: number) => string;
    orphaned: (n: number) => string;
    externalCampaign: string;
    step: string;
    contacts: string;
    replies: string;
    interested: string;
    notInterested: string;
    meetings: string;
    autoReplies: string;
    thin: (n: number) => string;
    bestStep: string;
  };
}) {
  const groups = new Map<string, CopyBucket[]>();
  for (const b of buckets) {
    const name = b.campaignName || L.externalCampaign;
    const list = groups.get(name);
    if (list) list.push(b);
    else groups.set(name, [b]);
  }

  return (
    <div className="rounded-xl border border-edge2 bg-panel p-5">
      <h2 className="font-medium text-ink">{L.byCopy}</h2>
      <p className="mt-0.5 text-xs text-faint">{L.byCopyHint}</p>

      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-faint">{L.noAttribution}</p>
      ) : (
        <>
          <p className="mt-3 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
            <span aria-hidden>⚠</span>
            <span>{L.copyWarning}</span>
          </p>

          <div className="mt-4 space-y-4">
            {[...groups.entries()].map(([campaign, list]) => {
              const best = bestBucket(list);
              const totalContacts = list.reduce((n, b) => Math.max(n, b.contacts), 0);
              return (
                <div key={campaign} className="overflow-hidden rounded-lg border border-edge2/70">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge2/70 bg-panel2/50 px-3 py-2">
                    <h3 className="text-sm font-medium text-ink">{campaign}</h3>
                    <span className="text-[11px] tabular-nums text-mute">
                      {totalContacts} {L.contacts}
                    </span>
                  </div>

                  <div className="divide-y divide-edge2/50">
                    {list.map((b) => {
                      const hasVariants = list.some((o) => o.step === b.step && o.variant !== b.variant);
                      const isBest = best?.key === b.key && (b.meetings > 0 || b.interested > 0 || b.replies > 0);
                      return (
                        <div
                          key={b.key}
                          className={
                            "px-3 py-2.5 transition-colors " +
                            (isBest ? "bg-emerald-500/[0.06]" : "hover:bg-wash")
                          }
                        >
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <span className="flex w-28 shrink-0 items-center gap-1.5 text-sm text-ink">
                              {L.step} {b.step + 1}
                              {hasVariants && (
                                <span className="rounded bg-chip px-1.5 py-0.5 text-[10px] font-medium text-soft">
                                  {variantLabel(b.variant)}
                                </span>
                              )}
                            </span>

                            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-mute">
                              {b.contacts}
                            </span>

                            {/* Der Balken: fuenffach ueberhoeht, taugt zum
                                Vergleichen zweier Zeilen -- die Zahl steht
                                daneben. */}
                            <span className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-chip">
                              {b.replyRate !== null && b.replyRate > 0 && (
                                <span
                                  className="block h-full rounded-full bg-sky-500"
                                  style={{ width: barWidth(b.replyRate) }}
                                />
                              )}
                            </span>

                            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-soft">
                              {b.replyRate === null ? (
                                <span className="text-mute">{L.thin(b.contacts)}</span>
                              ) : (
                                <>
                                  {b.replies} <span className="text-mute">· {(b.replyRate * 100).toFixed(1)} %</span>
                                </>
                              )}
                            </span>

                            {/* Die Termin-Pille steht rechts aussen und ist
                                das Einzige, was gefuellt farbig ist. */}
                            <span className="w-16 shrink-0 text-right">
                              {b.meetings > 0 ? (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                  {b.meetings} ★
                                </span>
                              ) : (
                                <span className="text-[11px] text-mute">—</span>
                              )}
                            </span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-28">
                            <Count n={b.interested} label={L.interested} tone="text-emerald-600 dark:text-emerald-400" />
                            <Count n={b.notInterested} label={L.notInterested} tone="text-red-600 dark:text-red-400" />
                            <Count n={b.autoReplies} label={L.autoReplies} tone="text-mute" />
                            {isBest && (
                              <span className="ml-auto text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-500">
                                {L.bestStep}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Was NICHT in der Auswertung steht, steht wenigstens darunter. */}
          {(orphaned > 0 || unattributed > 0) && (
            <p className="mt-3 space-x-2 text-[11px] text-mute">
              {orphaned > 0 && <span>{L.orphaned(orphaned)}</span>}
              {unattributed > 0 && <span className="text-amber-600 dark:text-amber-500">{L.unattributed(unattributed)}</span>}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Die drei Aufschluesselungen nach Liste, Wochentag und Tageszeit.
 *
 * Balken wie bisher, aber eingefaerbt und mit hervorgehobenem Spitzenreiter --
 * eine Reihe gleich grauer Balken beantwortet die Frage "wo soll ich
 * hinschauen" nicht.
 */
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
  const best = buckets.reduce<number>((m, b) => (b.rate !== null && b.rate > m ? b.rate : m), 0);

  return (
    <div className="rounded-xl border border-edge2 bg-panel p-5">
      <h2 className="font-medium text-ink">{title}</h2>
      <p className="mt-0.5 text-xs text-faint">{hint}</p>

      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-faint">{empty}</p>
      ) : (
        <div className="mt-3 space-y-1">
          {buckets.map((b) => {
            const leads = b.rate !== null && b.rate === best && best > 0;
            return (
              <div key={b.key} className="flex items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-wash">
                <span
                  className={
                    "w-40 shrink-0 truncate text-sm " + (leads ? "font-medium text-ink" : "text-soft")
                  }
                >
                  {b.label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-chip">
                  {/* Der Balken zeigt die Quote nur dort, wo es eine gibt. Bei
                      duenner Grundlage bleibt die Flaeche leer statt einen
                      zufaelligen Ausschlag zu zeichnen. */}
                  {b.rate !== null && b.rate > 0 && (
                    <div
                      className={
                        "h-full rounded-full " +
                        (leads ? "bg-emerald-500" : "bg-sky-500/70")
                      }
                      style={{ width: barWidth(b.rate) }}
                    />
                  )}
                </div>
                <span className="w-28 shrink-0 text-right text-xs tabular-nums text-soft">
                  {b.rate === null ? (
                    <span className="text-mute">{labels.thin(b.contacts)}</span>
                  ) : (
                    <>
                      {(b.rate * 100).toFixed(1)} %{" "}
                      <span className="text-mute">
                        · {b.replies}/{b.contacts}
                      </span>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
