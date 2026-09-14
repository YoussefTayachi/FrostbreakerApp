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
import { dailyTimeline } from "@/lib/report/timeline";
import { nicheOutcomes, recommend, type Recommendation } from "@/lib/report/recommendations";
import TimelineChart from "./timeline-chart";
import { setStatsArchived } from "./actions";

/**
 * Was tatsaechlich Antworten bringt.
 *
 * Die Seite, die es erst geben kann, seit die Daten vollstaendig sind: bis
 * zum Nachlauf am 2026-08-04 kannte die App 184 von 312 versendeten Mails,
 * und jede Auswertung darauf haette zuverlaessig in die Irre gefuehrt.
 *
 * Serverseitig gerechnet, weil alles in einer Abfrage liegt; die einzige
 * Interaktion (Kampagnen ausblenden) laeuft ueber eine Server-Action mit
 * einem <form>-Knopf, die Seite bleibt ohne eigenes Client-JS.
 *
 * ALLE ZAHLEN AUS DEN EIGENEN messages-ZEILEN, NIE AUS INSTANTLYS ROLLUP.
 * Instantlys eigene Oberflaeche zeigte am 2026-09-12 "Reply rate 0%" ueber
 * einer Tabelle mit 4 Antworten; das Rollup und die Einzelmails widersprechen
 * sich dort. Unsere Quelle sind die synchronisierten Mails, die wir selbst
 * pruefen koennen.
 *
 * Die Auswertung selbst steht in lib/report/ (mit Tests). Der wichtigste
 * Teil davon ist, was NICHT angezeigt wird: unter 30 angeschriebenen
 * Kontakten je Gruppe gibt es keine Quote, sondern den Hinweis, dass die
 * Grundlage fehlt.
 */
