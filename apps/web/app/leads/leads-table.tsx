"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OUTREACH_STAGES, stageRank } from "@/lib/crm/stages";
import { pickPrimaryContactPerBusiness } from "@/lib/contacts";
import { contactSourceBadgeClass } from "@/lib/search-source";
import { formatDate } from "@/lib/format-time";
import {
  AUDIT_CODES,
  isAuditCode,
  topFinding,
  type AuditCode,
  type WebsiteAudit,
} from "@/lib/website-audit";
import CompanyLogo from "../company-logo";
import ContactTimeline from "../crm/contact-timeline";
import DealsPanel from "../crm/deals-panel";
import StatusSelect from "../crm/status-select";
import { IconSearch } from "../icons";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import type { Dictionary } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

type Contact = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  email_confidence: number | null;
  email_verification_status: string | null;
  phone: string | null;
  linkedin: string | null;
  source: string;
  outreach_status: string;
  email_type: string | null;
  business_id?: string | null;
  is_primary?: boolean | null;
  businesses: {
    name: string;
    website: string | null;
    personalization: string | null;
    company_summary?: string | null;
    search_id?: string | null;
    address?: string | null;
    phone_national?: string | null;
    decisionmaker_status?: string | null;
    traffic_rank?: number | null;
    traffic_rank_source?: string | null;
    hunter_status?: string | null;
    /** Website-Befund, Migration 0102. Optional getippt, weil die Spalten am
     *  Tag des Deployments noch fehlen koennen und PostgREST dann gar nichts
     *  dazu liefert. */
    website_audit?: WebsiteAudit | null;
    website_audit_status?: string | null;
    website_audit_at?: string | null;
    /** Der aus website_audit geschriebene Satz fuer {{websiteFinding}} in
     *  Mail 1 (Migration 0103). Leer heisst: kein Befund, siehe
     *  website_audit.top_finding, nicht "noch nicht geprueft". */
    website_finding?: string | null;
  } | null;
};

type Merged = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  email_confidence: number | null;
  email_verification_status: string | null;
  phone: string | null;
  linkedin: string | null;
  outreach_status: string;
  email_type: string | null;
  is_primary: boolean;
  sources: string[];
};

type Group = {
  key: string;
  name: string;
  // Fuer Timeline und Deals im Drawer: Gruppen fassen Kontakte einer Firma
  // zusammen, alle teilen dieselbe business_id.
  business_id: string | null;
  website: string | null;
  personalization: string | null;
  company_summary: string | null;
  search_id: string | null;
  address: string | null;
  phone_national: string | null;
  decisionmaker_status: string | null;
  hunter_status: string | null;
  /** Popularitaetsrang der Website, kleiner = groesser (Migration 0079).
   *  Null heisst "unbekannt", NICHT "wenig Besucher". */
  traffic_rank: number | null;
  traffic_rank_source: string | null;
  /** Der Website-Befund dieser Firma (Migration 0102). `null` heisst "nie
   *  geprueft", `status = 'ok'` heisst "geprueft", NICHT "alles gut": die
   *  Maengel stehen in website_audit.findings. */
  website_audit: WebsiteAudit | null;
  website_audit_status: string | null;
  website_audit_at: string | null;
  /** Siehe Contact["businesses"]["website_finding"]. */
  website_finding: string | null;
  contacts: Merged[];
};

type SearchOption = { id: string; query: string; location: string };
type LeadsDict = Dictionary["leads"];

/** Mehrfachauswahl von Suchen als Dropdown-Panel (statt eines nativen
 *  <select multiple>, das als aufgeklapptes Listbox-Element das Layout der
 *  Filterleiste sprengen wuerde). Schliesst bei Klick ausserhalb. */
