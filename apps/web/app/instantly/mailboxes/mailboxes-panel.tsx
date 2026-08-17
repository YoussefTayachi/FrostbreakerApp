"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { IconMail } from "../../icons";
import { parseCsvToObjects } from "@/lib/csv";
import { inputCls } from "@/lib/ui";
import { WARMUP_TARGET_DAYS, readyDate, warmupInfo } from "@/lib/instantly/warmup";
import Link from "next/link";

type Account = {
  email: string;
  provider_code: number;
  status: number;
  warmup_status: number;
  stat_warmup_score: number | null;
  daily_limit: number | null;
  /** Liefert Instantly bereits mit; bis zum 2026-08-09 wurde es nur nicht
   *  gelesen — und damit blieb die einzige Auskunft ungenutzt, aus der sich
   *  "wie lange waermt das schon auf" ableiten laesst. */
  timestamp_warmup_start?: string | null;
};

type BulkRowResult = { email: string; success: boolean; error?: string };

// Spalten, die der CSV-Bulk-Upload erkennt (Reihenfolge egal, Header
// case-insensitiv). smtp_username/smtp_password sind optional — fehlen sie,
// werden imap_username/imap_password uebernommen (typischer Fall: eine
// Mailbox, ein Login fuer IMAP und SMTP).
const CSV_TEMPLATE_HEADERS = [
  "email", "first_name", "last_name",
  "imap_host", "imap_port", "imap_username", "imap_password",
  "smtp_host", "smtp_port", "smtp_username", "smtp_password",
  "daily_limit",
];
const CSV_TEMPLATE_EXAMPLE = [
  "youssef@marketing.frostbreaker.app", "Youssef", "Tayachi",
  "imap.ionos.de", "993", "youssef@marketing.frostbreaker.app", "",
  "smtp.ionos.de", "587", "", "",
  "50",
];

const PROVIDER_LABELS: Record<number, string> = { 1: "IMAP/SMTP", 2: "Google", 3: "Microsoft", 4: "AWS" };
const STATUS_LABELS: Record<number, { label: string; cls: string }> = {
  1: { label: "Aktiv", cls: "text-emerald-600 dark:text-emerald-300" },
  2: { label: "Pausiert", cls: "text-mute" },
  "-1": { label: "Verbindungsfehler", cls: "text-red-600 dark:text-red-400" },
  "-2": { label: "Soft-Bounce-Fehler", cls: "text-amber-600 dark:text-amber-400" },
  "-3": { label: "Sende-Fehler", cls: "text-red-600 dark:text-red-400" },
} as unknown as Record<number, { label: string; cls: string }>;

/**
 * Mailbox-Verwaltung direkt in Thaw, ueber die Instantly API v2 (BYOK, siehe
 * lib/instantly.ts). Deckt Phase 1 aus instantly_native_integration_plan.md:
 * Mailboxen verbinden (Custom IMAP/SMTP direkt, Google/Microsoft per OAuth-
 * Popup gegen Instantly), auflisten, Warmup an/aus, entfernen.
 *
 * Bewusst optional: diese Sektion setzt voraus, dass oben schon ein
 * Instantly-API-Key hinterlegt ist, und ist nur fuer Kund:innen gedacht, die
 * bereits mit Instantly versenden und das nicht mehr separat aufmachen wollen.
 */
