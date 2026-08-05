"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PROSPEO_HEADCOUNT_RANGES,
  PROSPEO_LIMITS,
  PROSPEO_REVENUE_TIERS,
  PROSPEO_TRAFFIC_PERIODS,
  hasAnyProspeoFilter,
  requiredProspeoPlan,
  type ProspeoFilters,
  type ProspeoMatchMode,
} from "@/lib/prospeo-query";
import { useT } from "./language-provider";

/**
 * Die Filtermaske des Prospeo-Suchwegs.
 *
 * Eigene Datei, weil new-search-form.tsx schon bei 1299 Zeilen liegt und
 * Prospeo mehr Filter hat als die anderen drei Wege zusammen. Die Zustaende
 * liegen beim Formular (kontrollierte Komponente) -- so landet beim Absenden
 * genau das Objekt in searches.filters, das der Trefferzaehler gezaehlt hat.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ZWEI ENTWURFSENTSCHEIDUNGEN, DIE MAN SONST FUER WILLKUER HALTEN KOENNTE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. WERTE KOMMEN VON PROSPEO, NICHT AUS EINER LISTE IM CODE
 *
 * Ort, Branche und Technologie akzeptiert Prospeo nur mit Werten aus seiner
 * eigenen Suggestions-API. Eine hier gepflegte Liste waere beim naechsten
 * Prospeo-Update falsch, und der Fehler waere nicht laut, sondern ein leeres
 * Suchergebnis. Genau das ist bei Apollo passiert: am 2026-08-02 lief eine
 * 300-Lead-Suche leer, weil drei Technologie-Slugs dort gar nicht
 * existierten. Deshalb SuggestPicker statt Auswahlliste -- die Vorschlaege
 * sind kostenlos (siehe api/prospeo/suggestions).
 *
 * 2. DER TREFFERZAEHLER LAEUFT NUR AUF KNOPFDRUCK
 *
 * Bei Apollo laeuft er bei jeder Filteraenderung, weil Apollos Suche gratis
 * ist. Prospeos Suche kostet 1 Credit je Seite -- auch fuer die blosse
 * Gesamtzahl. Ein Zaehler bei jedem Tastendruck haette auf dem Starter-Tarif
 * (1000 Credits) nach Minuten das Monatskontingent aufgebraucht. Der Knopf
 * schreibt den Preis daneben.
 */

type Props = {
  value: ProspeoFilters;
  onChange: (next: ProspeoFilters) => void;
};

type Suggestion = { value: string; label: string; hint: string | null };

const SUGGEST_TYPES = {
  location: "location_search",
  industry: "industry_search",
  technology: "technology_search",
  country: "company_website_traffic_countries_search",
} as const;