function SearchMultiSelect({
  searches,
  selected,
  onChange,
  allLabel,
}: {
  searches: SearchOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  const label = selected.size === 0 ? allLabel : `${allLabel.replace(/^Alle |^All /, "")} (${selected.size})`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-edge2 bg-field px-3.5 py-2.5 text-sm text-ink outline-none transition-colors hover:border-edge3 focus:border-sky-500"
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-edge2 bg-panel p-1.5 shadow-lg">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-sky-600 hover:bg-chip dark:text-sky-400"
            >
              {allLabel}
            </button>
          )}
          {searches.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-chip"
            >
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
                className="h-4 w-4 rounded accent-sky-500"
              />
              <span className="truncate">{s.query} · {s.location}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const ALL_COLUMN_IDS = ["title", "email", "phone", "sources", "status"] as const;

function normName(name: string | null): string | null {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/\b(mag|dr|msc|bsc|mba|akad|vkfm|vkff|ing|prof)\b\.?/g, "")
    .replace(/[^a-zäöüß ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeInto(target: Merged, c: Contact) {
  if (!target.title || (c.title && c.title.length > target.title.length)) target.title = c.title ?? target.title;
  if (!target.email && c.email) {
    target.email = c.email;
    target.email_confidence = c.email_confidence;
    target.email_verification_status = c.email_verification_status;
    target.email_type = c.email_type;
  }
  if (!target.phone && c.phone) target.phone = c.phone;
  if (!target.first_name && c.first_name) target.first_name = c.first_name;
  if (!target.last_name && c.last_name) target.last_name = c.last_name;
  if (!target.linkedin && c.linkedin) target.linkedin = c.linkedin;
  if (c.is_primary) target.is_primary = true;
  if (stageRank(c.outreach_status) > stageRank(target.outreach_status)) {
    target.outreach_status = c.outreach_status;
  }
  if (!target.sources.includes(c.source)) target.sources.push(c.source);
}

function groupContacts(contacts: Contact[]): Group[] {
  const groups = new Map<string, Group>();
  for (const c of contacts) {
    const b = c.businesses;
    const key = b?.website || b?.name || "unbekannt";
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: b?.name ?? "Unbekannt",
        business_id: c.business_id ?? null,
        website: b?.website ?? null,
        personalization: b?.personalization ?? null,
        company_summary: b?.company_summary ?? null,
        search_id: b?.search_id ?? null,
        address: b?.address ?? null,
        phone_national: b?.phone_national ?? null,
        decisionmaker_status: b?.decisionmaker_status ?? null,
        hunter_status: b?.hunter_status ?? null,
        traffic_rank: b?.traffic_rank ?? null,
        traffic_rank_source: b?.traffic_rank_source ?? null,
        website_audit: b?.website_audit ?? null,
        website_audit_status: b?.website_audit_status ?? null,
        website_audit_at: b?.website_audit_at ?? null,
        website_finding: b?.website_finding ?? null,
        contacts: [],
      };
      groups.set(key, g);
    }
    const email = c.email?.toLowerCase() ?? null;
    const name = normName(c.full_name);
    const existing = g.contacts.find(
      (m) =>
        (email && m.email?.toLowerCase() === email) ||
        (name && normName(m.full_name) === name)
    );
    if (existing) {
      mergeInto(existing, c);
    } else {
      g.contacts.push({
        id: c.id,
        full_name: c.full_name,
        first_name: c.first_name,
        last_name: c.last_name,
        title: c.title,
        email: c.email,
        email_confidence: c.email_confidence,
        email_verification_status: c.email_verification_status,
        email_type: c.email_type,
        phone: c.phone,
        linkedin: c.linkedin,
        outreach_status: c.outreach_status || "new",
        is_primary: c.is_primary ?? false,
        sources: [c.source],
      });
    }
  }
  return Array.from(groups.values());
}

function splitName(c: Merged): { first: string; last: string } {
  if (c.first_name || c.last_name) {
    return { first: c.first_name ?? "", last: c.last_name ?? "" };
  }
  const parts = (c.full_name ?? "").split(" ");
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

function withoutInvalidEmails(groups: Group[], enabled: boolean): Group[] {
  if (!enabled) return groups;
  return groups.map((g) => ({
    ...g,
    contacts: g.contacts.filter((c) => c.email_verification_status !== "invalid"),
  }));
}

function toCsv(groups: Group[], headers: readonly string[]): string {
  const esc = (v: unknown) => '"' + (v == null ? "" : String(v)).replace(/"/g, '""') + '"';
  const lines = groups.flatMap((g) =>
    g.contacts.map((c) => {
      const { first, last } = splitName(c);
      return [g.name, g.website, g.company_summary, first, last, c.title, c.email, c.email_confidence,
       c.phone, c.linkedin, c.sources.join("+"), g.personalization].map(esc).join(";");
    })
  );
  return [headers.join(";"), ...lines].join("\n");
}

// Spaltennamen sind Instantlys eigene Merge-Tag-Namen: NICHT uebersetzen,
// unabhaengig von der UI-Sprache, sonst greift Instantlys Auto-Mapping nicht mehr.
function toInstantlyCsv(groups: Group[]): string {
  const header = [
    "email", "first_name", "last_name", "company_name", "phone",
    "website", "personalization", "company_summary", "title", "linkedin",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v).replace(/\r?\n/g, " ");
    return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const g of groups) {
    for (const c of g.contacts) {
      const email = c.email?.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const { first, last } = splitName(c);
      lines.push(
        [email, first, last, g.name, c.phone, g.website, g.personalization, g.company_summary, c.title, c.linkedin]
          .map(esc)
          .join(",")
      );
    }
  }
  return [header.join(","), ...lines].join("\n");
}

function EmailTypeBadge({ c, t }: { c: Merged; t: LeadsDict }) {
  if (!c.email || !c.email_type) return null;
  const personal = c.email_type === "personal";
  return (
    <span
      title={personal ? t.emailTypePersonalHint : t.emailTypeGenericHint}
      className={
        "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide " +
        (personal
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300")
      }
    >
      {personal ? t.emailTypePersonal : t.emailTypeGeneric}
    </span>
  );
}

function VerificationShield({ c, t }: { c: Merged; t: LeadsDict }) {
  if (!c.email) return null;
  const verified =
    c.email_verification_status === "valid" || (c.email_confidence ?? 0) >= 85;
  return (
    <span
      title={
        verified
          ? t.verifiedEmail + (c.email_confidence ? ` (${c.email_confidence}${t.confidenceSuffix})` : "")
          : t.unverifiedEmail
      }
      className={verified ? "text-emerald-500" : "text-amber-500"}
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z" />
        {verified ? <path d="m9 12 2 2 4-4" /> : <path d="M12 8v4m0 3h.01" />}
      </svg>
    </span>
  );
}

function PipelineStep({
  label,
  state,
  detail,
}: {
  label: string;
  state: "done" | "active" | "pending" | "failed" | "empty";
  detail?: string;
}) {
  const dot = {
    done: "bg-emerald-500",
    active: "bg-blue-500 animate-pulse",
    pending: "bg-chip border border-edge2",
    failed: "bg-red-500",
    empty: "bg-amber-400",
  }[state];
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={"mt-0.5 h-2.5 w-2.5 rounded-full " + dot} />
        <span className="w-px flex-1 bg-edge" />
      </div>
      <div className="pb-4">
        <p className="text-sm text-ink">{label}</p>
        {detail && <p className="text-xs text-faint">{detail}</p>}
      </div>
    </div>
  );
}

function statusToState(s: string | null | undefined): "done" | "active" | "pending" | "failed" | "empty" {
  if (s === "found") return "done";
  if (s === "not_found") return "empty";
  if (s === "running") return "active";
  if (s === "failed") return "failed";
  return "pending";
}

/**
 * Die bekannten Befunde einer Firma in der Rangfolge des Pruefers.
 *
 * KEINE zweite Rangfolge: die Reihenfolge kommt aus derselben exportierten
 * Liste AUDIT_CODES, aus der auch topFinding() seine holt (lib/website-audit.ts).
 * Unbekannte Codes fallen weg, weil es fuer sie hier weder Beschriftung noch
 * Folgesatz gibt; einen Befund ohne Text zu zeigen waere schlechter als keinen.
 * Doppelte Codes fallen mit weg, das Set entscheidet.
 */
function auditCodes(audit: WebsiteAudit | null | undefined): AuditCode[] {
  const findings = audit?.findings;
  if (!Array.isArray(findings)) return [];
  const vorhanden = new Set(
    findings.filter((f) => f && typeof f.code === "string" && isAuditCode(f.code)).map((f) => f.code)
  );
  return AUDIT_CODES.filter((code) => vorhanden.has(code));
}

/** Der Text zum gespeicherten Zustand, oder null bei einem unbekannten. */
function auditStatusLabel(status: string | null | undefined, L: LeadsDict): string | null {
  if (status === "pending" || status === "ok" || status === "unreachable" || status === "skipped") {
    return L.audit.status[status];
  }
  return null;
}

/**
 * Der ranghoechste Befund als Plakette in der Firmenzeile.
 *
 * Beantwortet die eine Frage beim Ueberfliegen der Liste: wo ist ueberhaupt
 * ein Aufhaenger? Deshalb erscheint sie NUR, wenn einer da ist. Bernstein wie
 * ueberall in dieser Liste (PipelineStep "empty"), nicht Rot: das ist kein
 * Fehler des Nutzers, sondern seine Chance.
 *
 * 'pending' bekommt bewusst kein eigenes Zeichen. Direkt nach einer Suche
 * stuende es an jeder zweiten Zeile, es loest sich binnen Sekunden von selbst
 * auf (die Suchdetailseite laedt sich alle fuenf Sekunden nach), und eine
 * zweite Plakette in derselben Ecke wuerde die eine Aussage verwaessern, die
 * die Liste hier trifft. Im Drawer steht der Zustand, dort ist Platz dafuer.
 *
 * Unter md faellt sie weg, spaeter als die Listen-Plakette daneben (die ab
 * sm erscheint): in dieser Zeile stehen schon Firmenname, Domain, Liste und
 * Kontaktzahl, und der Name ist das, woran der Nutzer die Zeile erkennt. Er
 * darf nicht auf vier Buchstaben schrumpfen, damit eine Plakette voll
 * ausgeschrieben danebenpasst. Auf dem Handy fuehrt der Weg ueber den Drawer,
 * der dort die volle Breite hat.
 *
 * Die Beschriftungen sind Saetze und keine Schlagworte (sie stehen so in
 * dict.ts und gehoeren dem Pruefer): auf mittleren Breiten schneidet sie
 * deshalb truncate ab. Der volle Text steht im title und im Drawer.
 */
function AuditPill({ g, t: L }: { g: Group; t: LeadsDict }) {
  const top = topFinding(g.website_audit);
  if (!top || !isAuditCode(top.code)) return null;
  const label = L.audit[top.code].label;
  return (
    <span
      title={L.audit.pillTitle(label)}
      // Ab lg statt ab md.
      //
      // Am Live-Stand bei 900 Pixeln nachgemessen (2026-08-31): von den
      // Firmennamen stand je EIN Buchstabe da -- "V", "I.", "M". Diese
      // Plakette (112 Pixel), der Listen-Chip daneben (160) und die Zaehlung
      // am Zeilenende (150) sind alle drei shrink-0 und nehmen sich ihren
      // Platz vor dem Namen; uebrig blieben rund 40 Pixel fuer das Einzige,
      // woran man eine Zeile wiedererkennt.
      //
      // Die Rangfolge ist jetzt Name, dann Befund, dann Liste: die Plakette
      // kommt ab 1024 dazu, der Chip ab 1280. Ein Befund, der den Namen
      // verdraengt, zu dem er gehoert, hilft niemandem.
      className="hidden max-w-28 shrink-0 truncate rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 lg:block lg:max-w-44 xl:max-w-60 dark:text-amber-300"
    >
      {label}
    </span>
  );
}

/**
 * Der volle Befund im Drawer.
 *
 * Steht direkt ueber der Personalisierung, weil er ihr Material ist: wer
 * beides untereinander sieht, versteht ohne Erklaerung, woher der erste Satz
 * der Mail kommt.
 *
 * Genau EIN Befund geht in die Mail (lib/copy/playbook.ts: eine Friction ueber
 * alle vier Stufen). Deshalb traegt der ranghoechste hier Beschriftung,
 * Folgesatz und die Plakette "Geht in die Mail", waehrend die uebrigen
 * darunter als kurze Liste stehen. Alle gleich gross zu zeigen hiesse, dem
 * Nutzer fuenf Maengel in einer Mail zu versprechen, in der einer steht.
 */
function WebsiteAuditPanel({ g, t: L, lang }: { g: Group; t: LeadsDict; lang: Lang }) {
  const codes = auditCodes(g.website_audit);
  const status = g.website_audit_status;
  // Nie geprueft oder ohne Website: gar nichts. Ein Kasten, der nur meldet,
  // dass nichts geprueft wurde, beantwortet keine Frage, die hier jemand hat.
  if (codes.length === 0 && (!status || status === "skipped")) return null;

  const audit = g.website_audit;
  const url = (audit?.final_url || audit?.checked_url || "").replace(/^https?:\/\//, "");
  const meta = [url, g.website_audit_at ? L.audit.checkedAt(formatDate(g.website_audit_at, lang)) : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">{L.audit.heading}</p>
      <div className="mb-5 rounded-lg border border-edge/60 bg-surface/60 p-3">
        {codes.length === 0 ? (
          <>
            <p className="text-sm text-soft">{auditStatusLabel(status, L)}</p>
            {/* Waehrend der Pruefung ein Balken in der Form des Befundes, der
                gleich hier steht, statt eines Kreisels: er zeigt, wo etwas
                hinkommt, und wie viel. */}
            {status === "pending" && <span className="skeleton mt-2 block h-3 w-2/3" aria-hidden />}
          </>
        ) : (
          <>
            <div className="flex items-start gap-2.5">
              <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-ink">{L.audit[codes[0]].label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-soft">{L.audit[codes[0]].consequence}</p>
                {/* Unter dem Befund und nicht neben ihm: der Drawer ist 400
                    Pixel breit, und eine Plakette rechts nimmt der
                    Beschriftung genau die Zeilen, die sie zum Lesen braucht. */}
                <span
                  title={L.audit.inMailTitle}
                  className="mt-1.5 inline-block rounded-full border border-edge2 bg-chip px-1.5 py-0.5 text-[10px] text-faint"
                >
                  {L.audit.inMail}
                </span>
              </div>
            </div>
            {codes.length > 1 && (
              <div className="mt-3 border-t border-edge/60 pt-2.5">
                <p className="text-[11px] text-faint">{L.audit.alsoFound}</p>
                <ul className="mt-1.5 space-y-1">
                  {codes.slice(1).map((code) => (
                    <li key={code} className="flex items-start gap-2.5 text-xs leading-snug text-soft">
                      <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400/60" />
                      {L.audit[code].label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {/* Was geprueft wurde und wann. break-words statt truncate: sonst
            frisst eine lange Adresse das Datum dahinter auf. */}
        {meta && <p className="mt-3 text-[11px] leading-4 break-words text-faint">{meta}</p>}
      </div>
    </>
  );
}

export default function LeadsTable({
  contacts,
  searches,
  exportName = "leads",
}: {
  contacts: Contact[];
  searches?: SearchOption[];
  exportName?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, lang } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  /**
   * Name der Lead-Liste, aus der eine Firma stammt.
   *
   * Nur auf "Alle Leads" gefuellt: dort laufen alle Listen zusammen, und wer
   * dort jemanden findet, sieht sonst nicht, woher er kommt. Die
   * Suchdetailseite reicht searches gar nicht erst herein; dort waere die
   * Antwort die Ueberschrift der Seite.
   */
  const listeVon = (searchId: string | null): string | null =>
    (searchId && searches?.find((s) => s.id === searchId)?.query) || null;
  const L = t.leads;
  const ALL_COLUMNS = ALL_COLUMN_IDS.map((id) => ({ id, label: L.columnLabels[id] }));

  const [q, setQ] = useState(() => searchParams.get("q") ?? "");

  useEffect(() => {
    const urlQ = searchParams.get("q");
    if (urlQ !== null && urlQ !== q) setQ(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [onlyEmail, setOnlyEmail] = useState(false);
  const [onlyPhone, setOnlyPhone] = useState(false);
  // Die direkte Antwort auf die Frage, die die Plakette in der Zeile stellt:
  // zeig mir nur die Firmen, bei denen es etwas anzusprechen gibt.
  const [onlyFinding, setOnlyFinding] = useState(false);
  // Mehrfachauswahl statt einer einzelnen Suche: z.B. bei einem
  // Fan-out ueber mehrere Staedte will man alle zugehoerigen Suchen
  // zusammen filtern und in einem Rutsch verifizieren, statt jede einzeln.
  const [searchFilters, setSearchFilters] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState("");
  const [emailTypeFilter, setEmailTypeFilter] = useState("");
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  // business_id -> contactId, fuer sofortiges UI-Feedback im offenen Drawer (siehe setPrimaryContact).
  const [primaryOverrides, setPrimaryOverrides] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<Group | null>(null);
  const [cols, setCols] = useState<Set<string>>(new Set(ALL_COLUMN_IDS));
  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);
  const [bulkAction, setBulkAction] = useState<"" | "block" | "delete">("");
  const [excludeInvalid, setExcludeInvalid] = useState(true);
  const [verifyStatus, setVerifyStatus] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("leads_cols");
      if (saved) setCols(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function toggleCol(id: string) {
    setCols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem("leads_cols", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  // statusOverrides haelt lokale, optimistische Aenderungen (Dropdown -> sofortige
  // UI-Reaktion), ohne auf einen vollen router.refresh() zu warten; gruppiert wird
  // trotzdem aus contacts neu, damit ein echter Reload jederzeit die Quelle der
  // Wahrheit bleibt.
  const allGroups = useMemo(() => {
    const withOverrides = contacts.map((c) => {
      let next = c;
      if (statusOverrides[c.id]) next = { ...next, outreach_status: statusOverrides[c.id] };
      if (c.business_id && primaryOverrides[c.business_id]) {
        next = { ...next, is_primary: c.id === primaryOverrides[c.business_id] };
      }
      return next;
    });
    return groupContacts(withOverrides);
  }, [contacts, statusOverrides, primaryOverrides]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return allGroups
      .filter((g) => searchFilters.size === 0 || (!!g.search_id && searchFilters.has(g.search_id)))
      .map((g) => {
        const companyMatch = !needle || g.name.toLowerCase().includes(needle);
        const cs = g.contacts.filter((c) => {
          if (onlyEmail && !c.email) return false;
          if (statusFilter && c.outreach_status !== statusFilter) return false;
          if (emailTypeFilter && c.email_type !== emailTypeFilter) return false;
          if (!needle || companyMatch) return true;
          return [c.full_name, c.title, c.email]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(needle));
        });
        return { ...g, contacts: cs };
      })
      .filter((g) => g.contacts.length > 0)
      // Telefon-Filter bewusst auf Gruppenebene: die Firmennummer
      // (phone_national aus Google Places) ist fuer jeden Ansprechpartner
      // dieser Firma anrufbar, nicht nur fuer den, an dessen Kontaktzeile eine
      // eigene Durchwahl haengt.
      .filter((g) => !onlyPhone || !!g.phone_national || g.contacts.some((c) => !!c.phone))
      // Auf Gruppenebene wie der Telefon-Filter: der Befund haengt an der
      // Firma, nicht an einer Person.
      .filter((g) => !onlyFinding || topFinding(g.website_audit) !== null);
  }, [allGroups, q, onlyEmail, onlyPhone, onlyFinding, searchFilters, statusFilter, emailTypeFilter]);

  async function updateStatus(contactId: string, status: string) {
    setStatusOverrides((prev) => ({ ...prev, [contactId]: status }));
    const { error } = await createClient()
      .from("contacts")
      .update({ outreach_status: status })
      .eq("id", contactId)
      .eq("workspace_id", workspaceId);
    if (error) push(t.common.error + error.message, "error");
  }

  // Ueberschreibt die automatische Rang-Auswahl (lib/contacts.ts) fuer genau
  // diese Firma: erst alle anderen Kontakte der Firma zuruecksetzen, dann den
  // gewaehlten setzen; sonst wuerde der unique Index
  // contacts_one_primary_per_business (Migration 0044) den zweiten Schritt
  // ablehnen, falls kurzzeitig zwei Kontakte gleichzeitig is_primary haetten.
  async function setPrimaryContact(businessId: string, contactId: string) {
    setPrimaryOverrides((prev) => ({ ...prev, [businessId]: contactId }));
    const supabase = createClient();
    const { error: clearError } = await supabase
      .from("contacts")
      .update({ is_primary: false })
      .eq("business_id", businessId)
      .eq("workspace_id", workspaceId)
      .neq("id", contactId);
    const { error: setError } = await supabase
      .from("contacts")
      .update({ is_primary: true })
      .eq("id", contactId)
      .eq("workspace_id", workspaceId);
    if (clearError || setError) push(t.common.error + (clearError ?? setError)!.message, "error");
  }

  const totalContacts = useMemo(
    () => allGroups.reduce((n, g) => n + g.contacts.length, 0),
    [allGroups]
  );
  const shownContacts = filtered.reduce((n, g) => n + g.contacts.length, 0);
  const unverifiedCount = filtered.reduce(
    (n, g) => n + g.contacts.filter((c) => c.email && !c.email_verification_status).length,
    0
  );
  const selectedGroups = filtered.filter((g) => selected.has(g.key));
  const selectedContacts = selectedGroups.reduce((n, g) => n + g.contacts.length, 0);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((g) => selected.has(g.key));
  const someFilteredSelected = filtered.some((g) => selected.has(g.key));

  function toggleSelectAll() {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        filtered.forEach((g) => next.delete(g.key));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((g) => next.add(g.key));
      return next;
    });
  }

  function download(content: string, suffix: string) {
    const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportName.replace(/[^\wäöüÄÖÜß -]/g, "").trim() + suffix;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function blockSelected() {
    if (!confirm(L.bulkBlockConfirm(selectedGroups.length))) return;
    setBulkAction("block");
    const supabase = createClient();
    const rows = selectedGroups
      .filter((g) => g.website)
      .map((g) => ({
        workspace_id: workspaceId,
        domain: g.website!.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0],
        reason: "manual",
      }));
    if (rows.length) {
      await supabase.from("suppression_list").upsert(rows, { onConflict: "workspace_id,email", ignoreDuplicates: true });
    }
    setBulkAction("");
    push(t.blocklist.blockedSummary(0, rows.length), "success");
    setSelected(new Set());
    router.refresh();
  }

  async function deleteSelected() {
    if (!confirm(L.bulkDeleteConfirm(selectedGroups.length))) return;
    setBulkAction("delete");
    const supabase = createClient();
    const contactIds = selectedGroups.flatMap((g) => g.contacts.map((c) => c.id));
    for (let i = 0; i < contactIds.length; i += 200) {
      await supabase.from("contacts").delete().in("id", contactIds.slice(i, i + 200)).eq("workspace_id", workspaceId);
    }
    setBulkAction("");
    push(L.bulkDeleteDone(selectedGroups.length), "success");
    setSelected(new Set());
    router.refresh();
  }

  async function verifyEmails(groups: Group[]) {
    const ids = groups.flatMap((g) =>
      g.contacts.filter((c) => c.email && !c.email_verification_status).map((c) => c.id)
    );
    if (ids.length === 0) return;
    setVerifyStatus(`${L.verifying} ${ids.length}...`);
    const res = await fetch("/api/verify-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_ids: ids }),
    });
    const body = await res.json();
    setVerifyStatus("");
    if (res.ok) {
      push(`${body.checked} ${L.verifyChecked} · ${body.valid} ${L.verifyValid} · ${body.invalid} ${L.verifyInvalid}`, "success");
    } else {
      push(t.common.error + body.error, "error");
    }
    router.refresh();
  }

  const forceOpen = q.length > 0;
  const activeChips: { label: string; clear: () => void }[] = [];
  for (const id of searchFilters) {
    const s = searches?.find((x) => x.id === id);
    activeChips.push({
      label: L.searchFilterPrefix + (s?.query ?? "…"),
      clear: () => setSearchFilters((prev) => { const next = new Set(prev); next.delete(id); return next; }),
    });
  }
  if (onlyEmail) activeChips.push({ label: L.onlyWithEmail, clear: () => setOnlyEmail(false) });
  if (onlyPhone) activeChips.push({ label: L.onlyWithPhone, clear: () => setOnlyPhone(false) });
  if (onlyFinding) activeChips.push({ label: L.onlyWithFinding, clear: () => setOnlyFinding(false) });
  if (statusFilter) {
    activeChips.push({ label: L.statusLabels[statusFilter], clear: () => setStatusFilter("") });
  }
  if (emailTypeFilter) {
    activeChips.push({
      label: emailTypeFilter === "personal" ? L.emailTypePersonal : L.emailTypeGeneric,
      clear: () => setEmailTypeFilter(""),
    });
  }
  if (q) activeChips.push({ label: '"' + q + '"', clear: () => setQ("") });

  return (
    <>
      <section className="overflow-hidden rounded-lg border border-edge/60 bg-panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-edge/60 px-4 py-3">
          <div className="relative min-w-52 flex-1">
            <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L.searchPlaceholder}
              className="w-full rounded-lg border border-edge2 bg-field py-2.5 pl-9 pr-3 text-sm text-ink placeholder-mute outline-none transition-colors focus:border-sky-500"
            />
          </div>
          {searches && searches.length > 0 && (
            <SearchMultiSelect
              searches={searches}
              selected={searchFilters}
              onChange={setSearchFilters}
              allLabel={L.allSearches}
            />
          )}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-edge2 bg-field px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-sky-500"
          >
            <option value="">{L.allStatuses}</option>
            {OUTREACH_STAGES.map((s) => (
              <option key={s} value={s}>{L.statusLabels[s]}</option>
            ))}
          </select>
          <select
            value={emailTypeFilter}
            onChange={(e) => setEmailTypeFilter(e.target.value)}
            className="rounded-lg border border-edge2 bg-field px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-sky-500"
          >
            <option value="">{L.allEmailTypes}</option>
            <option value="personal">{L.emailTypePersonal}</option>
            <option value="generic">{L.emailTypeGeneric}</option>
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-soft" title={L.selectAllTitle}>
            <input
              type="checkbox"
              checked={allFilteredSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected;
              }}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded accent-sky-500"
            />
            {L.selectAll}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-soft">
            <input
              type="checkbox"
              checked={onlyEmail}
              onChange={(e) => setOnlyEmail(e.target.checked)}
              className="h-4 w-4 rounded accent-sky-500"
            />
            {L.onlyWithEmail}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-soft" title={L.onlyWithPhoneTitle}>
            <input
              type="checkbox"
              checked={onlyPhone}
              onChange={(e) => setOnlyPhone(e.target.checked)}
              className="h-4 w-4 rounded accent-sky-500"
            />
            {L.onlyWithPhone}
          </label>
          <label
            className="flex cursor-pointer items-center gap-2 text-sm text-soft"
            title={L.onlyWithFindingTitle}
          >
            <input
              type="checkbox"
              checked={onlyFinding}
              onChange={(e) => setOnlyFinding(e.target.checked)}
              className="h-4 w-4 rounded accent-sky-500"
            />
            {L.onlyWithFinding}
          </label>
          <label
            className="flex cursor-pointer items-center gap-2 text-sm text-soft"
            title={L.excludeInvalidExportTitle}
          >
            <input
              type="checkbox"
              checked={excludeInvalid}
              onChange={(e) => setExcludeInvalid(e.target.checked)}
              className="h-4 w-4 rounded accent-sky-500"
            />
            {L.excludeInvalidExport}
          </label>
          <button
            onClick={() => verifyEmails(filtered)}
            disabled={unverifiedCount === 0}
            title={L.verifyEmailsTitle}
            className="rounded-lg border border-edge2 px-4 py-2 text-sm font-medium text-soft transition-colors hover:border-edge3 hover:text-ink disabled:opacity-40"
          >
            {L.verifyEmails}{unverifiedCount > 0 ? ` (${unverifiedCount})` : ""}
          </button>
          <div className="relative" ref={colsRef}>
            <button
              onClick={() => setColsOpen(!colsOpen)}
              className="rounded-lg border border-edge2 px-4 py-2 text-sm font-medium text-soft transition-colors hover:border-edge3 hover:text-ink"
            >
              {L.columns}
            </button>
            {colsOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-edge/60 bg-panel p-2 shadow-2xl">
                {ALL_COLUMNS.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-soft hover:bg-wash">
                    <input
                      type="checkbox"
                      checked={cols.has(c.id)}
                      onChange={() => toggleCol(c.id)}
                      className="h-3.5 w-3.5 rounded accent-sky-500"
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <span className="text-xs text-faint">
            {L.countSummary(filtered.length, shownContacts, totalContacts)}
          </span>
          {verifyStatus && <span className="text-xs text-faint">{verifyStatus}</span>}
          <button
            onClick={() => download(toInstantlyCsv(withoutInvalidEmails(filtered, excludeInvalid)), "-instantly.csv")}
            disabled={shownContacts === 0}
            title={L.exportInstantlyTitle}
            className="rounded-lg bg-gradient-to-r from-sky-600 to-sky-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-sky-600/25 transition-all hover:shadow-xl hover:shadow-sky-600/35 hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            {L.exportInstantly}
          </button>
          <button
            onClick={() => download(toCsv(withoutInvalidEmails(filtered, excludeInvalid), L.csvHeaders), ".csv")}
            disabled={shownContacts === 0}
            className="rounded-lg border border-edge2 px-4 py-2 text-sm font-medium text-soft transition-colors hover:border-edge3 hover:text-ink disabled:opacity-40"
          >
            {L.exportExcel}
          </button>
        </div>

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-edge/60 bg-wash/50 px-4 py-2">
            {activeChips.map((chip) => (
              <button
                key={chip.label}
                onClick={chip.clear}
                className="group flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs text-sky-600 transition-colors hover:border-sky-500/60 dark:text-sky-300"
              >
                {chip.label}
                <span className="text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-200">×</span>
              </button>
            ))}
          </div>
        )}

        <div className="divide-y divide-edge/60">
          {filtered.map((g) => {
            const isOpen = forceOpen || open.has(g.key);
            const withEmail = g.contacts.filter((c) => c.email).length;
            return (
              <div key={g.key}>
                {/* flex-wrap und gap-y: am Live-Stand bei 390 Pixeln
                    nachgemessen (2026-08-31) standen von den Firmennamen noch
                    "Vang…", "Ignit…", "Mal…" da -- rund vier Zeichen. Schuld
                    war nicht der Name, sondern die Zaehlung am Zeilenende:
                    "1 contact · 1 with email" ist shrink-0 und nahm sich ihre
                    150 Pixel zuerst, die Website daneben noch einmal 40. Uebrig
                    blieb fuer die einzige Angabe, an der man eine Zeile
                    wiedererkennt, weniger als fuer ihre beiden Beilagen.

                    Jetzt faellt die Zaehlung auf dem Handy in eine zweite
                    Zeile, eingerueckt bis unter den Namen. Ab sm steht wieder
                    alles nebeneinander. */}
                <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-all duration-150 hover:z-10 hover:bg-wash hover:shadow-[0_1px_0_0_var(--c-edge2)]">
                  <input
                    type="checkbox"
                    checked={selected.has(g.key)}
                    onChange={() => toggleSelect(g.key)}
                    className="h-4 w-4 shrink-0 rounded accent-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => toggle(g.key)}
                    className={"shrink-0 cursor-pointer text-faint transition-transform " + (isOpen ? "rotate-90" : "")}
                  >
                    ▸
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawer(g)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                  >
                    <CompanyLogo name={g.name} website={g.website} size={22} />
                    <span className="flex min-w-0 items-center gap-2">
                      {/* flex-1 mit Untergrenze: der Name nimmt sich, was da
                          ist, faellt aber nie unter 7rem. Ohne die Untergrenze
                          gewinnt jedes shrink-0 daneben gegen ihn, und genau
                          das war der Fehler. */}
                      <span className="min-w-[7rem] flex-1 truncate font-medium text-ink underline-offset-4 hover:underline">
                        {g.name}
                      </span>
                      {/* Erst ab sm. Zwei truncate-Elemente in einem Flex
                          teilen sich den Platz, statt dass eines Vorrang
                          bekommt -- auf dem Handy hiess das: halber Name,
                          halbe Adresse, beides unlesbar. Die Adresse steht
                          ohnehin im Drawer, den ein Tipp auf den Namen
                          oeffnet. */}
                      {g.website && (
                        <span className="hidden truncate text-xs text-faint md:inline">
                          {g.website.replace(/^https?:\/\//, "")}
                        </span>
                      )}
                      {/* Popularitaetsrang, wo einer bekannt ist. Bewusst NUR
                          dort: eine Plakette "—" an jeder zweiten Zeile waere
                          Rauschen, und ein fehlender Rang heisst "unbekannt",
                          nicht "unbedeutend" (siehe Migration 0079). */}
                      {g.traffic_rank !== null && (
                        <span
                          title={L.trafficRankTitle(g.traffic_rank_source ?? "")}
                          className="shrink-0 rounded-full border border-edge2 bg-chip px-1.5 py-0.5 text-[10px] tabular-nums text-mute"
                        >
                          {L.trafficRankBadge(g.traffic_rank)}
                        </span>
                      )}
                      {/* Der Aufhaenger, sofern es einen gibt. Innerhalb des
                          Knopfes und nicht daneben: ein Klick darauf oeffnet
                          den Drawer, in dem der volle Befund steht. */}
                      <AuditPill g={g} t={L} />
                    </span>
                  </button>
                  {/* Zu welcher Lead-Liste gehoert dieser Treffer?
                      Auf "Alle Leads" laufen alle Listen zusammen — wer dort
                      jemanden findet, sieht sonst nicht, woher er stammt, und
                      muss die Listen einzeln durchsehen. Nur hier sichtbar:
                      auf der Detailseite einer Suche waere die Antwort die
                      Ueberschrift. Als eigener Link neben dem Knopf, nicht
                      darin — ein <a> in einem <button> ist ungueltig. */}
                  {listeVon(g.search_id) && (
                    <Link
                      href={"/searches/" + g.search_id}
                      onClick={(e) => e.stopPropagation()}
                      title={L.fromListTitle}
                      className="hidden max-w-40 shrink-0 truncate rounded-full border border-edge2 bg-chip px-2 py-0.5 text-[10px] text-mute transition-colors hover:border-edge3 hover:text-ink xl:block"
                    >
                      {listeVon(g.search_id)}
                    </Link>
                  )}
                  {/* pl-[52px] ruecken sie unter den Namen statt unter das
                      Kaestchen: Kaestchen (16) plus Abstand (12) plus Pfeil (8)
                      plus Abstand (12) sind die 48 Pixel, um die der Name
                      selbst eingerueckt ist. */}
                  <span className="w-full shrink-0 pl-[52px] text-xs text-faint lg:w-auto lg:pl-0">
                    {g.contacts.length} {g.contacts.length === 1 ? L.contactSingular : L.contactPlural}
                    {" · "}
                    <span className={withEmail > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}>
                      {withEmail} {L.withEmail}
                    </span>
                  </span>
                </div>

                {isOpen && (
                  <div className="border-t border-edge/60 bg-surface/60 px-4 pb-4 pt-3">
                    {g.company_summary && (
                      <p className="mb-2 max-w-3xl text-xs leading-relaxed text-faint">
                        {g.company_summary}
                      </p>
                    )}
                    {g.personalization && (
                      <p className="mb-3 max-w-3xl border-l-2 border-sky-500/40 pl-3 text-xs italic leading-relaxed text-soft">
                        {g.personalization}
                      </p>
                    )}
                    {/* Bis zu sechs Spalten, darunter eine E-Mail-Adresse und
                        eine Statusauswahl. Auf einem 343er Bildschirm bleiben
                        je Spalte rund 55 Pixel: die Adresse steht dann auf vier
                        Zeilen, die Auswahl ist ein Streifen, und weil die
                        Tabelle in keinem scrollenden Container sitzt, drueckt
                        sie stattdessen die ganze Seite waagerecht auf. Ab sm
                        die Tabelle, darunter eine Karte je Person. */}
                    <table className="hidden w-full text-sm sm:table">
                      <thead>
                        <tr className="text-left text-xs text-mute">
                          <th className="py-1.5 pr-4 font-medium">{L.tableHeaders.person}</th>
                          {cols.has("title") && <th className="py-1.5 pr-4 font-medium">{L.tableHeaders.title}</th>}
                          {cols.has("email") && <th className="py-1.5 pr-4 font-medium">{L.tableHeaders.email}</th>}
                          {cols.has("phone") && <th className="py-1.5 pr-4 font-medium">{L.tableHeaders.phone}</th>}
                          {cols.has("sources") && <th className="py-1.5 pr-4 font-medium">{L.tableHeaders.sources}</th>}
                          {cols.has("status") && <th className="py-1.5 font-medium">{L.tableHeaders.status}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {g.contacts.map((c) => (
                          <tr key={c.id} className="border-t border-edge/60">
                            <td className="py-2 pr-4 text-ink">
                              {c.linkedin ? (
                                <a href={c.linkedin} target="_blank"
                                  className="underline-offset-4 hover:text-sky-600 hover:underline dark:hover:text-sky-300">
                                  {c.full_name ?? "—"}
                                </a>
                              ) : (
                                c.full_name ?? "—"
                              )}
                            </td>
                            {cols.has("title") && <td className="py-2 pr-4 text-faint">{c.title ?? "—"}</td>}
                            {cols.has("email") && (
                              <td className="py-2 pr-4">
                                {c.email ? (
                                  <span className="flex items-center gap-1.5 text-ink">
                                    <VerificationShield c={c} t={L} />
                                    {c.email}
                                    <EmailTypeBadge c={c} t={L} />
                                  </span>
                                ) : (
                                  <span className="text-mute">—</span>
                                )}
                              </td>
                            )}
                            {cols.has("phone") && (
                              <td className="py-2 pr-4 text-soft">
                                {c.phone ?? <span className="text-mute">—</span>}
                              </td>
                            )}
                            {cols.has("sources") && (
                              <td className="py-2 pr-4">
                                <span className="flex gap-1">
                                  {c.sources.map((s) => (
                                    <span
                                      key={s}
                                      className={
                                        "rounded-full border px-2 py-0.5 text-[11px] " + contactSourceBadgeClass(s)
                                      }
                                    >
                                      {t.common.sourceLabels[s] ?? s}
                                    </span>
                                  ))}
                                </span>
                              </td>
                            )}
                            {cols.has("status") && (
                              <td className="py-2">
                                <StatusSelect
                                  value={c.outreach_status}
                                  onChange={(v) => updateStatus(c.id, v)}
                                  labels={L.statusLabels}
                                />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Dieselben Kontakte als Karten. Die Reihenfolge folgt der
                        Tabelle: wer ist es, was macht er, wie erreicht man ihn,
                        woher kommt er, wo steht er. Die Spaltenwahl oben
                        (cols) gilt hier genauso -- wer Telefon ausgeblendet
                        hat, hat es auch auf dem Handy ausgeblendet. */}
                    <div className="space-y-2 sm:hidden">
                      {g.contacts.map((c) => (
                        <div key={c.id} className="rounded-lg border border-edge/60 bg-panel p-3">
                          <p className="text-sm font-medium text-ink">
                            {c.linkedin ? (
                              <a
                                href={c.linkedin}
                                target="_blank"
                                className="underline-offset-4 hover:text-sky-600 hover:underline dark:hover:text-sky-300"
                              >
                                {c.full_name ?? "—"}
                              </a>
                            ) : (
                              (c.full_name ?? "—")
                            )}
                          </p>
                          {cols.has("title") && c.title && (
                            <p className="mt-0.5 text-xs text-faint">{c.title}</p>
                          )}
                          {cols.has("email") && (
                            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink [overflow-wrap:anywhere]">
                              {c.email ? (
                                <>
                                  <VerificationShield c={c} t={L} />
                                  {c.email}
                                  <EmailTypeBadge c={c} t={L} />
                                </>
                              ) : (
                                <span className="text-mute">{L.tableHeaders.email}: —</span>
                              )}
                            </p>
                          )}
                          {cols.has("phone") && c.phone && (
                            <p className="mt-1 text-xs text-soft">{c.phone}</p>
                          )}
                          {cols.has("sources") && c.sources.length > 0 && (
                            <p className="mt-2 flex flex-wrap gap-1">
                              {c.sources.map((src) => (
                                <span
                                  key={src}
                                  className={
                                    "rounded-full border px-2 py-0.5 text-[11px] " + contactSourceBadgeClass(src)
                                  }
                                >
                                  {t.common.sourceLabels[src] ?? src}
                                </span>
                              ))}
                            </p>
                          )}
                          {cols.has("status") && (
                            <div className="mt-2">
                              <StatusSelect
                                value={c.outreach_status}
                                onChange={(v) => updateStatus(c.id, v)}
                                labels={L.statusLabels}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-4 py-10 text-center text-faint">{L.noLeadsFound}</p>
          )}
        </div>
      </section>

      {/* Bulk-Action-Leiste */}
      {selected.size > 0 && (
        /* Auf dem Handy an beiden Raendern verankert statt mittig zentriert.

           Die Leiste enthaelt eine Zaehlung und vier Knoepfe in einer Reihe
           ohne Umbruch: zusammen rund 700 Pixel. Zentriert ueber einem 375er
           Bildschirm hiess das, dass sie links UND rechts hinauslief -- vom
           Text war die Mitte zu sehen, der erste und der letzte Knopf gar
           nicht. Ausgerechnet "Auswahl aufheben" stand ganz rechts, also der
           Ausweg aus einem Zustand, den man nur noch durch Neuladen verliess.

           bottom mit safe-area: sonst liegt die unterste Knopfreihe unter dem
           Wischbalken des iPhones, und jeder Tipp darauf schickt einen auf den
           Startbildschirm. */
        <div className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 md:inset-x-auto md:bottom-6 md:left-[calc(50%+7.5rem)] md:-translate-x-1/2">
          <div className="fade-up flex flex-wrap items-center gap-2 rounded-lg border border-edge/60 bg-panel px-3 py-3 shadow-2xl sm:gap-3 sm:px-4">
            <span className="w-full text-sm text-ink sm:w-auto">
              <span className="font-semibold">{selectedGroups.length}</span> {L.bulkCompanies} ·{" "}
              {selectedContacts} {L.bulkContacts}
            </span>
            <button
              onClick={() => download(toInstantlyCsv(withoutInvalidEmails(selectedGroups, excludeInvalid)), "-auswahl-instantly.csv")}
              className="min-w-0 flex-1 rounded-lg bg-gradient-to-r from-sky-600 to-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:brightness-110 active:scale-[0.98] sm:flex-none sm:py-2"
            >
              {L.bulkExportInstantly}
            </button>
            <button
              onClick={() => download(toCsv(withoutInvalidEmails(selectedGroups, excludeInvalid), L.csvHeaders), "-auswahl.csv")}
              className="min-w-0 flex-1 rounded-lg border border-edge2 px-4 py-2.5 text-sm text-soft transition-colors hover:border-edge3 hover:text-ink sm:flex-none sm:py-2"
            >
              {L.bulkExportExcel}
            </button>
            <button
              onClick={blockSelected}
              disabled={bulkAction !== ""}
              className="min-w-0 flex-1 rounded-lg border border-red-300 px-4 py-2.5 text-sm text-red-600 transition-colors hover:border-red-500 disabled:opacity-40 sm:flex-none sm:py-2 dark:border-red-900/60 dark:text-red-400"
            >
              {bulkAction === "block" ? L.bulkBlocking : L.bulkBlock}
            </button>
            <button
              onClick={deleteSelected}
              disabled={bulkAction !== ""}
              className="min-w-0 flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40 sm:flex-none sm:py-2"
            >
              {bulkAction === "delete" ? L.bulkDeleting : L.bulkDelete}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="w-full py-1 text-xs text-faint hover:text-ink sm:w-auto sm:py-0"
            >
              {L.deselect}
            </button>
          </div>
        </div>
      )}

      {/* Lead-Detail-Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setDrawer(null)}
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-edge/60 bg-panel p-6 shadow-2xl [animation:fadeUp_.25s_ease]">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <CompanyLogo name={drawer.name} website={drawer.website} size={32} />
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-ink">{drawer.name}</h2>
                  {drawer.website && (
                    <a href={drawer.website} target="_blank"
                      className="text-xs text-sky-600 underline-offset-4 hover:underline dark:text-sky-300">
                      {drawer.website.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                  {listeVon(drawer.search_id) && (
                    <p className="mt-0.5 text-[11px] text-mute">
                      {L.fromList}{" "}
                      <Link
                        href={"/searches/" + drawer.search_id}
                        className="text-soft underline decoration-dotted underline-offset-2 hover:text-ink"
                      >
                        {listeVon(drawer.search_id)}
                      </Link>
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setDrawer(null)}
                className="rounded-lg border border-edge/60 px-2.5 py-1 text-sm text-faint transition-colors hover:border-edge2 hover:text-ink"
              >
                ✕
              </button>
            </div>

            {(drawer.address || drawer.phone_national) && (
              <div className="mb-5 space-y-1 rounded-lg border border-edge/60 bg-surface/60 p-3 text-xs text-soft">
                {drawer.address && <p>{drawer.address}</p>}
                {drawer.phone_national && <p>{drawer.phone_national}</p>}
              </div>
            )}

            {drawer.company_summary && (
              <>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">
                  {L.companySummaryHeading}
                </p>
                <p className="mb-5 rounded-lg border border-edge/60 bg-surface/60 p-3 text-sm leading-relaxed text-soft">
                  {drawer.company_summary}
                </p>
              </>
            )}

            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">
              {L.pipeline}
            </p>
            <div className="mb-5">
              <PipelineStep label={L.pipelineFound} state="done" detail={drawer.website ? L.pipelineFoundWebsite : L.pipelineFoundNoWebsite} />
              <PipelineStep
                label={L.pipelineDecisionmaker}
                state={statusToState(drawer.decisionmaker_status)}
                detail={drawer.decisionmaker_status === "found" ? L.pipelineDecisionmakerFound : drawer.decisionmaker_status === "not_found" ? L.pipelineDecisionmakerNotFound : undefined}
              />
              {/* Bei Apollo laeuft Hunter bewusst nie: Apollo liefert die
                  Adresse bereits verifiziert mit, ein Hunter-Aufruf waere
                  bezahlte Doppelarbeit. Der Worker setzt dafuer
                  hunter_status='not_found' — ohne Sonderfall stuende hier
                  "Keine Datenbank-Treffer" mit gelbem Punkt, als haette Hunter
                  gesucht und versagt. Das liess einen guten Lead schlechter
                  aussehen als er ist. */}
              {(() => {
                if (drawer.contacts.some((c) => c.sources.includes("apollo"))) {
                  return (
                    <PipelineStep
                      label={L.pipelineEmailVerification}
                      state="done"
                      detail={L.pipelineVerifiedByApollo}
                    />
                  );
                }
                // Seit jeder Suchweg genau eine Adressquelle hat, laeuft Hunter
                // im Umkreis-Modus gar nicht mehr; dort kommt die Adresse aus
                // der KI-Recherche, die als eigener Schritt darueber steht.
                // hunter_status bleibt deshalb dauerhaft "pending". Diesen
                // Schritt trotzdem anzuzeigen waere ein Versprechen auf etwas,
                // das nie kommt, also entfaellt er ganz.
                const hunterRan = Boolean(drawer.hunter_status) && drawer.hunter_status !== "pending";
                const hunterFoundContact = drawer.contacts.some((c) => c.sources.includes("hunter"));
                if (!hunterRan && !hunterFoundContact) return null;
                return (
                  <PipelineStep
                    label={L.pipelineHunter}
                    state={drawer.website ? statusToState(drawer.hunter_status) : "empty"}
                    detail={!drawer.website ? L.pipelineHunterSkipped : drawer.hunter_status === "not_found" ? L.pipelineHunterNotFound : undefined}
                  />
                );
              })()}
              {/* "active" statt "pending", solange eine Website da ist und
                  der Aufhaenger fehlt: Der Schritt IST dann in Arbeit — der
                  Job dafuer wird beim Anlegen der Firma mit eingereiht. Der
                  graue Punkt ohne Zeile darunter sah dagegen aus wie "wird
                  nicht gemacht", und genau so hat ein Kunde ihn am
                  2026-08-09 gelesen. Die Seite laedt sich dazu alle fuenf
                  Sekunden nach (siehe searches/[id]/page.tsx), der Zustand
                  loest sich also vor seinen Augen auf. */}
              <PipelineStep
                label={L.pipelinePersonalize}
                state={drawer.personalization ? "done" : drawer.website ? "active" : "empty"}
                detail={
                  drawer.personalization ? L.pipelinePersonalizeDone : drawer.website ? L.pipelinePersonalizeRunning : undefined
                }
              />
            </div>

            {/* Befund und Aufhaenger untereinander: das eine ist das Material
                des anderen. Diese Nachbarschaft ist der Zweck, nicht die
                Reihenfolge im Datensatz. */}
            <WebsiteAuditPanel g={drawer} t={L} lang={lang} />

            {drawer.personalization && (
              <>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">
                  {L.personalizationHeading}
                </p>
                <p className="mb-5 rounded-lg border-l-2 border-sky-500/50 bg-sky-500/5 p-3 text-sm italic leading-relaxed text-soft">
                  {drawer.personalization}
                </p>
              </>
            )}

            {/* Der Satz fuer {{websiteFinding}} in Mail 1 (Migration 0103),
                bislang nirgends in diesem Drawer zu sehen, obwohl die
                Variable in Instantly laengst gefuellt wird. Eigene Farbe statt
                sky wie bei personalization: es ist ein zweites, unabhaengiges
                Textfeld, keine Fortsetzung des Aufhaengers darueber. */}
            {drawer.website_finding && (
              <>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">
                  {L.websiteFindingHeading}
                </p>
                {/* whitespace-pre-line, anders als beim Aufhaenger darueber:
                    der Aufhaenger ist EIN Satz, der Befund sind mehrere
                    Absaetze (ein Mangel je Absatz, getrennt durch eine
                    Leerzeile). Ohne diese Klasse faltet der Browser die
                    Umbrueche weg und drei Mangel stehen als eine Textwand da --
                    genau so, wie sie in der Mail NICHT ankommen. */}
                <p className="mb-5 whitespace-pre-line rounded-lg border-l-2 border-violet-500/50 bg-violet-500/5 p-3 text-sm italic leading-relaxed text-soft">
                  {drawer.website_finding}
                </p>
              </>
            )}

            {/* Deals und vollstaendiger Verlauf. Ersetzt die frueher hier
                eingebaute Antwortliste: die Timeline zeigt dieselben E-Mails
                plus Notizen, Aktivitaeten und Status-Bewegungen. Beantwortet
                werden E-Mails in der Inbox (/inbox), wo der Thread-Kontext ist. */}
            {drawer.business_id && (
              <>
                <DealsPanel businessId={drawer.business_id} className="mb-5" />
                <ContactTimeline businessId={drawer.business_id} className="mb-5" />
              </>
            )}

            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">
              {L.contactsHeading(drawer.contacts.length)}
            </p>
            <div className="space-y-2">
              {(() => {
                // Bei mehreren Kontakten derselben Firma schreibt eine Kampagne
                // nur die ranghoechste Person an (siehe lib/contacts.ts,
                // dieselbe Funktion wie beim Kampagnen-Start): hier dieselbe
                // Logik angewendet, damit die Anzeige garantiert zum
                // tatsaechlichen Versandverhalten passt statt nur zu vermuten.
                // primaryOverrides ueberschreibt is_primary lokal-optimistisch:
                // drawer selbst ist eine beim Oeffnen eingefrorene Momentaufnahme
                // (setDrawer(g)), reagiert also nicht von selbst auf spaetere
                // Aenderungen; ohne diesen Merge wuerde ein Klick auf "Diesen
                // kontaktieren" erst nach Schliessen/erneutem Oeffnen sichtbar.
                const resolvedContacts = drawer.contacts.map((c) =>
                  drawer.business_id && primaryOverrides[drawer.business_id]
                    ? { ...c, is_primary: c.id === primaryOverrides[drawer.business_id] }
                    : c
                );
                const primaryId =
                  resolvedContacts.length > 1
                    ? pickPrimaryContactPerBusiness(
                        resolvedContacts.map((c) => ({ ...c, business_id: drawer.business_id }))
                      )[0]?.id
                    : undefined;
                return resolvedContacts.map((c) => (
                <div key={c.id} className="rounded-lg border border-edge/60 bg-surface/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{c.full_name ?? "—"}</p>
                    <span className="flex items-center gap-1.5">
                      {resolvedContacts.length > 1 &&
                        (c.id === primaryId ? (
                          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
                            {L.primaryContactBadge}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => drawer.business_id && setPrimaryContact(drawer.business_id, c.id)}
                            className="rounded-full border border-edge2 px-1.5 py-0.5 text-[10px] text-faint transition-colors hover:border-sky-500/50 hover:text-sky-600 dark:hover:text-sky-400"
                          >
                            {L.makePrimaryContact}
                          </button>
                        ))}
                      {c.sources.map((s) => (
                        <span
                          key={s}
                          className={"rounded-full border px-1.5 py-0.5 text-[10px] " + contactSourceBadgeClass(s)}
                        >
                          {t.common.sourceLabels[s] ?? s}
                        </span>
                      ))}
                      <StatusSelect
                        value={c.outreach_status}
                        onChange={(v) => updateStatus(c.id, v)}
                        labels={L.statusLabels}
                      />
                    </span>
                  </div>
                  {c.title && <p className="text-xs text-faint">{c.title}</p>}
                  <div className="mt-1.5 space-y-0.5 text-xs text-soft">
                    {c.email && (
                      <p className="flex items-center gap-1.5">
                        <VerificationShield c={c} t={L} /> {c.email}
                        <EmailTypeBadge c={c} t={L} />
                      </p>
                    )}
                    {c.phone && <p>{c.phone}</p>}
                    {c.linkedin && (
                      <a href={c.linkedin} target="_blank"
                        className="text-sky-600 underline-offset-4 hover:underline dark:text-sky-300">
                        {L.linkedinProfile}
                      </a>
                    )}
                  </div>
                </div>
                ));
              })()}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
