import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer, formatDate } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { searchSourceBadgeClass, searchSourceLabel } from "@/lib/search-source";
import NewSearchForm from "./new-search-form";
import AutoRefresh from "./auto-refresh";
import LocalTime from "./local-time";
import ActivityChart from "./activity-chart";
import CountUp from "./count-up";
import DateRangePicker from "./date-range-picker";
import ForecastCards, { type PipelineStats } from "./crm/forecast-cards";
import WelcomeModal from "./welcome-modal";
import WorkerStatus, { ProviderAlerts, type ProviderAlert, type WorkerHealth } from "./worker-status";
import { IconLock, IconSend, IconSearch, IconMail } from "./icons";

type Stats = {
  searches_total: number;
  businesses_total: number;
  contacts_total: number;
  contacts_with_email: number;
  personalized: number;
  emails_sent: number;
  replies: number;
  jobs_active: number;
  jobs_failed: number;
  jobs_geocode: number;
  jobs_decisionmaker: number;
  jobs_personalize: number;
  jobs_hunter: number;
  meetings_booked: number;
  customers: number;
  /** Gemessener Verbrauch im gewaehlten Zeitraum (api_usage, Migration 0054). */
  api_cost_usd?: number;
  /** Seit wann ueberhaupt gemessen wird. Aelter als dieses Datum gibt es keine
   *  Kosten -- nicht weil keine anfielen, sondern weil niemand mitschrieb. */
  api_cost_since?: string | null;
  /** Monatliche Tarifkosten, vom Nutzer eingetragen (Migration 0077). */
  subscription_monthly_usd?: number;
  /** Dieselben Tarife, anteilig auf das gewaehlte Fenster. */
  subscription_window_usd?: number;
  /** Laenge des Fensters in Tagen. */
  window_days?: number;
  instantly: {
    emails_sent: number;
    replies_unique: number;
    bounced: number;
    opportunities: number;
    opportunity_value: number;
    campaigns_linked: number;
  };
  activity: { day: string; leads: number }[];
};

function estimateCosts(s: Stats) {
  const google = (s.jobs_geocode ?? 0) * 0.005 + Math.ceil((s.businesses_total ?? 0) / 20) * 0.032;
  const openai = (s.jobs_decisionmaker ?? 0) * 0.03 + (s.jobs_personalize ?? 0) * 0.003;
  return { usd: google + openai, hunterCredits: s.jobs_hunter ?? 0 };
}

/**
 * Was die Maschine an Handarbeit erspart hat.
 *
 * DIE ANNAHMEN STEHEN HIER UND WERDEN AUCH ANGEZEIGT.
 *
 * Eine Zahl wie "511 Stunden gespart" ist nur so viel wert wie das, was
 * darunter steht. Wer sie nicht nachrechnen kann, glaubt sie beim ersten Mal
 * und keinem der folgenden Werte danach mehr. Deshalb nennt das Banner die
 * drei Groessen im Klartext.
 *
 * GEZAEHLT WERDEN NUR KONTAKTE MIT E-MAIL.
 *
 * Vorher zaehlte die Rechnung contacts_total -- am 2026-08-05 also 3115
 * Kontakte, von denen 1705 gar keine Adresse haben. Recherche fuer einen
 * Ansprechpartner, den man nicht anschreiben kann, ist keine gesparte Arbeit,
 * sondern ein unfertiges Ergebnis. Die Zahl war damit um rund das Doppelte
 * zu hoch.
 *
 * Aufhaenger zaehlen dagegen ALLE, auch die mit Regelverstoss: die Recherche
 * dahinter ist auch dann geleistet, wenn die Zeile noch redigiert werden
 * muss.
 */
const MIN_PER_CONTACT = 8;
const MIN_PER_ICEBREAKER = 4;
const HOURLY_EUR = 45;

