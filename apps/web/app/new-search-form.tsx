"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "./language-provider";
import { useToast } from "./toast-provider";

const INDUSTRIES = [
  "Insurance", "Financial Services", "Banking", "Accounting", "Legal Services",
  "Software Development", "IT Services and IT Consulting", "Information Technology and Services",
  "Marketing Services", "Advertising Services", "Business Consulting and Services",
  "Staffing and Recruiting", "Human Resources Services", "Real Estate", "Construction",
  "Manufacturing", "Hospitals and Health Care", "Medical Practices", "Dentists",
  "Wellness and Fitness Services", "Restaurants", "Hospitality", "Retail", "Wholesale",
  "Automotive", "Telecommunications", "Education", "Utilities",
];
const COUNTRY_CODES = ["AT", "DE", "CH", "GB", "US", "NL", "FR", "IT", "ES"];
const HEADCOUNTS = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"];

// Punkt 7 aus dem Differenzierungs-Plan: vorgefertigte Kombinationen aus
// Suchbegriff + Pain-Point-Filter (Punkt 3) fuer konkrete Nischen, damit man
// nicht bei jeder neuen Zielgruppe wieder bei null anfaengt. Query-Text bewusst
// nicht uebersetzt (wie INDUSTRIES oben), da das der tatsaechliche Google-Places-
// Suchbegriff ist, unabhaengig von der UI-Sprache.
type Playbook = {
  id: string;
  query: string;
  noWebsite: boolean;
  maxRating: number | "";
};
const PLAYBOOKS: Playbook[] = [
  { id: "restaurants_no_website", query: "Restaurant", noWebsite: true, maxRating: "" },
  { id: "handwerk_no_booking", query: "Handwerksbetrieb", noWebsite: true, maxRating: "" },
  { id: "local_low_rating", query: "Dienstleister", noWebsite: false, maxRating: 3.5 },
  { id: "friseure_no_website", query: "Friseursalon", noWebsite: true, maxRating: "" },
  { id: "zahnaerzte_low_rating", query: "Zahnarzt", noWebsite: false, maxRating: 4 },
];

const inputCls =
  "mt-1.5 rounded-lg border border-edge2 bg-field px-3.5 py-2.5 text-sm text-ink " +
  "placeholder-mute outline-none transition-colors focus:border-sky-500";
const labelCls = "flex flex-col text-sm font-medium text-soft";