export default function InstantlyMailboxes({ hasInstantlyKey }: { hasInstantlyKey: boolean }) {
  const { t } = useT();
  const M = t.settings.mailboxes;
  const { push } = useToast();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState<null | "smtp">(null);
  const [oauthBusy, setOauthBusy] = useState<null | "google" | "microsoft">(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "", first_name: "", last_name: "",
    imap_host: "", imap_port: "993", imap_username: "", imap_password: "",
    smtp_host: "", smtp_port: "587", smtp_username: "", smtp_password: "",
    daily_limit: "50",
  });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkRowResult[] | null>(null);
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null);

  async function loadAccounts() {
    setLoading(true);
    const res = await fetch("/api/instantly/accounts");
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (res.ok) setAccounts(body.items ?? []);
    else setAccounts(null);
  }

  useEffect(() => {
    if (hasInstantlyKey) loadAccounts();
  }, [hasInstantlyKey]);

  async function createSmtpAccount() {
    if (!form.email || !form.imap_host || !form.smtp_host) return;
    setLoading(true);
    const res = await fetch("/api/instantly/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (res.ok) {
      push(M.connected, "success");
      setShowForm(null);
      setForm((f) => ({ ...f, email: "", imap_username: "", imap_password: "", smtp_username: "", smtp_password: "" }));
      loadAccounts();
    } else {
      push(t.common.error + (body.error ?? res.status), "error");
    }
  }

  function downloadCsvTemplate() {
    const csv = [CSV_TEMPLATE_HEADERS.join(","), CSV_TEMPLATE_EXAMPLE.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "instantly-mailboxen-vorlage.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleBulkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneutes Auswaehlen derselben Datei
    if (!file) return;

    const text = await file.text();
    const rows = parseCsvToObjects(text);
    if (rows.length === 0) {
      push(M.bulkEmptyFile, "error");
      return;
    }

    // smtp_username/smtp_password-Fallback auf imap_* schon clientseitig
    // aufloesen, damit die Vorschau/Fehlermeldungen konsistent mit dem sind,
    // was tatsaechlich an Instantly geschickt wird.
    const accounts = rows.map((row) => ({
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      imap_host: row.imap_host,
      imap_port: row.imap_port,
      imap_username: row.imap_username,
      imap_password: row.imap_password,
      smtp_host: row.smtp_host,
      smtp_port: row.smtp_port,
      smtp_username: row.smtp_username || row.imap_username,
      smtp_password: row.smtp_password || row.imap_password,
      daily_limit: row.daily_limit,
    }));

    setBulkBusy(true);
    setBulkResults(null);
    const res = await fetch("/api/instantly/accounts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts }),
    });
    const body = await res.json().catch(() => ({}));
    setBulkBusy(false);

    if (!res.ok) {
      push(t.common.error + (body.error ?? res.status), "error");
      return;
    }
    setBulkResults(body.results ?? []);
    if (body.succeeded > 0) {
      push(M.bulkDone(body.succeeded, body.failed ?? 0), body.failed > 0 ? "error" : "success");
      loadAccounts();
    } else {
      push(M.bulkAllFailed, "error");
    }
  }

  async function startOAuth(provider: "google" | "microsoft") {
    setOauthBusy(provider);
    const res = await fetch("/api/instantly/oauth/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setOauthBusy(null);
      push(t.common.error + (body.error ?? res.status), "error");
      return;
    }
    const authUrl = body.auth_url ?? body.authUrl ?? body.url;
    const sessionId = body.session_id ?? body.sessionId ?? body.id;
    if (!authUrl || !sessionId) {
      setOauthBusy(null);
      push(M.oauthUnexpectedResponse, "error");
      return;
    }
    const popup = window.open(authUrl, "instantly-oauth", "width=520,height=720");
    const start = Date.now();
    const poll = window.setInterval(async () => {
      if (Date.now() - start > 120000 || (popup && popup.closed)) {
        window.clearInterval(poll);
        setOauthBusy(null);
        loadAccounts();
        return;
      }
      const statusRes = await fetch(`/api/instantly/oauth/status?sessionId=${encodeURIComponent(sessionId)}`);
      const statusBody = await statusRes.json().catch(() => ({}));
      const status = statusBody.status ?? statusBody.state;
      if (status === "completed" || status === "success" || status === "done") {
        window.clearInterval(poll);
        popup?.close();
        setOauthBusy(null);
        push(M.connected, "success");
        loadAccounts();
      } else if (status === "failed" || status === "error" || status === "expired") {
        window.clearInterval(poll);
        popup?.close();
        setOauthBusy(null);
        push(M.oauthFailed, "error");
      }
    }, 2000);
  }

  async function removeAccount(email: string) {
    if (!confirm(M.deleteConfirm(email))) return;
    setBusyEmail(email);
    const res = await fetch(`/api/instantly/accounts/${encodeURIComponent(email)}`, { method: "DELETE" });
    setBusyEmail(null);
    if (res.ok) {
      push(M.removed, "success");
      loadAccounts();
    } else {
      const body = await res.json().catch(() => ({}));
      push(t.common.error + (body.error ?? res.status), "error");
    }
  }

  async function toggleWarmup(a: Account) {
    setBusyEmail(a.email);
    const action = a.warmup_status === 1 ? "disable" : "enable";
    const res = await fetch("/api/instantly/accounts/warmup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, email: a.email }),
    });
    setBusyEmail(null);
    if (res.ok) {
      push(action === "enable" ? M.warmupEnabled : M.warmupDisabled, "success");
      window.setTimeout(loadAccounts, 1500);
    } else {
      const body = await res.json().catch(() => ({}));
      push(t.common.error + (body.error ?? res.status), "error");
    }
  }

  if (!hasInstantlyKey) {
    return (
      <div className="rounded-lg border border-edge/60 bg-panel p-6">
        <h2 className="flex items-center gap-1.5 font-medium text-ink">
          <IconMail className="h-4 w-4 text-mute" />
          {M.heading}
        </h2>
        <p className="mt-2 text-sm text-faint">
          {M.needsKey}{" "}
          <Link href="/instantly/connection" className="font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400">
            {t.instantly.subnav.connection} →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-edge/60 bg-panel p-6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 font-medium text-ink">
          <IconMail className="h-4 w-4 text-mute" />
          {M.heading}
        </h2>
      </div>
      <p className="mb-4 text-sm text-faint">{M.description}</p>

      {/* Die eigentliche Frage lautet nicht "wie steht Postfach 37?", sondern
          "ab wann kann ich senden?". Bei 50 Postfaechern ist das sonst eine
          Rechenaufgabe ueber 50 Zeilen. */}
      {accounts && accounts.length > 0 && <WarmupSummary accounts={accounts} labels={M} />}

      {accounts && accounts.length > 0 && (
        <div className="mb-4 space-y-2">
          {accounts.map((a) => {
            const st = STATUS_LABELS[a.status] ?? { label: String(a.status), cls: "text-faint" };
            const w = warmupInfo(a);
            const blocked = w.state === "blocked";
            return (
              <div
                key={a.email}
                className={
                  "rounded-lg border px-3.5 py-2.5 " +
                  (blocked ? "border-red-400/70 bg-red-500/5" : "border-edge2")
                }
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{a.email}</span>
                  <span className="rounded-full border border-edge2 px-2 py-0.5 text-[11px] text-faint">
                    {PROVIDER_LABELS[a.provider_code] ?? a.provider_code}
                  </span>
                  <span className={"text-xs " + st.cls}>{st.label}</span>
                  <span className="text-xs text-faint">
                    {M.warmupScore}: {a.stat_warmup_score ?? "–"}
                  </span>
                  <button
                    onClick={() => toggleWarmup(a)}
                    disabled={busyEmail === a.email}
                    className="rounded-md border border-edge2 px-2.5 py-1 text-xs font-medium text-soft transition-colors hover:border-sky-500 hover:text-sky-600 disabled:opacity-50 dark:hover:text-sky-400"
                  >
                    {a.warmup_status === 1 ? M.pauseWarmup : M.startWarmup}
                  </button>
                  <button
                    onClick={() => removeAccount(a.email)}
                    disabled={busyEmail === a.email}
                    className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    {t.common.delete}
                  </button>
                </div>

                {/* Zweite Zeile: der Aufwaerm-Fortschritt. Bewusst unter der
                    E-Mail und nicht als weiteres Abzeichen daneben — die
                    obere Zeile trug schon fuenf Angaben, eine sechste haette
                    niemand mehr gelesen. */}
                <WarmupRow info={w} labels={M} />
              </div>
            );
          })}
        </div>
      )}
      {accounts && accounts.length === 0 && <p className="mb-4 text-sm text-faint">{M.noAccounts}</p>}
      {loading && !accounts && <p className="mb-4 text-sm text-faint">{t.common.saving}</p>}

      <div className="flex flex-wrap gap-2.5">
        <button
          onClick={() => startOAuth("google")}
          disabled={oauthBusy !== null}
          className="rounded-lg border border-edge2 px-3.5 py-2 text-sm font-medium text-soft transition-colors hover:border-sky-500 hover:text-sky-600 disabled:opacity-50 dark:hover:text-sky-400"
        >
          {oauthBusy === "google" ? M.connecting : M.connectGoogle}
        </button>
        <button
          onClick={() => startOAuth("microsoft")}
          disabled={oauthBusy !== null}
          className="rounded-lg border border-edge2 px-3.5 py-2 text-sm font-medium text-soft transition-colors hover:border-sky-500 hover:text-sky-600 disabled:opacity-50 dark:hover:text-sky-400"
        >
          {oauthBusy === "microsoft" ? M.connecting : M.connectMicrosoft}
        </button>
        <button
          onClick={() => setShowForm(showForm === "smtp" ? null : "smtp")}
          className="rounded-lg border border-edge2 px-3.5 py-2 text-sm font-medium text-soft transition-colors hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400"
        >
          {M.connectSmtp}
        </button>
        <button
          onClick={() => bulkFileInputRef.current?.click()}
          disabled={bulkBusy}
          className="rounded-lg border border-edge2 px-3.5 py-2 text-sm font-medium text-soft transition-colors hover:border-sky-500 hover:text-sky-600 disabled:opacity-50 dark:hover:text-sky-400"
        >
          {bulkBusy ? M.bulkUploading : M.bulkUpload}
        </button>
        <input ref={bulkFileInputRef} type="file" accept=".csv,text/csv" onChange={handleBulkFile} className="hidden" />
        <button
          onClick={downloadCsvTemplate}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-faint underline-offset-2 transition-colors hover:text-sky-600 hover:underline dark:hover:text-sky-400"
        >
          {M.bulkTemplate}
        </button>
      </div>

      {bulkResults && (
        <div className="mt-4 rounded-lg border border-edge2 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">{M.bulkResultsHeading}</span>
            <button onClick={() => setBulkResults(null)} className="text-xs text-faint hover:text-sky-600 dark:hover:text-sky-400">
              ×
            </button>
          </div>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {bulkResults.map((r, i) => (
              <div key={`${r.email}-${i}`} className="flex items-center gap-2 text-xs">
                <span className={r.success ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>
                  {r.success ? "✓" : "✕"}
                </span>
                <span className="min-w-0 flex-1 truncate text-soft">{r.email || M.bulkRowWithoutEmail}</span>
                {!r.success && <span className="text-faint">{r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm === "smtp" && (
        <div className="mt-4 grid gap-3 rounded-lg border border-edge2 p-4 sm:grid-cols-2">
          <input placeholder={M.emailPlaceholder} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} />
          <input placeholder={M.dailyLimitPlaceholder} type="number" value={form.daily_limit} onChange={(e) => setForm((f) => ({ ...f, daily_limit: e.target.value }))} className={inputCls} />
          <input placeholder="IMAP Host" value={form.imap_host} onChange={(e) => setForm((f) => ({ ...f, imap_host: e.target.value }))} className={inputCls} />
          <input placeholder="IMAP Port" type="number" value={form.imap_port} onChange={(e) => setForm((f) => ({ ...f, imap_port: e.target.value }))} className={inputCls} />
          <input placeholder="IMAP Username" value={form.imap_username} onChange={(e) => setForm((f) => ({ ...f, imap_username: e.target.value }))} className={inputCls} />
          <input placeholder="IMAP Passwort" type="password" value={form.imap_password} onChange={(e) => setForm((f) => ({ ...f, imap_password: e.target.value }))} className={inputCls} />
          <input placeholder="SMTP Host" value={form.smtp_host} onChange={(e) => setForm((f) => ({ ...f, smtp_host: e.target.value }))} className={inputCls} />
          <input placeholder="SMTP Port" type="number" value={form.smtp_port} onChange={(e) => setForm((f) => ({ ...f, smtp_port: e.target.value }))} className={inputCls} />
          <input placeholder="SMTP Username" value={form.smtp_username} onChange={(e) => setForm((f) => ({ ...f, smtp_username: e.target.value }))} className={inputCls} />
          <input placeholder="SMTP Passwort" type="password" value={form.smtp_password} onChange={(e) => setForm((f) => ({ ...f, smtp_password: e.target.value }))} className={inputCls} />
          <button
            onClick={createSmtpAccount}
            disabled={loading}
            className="sm:col-span-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-sky-600/25 transition-all hover:bg-sky-500 disabled:opacity-50"
          >
            {M.connectSmtp}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Der Aufwaerm-Fortschritt eines Postfachs — und im Sperrfall die Anleitung.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ZWEI DINGE, DIE VORHER UNSICHTBAR WAREN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. WIE LANGE LAEUFT DAS SCHON
 *
 * Die Empfehlung lautet ueberall im Produkt "zwei bis vier Wochen aufwaermen",
 * aber nirgends stand, wie weit ein Postfach ist. Der Nutzer musste sich das
 * Startdatum selbst merken. Jetzt steht "Tag 3 von 14" mit Balken daneben --
 * dieselbe Zahl, auf die sich die Empfehlung bezieht.
 *
 * 2. DIE SPERRE
 *
 * Instantly schaltet das Aufwaermen ab, wenn ein Postfach den gemeinsamen
 * Warmup-Pool belastet. In deren Oberflaeche ist das eine rote Flamme mit
 * Erklaerung; bei uns stand weiterhin "Aktiv" (das war der VERBINDUNGS-Status).
 *
 * Der Reaktivierungscode laesst sich nicht aus der App anfordern: Instantlys
 * API v2 kennt dafuer keinen Endpunkt — geprueft am 2026-08-09, alle
 * plausiblen Pfade antworten "Route not found". Statt eines Knopfes, der
 * nichts tut, steht hier deshalb der genaue Weg samt Direktlink. Ein
 * Bedienelement, das so tut, als koennte es etwas, waere schlimmer als keins.
 */
function WarmupRow({
  info,
  labels,
}: {
  info: ReturnType<typeof warmupInfo>;
  labels: Record<string, never> | Record<string, unknown>;
}) {
  const M = labels as {
    warmupDay: (d: number, target: number) => string;
    warmupReady: string;
    warmupPaused: string;
    warmupUnknown: string;
    warmupBlockedTitle: string;
    warmupBlockedWhy: string;
    warmupBlockedSteps: string[];
    warmupBlockedNoApi: string;
    warmupOpenInstantly: string;
    warmupCheckDns: string;
  };

  if (info.state === "blocked") {
    return (
      <div className="mt-2 rounded-lg border border-red-400/50 bg-red-500/5 px-3 py-2.5">
        <p className="text-xs font-semibold text-red-700 dark:text-red-400">{M.warmupBlockedTitle}</p>
        <p className="mt-1 text-xs leading-relaxed text-soft">{M.warmupBlockedWhy}</p>
        <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs leading-relaxed text-soft">
          {M.warmupBlockedSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <a
            href="https://app.instantly.ai/app/accounts"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500"
          >
            {M.warmupOpenInstantly}
          </a>
          <Link
            href="/instantly/deliverability"
            className="rounded-md border border-edge2 px-2.5 py-1 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink"
          >
            {M.warmupCheckDns}
          </Link>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-mute">{M.warmupBlockedNoApi}</p>
      </div>
    );
  }

  if (info.state === "paused") {
    return <p className="mt-1.5 text-[11px] text-mute">{M.warmupPaused}</p>;
  }
  if (info.state === "unknown") {
    return <p className="mt-1.5 text-[11px] text-mute">{M.warmupUnknown}</p>;
  }

  const ready = info.state === "ready";
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className={ready ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-faint"}>
          {ready ? M.warmupReady : M.warmupDay(info.days ?? 0, WARMUP_TARGET_DAYS)}
        </span>
        <span className="tabular-nums text-mute">{info.percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-chip">
        <div
          className={
            "h-full rounded-full transition-[width] " + (ready ? "bg-emerald-500" : "bg-sky-500")
          }
          style={{ width: info.percent + "%" }}
        />
      </div>
    </div>
  );
}

/**
 * Die Zusammenfassung ueber der Liste.
 *
 * Sie beantwortet die drei Fragen, die man sonst durch Scrollen beantworten
 * muesste: wie viele sind sendebereit, bei wie vielen laeuft das Aufwaermen
 * noch, und ab wann sind alle so weit. Der Sperrfall steht zuerst und rot --
 * er ist der einzige, der Handeln verlangt.
 */
function WarmupSummary({
  accounts,
  labels,
}: {
  accounts: Account[];
  labels: Record<string, unknown>;
}) {
  const M = labels as {
    warmupSummaryReady: (ready: number, total: number) => string;
    warmupSummaryWarming: (n: number) => string;
    warmupSummaryAllReadyOn: (date: string) => string;
    warmupSummaryBlocked: (n: number) => string;
  };
  const states = accounts.map((a) => warmupInfo(a).state);
  const ready = states.filter((s) => s === "ready").length;
  const warming = states.filter((s) => s === "warming").length;
  const blocked = states.filter((s) => s === "blocked").length;
  const allReadyOn = readyDate(accounts);

  return (
    <div className="mb-4 space-y-2">
      {blocked > 0 && (
        <p className="rounded-lg border border-red-400/50 bg-red-500/5 px-3.5 py-2 text-sm font-medium text-red-700 dark:text-red-400">
          {M.warmupSummaryBlocked(blocked)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-edge2 bg-chip/40 px-3.5 py-2 text-xs">
        <span className="font-medium text-ink">{M.warmupSummaryReady(ready, accounts.length)}</span>
        {warming > 0 && <span className="text-faint">{M.warmupSummaryWarming(warming)}</span>}
        {allReadyOn && (
          <span className="text-sky-600 dark:text-sky-400">
            {/* Absichtlich nur Tag und Monat, aus dem ISO-String geschnitten:
                toLocaleDateString liefert auf Server und Browser
                unterschiedliche Ergebnisse und erzeugt einen
                Hydration-Unterschied. */}
            {M.warmupSummaryAllReadyOn(
              `${allReadyOn.toISOString().slice(8, 10)}.${allReadyOn.toISOString().slice(5, 7)}.`
            )}
          </span>
        )}
      </div>
    </div>
  );
}