function estimateRoi(s: Stats) {
  const minutes = (s.contacts_with_email ?? 0) * MIN_PER_CONTACT + (s.personalized ?? 0) * MIN_PER_ICEBREAKER;
  const hours = minutes / 60;
  return {
    hours: Math.round(hours * 10) / 10,
    value: Math.round(hours * HOURLY_EUR),
    contacts: s.contacts_with_email ?? 0,
    icebreakers: s.personalized ?? 0,
  };
}

/**
 * 0 heisst "Gesamtbestand".
 *
 * Bis 2026-08-05 filterten diese Knoepfe die Kacheln ueberhaupt nicht -- sie
 * steuerten nur den Chart, und alles darueber blieb Gesamtbestand (siehe
 * Migration 0077). Jetzt filtern sie, und weil der Gesamtbestand damit sonst
 * unerreichbar waere, steht er als eigene Auswahl daneben statt als stille
 * Voreinstellung.
 */
const RANGE_OPTIONS = [7, 14, 30, 90, 0] as const;
const DEFAULT_RANGE_DAYS = 14;

function parseRangeDays(raw: string | undefined): number {
  if (raw === "all") return 0;
  const n = Number(raw);
  return RANGE_OPTIONS.includes(n as (typeof RANGE_OPTIONS)[number]) ? n : DEFAULT_RANGE_DAYS;
}

/** Kalendereingabe aus der URL. Ungueltiges wird verworfen statt korrigiert --
 *  ein stillschweigend verschobenes Datum waere schlimmer als keines. */