export default function NewSearchForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { t } = useT();
  const { push } = useToast();
  const [mode, setMode] = useState<"maps" | "corporate">("maps");
  const [listName, setListName] = useState("");
  const [schedule, setSchedule] = useState("none");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [maxResults, setMaxResults] = useState(10);
  const [radius, setRadius] = useState(2000);
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("AT");
  const [headcount, setHeadcount] = useState("");
  const [keywords, setKeywords] = useState("");
  const [painPointNoWebsite, setPainPointNoWebsite] = useState(false);
  const [painPointMaxRating, setPainPointMaxRating] = useState<number | "">("");
  const [selectedPlaybook, setSelectedPlaybook] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const activeFilterCount = (painPointNoWebsite ? 1 : 0) + (painPointMaxRating !== "" ? 1 : 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const nextRun =
      schedule === "daily"
        ? new Date(Date.now() + 86400000).toISOString()
        : schedule === "weekly"
          ? new Date(Date.now() + 7 * 86400000).toISOString()
          : null;
    const base = {
      name: listName.trim() || null,
      schedule,
      next_run_at: nextRun,
    };
    const painPointFilters: Record<string, unknown> = {};
    if (painPointNoWebsite) painPointFilters.pain_point_no_website = true;
    if (painPointMaxRating !== "") painPointFilters.pain_point_max_rating = painPointMaxRating;

    const row: Record<string, unknown> =
      mode === "maps"
        ? {
            ...base,
            workspace_id: workspaceId, source: "maps", query, location,
            max_results: maxResults, radius_m: radius,
            ...(Object.keys(painPointFilters).length > 0 ? { filters: painPointFilters } : {}),
          }
        : {
            ...base,
            workspace_id: workspaceId, source: "corporate",
            query: [industry, keywords].filter(Boolean).join(" · ") || "Corporate-Suche",
            location: [city, country].filter(Boolean).join(", "),
            max_results: maxResults,
            filters: { industry: industry || null, city: city || null, country, headcount: headcount || null, keywords: keywords || null },
          };
    const { error } = await createClient().from("searches").insert(row);
    setLoading(false);
    if (error) {
      // RLS blockiert den Insert bei abgelaufener Testphase/fehlendem Abo
      // (searches_owner_insert, Migration 0024) -- freundliche Meldung statt
      // des rohen Postgres-Fehlertexts.
      if (error.code === "42501") {
        push(t.newSearchForm.billingBlocked, "error");
      } else {
        push(error.message, "error");
      }
      return;
    }
    setQuery(""); setLocation(""); setKeywords(""); setCity(""); setListName("");
    router.refresh();
  }

  function applyPlaybook(id: string) {
    setSelectedPlaybook(id);
    const pb = PLAYBOOKS.find((p) => p.id === id);
    if (!pb) return;
    setMode("maps");
    setQuery(pb.query);
    setPainPointNoWebsite(pb.noWebsite);
    setPainPointMaxRating(pb.maxRating);
    // Sichtbar machen, was das Playbook still mitgesetzt hat.
    if (pb.noWebsite || pb.maxRating !== "") setAdvancedOpen(true);
  }

  const tabCls = (active: boolean) =>
    "rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors " +
    (active ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : "text-faint hover:text-ink");

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className={labelCls + " max-w-xs"}>
        {t.newSearchForm.playbookLabel}
        <select
          value={selectedPlaybook}
          onChange={(e) => applyPlaybook(e.target.value)}
          className={inputCls}
        >
          <option value="">{t.newSearchForm.playbookNone}</option>
          {PLAYBOOKS.map((pb) => (
            <option key={pb.id} value={pb.id}>{t.newSearchForm.playbookLabels[pb.id] ?? pb.id}</option>
          ))}
        </select>
      </label>

      <div className="flex gap-1 rounded-lg border border-edge/60 bg-panel p-1 w-fit">
        <button type="button" className={tabCls(mode === "maps")} onClick={() => setMode("maps")}>
          {t.newSearchForm.tabMaps}
        </button>
        <button type="button" className={tabCls(mode === "corporate")} onClick={() => setMode("corporate")}>
          {t.newSearchForm.tabCorporate}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className={labelCls + " min-w-52 flex-1"}>
          {t.newSearchForm.listName}
          <input placeholder={t.newSearchForm.listNamePlaceholder} value={listName}
            onChange={(e) => setListName(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          {t.newSearchForm.subscription}
          <select value={schedule} onChange={(e) => setSchedule(e.target.value)} className={inputCls + " w-44"}>
            <option value="none">{t.newSearchForm.subscriptionOnce}</option>
            <option value="weekly">{t.newSearchForm.subscriptionWeekly}</option>
            <option value="daily">{t.newSearchForm.subscriptionDaily}</option>
          </select>
        </label>
      </div>
      {mode === "maps" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelCls + " lg:col-span-2"}>
            {t.newSearchForm.niche}
            <input required placeholder={t.newSearchForm.nichePlaceholder} value={query}
              onChange={(e) => setQuery(e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls + " lg:col-span-2"}>
            {t.newSearchForm.location}
            <input required placeholder={t.newSearchForm.locationPlaceholder} value={location}
              onChange={(e) => setLocation(e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls}>
            {t.newSearchForm.maxBusinesses}
            <input type="number" min={1} max={100} value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))} className={inputCls} />
          </label>
          <label className={labelCls}>
            {t.newSearchForm.radius}
            <input type="number" min={100} max={50000} step={100} value={radius}
              onChange={(e) => setRadius(Number(e.target.value))} className={inputCls} />
          </label>
        </div>
      ) : null}

      {/* Die Pain-Point-Filter standen bisher dauerhaft aufgeklappt zwischen
          Suchfeldern und Absenden-Knopf und machten die Maske dicht. Sie sind
          jetzt eingeklappt und oeffnen sich automatisch, sobald ein Filter
          gesetzt ist -- etwa durch ein Playbook. */}
      {mode === "maps" && (
        <details
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="rounded-lg border border-edge/60 bg-surface/60"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-faint transition-colors hover:text-soft">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4">
              <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3m13.4-6.4-1.6 1.6M9.2 14.8l-1.6 1.6m10.8 0-1.6-1.6M9.2 9.2 7.6 7.6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            {t.newSearchForm.painPointHeading}
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-300">
                {activeFilterCount}
              </span>
            )}
          </summary>
          <div className="space-y-3 border-t border-edge/60 px-3.5 py-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-soft">
              <input
                type="checkbox"
                checked={painPointNoWebsite}
                onChange={(e) => setPainPointNoWebsite(e.target.checked)}
                className="h-4 w-4 rounded accent-sky-500"
              />
              {t.newSearchForm.painPointNoWebsite}
            </label>
            <label className="flex items-center gap-2 text-sm text-soft">
              <input
                type="checkbox"
                checked={painPointMaxRating !== ""}
                onChange={(e) => setPainPointMaxRating(e.target.checked ? 4 : "")}
                className="h-4 w-4 rounded accent-sky-500"
              />
              {t.newSearchForm.painPointMaxRating}
              {painPointMaxRating !== "" && (
                <input
                  type="number"
                  min={1}
                  max={5}
                  step={0.5}
                  value={painPointMaxRating}
                  onChange={(e) => setPainPointMaxRating(Number(e.target.value))}
                  className={inputCls + " mt-0 w-20 py-1.5"}
                />
              )}
            </label>
          </div>
        </details>
      )}

      {mode === "maps" && <SubmitButton loading={loading} />}

      {mode === "corporate" ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelCls + " min-w-44 flex-1"}>
            {t.newSearchForm.industry}
            <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={inputCls}>
              <option value="">{t.newSearchForm.allIndustries}</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </label>
          <label className={labelCls}>
            {t.newSearchForm.city}
            <input placeholder={t.newSearchForm.cityPlaceholder} value={city}
              onChange={(e) => setCity(e.target.value)} className={inputCls + " w-36"} />
          </label>
          <label className={labelCls}>
            {t.newSearchForm.country}
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={inputCls + " w-36"}>
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>{t.newSearchForm.countryLabels[code] ?? code}</option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            {t.newSearchForm.headcount}
            <select value={headcount} onChange={(e) => setHeadcount(e.target.value)} className={inputCls + " w-32"}>
              <option value="">{t.newSearchForm.allHeadcounts}</option>
              {HEADCOUNTS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className={labelCls + " flex-1"}>
            {t.newSearchForm.keywords}
            <input placeholder={t.newSearchForm.keywordsPlaceholder} value={keywords}
              onChange={(e) => setKeywords(e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls}>
            {t.newSearchForm.maxBusinesses}
            <input type="number" min={1} max={100} value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))} className={inputCls + " w-24"} />
          </label>
          <SubmitButton loading={loading} />
        </div>
      ) : null}
      {mode === "corporate" && (
        <p className="text-xs text-mute">{t.newSearchForm.corporateHint}</p>
      )}
    </form>
  );

  function SubmitButton({ loading }: { loading: boolean }) {
    return (
      <button
        disabled={loading}
        className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-surface shadow-sm transition-all hover:opacity-85 active:scale-[0.98] disabled:opacity-50"
      >
        {loading ? t.newSearchForm.starting : t.newSearchForm.start}
      </button>
    );
  }
}
