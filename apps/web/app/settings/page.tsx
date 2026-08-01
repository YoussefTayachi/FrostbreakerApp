"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { IconLock, IconSend } from "../icons";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import BillingSection from "./billing-section";

// Instantly (Mailboxen, Kampagnen, API-Key) lebt seit dem eigenen /instantly-
// Bereich nicht mehr hier -- die anderen BYOK-Provider (reine Lookup-/
// Anreicherungs-Keys ohne eigene Unterseiten) bleiben in den generischen
// Einstellungen.
const PROVIDER_IDS = ["google_maps", "openai", "hunter", "apollo", "neverbounce"] as const;

const inputCls =
  "rounded-lg border border-edge2 bg-field px-3.5 py-2.5 text-sm text-ink " +
  "placeholder-mute outline-none transition-colors focus:border-sky-500";

const btnCls =
  "rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg " +
  "shadow-sky-600/25 transition-all hover:bg-sky-500 disabled:opacity-50";

export default function SettingsPage() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const [saved, setSaved] = useState<string[]>([]);
  const [keyHints, setKeyHints] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<string | null>(null);
  // Apollo hat einen kostenlosen Health-Endpunkt -- damit laesst sich ein Key
  // pruefen, ohne eine Suche zu starten und Credits zu verbrennen. Die anderen
  // Provider bieten kein Gegenstueck, deshalb bewusst nur hier.
  const [apolloTest, setApolloTest] = useState<"idle" | "testing" | "ok" | "fail">("idle");

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("api_keys")
      .select("provider, key_hint")
      .eq("workspace_id", workspaceId)
      .then(({ data }) => {
        setSaved((data ?? []).map((r) => r.provider));
        setKeyHints(Object.fromEntries((data ?? []).map((r) => [r.provider, r.key_hint ?? ""])));
      });
  }, [workspaceId]);

  const [brandName, setBrandName] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [brandSaving, setBrandSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const reportOrigin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("workspaces")
      .select("brand_name, brand_color, brand_logo_url")
      .eq("id", workspaceId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setBrandName(data.brand_name ?? "");
        setBrandColor(data.brand_color ?? "");
        setBrandLogoUrl(data.brand_logo_url ?? "");
      });
  }, [workspaceId]);

  async function saveBranding() {
    setBrandSaving(true);
    const { error } = await createClient()
      .from("workspaces")
      .update({
        brand_name: brandName.trim() || null,
        brand_color: brandColor.trim() || null,
        brand_logo_url: brandLogoUrl.trim() || null,
      })
      .eq("id", workspaceId);
    setBrandSaving(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    push(t.branding.saved, "success");
  }

  function copyReportLink() {
    navigator.clipboard.writeText(`${reportOrigin}/report/${workspaceId}`);
    setLinkCopied(true);
    push(t.branding.linkCopied, "success");
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function save(provider: string) {
    const key = values[provider];
    if (!key) return;
    setStatus((s) => ({ ...s, [provider]: "..." }));
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, key }),
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus((s) => ({ ...s, [provider]: t.settings.encryptedOk }));
      setSaved((p) => (p.includes(provider) ? p : [...p, provider]));
      if (body.key_hint) setKeyHints((h) => ({ ...h, [provider]: body.key_hint }));
      setValues((v) => ({ ...v, [provider]: "" }));
      push(providerLabels[provider] + ": " + t.settings.encryptedOk, "success");
    } else {
      const body = await res.json().catch(() => ({}));
      const message = t.common.error + (body.error ?? res.status);
      setStatus((s) => ({ ...s, [provider]: message }));
      push(message, "error");
    }
  }

  async function remove(provider: string) {
    setRemoving(provider);
    const res = await fetch("/api/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    setRemoving(null);
    if (res.ok) {
      setSaved((p) => p.filter((x) => x !== provider));
      setKeyHints((h) => {
        const next = { ...h };
        delete next[provider];
        return next;
      });
      setStatus((s) => ({ ...s, [provider]: "" }));
      push(providerLabels[provider] + ": " + t.settings.removed, "success");
    } else {
      const body = await res.json().catch(() => ({}));
      push(t.common.error + (body.error ?? res.status), "error");
    }
  }

  async function testApollo() {
    setApolloTest("testing");
    try {
      const res = await fetch("/api/apollo/health", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && body.ok === true;
      setApolloTest(ok ? "ok" : "fail");
      push(ok ? t.settings.apolloTestOk : t.settings.apolloTestFail, ok ? "success" : "error");
    } catch {
      setApolloTest("fail");
      push(t.settings.apolloTestFail, "error");
    }
  }

  const providerLabels: Record<string, string> = {
    google_maps: "Google Maps", openai: "OpenAI", hunter: "Hunter.io", apollo: "Apollo.io",
    neverbounce: "NeverBounce",
  };

  return (
    <div className="fade-up max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.settings.title}</h1>
        <p className="text-sm text-faint">{t.settings.subtitle}</p>
      </div>

      <BillingSection />

      <div>
        <h2 className="mb-1 flex items-center gap-1.5 font-medium text-ink">
          <IconLock className="h-4 w-4 text-mute" filled />
          {t.settings.apiKeysHeading}
        </h2>
        <p className="mb-4 text-sm text-faint">{t.settings.apiKeysDescription}</p>
        <div className="space-y-4">
          {PROVIDER_IDS.map((p) => (
            <div key={p} className="rounded-lg border border-edge/60 bg-panel p-6">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="font-medium text-ink">{providerLabels[p]}</h3>
                {saved.includes(p) && (
                  <span className="flex items-center gap-2">
                    {keyHints[p] && (
                      <code className="rounded bg-panel2 px-1.5 py-0.5 font-mono text-[11px] text-mute">{keyHints[p]}</code>
                    )}
                    <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-600 dark:text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {t.settings.saved}
                    </span>
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs text-faint">{t.settings.providerHints[p]}</p>
              <div className="flex gap-3">
                <input
                  type="password"
                  placeholder={saved.includes(p) ? t.settings.replaceKeyPlaceholder : t.settings.keyPlaceholder}
                  value={values[p] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
                  className={inputCls + " flex-1"}
                />
                <button onClick={() => save(p)} className={btnCls}>{t.settings.save}</button>
                {p === "apollo" && saved.includes(p) && (
                  <button
                    onClick={testApollo}
                    disabled={apolloTest === "testing"}
                    title={t.settings.apolloTestTitle}
                    className={
                      "rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 " +
                      (apolloTest === "ok"
                        ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : apolloTest === "fail"
                          ? "border-red-300 text-red-600 dark:border-red-500/30 dark:text-red-400"
                          : "border-edge2 text-soft hover:border-edge3 hover:text-ink")
                    }
                  >
                    {apolloTest === "testing" ? t.settings.apolloTesting : t.settings.apolloTest}
                  </button>
                )}
                {saved.includes(p) && (
                  <button
                    onClick={() => remove(p)}
                    disabled={removing === p}
                    className="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    {removing === p ? t.settings.removing : t.common.delete}
                  </button>
                )}
              </div>
              {status[p] && (
                <p
                  className={
                    "mt-2 flex items-center gap-1.5 text-xs " +
                    (status[p].includes(t.settings.encryptedOk)
                      ? "lock-pop font-medium text-emerald-600 dark:text-emerald-400"
                      : "text-faint")
                  }
                >
                  <IconLock
                    className={
                      "h-3.5 w-3.5 " +
                      (status[p] === "..."
                        ? "lock-spin text-mute"
                        : status[p].includes(t.settings.encryptedOk)
                        ? "text-emerald-500"
                        : "text-mute")
                    }
                    filled={status[p].includes(t.settings.encryptedOk)}
                  />
                  {status[p] === "..." ? t.settings.encrypting : status[p]}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <Link
        href="/instantly"
        className="flex items-center justify-between rounded-lg border border-edge/60 bg-panel p-6 transition-all hover:-translate-y-0.5 hover:border-sky-500/50"
      >
        <span className="flex items-center gap-3">
          <IconSend className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          <span>
            <span className="block font-medium text-ink">Instantly.ai</span>
            <span className="block text-xs text-faint">API-Key, Mailboxen und Kampagnen jetzt im eigenen Bereich verwalten</span>
          </span>
        </span>
        <span className="text-sm text-faint">→</span>
      </Link>

      <div className="rounded-lg border border-edge/60 bg-panel p-6">
        <h2 className="font-medium text-ink">{t.branding.heading}</h2>
        <p className="mb-4 mt-1 text-sm text-faint">{t.branding.description}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-faint">{t.branding.brandNameLabel}</label>
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder={t.branding.brandNamePlaceholder}
              className={inputCls + " w-full"}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-faint">{t.branding.brandColorLabel}</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#([0-9a-f]{3}){1,2}$/i.test(brandColor) ? brandColor : "#0ea5e9"}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-edge2 bg-field"
              />
              <input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#0EA5E9"
                className={inputCls + " w-full"}
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-faint">{t.branding.brandLogoLabel}</label>
            <input
              value={brandLogoUrl}
              onChange={(e) => setBrandLogoUrl(e.target.value)}
              placeholder={t.branding.brandLogoPlaceholder}
              className={inputCls + " w-full"}
            />
          </div>
        </div>
        <button onClick={saveBranding} disabled={brandSaving} className={btnCls + " mt-4"}>
          {brandSaving ? t.branding.saving : t.branding.save}
        </button>

        <div className="mt-6 border-t border-edge/60 pt-5">
          <h3 className="text-sm font-medium text-ink">{t.branding.reportLinkHeading}</h3>
          <p className="mb-3 mt-1 text-xs text-faint">{t.branding.reportLinkDescription}</p>
          <div className="flex gap-3">
            <input
              readOnly
              value={`${reportOrigin}/report/${workspaceId}`}
              onFocus={(e) => e.currentTarget.select()}
              className={inputCls + " flex-1 text-faint"}
            />
            <button
              onClick={copyReportLink}
              className="rounded-lg border border-edge2 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400"
            >
              {linkCopied ? t.branding.linkCopied : t.branding.copyLink}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-edge/60 bg-panel p-6">
        <h2 className="font-medium text-ink">{t.settings.stackHeading}</h2>
        <p className="mb-4 mt-1 text-sm text-faint">{t.settings.stackDescription}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {t.settings.integrations.map((it) => (
            <div
              key={it.name}
              className="rounded-lg border border-edge bg-surface/60 px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-edge2"
            >
              <p className="text-sm font-medium text-ink">{it.name}</p>
              <p className="text-[11px] text-faint">{it.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