export default function ProspeoFilterForm({ value, onChange }: Props) {
  const { t } = useT();
  const P = t.prospeo;
  const set = <K extends keyof ProspeoFilters>(key: K, v: ProspeoFilters[K]) =>
    onChange({ ...value, [key]: v });

  const { plan, fields } = requiredProspeoPlan(value);

  return (
    <div className="space-y-5">
      {/* ── Person ─────────────────────────────────────────────────── */}
      <Group title={P.groupPerson}>
        <Field label={P.titles} hint={P.titlesHint}>
          <input
            value={value.person_titles ?? ""}
            onChange={(e) => set("person_titles", e.target.value)}
            placeholder={P.titlesPlaceholder}
            className={INPUT}
          />
        </Field>
        <Field label={P.titleMatch}>
          <select
            value={value.person_title_match ?? "CONTAINS"}
            onChange={(e) => set("person_title_match", e.target.value as ProspeoMatchMode)}
            className={INPUT}
          >
            {/* GROSS, weil Prospeo klein geschriebene Werte mit einem 400
                ablehnt -- am 2026-08-05 im Testlauf gemessen. */}
            <option value="CONTAINS">{P.matchContains}</option>
            <option value="EXACT">{P.matchExact}</option>
            <option value="SIMILAR">{P.matchSimilar}</option>
            <option value="STRICT">{P.matchStrict}</option>
          </select>
        </Field>
      </Group>

      {/* ── Firma ──────────────────────────────────────────────────── */}
      <Group title={P.groupCompany}>
        <Field label={P.locations} hint={P.locationsHint} full>
          <SuggestPicker
            type={SUGGEST_TYPES.location}
            selected={value.company_locations ?? []}
            onChange={(v) => set("company_locations", v)}
            placeholder={P.locationsPlaceholder}
          />
        </Field>
        <Field label={P.industries} full>
          <SuggestPicker
            type={SUGGEST_TYPES.industry}
            selected={value.industries ?? []}
            onChange={(v) => set("industries", v)}
            placeholder={P.industriesPlaceholder}
            max={PROSPEO_LIMITS.industries}
          />
        </Field>
        <Field label={P.headcount} full>
          <ChipToggles
            options={[...PROSPEO_HEADCOUNT_RANGES]}
            selected={value.headcount ?? []}
            onChange={(v) => set("headcount", v)}
          />
        </Field>
        <Field label={P.keywords} hint={P.keywordsHint} full>
          <input
            value={value.keywords ?? ""}
            onChange={(e) => set("keywords", e.target.value)}
            placeholder={P.keywordsPlaceholder}
            className={INPUT}
          />
        </Field>
      </Group>

      {/* ── Ab Starter ─────────────────────────────────────────────── */}
      <Group title={P.groupStarter} badge={P.planStarter}>
        <Field label={P.technologies} hint={P.technologiesHint} full>
          <SuggestPicker
            type={SUGGEST_TYPES.technology}
            selected={value.technologies ?? []}
            onChange={(v) => set("technologies", v)}
            placeholder={P.technologiesPlaceholder}
            max={PROSPEO_LIMITS.technologies}
          />
        </Field>

        <Field label={P.hiringFor} hint={P.hiringForHint} full>
          <input
            value={value.hiring_for ?? ""}
            onChange={(e) => set("hiring_for", e.target.value)}
            placeholder={P.hiringForPlaceholder}
            className={INPUT}
          />
        </Field>
        <Field label={P.jobPostingMin}>
          <NumberInput value={value.job_posting_min} onChange={(v) => set("job_posting_min", v)} min={0} max={5000} />
        </Field>
        <Field label={P.jobPostingMax}>
          <NumberInput value={value.job_posting_max} onChange={(v) => set("job_posting_max", v)} min={0} max={5000} />
        </Field>

        <Field label={P.revenue} full>
          <ChipToggles
            options={[...PROSPEO_REVENUE_TIERS]}
            selected={value.revenue ?? []}
            onChange={(v) => set("revenue", v)}
          />
        </Field>
      </Group>

      {/* ── Ab Pro ─────────────────────────────────────────────────── */}
      <Group title={P.groupTraffic} badge={P.planPro} hint={P.groupTrafficHint}>
        <Field label={P.visitsMin}>
          <NumberInput value={value.traffic_min_visits} onChange={(v) => set("traffic_min_visits", v)} min={0} />
        </Field>
        <Field label={P.visitsMax}>
          <NumberInput value={value.traffic_max_visits} onChange={(v) => set("traffic_max_visits", v)} min={0} />
        </Field>
        <Field label={P.changePeriod}>
          <select
            value={value.traffic_change_period ?? "monthly"}
            onChange={(e) =>
              set("traffic_change_period", e.target.value as (typeof PROSPEO_TRAFFIC_PERIODS)[number])
            }
            className={INPUT}
          >
            {PROSPEO_TRAFFIC_PERIODS.map((p) => (
              <option key={p} value={p}>
                {P.periods[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={P.changeMin} hint={P.changeMinHint}>
          <NumberInput value={value.traffic_change_min} onChange={(v) => set("traffic_change_min", v)} min={-100} />
        </Field>
        <Field label={P.changeMax}>
          <NumberInput value={value.traffic_change_max} onChange={(v) => set("traffic_change_max", v)} />
        </Field>
        <Field label={P.trafficCountries} hint={P.trafficCountriesHint} full>
          <SuggestPicker
            type={SUGGEST_TYPES.country}
            selected={value.traffic_countries ?? []}
            onChange={(v) => set("traffic_countries", v)}
            placeholder={P.trafficCountriesPlaceholder}
            max={PROSPEO_LIMITS.trafficCountries}
          />
        </Field>
        {(value.traffic_countries ?? []).length > 0 && (
          <Field label={P.countryPct} hint={P.countryPctHint}>
            <NumberInput
              value={value.traffic_country_min_pct}
              onChange={(v) => set("traffic_country_min_pct", v)}
              min={0}
              max={100}
            />
          </Field>
        )}
      </Group>

      {/* Welcher Tarif fuer die aktuelle Auswahl noetig ist. Steht hier statt
          erst im 403 der Suche -- derselbe Gedanke wie beim Torwart: lieber
          vorher erklaeren als hinterher scheitern. */}
      {plan !== "free" && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
          {P.planNotice(plan === "pro" ? "Pro" : "Starter", fields.length)}
        </p>
      )}

      <CountButton filters={value} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════ */

const INPUT =
  "w-full rounded-lg border border-edge2 bg-field px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-sky-500";

function Group({
  title,
  badge,
  hint,
  children,
}: {
  title: string;
  badge?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-edge2 bg-panel2/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium text-ink">{title}</h4>
        {badge && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            {badge}
          </span>
        )}
      </div>
      {hint && <p className="mb-3 text-xs text-faint">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={"flex flex-col gap-1 " + (full ? "sm:col-span-2" : "")}>
      <span className="text-xs font-medium text-soft">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-mute">{hint}</span>}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      // Leeres Feld heisst "nicht gesetzt", nicht 0 -- 0 ist bei
      // job_posting_min eine echte Bedingung ("keine offenen Stellen").
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className={INPUT}
    />
  );
}

function ChipToggles({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? selected.filter((s) => s !== o) : [...selected, o])}
            className={
              "rounded-full border px-2.5 py-1 text-xs transition-colors " +
              (on
                ? "border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                : "border-edge2 text-soft hover:border-edge3 hover:text-ink")
            }
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Mehrfachauswahl, deren Werte von Prospeo kommen.
 *
 * Getippt wird ein Suchbegriff, gewaehlt wird aus dem, was Prospeo
 * zurueckgibt. Freitext ist bewusst NICHT moeglich: ein selbst getippter Wert,
 * den Prospeo nicht kennt, fuehrt zu null Treffern ohne Fehlermeldung.
 */
function SuggestPicker({
  type,
  selected,
  onChange,
  placeholder,
  max,
}: {
  type: string;
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setItems([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch("/api/prospeo/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, query: q }),
        });
        const body = await res.json().catch(() => ({}));
        setItems(Array.isArray(body.suggestions) ? body.suggestions : []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [type]
  );

  // Entprellt, damit nicht jeder Tastendruck eine Anfrage ausloest. Der
  // Endpunkt ist zwar kostenlos, aber die Ratengrenze gilt trotzdem.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => search(query), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, search]);

  const atMax = max !== undefined && selected.length >= max;

  return (
    <div className="relative">
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span
              key={s}
              className="flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-300"
            >
              {s}
              <button
                type="button"
                onClick={() => onChange(selected.filter((v) => v !== s))}
                className="text-sky-600/70 transition-colors hover:text-sky-800 dark:hover:text-sky-100"
                aria-label={t.common.delete}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        value={query}
        disabled={atMax}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        // Verzoegert schliessen, sonst feuert das Blur vor dem Klick auf einen
        // Vorschlag und die Auswahl geht verloren.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={atMax ? t.prospeo.maxReached(max!) : placeholder}
        className={INPUT + (atMax ? " opacity-60" : "")}
      />

      {open && query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-edge2 bg-panel shadow-lg">
          {loading ? (
            <p className="px-3 py-2 text-xs text-mute">{t.prospeo.counting}</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-2 text-xs text-mute">{t.prospeo.noSuggestions}</p>
          ) : (
            items
              .filter((i) => !selected.includes(i.value))
              .map((i) => (
                <button
                  key={i.value + (i.hint ?? "")}
                  type="button"
                  onClick={() => {
                    onChange([...selected, i.value]);
                    setQuery("");
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-ink transition-colors hover:bg-chip"
                >
                  <span>{i.label}</span>
                  {i.hint && <span className="text-[11px] text-mute">{i.hint}</span>}
                </button>
              ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Der Trefferzaehler -- ausdruecklich, nicht automatisch.
 *
 * Siehe Kopfkommentar: jeder Klick kostet einen Credit. Der Preis steht
 * deshalb am Knopf, nicht im Kleingedruckten.
 */
function CountButton({ filters }: { filters: ProspeoFilters }) {
  const { t } = useT();
  const P = t.prospeo;
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; total: number; retrievable: number; dailyLeft: number | null }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const usable = hasAnyProspeoFilter(filters);

  async function run() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/prospeo/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        /**
         * Prospeos eigenen Text zeigen, wo es einen gibt.
         *
         * filter_error nennt den Filternamen und die noetige Stufe
         * ("company_technology (STARTER+)"). Das ist praeziser als jede
         * Umschreibung von uns -- und im Testlauf am 2026-08-05 war genau
         * diese Auskunft der Unterschied zwischen "nicht erreichbar" und
         * "dein Tarif kann das nicht".
         */
        const detail = typeof body.detail === "string" && body.detail ? ` (${body.detail})` : "";
        const msg =
          body.error === "plan"
            ? P.errorPlan(body.plan === "pro" ? "Pro" : "Starter") + detail
            : body.error === "invalid_filters"
              ? P.errorInvalidFilters + detail
              : body.error === "no_key"
                ? P.errorNoKey
                : body.error === "rate_limited"
                  ? P.errorRateLimited
                  : body.error === "rejected"
                    ? P.errorRejected
                    : P.errorGeneric;
        setState({ kind: "error", message: msg });
        return;
      }
      setState({
        kind: "ok",
        total: body.total ?? 0,
        retrievable: body.retrievable ?? 0,
        dailyLeft: body.dailyLeft ?? null,
      });
    } catch {
      setState({ kind: "error", message: P.errorGeneric });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={!usable || state.kind === "loading"}
        className="rounded-lg border border-edge2 px-3.5 py-2 text-sm font-medium text-soft transition-colors hover:border-edge3 hover:text-ink disabled:opacity-50"
      >
        {state.kind === "loading" ? P.counting : P.countButton}
      </button>
      <span className="text-xs text-mute">{P.countCost}</span>

      {state.kind === "ok" && (
        <span className="text-sm text-ink">
          {P.countResult(state.total)}
          {/* Prospeo deckelt die abrufbaren Treffer bei 25.000. Eine hoehere
              Gesamtzahl zu zeigen, ohne das zu sagen, waere ein Versprechen,
              das die Suche nicht einloest. */}
          {state.retrievable < state.total && (
            <span className="text-mute"> · {P.countCapped(state.retrievable)}</span>
          )}
        </span>
      )}
      {state.kind === "error" && (
        <span className="text-sm text-red-600 dark:text-red-400">{state.message}</span>
      )}
    </div>
  );
}