/**
 * Eine Abfrage vollstaendig lesen, Seite fuer Seite.
 *
 * PostgREST deckelt JEDE Antwort bei 1.000 Zeilen, ein groesseres .limit()
 * aendert daran nichts. Diese Seite lief bis zum 2026-09-12 ohne
 * Pagination und rechnete deshalb auf den ersten 1.000 von 6.176 Mails:
 * angezeigt waren 281 angeschriebene Kontakte und 0 Antworten, waehrend in
 * der Tabelle 12 echte Antworten standen. Die Seite, die es gibt, um
 * ehrlich zu sein, war durch den Deckel selbst die Luegnerin.
 */
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await query(from, from + PAGE - 1);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

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
    sent_at: string | null;
  };

  // .order("id") an jeder paginierten Abfrage: ohne feste Reihenfolge darf
  // PostgREST Zeilen zwischen zwei Seiten wiederholen oder auslassen.
  const [outboundRows, inboundRows, meetingRows, { data: campaignRows }] = await Promise.all([
    fetchAll<Row>((from, to) =>
      supabase
        .from("messages")
        .select(
          "contact_id, sent_at, campaign_id, step_order, variant_index, campaigns(name), contacts(businesses(search_id, searches(name, query)))"
        )
        .eq("workspace_id", ws.workspace.id)
        .eq("direction", "outbound")
        .not("contact_id", "is", null)
        .order("id")
        .range(from, to)
    ),
      /**
       * Abwesenheitsnotizen zaehlen NICHT als Antwort.
       *
       * Beim ersten Blick auf die fertige Seite stand hier 7: Instantly
       * meldete 1. Der Unterschied waren die 5 automatischen Antworten und
       * damit eine Quote von 2,4 statt 0,3 Prozent. Ein Autoresponder ist kein
       * Mensch, der reagiert hat; ihn mitzuzaehlen macht ausgerechnet die
       * Ansicht unehrlich, die es gibt, um ehrlich zu sein.
       *
       * Ueber ai_interest, das der Inbox-Sync ohnehin setzt (Migration 0064).
       * Nachrichten ohne Einstufung bleiben drin: das sind die aelteren, und
       * eine echte Antwort faelschlich zu verwerfen waere der schlimmere
       * Fehler. Das Aussortieren fuer die Text-Auswertung passiert in byCopy,
       * das die Abwesenheitsnotizen als eigene Spalte ausweist.
       */
      fetchAll<InRow>((from, to) =>
        supabase
          .from("messages")
          .select("contact_id, campaign_id, step_order, variant_index, ai_interest, sent_at")
          .eq("workspace_id", ws.workspace.id)
          .eq("direction", "inbound")
          .not("contact_id", "is", null)
          .order("id")
          .range(from, to)
      ),
      /**
       * Wer es bis zu einem Termin gebracht hat.
       *
       * `customer` zaehlt mit: wer gekauft hat, hatte den Termin erst recht.
       * Ihn hier auszulassen wuerde ausgerechnet die erfolgreichsten Kontakte
       * aus der Erfolgsspalte streichen.
       */
      fetchAll<{ id: string }>((from, to) =>
        supabase
          .from("contacts")
          .select("id")
          .eq("workspace_id", ws.workspace.id)
          .in("outreach_status", ["meeting_booked", "customer"])
          .order("id")
          .range(from, to)
      ),
      /**
       * Der Archiv-Zustand je Kampagne (Migration 0116): von Hand ausgeblendet
       * oder automatisch, weil die Kampagne bei Instantly geloescht wurde.
       */
      supabase
        .from("campaigns")
        .select("id, stats_archived_at")
        .eq("workspace_id", ws.workspace.id),
    ]);

  const rows: OutboundRow[] = outboundRows.map((m) => {
    const search = m.contacts?.businesses?.searches;
    return {
      contactId: m.contact_id,
      sentAt: m.sent_at,
      searchId: m.contacts?.businesses?.search_id ?? null,
      searchName: search?.name || search?.query || null,
    };
  });

  // Fuer die Aufschluesselungen zaehlt nur, DASS geantwortet wurde,
  // und Abwesenheitsnotizen zaehlen dort nicht mit (siehe Kommentar oben).
  const replies = new Set(
    inboundRows.filter((m) => m.ai_interest !== "out_of_office").map((m) => m.contact_id!).filter(Boolean)
  );
  const interestedContacts = new Set(
    inboundRows.filter((m) => m.ai_interest === "interested").map((m) => m.contact_id!).filter(Boolean)
  );
  const meetings = new Set(meetingRows.map((c) => c.id));
  // Positiv = interessiert ODER Termin, dieselbe Regel wie in copy-outcomes.
  const positiveContacts = new Set([...interestedContacts, ...meetings]);

  const total = overview(rows, replies);
  const searches = bySearch(rows, replies);
  const weekdays = byWeekday(rows, replies, lang);
  const hours = byHourBlock(rows, replies);

  const timeline = dailyTimeline(
    outboundRows.map((m) => ({ sentAt: m.sent_at, interest: null })),
    inboundRows.map((m) => ({ sentAt: m.sent_at, interest: m.ai_interest })),
    30
  );

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
  const copy = byCopy(copyRows, replyRows, meetings);
  const copySummary = summarize(copyRows, copy);

  /**
   * Aktiv und ausgeblendet trennen. Der Schluessel jedes Buckets beginnt mit
   * der Kampagnen-ID (siehe copy-outcomes.bucketKey); die Archiv-Markierung
   * haengt an der Kampagne, nicht am Bucket.
   */
  const archivedIds = new Set(
    ((campaignRows ?? []) as { id: string; stats_archived_at: string | null }[])
      .filter((c) => c.stats_archived_at)
      .map((c) => c.id)
  );
  const activeCopy = copy.filter((b) => !archivedIds.has(b.key.split("|")[0]));
  const archivedCopy = copy.filter((b) => archivedIds.has(b.key.split("|")[0]));

  // Empfehlungen nur aus dem, was zaehlt: ausgeblendete Kampagnen sollen
  // keinen Fassungs-Vergleich mehr gewinnen.
  const recommendations = recommend(nicheOutcomes(rows, replies, positiveContacts), activeCopy);

  // Die Erfolge, mit Herkunft: jede Zeile ein Bucket mit positivem Signal.
  const wins = copy
    .filter((b) => b.interested > 0 || b.meetings > 0)
    .sort((a, b) => b.meetings - a.meetings || b.interested - a.interested)
    .slice(0, 6);

  return (
    <div className="fade-up max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{W.title}</h1>
        <p className="mt-1 text-sm text-faint">{W.subtitle}</p>
      </div>

      <Funnel
        total={total}
        interested={interestedContacts.size}
        meetings={meetings.size}
        labels={W}
      />

      {wins.length > 0 && <Wins wins={wins} labels={W} />}

      <div className="rounded-xl border border-edge/70 bg-panel p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold text-ink">{W.timelineTitle}</h2>
        <p className="mt-1 text-sm text-faint">{W.timelineHint}</p>
        <div className="mt-4">
          <TimelineChart
            points={timeline}
            lang={lang}
            labels={{
              sent: W.timelineSent,
              replies: W.timelineReplies,
              interested: W.timelineInterested,
              inWindow: W.timelineInWindow,
              noneYet: W.timelineNone,
              asTable: W.timelineTable,
              day: W.timelineDay,
            }}
          />
        </div>
      </div>

      <Recommendations recs={recommendations} labels={W} />

      <CopySection
        active={activeCopy}
        archived={archivedCopy}
        unattributed={copySummary.unattributed}
        orphaned={copySummary.orphaned}
        labels={W}
      />

      <Section title={W.bySearch} hint={W.bySearchHint} buckets={searches} empty={W.noData} labels={W} />
      <Section title={W.byWeekday} hint={W.byWeekdayHint} buckets={weekdays} empty={W.noData} labels={W} />
      <Section title={W.byHour} hint={W.byHourHint} buckets={hours} empty={W.noData} labels={W} />

      <p className="text-xs text-faint">{W.methodNote(MIN_SAMPLE)}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Gestaltung
   ══════════════════════════════════════════════════════════════════════

   Die Zahlen dieser Seite sind klein und die Quoten winzig — ein bis zwei
   Antworten auf zweihundert Kontakte. Das ist die eigentliche gestalterische
   Aufgabe hier: ein Balken, der 1 % massstabsgetreu zeichnet, ist ein
   unsichtbarer Strich, und eine Tabelle voller Striche liest niemand.

   Deshalb zwei Kunstgriffe, beide bewusst:

     1. Balken sind fuenffach ueberhoeht (RATE_SCALE). Sie taugen damit zum
        VERGLEICHEN zweier Zeilen, nicht zum Ablesen — die Zahl steht
        daneben. Dieselbe Ueberhoehung wie in der Lead-Listen-Ansicht, damit
        die Balken der Seite untereinander vergleichbar bleiben.

     2. Die Zusammensetzung steht als farbige Chips daneben, nicht als
        Balkenabschnitte. Bei zwei Absagen auf 149 Kontakte waere ein
        Abschnitt 1,3 % breit und nicht erkennbar; als Chip mit einer Zwei
        ist er sofort lesbar.

   Farben tragen Bedeutung, nicht Dekoration: gruen = etwas Gutes ist
   passiert, rot = ausdrueckliches Nein, grau = Maschine. Sie stehen nie
   allein — daneben steht immer die Zahl und das Wort.
   ══════════════════════════════════════════════════════════════════════ */

/** Ueberhoehung der Balken. Siehe Kommentar oben. */
const RATE_SCALE = 5;

function barWidth(rate: number): string {
  return `${Math.max(2, Math.min(100, rate * 100 * RATE_SCALE))}%`;
}

/**
 * Der Trichter: angeschrieben, geantwortet, interessiert, Termin.
 *
 * Vier Zahlen, die zusammengehoeren und einzeln nichts sagen. Mit Pfeilen
 * dazwischen sieht man, dass es dieselben Menschen sind, die schmaler
 * werden. "Interessiert" steht seit dem 2026-09-12 als eigene Stufe dabei:
 * das ist die Zahl, fuer die es die Seite gibt, und sie stand vorher nur
 * kleingedruckt in den Karten.
 */
function Funnel({
  total,
  interested,
  meetings,
  labels: L,
}: {
  total: { contacted: number; replied: number; rate: number | null; missing: number };
  interested: number;
  meetings: number;
  labels: {
    contacted: string;
    replied: string;
    interested: string;
    meetings: string;
    rate: string;
    tooEarly: (n: number) => string;
  };
}) {
  const steps = [
    { label: L.contacted, value: total.contacted, tone: "text-ink" },
    { label: L.replied, value: total.replied, tone: "text-sky-600 dark:text-sky-400" },
    { label: L.interested, value: interested, tone: "text-emerald-600 dark:text-emerald-400" },
    { label: L.meetings, value: meetings, tone: "text-emerald-600 dark:text-emerald-400" },
  ];
  return (
    <div className="rounded-xl border border-edge/70 bg-gradient-to-br from-panel to-panel2/40 p-5 shadow-sm sm:p-6">
      {/* Unter sm ein Raster mit zwei Spalten statt einer Reihe mit Pfeilen:
          vier 34-Pixel-Zahlen nebeneinander bekommen auf 390 Pixel je rund 70
          Pixel, und die Beschriftung darunter ("Angeschrieben") bleibt als
          "Angesch…" stehen. Die Pfeile verschwinden dabei, weil sie eine
          waagerechte Kette erzaehlen, die es dort nicht gibt. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:flex sm:items-stretch sm:gap-2">
        {steps.map((s, i) => (
          <Fragment key={s.label}>
            {i > 0 && (
              <div className="hidden items-center text-mute sm:flex" aria-hidden>
                <svg viewBox="0 0 12 24" className="h-5 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 5l5 7-5 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
            <div className="min-w-0 sm:flex-1">
              <p className="truncate text-2xs font-medium uppercase tracking-wider text-mute">{s.label}</p>
              <p className={"mt-1 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl " + s.tone}>
                {s.value}
              </p>
            </div>
          </Fragment>
        ))}
        {/* Auf dem Handy die fuenfte Kachel statt gar nichts: die Quote ist
            die eine Zahl, nach der hier gesucht wird. */}
        <div className="min-w-0 sm:flex-1 sm:border-l sm:border-edge/70 sm:pl-4">
          <p className="truncate text-2xs font-medium uppercase tracking-wider text-mute">{L.rate}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-soft sm:text-3xl">
            {total.rate === null ? "—" : `${(total.rate * 100).toFixed(1)} %`}
          </p>
        </div>
      </div>
      {total.rate === null && (
        <p className="mt-4 text-sm text-amber-600 dark:text-amber-500">{L.tooEarly(total.missing)}</p>
      )}
    </div>
  );
}

/**
 * Das Erfolgs-Brett: die positiven Signale mit ihrer Herkunft.
 *
 * Vorher musste man die gruenen Zahlen aus den Karten zusammensuchen. Wenn
 * es etwas zu feiern gibt, steht es jetzt direkt unter dem Trichter, und
 * daneben steht, welcher Text es ausgeloest hat: genau die Information, auf
 * die man ein "mehr davon" bauen kann.
 */
function Wins({
  wins,
  labels: L,
}: {
  wins: CopyBucket[];
  labels: {
    successTitle: string;
    successHint: string;
    successInterested: (n: number) => string;
    successMeetings: (n: number) => string;
    step: string;
    externalCampaign: string;
  };
}) {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-5 sm:p-6">
      <h2 className="text-base font-semibold text-emerald-700 dark:text-emerald-400">{L.successTitle}</h2>
      <p className="mt-1 text-sm text-faint">{L.successHint}</p>
      <ul className="mt-4 space-y-2">
        {wins.map((b) => (
          <li key={b.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              {b.meetings > 0 ? L.successMeetings(b.meetings) : L.successInterested(b.interested)}
            </span>
            <span className="text-soft">
              {b.campaignName || L.externalCampaign} · {L.step} {b.step + 1}
              <span className="ml-1.5 rounded-full bg-chip px-2 py-0.5 text-xs font-medium text-soft">
                {variantLabel(b.variant)}
              </span>
            </span>
            {b.meetings > 0 && b.interested > 0 && (
              <span className="text-xs text-faint">+ {L.successInterested(b.interested)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Die Empfehlungen: was die App aus den Zahlen schliesst.
 *
 * Regeln, kein Modell (lib/report/recommendations.ts). Jede Zeile traegt
 * ihren Beleg als zweiten Satz; eine Empfehlung ohne Beleg waere auf dieser
 * Seite ein Fremdkoerper.
 */
function Recommendations({
  recs,
  labels: L,
}: {
  recs: Recommendation[];
  labels: {
    recTitle: string;
    recHint: string;
    recDoubleDown: (niche: string) => string;
    recDoubleDownWhy: (positives: number, contacts: number) => string;
    recCopyWinner: (winner: string, step: number, campaign: string) => string;
    recCopyWinnerWhy: (interested: number, loser: string, loserContacts: number) => string;
    recStop: (niche: string) => string;
    recStopWhy: (contacts: number, replies: number) => string;
    recCollect: (niche: string | null) => string;
    recCollectWhy: (missing: number) => string;
    recNoSignal: (threshold: number) => string;
    recNoSignalWhy: (niche: string, contacts: number, threshold: number) => string;
  };
}) {
  const rendered = recs.map((r) => {
    switch (r.kind) {
      case "double_down":
        return {
          key: "double_down" + r.niche,
          tone: "emerald" as const,
          title: L.recDoubleDown(r.niche),
          why: L.recDoubleDownWhy(r.positives, r.contacts),
        };
      case "copy_winner":
        return {
          key: "copy" + r.campaign + r.step,
          tone: "sky" as const,
          title: L.recCopyWinner(r.winner, r.step + 1, r.campaign),
          why: L.recCopyWinnerWhy(r.interested, r.loser, r.loserContacts),
        };
      case "stop_niche":
        return {
          key: "stop" + r.niche,
          tone: "red" as const,
          title: L.recStop(r.niche),
          why: L.recStopWhy(r.contacts, r.replies),
        };
      case "collect_more":
        return {
          key: "collect",
          tone: "mute" as const,
          title: L.recCollect(r.niche),
          why: L.recCollectWhy(r.missing),
        };
      case "no_signal":
        return {
          key: "nosignal",
          tone: "mute" as const,
          title: L.recNoSignal(r.threshold),
          why: L.recNoSignalWhy(r.niche, r.contacts, r.threshold),
        };
    }
  });

  const dot: Record<string, string> = {
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
    red: "bg-red-500",
    mute: "bg-mute/60",
  };

  return (
    <div className="rounded-xl border border-edge/70 bg-panel p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-ink">{L.recTitle}</h2>
      <p className="mt-1 text-sm text-faint">{L.recHint}</p>
      <ul className="mt-4 space-y-3.5">
        {rendered.map((r) => (
          <li key={r.key} className="flex gap-3">
            <span className={"mt-2 h-2 w-2 shrink-0 rounded-full " + dot[r.tone]} aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink">{r.title}</p>
              <p className="mt-0.5 text-xs text-faint">{r.why}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Eine farbige Zahl mit Wort. Null wird zu einem Strich in Grau: eine
 *  grosse bunte 0 zieht Aufmerksamkeit auf ein Nichtereignis. */
function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  if (n === 0) {
    return (
      <span className="whitespace-nowrap text-xs text-mute">
        — {label}
      </span>
    );
  }
  return (
    <span className={"whitespace-nowrap text-xs font-medium " + tone}>
      {n} {label}
    </span>
  );
}

type CopyLabels = {
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
  hideCampaign: string;
  restoreCampaign: string;
  archivedSection: (n: number) => string;
  archivedHint: string;
};

/** Buckets je Kampagne gruppieren; die ID steckt vorn im Bucket-Schluessel. */
function groupByCampaign(buckets: CopyBucket[]): { id: string; name: string; list: CopyBucket[] }[] {
  const groups = new Map<string, { id: string; name: string; list: CopyBucket[] }>();
  for (const b of buckets) {
    const id = b.key.split("|")[0];
    let g = groups.get(id);
    if (!g) {
      g = { id, name: b.campaignName, list: [] };
      groups.set(id, g);
    }
    if (!g.name && b.campaignName) g.name = b.campaignName;
    g.list.push(b);
  }
  return [...groups.values()];
}

/**
 * Was welcher Text gebracht hat: je Kampagne eine Karte.
 *
 * Vorher stand hier EINE Tabelle ueber alle Kampagnen, mit
 * Zwischenueberschriften als Zeilen. Das las sich wie eine Kontoauszugsliste:
 * sieben Spalten, alles gleich gewichtet, kein Anhaltspunkt, wo man
 * hinschauen soll. Jetzt ist jede Kampagne eine Karte, jeder Schritt eine
 * Zeile mit Balken, und die beste Zeile je Kampagne ist hervorgehoben.
 *
 * Seit dem 2026-09-12 laesst sich jede Karte ausblenden (Migration 0116):
 * abgeschlossene Tests verdeckten sonst die laufenden Kampagnen. Die
 * ausgeblendeten stehen eingeklappt darunter, nichts wird geloescht.
 */
function CopySection({
  active,
  archived,
  unattributed,
  orphaned,
  labels: L,
}: {
  active: CopyBucket[];
  archived: CopyBucket[];
  unattributed: number;
  orphaned: number;
  labels: CopyLabels;
}) {
  const activeGroups = groupByCampaign(active);
  const archivedGroups = groupByCampaign(archived);

  return (
    <div className="rounded-xl border border-edge/70 bg-panel p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-ink">{L.byCopy}</h2>
      <p className="mt-1 text-sm text-faint">{L.byCopyHint}</p>

      {active.length === 0 && archived.length === 0 ? (
        <p className="py-10 text-center text-sm text-faint">{L.noAttribution}</p>
      ) : (
        <>
          <p className="mt-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-500">
            <span aria-hidden>⚠</span>
            <span>{L.copyWarning}</span>
          </p>

          <div className="mt-4 space-y-4">
            {activeGroups.map((g) => (
              <CampaignCard key={g.id} group={g} archived={false} labels={L} />
            ))}
          </div>

          {archivedGroups.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer py-1 text-sm font-medium text-faint transition-colors hover:text-ink">
                {L.archivedSection(archivedGroups.length)}
              </summary>
              <p className="mt-1 text-xs text-faint">{L.archivedHint}</p>
              <div className="mt-3 space-y-4 opacity-70">
                {archivedGroups.map((g) => (
                  <CampaignCard key={g.id} group={g} archived labels={L} />
                ))}
              </div>
            </details>
          )}

          {/* Was NICHT in der Auswertung steht, steht wenigstens darunter. */}
          {(orphaned > 0 || unattributed > 0) && (
            <p className="mt-4 space-x-2 text-xs text-faint">
              {orphaned > 0 && <span>{L.orphaned(orphaned)}</span>}
              {unattributed > 0 && <span className="text-amber-600 dark:text-amber-500">{L.unattributed(unattributed)}</span>}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CampaignCard({
  group,
  archived,
  labels: L,
}: {
  group: { id: string; name: string; list: CopyBucket[] };
  archived: boolean;
  labels: CopyLabels;
}) {
  const best = bestBucket(group.list);
  const totalContacts = group.list.reduce((n, b) => Math.max(n, b.contacts), 0);
  return (
    <div className="overflow-hidden rounded-xl border border-edge/70">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge/70 bg-panel2 px-3.5 py-2.5">
        <h3 className="text-sm font-semibold text-ink">{group.name || L.externalCampaign}</h3>
        <span className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-faint">
            {totalContacts} {L.contacts}
          </span>
          {/* Ausblenden ist eine Anzeige-Entscheidung, kein Loeschen; deshalb
              ein leiser Textknopf statt eines roten. */}
          <form action={setStatsArchived}>
            <input type="hidden" name="campaignId" value={group.id} />
            <input type="hidden" name="archive" value={archived ? "0" : "1"} />
            <button
              type="submit"
              className="py-1 text-xs text-faint transition-colors hover:text-ink"
            >
              {archived ? L.restoreCampaign : L.hideCampaign}
            </button>
          </form>
        </span>
      </div>

      <div className="divide-y divide-edge/70">
        {group.list.map((b) => {
          const hasVariants = group.list.some((o) => o.step === b.step && o.variant !== b.variant);
          // bestBucket liefert nur noch etwas, wenn es einen echten Erfolg gab
          // (Termin oder interessierte Antwort); die zusaetzliche
          // Pruefung hier waere doppelt und stand vorher genau dem
          // im Weg: sie liess auch reine Absagen gewinnen.
          const isBest = best?.key === b.key;
          return (
            <div
              key={b.key}
              className={
                "px-3.5 py-3 transition-colors duration-150 " +
                (isBest ? "bg-emerald-500/[0.06]" : "hover:bg-wash")
              }
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {/* Unter sm steht die Stufe allein in der ersten Zeile:
                    Beschriftung, zwei Zahlen, Balken und Pille zusammen
                    brauchen rund 400 Pixel, und der Balken war der erste, der
                    dabei auf null zusammenfiel. */}
                <span className="flex w-full shrink-0 items-center gap-1.5 text-sm font-medium text-ink sm:w-28">
                  {L.step} {b.step + 1}
                  {hasVariants && (
                    <span className="rounded-full bg-chip px-2 py-0.5 text-xs font-medium text-soft">
                      {variantLabel(b.variant)}
                    </span>
                  )}
                </span>

                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-faint sm:w-16">
                  {b.contacts}
                </span>

                {/* Der Balken: fuenffach ueberhoeht, taugt zum
                    Vergleichen zweier Zeilen — die Zahl steht
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
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      {b.meetings} ★
                    </span>
                  ) : (
                    <span className="text-xs text-mute">—</span>
                  )}
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:pl-28">
                <Count n={b.interested} label={L.interested} tone="text-emerald-600 dark:text-emerald-400" />
                <Count n={b.notInterested} label={L.notInterested} tone="text-red-600 dark:text-red-400" />
                <Count n={b.autoReplies} label={L.autoReplies} tone="text-mute" />
                {isBest && (
                  <span className="ml-auto text-2xs font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-500">
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
}

/**
 * Die drei Aufschluesselungen nach Liste, Wochentag und Tageszeit.
 *
 * Balken wie bisher, aber eingefaerbt und mit hervorgehobenem Spitzenreiter:
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
    <div className="rounded-xl border border-edge/70 bg-panel p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-sm text-faint">{hint}</p>

      {buckets.length === 0 ? (
        <p className="py-10 text-center text-sm text-faint">{empty}</p>
      ) : (
        <div className="mt-4 space-y-1">
          {buckets.map((b) => {
            const leads = b.rate !== null && b.rate === best && best > 0;
            return (
              <div key={b.key} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-wash">
                <span
                  className={
                    "w-28 shrink-0 truncate text-sm sm:w-40 " + (leads ? "font-medium text-ink" : "text-soft")
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
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-soft sm:w-28">
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
