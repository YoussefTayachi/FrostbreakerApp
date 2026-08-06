"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OUTREACH_STAGES, stageRank } from "@/lib/crm/stages";
import { pickPrimaryContactPerBusiness } from "@/lib/contacts";
import { contactSourceBadgeClass } from "@/lib/search-source";
import CompanyLogo from "../company-logo";
import ContactTimeline from "../crm/contact-timeline";
import DealsPanel from "../crm/deals-panel";
import StatusSelect from "../crm/status-select";
import { IconSearch } from "../icons";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import type { Dictionary } from "@/lib/i18n/dict";

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

// Spaltennamen sind Instantlys eigene Merge-Tag-Namen -- NICHT uebersetzen,
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
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
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
  // Mehrfachauswahl statt einer einzelnen Suche -- z.B. bei einem
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
  // UI-Reaktion), ohne auf einen vollen router.refresh() zu warten -- gruppiert wird
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
      .filter((g) => !onlyPhone || !!g.phone_national || g.contacts.some((c) => !!c.phone));
  }, [allGroups, q, onlyEmail, onlyPhone, searchFilters, statusFilter, emailTypeFilter]);

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
  // gewaehlten setzen -- sonst wuerde der unique Index
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
                <div className="flex w-full items-center gap-3 px-4 py-3 transition-all duration-150 hover:z-10 hover:bg-wash hover:shadow-[0_1px_0_0_var(--c-edge2)]">
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
                      <span className="truncate font-medium text-ink underline-offset-4 hover:underline">{g.name}</span>
                      {g.website && (
                        <span className="truncate text-xs text-faint">
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
                    </span>
                  </button>
                  <span className="shrink-0 text-xs text-faint">
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
                    <table className="w-full text-sm">
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
        <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 md:left-[calc(50%+7.5rem)]">
          <div className="fade-up flex items-center gap-3 rounded-lg border border-edge/60 bg-panel px-4 py-3 shadow-2xl">
            <span className="text-sm text-ink">
              <span className="font-semibold">{selectedGroups.length}</span> {L.bulkCompanies} ·{" "}
              {selectedContacts} {L.bulkContacts}
            </span>
            <button
              onClick={() => download(toInstantlyCsv(withoutInvalidEmails(selectedGroups, excludeInvalid)), "-auswahl-instantly.csv")}
              className="rounded-lg bg-gradient-to-r from-sky-600 to-sky-600 px-4 py-2 text-sm font-medium text-white transition-all hover:brightness-110 active:scale-[0.98]"
            >
              {L.bulkExportInstantly}
            </button>
            <button
              onClick={() => download(toCsv(withoutInvalidEmails(selectedGroups, excludeInvalid), L.csvHeaders), "-auswahl.csv")}
              className="rounded-lg border border-edge2 px-4 py-2 text-sm text-soft transition-colors hover:border-edge3 hover:text-ink"
            >
              {L.bulkExportExcel}
            </button>
            <button
              onClick={blockSelected}
              disabled={bulkAction !== ""}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 transition-colors hover:border-red-500 disabled:opacity-40 dark:border-red-900/60 dark:text-red-400"
            >
              {bulkAction === "block" ? L.bulkBlocking : L.bulkBlock}
            </button>
            <button
              onClick={deleteSelected}
              disabled={bulkAction !== ""}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40"
            >
              {bulkAction === "delete" ? L.bulkDeleting : L.bulkDelete}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-faint hover:text-ink"
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
                  hunter_status='not_found' -- ohne Sonderfall stuende hier
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
                // im Umkreis-Modus gar nicht mehr -- dort kommt die Adresse aus
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
              <PipelineStep
                label={L.pipelinePersonalize}
                state={drawer.personalization ? "done" : drawer.website ? "pending" : "empty"}
                detail={drawer.personalization ? L.pipelinePersonalizeDone : undefined}
              />
            </div>

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
                // dieselbe Funktion wie beim Kampagnen-Start) -- hier dieselbe
                // Logik angewendet, damit die Anzeige garantiert zum
                // tatsaechlichen Versandverhalten passt statt nur zu vermuten.
                // primaryOverrides ueberschreibt is_primary lokal-optimistisch:
                // drawer selbst ist eine beim Oeffnen eingefrorene Momentaufnahme
                // (setDrawer(g)), reagiert also nicht von selbst auf spaetere
                // Aenderungen -- ohne diesen Merge wuerde ein Klick auf "Diesen
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