function parseDate(raw: string | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return Number.isNaN(new Date(raw).getTime()) ? null : raw;
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const lang = await getLangServer();
  const t = dict[lang];
  const params = await searchParams;
  const rangeDays = parseRangeDays(params.range);
  const fromDate = parseDate(params.from);
  const toDate = parseDate(params.to);
  // Nur wenn BEIDE Enden gesetzt sind, gilt die Kalenderauswahl -- ein halb
  // ausgefuelltes Feld soll die Anzeige nicht schon umstellen.
  const useDateRange = Boolean(fromDate && toDate);
  // p_to ist exklusiv, deshalb einen Tag weiter: sonst fehlte der gewaehlte
  // Endtag komplett.
  const toExclusive = toDate
    ? new Date(new Date(toDate).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;
  const workspaceId = ws.workspace.id;

  const [statsRes, searchesRes, recentRes, apiKeysRes, campaignsCountRes, pipelineRes, workerRes, alertsRes] = await Promise.all([
    supabase.rpc("dashboard_stats", {
      p_workspace_id: workspaceId,
      p_days: rangeDays,
      p_from: useDateRange ? new Date(fromDate as string).toISOString() : null,
      p_to: useDateRange ? toExclusive : null,
    }),
    supabase
      .from("searches")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      // Nur Listen, die es auch auf der Suchen-Seite gibt: die Teilsuchen einer
      // gebuendelten Mehrfach-Suche wuerden die sechs Plaetze hier komplett
      // belegen und dabei sechsmal dasselbe zeigen (Migration 0096).
      .is("parent_search_id", null)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("contacts")
      .select("id, full_name, title, email, businesses(name)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("api_keys").select("provider").eq("workspace_id", workspaceId),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.rpc("crm_pipeline_stats", { p_workspace_id: workspaceId }),
    // Betriebszustand des Workers (Migration 0058). Nicht workspace-bezogen --
    // der Worker bedient alle. Kostet eine winzige Abfrage und beantwortet die
    // Frage, die sonst niemand stellen kann: laeuft die Maschine ueberhaupt?
    supabase.rpc("worker_health"),
    // Offene Guthaben-Alarme (Migration 0059). Die konkretere Ursache als ein
    // toter Worker: er kann tadellos laufen und trotzdem nichts zustandebringen.
    supabase
      .from("provider_alerts")
      .select("provider, message, first_seen_at")
      .eq("workspace_id", workspaceId)
      .is("resolved_at", null)
      .order("first_seen_at", { ascending: true }),
  ]);
  const stats = (statsRes.data ?? {}) as Stats;
  const workerHealth = (workerRes.data ?? null) as WorkerHealth | null;
  const providerAlerts = (alertsRes.data ?? []) as ProviderAlert[];
  const pipelineStats = (pipelineRes.data ?? null) as PipelineStats | null;
  const searches = searchesRes.data ?? [];
  const recent = recentRes.data ?? [];

  // Punkt 4 aus dem PMF-Bericht: gefuehrte Onboarding-Checkliste. Bewusst nur
  // lokale, ohnehin schon guenstige Queries (keine Live-Instantly-API-Calls
  // bei jedem Dashboard-Aufruf) -- Mailbox-Anzahl wird daher indirekt ueber
  // "mindestens eine Kampagne mit Mailboxen angelegt" approximiert statt live
  // bei Instantly nachzufragen.
  const apiKeyProviders = (apiKeysRes.data ?? []).map((k) => k.provider as string);
  // Titel, Text, Ziel und Erledigt-Kriterium stehen bewusst zusammen in EINER
  // Liste: vorher lagen die Texte im JSX und wurden per Array-Index
  // (onboardingSteps[2]) mit dem Kriterium verheiratet -- beim Einfuegen eines
  // Schritts verschieben sich dann stillschweigend alle Zuordnungen.
  const onboardingSteps = [
    {
      icon: IconLock,
      title: t.onboarding.step1Title,
      body: t.onboarding.step1Body,
      cta: t.onboarding.step1Cta,
      href: "/settings",
      done: apiKeyProviders.length > 0,
    },
    {
      icon: IconSend,
      title: t.onboarding.step2Title,
      body: t.onboarding.step2Body,
      cta: t.onboarding.step2Cta,
      href: "/instantly/connection",
      done: apiKeyProviders.includes("instantly"),
    },
    {
      icon: IconSearch,
      title: t.onboarding.step3Title,
      body: t.onboarding.step3Body,
      cta: t.onboarding.step3Cta,
      href: "/searches",
      done: (stats.searches_total ?? 0) > 0,
    },
    {
      icon: IconMail,
      title: t.onboarding.step4Title,
      body: t.onboarding.step4Body,
      cta: t.onboarding.step4Cta,
      href: "/instantly/campaigns/new",
      done: (campaignsCountRes.count ?? 0) > 0,
    },
  ];
  const onboardingDone = onboardingSteps.every((s) => s.done);
  // Gemessene Kosten aus api_usage (Migration 0054) statt der Hochrechnung
  // aus Job-Zaehlern. estimateCosts bleibt als Rueckfall fuer Workspaces, in
  // denen noch nichts erfasst wurde -- sonst stuende dort ploetzlich $0.00,
  // obwohl vorher Geld geflossen ist.
  const gemessen = Number(stats.api_cost_usd ?? 0);
  /**
   * Die Hochrechnung greift nur noch beim Gesamtbestand.
   *
   * estimateCosts rechnet aus den Job-Zaehlern, und die sind in
   * dashboard_stats bewusst NICHT zeitraumgefiltert -- es sind Betriebszahlen.
   * Sie in ein 7-Tage-Fenster zu setzen wuerde genau den Fehler wiederholen,
   * um den es hier geht: eine Zahl aus sechs Wochen in einem Fenster von einer
   * Woche. Im Fenster gilt deshalb der gemessene Wert, auch wenn er 0 ist --
   * eine 0 fuer "in diesen sieben Tagen lief nichts" ist richtig, keine Luecke.
   */
  const alleZeit = !useDateRange && rangeDays === 0;
  const verbrauch =
    gemessen > 0
      ? { usd: gemessen, hunterCredits: stats.jobs_hunter ?? 0 }
      : alleZeit
        ? estimateCosts(stats)
        : { usd: 0, hunterCredits: stats.jobs_hunter ?? 0 };

  /**
   * Verbrauch PLUS Tarife.
   *
   * Bis 2026-08-05 zeigte das Dashboard 0,33 $ und nannte das "API-Kosten".
   * Das war der gemessene Verbrauch -- und er ist der kleinere Teil der
   * Wahrheit. Instantly taucht in api_usage gar nicht auf (ein Abo hat keinen
   * zaehlbaren Aufruf), und bei Apollo und Hunter steht dort bewusst kein
   * Betrag, weil der Wert eines Credits am gebuchten Paket haengt.
   *
   * Wer 0,33 $ neben einen Nutzen von 22998 EUR stellt, behauptet einen
   * Faktor von siebzigtausend. Mit den Tarifen daneben steht dort eine Zahl,
   * die der Kunde auf seiner Kreditkartenabrechnung wiederfindet.
   */
  const abosImFenster = Number(stats.subscription_window_usd ?? 0);
  const abosMonatlich = Number(stats.subscription_monthly_usd ?? 0);
  const costs = { usd: verbrauch.usd + abosImFenster, hunterCredits: verbrauch.hunterCredits };
  const roi = estimateRoi(stats);

  /**
   * Deckt die Messung das Fenster ueberhaupt ab?
   *
   * api_usage schreibt erst seit dem 2026-08-02, die Firmen gibt es seit dem
   * 2026-07-13. Ein 90-Tage-Fenster stellt also einen Nutzen aus sechs Wochen
   * neben Kosten aus wenigen Tagen. Das gehoert dazugesagt, statt die Luecke
   * als Ergebnis auszugeben -- sie schliesst sich mit der Zeit von selbst.
   */
  const messungSeit = stats.api_cost_since ? new Date(stats.api_cost_since) : null;
  const fensterTage = Number(stats.window_days ?? 0);
  const messungJuenger =
    messungSeit !== null &&
    fensterTage > 0 &&
    messungSeit.getTime() > Date.now() - fensterTage * 24 * 60 * 60 * 1000 + 60 * 60 * 1000;
  const hasActive = (stats.jobs_active ?? 0) > 0;

  const kpis: { label: string; value: number | string; sub?: string; hero?: boolean; href?: string }[] = [
    { label: t.dashboard.kpis.searches, value: stats.searches_total ?? 0 },
    { label: t.dashboard.kpis.businesses, value: stats.businesses_total ?? 0 },
    { label: t.dashboard.kpis.contacts, value: stats.contacts_total ?? 0 },
    { label: t.dashboard.kpis.withEmail, value: stats.contacts_with_email ?? 0 },
    { label: t.dashboard.kpis.personalized, value: stats.personalized ?? 0, hero: true },
    {
      label: t.dashboard.kpis.apiCosts,
      value: "$" + costs.usd.toFixed(2),
      /**
       * "gemessen" darf nur dastehen, wenn die Zahl auch gemessen ist.
       *
       * Am 2026-08-09 stand hier "$32,77 gemessen", wovon 32,67 $ ein
       * eingetipptes Monatsabo waren und 11 Cent die Messung. Sobald Tarife
       * mitzaehlen, wird der gemessene Teil deshalb beziffert -- eine Kachel,
       * die ihre eigene Herkunft falsch angibt, ist schlimmer als gar keine.
       */
      sub:
        abosImFenster > 0
          ? t.dashboard.costsMeasuredPlusPlans("$" + verbrauch.usd.toFixed(2))
          : gemessen > 0
            ? t.dashboard.costsMeasured
            : t.dashboard.costsEstimated,
      href: "/costs",
    },
  ];
  const onboardingDoneCount = onboardingSteps.filter((s) => s.done).length;

  return (
    <div className="fade-up space-y-5">
      {hasActive && <AutoRefresh />}
      {/* Ganz oben und vor allem anderen: wenn die Maschine steht, ist jede
          andere Zahl auf dieser Seite veraltet. Zeigt sich im Normalfall gar
          nicht, siehe worker-status.tsx. */}
      <ProviderAlerts alerts={providerAlerts} t={t} lang={lang} />
      <WorkerStatus health={workerHealth} t={t} lang={lang} />
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.dashboard.title}</h1>
          <p className="text-sm text-faint">{t.dashboard.subtitle}</p>
        </div>
        {hasActive && (
          <div className="flex flex-col items-end gap-1.5">
            <span className="flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
              {stats.jobs_active} {t.dashboard.agentsWorking}
            </span>
            <div className="h-1 w-36 overflow-hidden rounded-full bg-chip">
              <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-sky-500 to-sky-500" />
            </div>
          </div>
        )}
      </div>

      {!onboardingDone && (
        <WelcomeModal
          openSteps={[
            t.onboarding.step1Title,
            t.onboarding.step2Title,
            t.onboarding.step3Title,
            t.onboarding.step4Title,
          ].filter((_, i) => !onboardingSteps[i].done)}
        />
      )}

      {!onboardingDone && (
        <div className="rounded-lg border border-edge/60 bg-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-medium text-ink">{t.onboarding.heading}</h2>
              <p className="mt-1 text-sm text-faint">
                {t.onboarding.subtitle}{" "}
                <Link href="/guide" className="font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400">
                  {t.onboarding.guideLink}
                </Link>
              </p>
            </div>
            <div className="relative h-11 w-11 shrink-0">
              <svg viewBox="0 0 36 36" className="h-11 w-11 -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--c-chip)" strokeWidth="3.5" />
                <circle
                  cx="18" cy="18" r="15.5" fill="none" stroke="#0ea5e9" strokeWidth="3.5" strokeLinecap="round"
                  strokeDasharray={`${(onboardingDoneCount / onboardingSteps.length) * 97.4} 97.4`}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-ink">
                {onboardingDoneCount}/{onboardingSteps.length}
              </span>
            </div>
          </div>
          {/* Warmup ist kein Haken, den man setzen kann: es dauert Wochen und
              laesst sich lokal nicht messen (nur ueber einen Live-Call zu
              Instantly, den das Dashboard bewusst nicht macht). Als Checklisten-
              Punkt waere er also entweder dauerhaft offen oder eine Luege --
              deshalb ein Hinweis, der genau an der Stelle steht, an der jemand
              sonst am ersten Tag die erste Kampagne startet und seine Domain
              verbrennt. */}
          <Link
            href="/guide#warmup"
            className="mb-3 flex items-start gap-2.5 rounded-lg border-l-2 border-amber-500/60 bg-amber-500/5 px-3.5 py-2.5 transition-colors hover:bg-amber-500/10"
          >
            <span aria-hidden className="text-sm leading-tight">🔥</span>
            <span className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              <span className="font-medium">{t.onboarding.warmupTitle}</span>{" "}
              {t.onboarding.warmupBody}
            </span>
          </Link>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {onboardingSteps.map(({ icon: Icon, title, body, cta, href, done }) => (
              <div
                key={title}
                className={
                  "rounded-lg border p-4 " +
                  (done ? "border-emerald-500/25 bg-emerald-500/5" : "border-edge/60 bg-surface/60")
                }
              >
                <div className="mb-2 flex items-center justify-between">
                  <Icon className={"h-4 w-4 " + (done ? "text-emerald-500" : "text-faint")} />
                  {done && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
                      ✓ {t.onboarding.doneLabel}
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-medium text-ink">{title}</h3>
                <p className="mt-1 text-xs text-faint">{body}</p>
                {!done && (
                  <Link href={href} className="mt-2.5 inline-block text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400">
                    {cta} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI-Leiste */}
      <div className="grid grid-cols-3 divide-edge overflow-hidden rounded-lg border border-edge/60 bg-panel shadow-sm md:grid-cols-6 md:divide-x">
        {kpis.map((k) => {
          const inhalt = (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wide text-mute">{k.label}</p>
              <p className={"mt-0.5 text-2xl font-semibold tracking-tight " + (k.hero ? "text-sky-600 dark:text-sky-400" : "text-ink")}>
                {typeof k.value === "number" ? <CountUp value={k.value} /> : k.value}
              </p>
              {k.sub && <p className="text-[11px] text-mute">{k.sub}</p>}
            </>
          );
          // Die Kostenkachel fuehrt zur Aufschluesselung -- die Frage "wie
          // kommt die Zahl zustande" stellt sich genau dort.
          return k.href ? (
            <Link key={k.label} href={k.href} className="block px-4 py-3.5 transition-colors hover:bg-edge/30">
              {inhalt}
            </Link>
          ) : (
            <div key={k.label} className="px-4 py-3.5">{inhalt}</div>
          );
        })}
      </div>

      {/* Forecast + faellige Aufgaben (CRM Phase 4/5) -- blendet sich selbst aus,
          solange es weder Deals noch offene Aufgaben gibt. */}
      <ForecastCards stats={pipelineStats} />

      {/* ROI-Banner.
          Traegt seinen Zeitraum und seine Annahmen mit sich: eine Zahl, die
          man nicht nachrechnen kann, glaubt man genau einmal. */}
      {roi.hours > 0 && (
        <div className="rounded-lg border border-sky-200/70 bg-gradient-to-r from-sky-50 via-panel to-panel px-4 py-3 dark:border-sky-500/25 dark:from-sky-500/10">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <svg className="h-4 w-4 shrink-0 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
            </svg>
            <p className="text-sm text-ink">
              <span className="font-semibold">≈ {roi.hours} {t.dashboard.roiHours}</span> {t.dashboard.roiSaved}
              <span className="text-soft"> {useDateRange ? t.dashboard.roiInRange : t.dashboard.roiInDays(rangeDays)}</span>
            </p>
            <p className="text-sm text-soft">
              · {t.dashboard.roiEquals}{" "}
              <span className="font-medium text-emerald-600 dark:text-emerald-400">~{roi.value} €</span>{" "}
              {t.dashboard.roiLaborCost}
              {costs.usd > 0 && (
                <>
                  {", "}{t.dashboard.roiAt}{" "}
                  <span className="font-medium text-ink">${costs.usd.toFixed(2)}</span>{" "}
                  {abosImFenster > 0 ? t.dashboard.roiTotalCosts : t.dashboard.roiApiCosts}
                </>
              )}
            </p>
          </div>

          {/* Die Rechnung im Klartext. */}
          <p className="mt-1.5 pl-7 text-[11px] text-mute">
            {t.dashboard.roiBasis(roi.contacts, MIN_PER_CONTACT, roi.icebreakers, MIN_PER_ICEBREAKER, HOURLY_EUR)}
            {abosImFenster > 0 && " · " + t.dashboard.roiSubscriptions(abosMonatlich, fensterTage)}
          </p>

          {/* Zwei Vorbehalte, die die Zahl relativieren -- und die genau
              deshalb danebenstehen und nicht weggelassen werden. */}
          {abosImFenster === 0 && (
            <p className="mt-1 pl-7 text-[11px] text-amber-600 dark:text-amber-500">
              {t.dashboard.roiNoSubscriptions}{" "}
              <Link href="/costs" className="underline underline-offset-2">{t.dashboard.roiEnterCosts}</Link>
            </p>
          )}
          {messungJuenger && messungSeit && (
            <p className="mt-1 pl-7 text-[11px] text-amber-600 dark:text-amber-500">
              {t.dashboard.roiCostsSince(messungSeit.toLocaleDateString(lang === "de" ? "de-DE" : "en-US"))}
            </p>
          )}
        </div>
      )}

      {/* Umsatz- & Zustellbarkeits-Uebersicht (Punkt 2 + 6): nur sichtbar, sobald
          mindestens eine Suche mit einer Instantly-Kampagne verknuepft ist, siehe
          Suchdetail-Seite. Ohne Verknuepfung gibt es hier schlicht nichts zu zeigen. */}
      {stats.instantly && stats.instantly.campaigns_linked > 0 && (() => {
        const bounceRate = stats.instantly.emails_sent > 0
          ? (stats.instantly.bounced / stats.instantly.emails_sent) * 100
          : 0;
        const riskyBounceRate = bounceRate > 3;
        const costPerOpportunity = stats.instantly.opportunities > 0
          ? costs.usd / stats.instantly.opportunities
          : null;
        return (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-edge/60 bg-panel p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-mute">{t.dashboard.instantlySent}</p>
              <p className="mt-0.5 text-xl font-semibold text-ink">{stats.instantly.emails_sent}</p>
              <p className="text-[11px] text-faint">{stats.instantly.replies_unique} {t.dashboard.instantlyReplies}</p>
            </div>
            <div className="rounded-lg border border-edge/60 bg-panel p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-mute">{t.dashboard.instantlyBounceRate}</p>
              <p className={"mt-0.5 text-xl font-semibold " + (riskyBounceRate ? "text-red-600 dark:text-red-400" : "text-ink")}>
                {bounceRate.toFixed(1)}%
              </p>
              <p className="text-[11px] text-faint">
                {riskyBounceRate ? t.dashboard.instantlyBounceRisky : t.dashboard.instantlyBounceOk}
              </p>
            </div>
            <div className="rounded-lg border border-edge/60 bg-panel p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-mute">{t.dashboard.instantlyMeetings}</p>
              <p className="mt-0.5 text-xl font-semibold text-ink">{stats.meetings_booked}</p>
              <p className="text-[11px] text-faint">{stats.customers} {t.dashboard.instantlyCustomers}</p>
            </div>
            <div className="rounded-lg border border-edge/60 bg-panel p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-mute">{t.dashboard.instantlyPipelineValue}</p>
              <p className="mt-0.5 text-xl font-semibold text-emerald-600 dark:text-emerald-400">
                ~{Math.round(stats.instantly.opportunity_value)} €
              </p>
              <p className="text-[11px] text-faint">
                {stats.instantly.opportunities} {t.dashboard.instantlyOpportunities}
                {costPerOpportunity !== null && ` · ${costPerOpportunity.toFixed(2)} $ ${t.dashboard.instantlyCostPer}`}
              </p>
            </div>
          </div>
        );
      })()}

      {/* Chart + Neueste Leads */}
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="rounded-lg border border-edge/60 bg-panel p-5 shadow-sm lg:col-span-3">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">{t.dashboard.chartTitle(rangeDays)}</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-mute">
                {stats.emails_sent ?? 0} {t.dashboard.emailsSent} · {stats.replies ?? 0} {t.dashboard.replies}
              </span>
              <div className="flex overflow-hidden rounded-lg border border-edge2">
                {RANGE_OPTIONS.map((days) => (
                  <Link
                    key={days}
                    href={
                      days === DEFAULT_RANGE_DAYS ? "/" : days === 0 ? "/?range=all" : `/?range=${days}`
                    }
                    className={
                      "px-2.5 py-1 text-xs font-medium transition-colors " +
                      // Bei aktiver Kalenderauswahl ist keiner der festen
                      // Bereiche gemeint -- sonst saehe es aus, als gaelten beide.
                      (!useDateRange && days === rangeDays
                        ? "bg-sky-600 text-white"
                        : "text-soft hover:bg-chip hover:text-ink")
                    }
                  >
                    {t.dashboard.rangeOptions[String(days)]}
                  </Link>
                ))}
              </div>
              <DateRangePicker />
            </div>
          </div>
          <ActivityChart data={stats.activity ?? []} />
        </div>
        <div className="overflow-hidden rounded-lg border border-edge/60 bg-panel shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-edge/60 px-4 py-3">
            <h2 className="text-sm font-medium text-ink">{t.dashboard.recentLeads}</h2>
            <Link href="/leads" className="text-xs text-faint hover:text-ink">{t.dashboard.all}</Link>
          </div>
          <div className="divide-y divide-edge/60">
            {recent.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-chip text-[11px] font-semibold text-soft">
                  {(c.full_name ?? "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{c.full_name ?? "—"}</p>
                  <p className="truncate text-xs text-faint">
                    {c.title ? c.title + " · " : ""}
                    {(c.businesses as unknown as { name: string } | null)?.name}
                  </p>
                </div>
                {c.email && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="E-Mail vorhanden" />
                )}
              </div>
            ))}
            {recent.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-mute">{t.dashboard.noLeadsYet}</p>
            )}
          </div>
        </div>
      </div>

      {/* Neue Suche. Die id ist das Ziel von "Suche wiederholen" auf der
          Suchdetailseite -- ohne sie fuellt sich das Formular ausserhalb des
          Sichtbereichs, und der Klick sieht folgenlos aus. */}
      <section id="neue-suche" className="scroll-mt-4 rounded-lg border border-edge/60 bg-panel p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-medium text-ink">{t.dashboard.newSearch}</h2>
        <p className="mb-4 text-sm text-faint">{t.dashboard.newSearchHint}</p>
        <NewSearchForm workspaceId={workspaceId} apiKeyProviders={apiKeyProviders} />
      </section>

      {/* Letzte Suchen */}
      <section className="overflow-hidden rounded-lg border border-edge/60 bg-panel shadow-sm">
        <div className="flex items-center justify-between border-b border-edge/60 px-5 py-3">
          <h2 className="text-sm font-medium text-ink">{t.dashboard.recentSearches}</h2>
          <Link href="/searches" className="text-xs text-faint hover:text-ink">{t.dashboard.showAll}</Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge/60 text-left text-xs text-mute">
              <th className="px-5 py-2 font-medium">{t.dashboard.table.list}</th>
              <th className="px-5 py-2 font-medium">{t.dashboard.table.source}</th>
              <th className="px-5 py-2 font-medium">{t.dashboard.table.location}</th>
              <th className="px-5 py-2 font-medium">{t.dashboard.table.max}</th>
              <th className="px-5 py-2 font-medium">{t.dashboard.table.status}</th>
              <th className="px-5 py-2 font-medium">{t.dashboard.table.created}</th>
            </tr>
          </thead>
          <tbody>
            {searches.map((s) => (
              <tr key={s.id} className="border-b border-edge/60 transition-colors last:border-0 hover:bg-wash">
                <td className="px-5 py-2.5 font-medium text-ink">
                  <Link href={"/searches/" + s.id} className="hover:underline underline-offset-4">
                    {s.name ?? s.query}
                  </Link>
                </td>
                <td className="px-5 py-2.5">
                  <span
                    className={
                      "rounded-md border px-1.5 py-0.5 text-[11px] " +
                      searchSourceBadgeClass(s.source)
                    }
                  >
                    {searchSourceLabel(s.source)}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-soft">{s.location}</td>
                <td className="px-5 py-2.5 text-soft" title={s.target_email_count ? `${s.max_results} Firmen durchsucht` : undefined}>
                  {s.target_email_count ? `🎯 ${s.target_email_count}` : s.max_results}
                </td>
                <td className="px-5 py-2.5"><StatusBadge status={s.status} labels={t.common.statusLabels} /></td>
                <td className="px-5 py-2.5 text-faint">
                  <LocalTime
                    iso={s.created_at}
                    lang={lang}
                    serverFormatted={formatDate(s.created_at, lang)}
                  />
                </td>
              </tr>
            ))}
            {searches.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-mute">{t.dashboard.noSearchesYet}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  const config: Record<string, { dot: string; text: string }> = {
    pending: { dot: "bg-amber-400", text: "text-amber-700 dark:text-amber-300" },
    running: { dot: "bg-blue-500 animate-pulse", text: "text-blue-700 dark:text-blue-300" },
    completed: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
    failed: { dot: "bg-red-500", text: "text-red-700 dark:text-red-300" },
  };
  const c = config[status] ?? { dot: "bg-mute", text: "text-soft" };
  return (
    <span className={"inline-flex items-center gap-1.5 text-xs font-medium " + c.text}>
      <span className={"h-1.5 w-1.5 rounded-full " + c.dot} />
      {labels[status] ?? status}
    </span>
  );
}
