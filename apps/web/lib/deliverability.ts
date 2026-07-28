import { resolveTxt } from "node:dns/promises";

// SPF/DKIM/DMARC-Check per Live-DNS-Abfrage (TXT-Records). Bewusst zustandslos
// -- nichts wird in Supabase gespeichert, jeder Aufruf fragt live bei den
// DNS-Servern des Users nach. Kein Instantly-API-Aufruf noetig: die
// Sende-Infrastruktur (IONOS, Google Workspace, M365, ...) ist bei "Custom
// IMAP/SMTP"-Mailboxen (siehe mailboxes-panel.tsx) die des Users selbst, nicht
// die von Instantly -- SPF/DKIM muessen also beim jeweiligen Provider des
// Users stimmen, nicht bei Instantly.

// Haeufigste DKIM-Selektoren der gaengigen Provider (Google, M365, IONOS,
// Mailchimp Transactional, Amazon SES, ...). Wird zusaetzlich um einen vom
// User eingegebenen Selektor ergaenzt, falls bekannt.
//
// "s1-ionos"/"s2-ionos" sind IONOS' tatsaechliche Selektor-Namen (bestaetigt
// gegen eine echte IONOS-Domain) -- nicht einfach "s1"/"ionos" einzeln, wie
// man beim Kombinieren gaengiger Kurz-Selektoren vermuten wuerde. Ohne diesen
// Eintrag meldet der Check bei jedem IONOS-Kunden faelschlich "DKIM fehlt",
// obwohl es korrekt eingerichtet ist.
const COMMON_DKIM_SELECTORS = [
  "google", "selector1", "selector2", "default", "dkim", "mail",
  "k1", "s1", "s2", "smtp", "em", "ionos", "mx", "s1-ionos", "s2-ionos",
];

function joinTxt(records: string[][]): string[] {
  return records.map((chunks) => chunks.join(""));
}

async function safeResolveTxt(hostname: string): Promise<string[][] | null> {
  try {
    return await resolveTxt(hostname);
  } catch {
    return null; // NXDOMAIN / kein Record -- kein Fehler im User-Sinn, einfach "nicht gefunden"
  }
}

export type CheckStatus = "ok" | "warning" | "missing";

export type SpfResult = { status: CheckStatus; record: string | null; issues: string[] };
export type DkimResult = {
  status: CheckStatus;
  foundSelectors: { selector: string; record: string }[];
  checkedSelectors: string[];
};
export type DmarcResult = { status: CheckStatus; record: string | null; policy: string | null; issues: string[] };

export type DeliverabilityReport = {
  domain: string;
  spf: SpfResult;
  dkim: DkimResult;
  dmarc: DmarcResult;
  checkedAt: string;
};

async function checkSpf(domain: string): Promise<SpfResult> {
  const raw = await safeResolveTxt(domain);
  if (!raw) return { status: "missing", record: null, issues: [] };

  const txts = joinTxt(raw);
  const spfRecords = txts.filter((t) => t.toLowerCase().startsWith("v=spf1"));

  if (spfRecords.length === 0) return { status: "missing", record: null, issues: [] };

  const issues: string[] = [];
  if (spfRecords.length > 1) {
    issues.push("multiple_records");
  }
  const record = spfRecords[0];
  const lower = record.toLowerCase();
  if (!lower.includes("-all") && !lower.includes("~all")) {
    issues.push("no_catch_all");
  } else if (lower.includes("?all")) {
    issues.push("neutral_catch_all");
  }

  return { status: issues.length > 0 ? "warning" : "ok", record, issues };
}

async function checkDkim(domain: string, extraSelector?: string): Promise<DkimResult> {
  const selectors = Array.from(
    new Set([...(extraSelector ? [extraSelector] : []), ...COMMON_DKIM_SELECTORS])
  );

  const results = await Promise.all(
    selectors.map(async (selector) => {
      const raw = await safeResolveTxt(`${selector}._domainkey.${domain}`);
      if (!raw) return null;
      const txts = joinTxt(raw);
      const dkimRecord = txts.find((t) => t.toLowerCase().includes("v=dkim1") || t.toLowerCase().includes("p="));
      return dkimRecord ? { selector, record: dkimRecord } : null;
    })
  );

  const foundSelectors = results.filter((r): r is { selector: string; record: string } => r !== null);
  return {
    status: foundSelectors.length > 0 ? "ok" : "missing",
    foundSelectors,
    checkedSelectors: selectors,
  };
}

async function checkDmarc(domain: string): Promise<DmarcResult> {
  const raw = await safeResolveTxt(`_dmarc.${domain}`);
  if (!raw) return { status: "missing", record: null, policy: null, issues: [] };

  const txts = joinTxt(raw);
  const dmarcRecord = txts.find((t) => t.toLowerCase().startsWith("v=dmarc1"));
  if (!dmarcRecord) return { status: "missing", record: null, policy: null, issues: [] };

  const policyMatch = dmarcRecord.match(/p=(\w+)/i);
  const policy = policyMatch ? policyMatch[1].toLowerCase() : null;

  const issues: string[] = [];
  if (policy === "none") issues.push("policy_none");

  return { status: issues.length > 0 ? "warning" : "ok", record: dmarcRecord, policy, issues };
}

/**
 * Normalisiert Domain-Eingaben: Protokoll/Pfad abschneiden und, falls jemand
 * eine komplette E-Mail-Adresse eintraegt (naheliegender Fehler, da genau das
 * Feld direkt neben den Mailbox-Adressen steht), alles bis zum "@" abschneiden.
 * Sonst wird "user@domain.tld" woertlich als Hostname abgefragt, findet nie
 * einen DNS-Record und meldet SPF/DKIM/DMARC faelschlich als "fehlt" --
 * obwohl die Domain korrekt eingerichtet sein kann.
 */
export function normalizeDomainInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^[^@\s]*@/, "");
}

export async function runDeliverabilityCheck(domain: string, dkimSelector?: string): Promise<DeliverabilityReport> {
  const cleanDomain = normalizeDomainInput(domain);
  const [spf, dkim, dmarc] = await Promise.all([
    checkSpf(cleanDomain),
    checkDkim(cleanDomain, dkimSelector),
    checkDmarc(cleanDomain),
  ]);
  return { domain: cleanDomain, spf, dkim, dmarc, checkedAt: new Date().toISOString() };
}
