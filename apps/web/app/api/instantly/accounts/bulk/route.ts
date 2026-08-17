import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";

// CSV-Bulk-Upload fuer Instantly-Mailboxen (Custom IMAP/SMTP, provider_code 1).
// Instantly selbst bietet keinen eigenen Bulk-Create-Endpoint fuer /accounts,
// wir mappen die CSV-Zeilen deshalb serverseitig auf N einzelne POST-Aufrufe
// gegen den bestehenden /api/v2/accounts-Endpoint (siehe ../route.ts), mit
// begrenzter Parallelitaet, damit Instantlys Rate-Limit (6000 req/min pro
// Workspace, ueber beide API-Versionen geteilt) niemals in die Naehe kommt
// und einzelne fehlerhafte Zeilen den Rest nicht blockieren.
//
// Laenger laufende Funktion auf Vercel erlauben (Standard waere 10s / Hobby),
// bei z.B. 50 Zeilen mit ein paar Sekunden Instantly-Latenz pro Call reicht
// Default nicht.
export const maxDuration = 60;

const MAX_ROWS = 200;
const CONCURRENCY = 4;

type BulkRow = {
  email: string;
  first_name?: string;
  last_name?: string;
  imap_host: string;
  imap_port?: string | number;
  imap_username: string;
  imap_password: string;
  smtp_host: string;
  smtp_port?: string | number;
  smtp_username: string;
  smtp_password: string;
  daily_limit?: string | number;
};

type BulkResult = { email: string; success: boolean; error?: string };

function validateRow(row: unknown, index: number): { row: BulkRow } | { error: string } {
  if (!row || typeof row !== "object") return { error: `Zeile ${index + 1}: ungueltig` };
  const r = row as Record<string, unknown>;
  const email = String(r.email ?? "").trim();
  const imap_host = String(r.imap_host ?? "").trim();
  const imap_username = String(r.imap_username ?? "").trim();
  const imap_password = String(r.imap_password ?? "").trim();
  const smtp_host = String(r.smtp_host ?? "").trim();
  const smtp_username = String(r.smtp_username ?? imap_username).trim();
  const smtp_password = String(r.smtp_password ?? imap_password).trim();

  const missing: string[] = [];
  if (!email) missing.push("email");
  if (!imap_host) missing.push("imap_host");
  if (!imap_username) missing.push("imap_username");
  if (!imap_password) missing.push("imap_password");
  if (!smtp_host) missing.push("smtp_host");
  if (!smtp_username) missing.push("smtp_username");
  if (!smtp_password) missing.push("smtp_password");
  if (missing.length > 0) {
    return { error: `${email || "Zeile " + (index + 1)}: fehlende Felder (${missing.join(", ")})` };
  }

  return {
    row: {
      email,
      first_name: r.first_name ? String(r.first_name).trim() : undefined,
      last_name: r.last_name ? String(r.last_name).trim() : undefined,
      imap_host,
      imap_port: r.imap_port ? String(r.imap_port).trim() : undefined,
      imap_username,
      imap_password,
      smtp_host,
      smtp_port: r.smtp_port ? String(r.smtp_port).trim() : undefined,
      smtp_username,
      smtp_password,
      daily_limit: r.daily_limit ? String(r.daily_limit).trim() : undefined,
    },
  };
}

async function createOne(apiKey: string, row: BulkRow): Promise<BulkResult> {
  try {
    await instantlyRequest(apiKey, "/api/v2/accounts", {
      method: "POST",
      body: JSON.stringify({
        email: row.email,
        first_name: row.first_name || row.email.split("@")[0],
        last_name: row.last_name || "",
        provider_code: 1,
        imap_host: row.imap_host,
        imap_port: Number(row.imap_port) || 993,
        imap_username: row.imap_username,
        imap_password: row.imap_password,
        smtp_host: row.smtp_host,
        smtp_port: Number(row.smtp_port) || 587,
        smtp_username: row.smtp_username,
        smtp_password: row.smtp_password,
        daily_limit: row.daily_limit ? Number(row.daily_limit) : undefined,
      }),
    });
    return { email: row.email, success: true };
  } catch (e) {
    const message = e instanceof InstantlyApiError ? e.message : (e as Error).message || "Unbekannter Fehler";
    return { email: row.email, success: false, error: message };
  }
}

/** Fuehrt Tasks mit begrenzter Parallelitaet aus, Reihenfolge der Ergebnisse bleibt erhalten. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const rawRows = body?.accounts;
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return NextResponse.json({ error: "Keine Zeilen zum Importieren gefunden." }, { status: 400 });
  }
  if (rawRows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Maximal ${MAX_ROWS} Zeilen pro Upload — Datei bitte aufteilen.` },
      { status: 400 }
    );
  }

  // Index-basiert statt per E-Mail zugeordnet, damit doppelte/leere Adressen
  // in der CSV die Ergebnisreihenfolge nicht durcheinanderbringen.
  const ordered: BulkResult[] = new Array(rawRows.length);
  const validIndexes: number[] = [];
  const validRows: BulkRow[] = [];

  rawRows.forEach((raw, i) => {
    const rawEmail =
      typeof raw === "object" && raw && "email" in raw ? String((raw as Record<string, unknown>).email ?? "") : "";
    const v = validateRow(raw, i);
    if ("error" in v) {
      ordered[i] = { email: rawEmail, success: false, error: v.error };
    } else {
      validIndexes.push(i);
      validRows.push(v.row);
    }
  });

  const created = await mapLimit(validRows, CONCURRENCY, (row) => createOne(ctx.apiKey, row));
  created.forEach((result, j) => {
    ordered[validIndexes[j]] = result;
  });

  const succeeded = ordered.filter((o) => o.success).length;
  return NextResponse.json({ results: ordered, succeeded, failed: ordered.length - succeeded });
}
