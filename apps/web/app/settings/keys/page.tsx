"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { inputCls, primaryBtnCls, dangerBtnCls } from "@/lib/ui";
import { IconLock, IconSend } from "../../icons";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";
import HelpLink from "../../help-link";

/**
 * Die BYOK-Schluessel der Anreicherungs-Anbieter.
 *
 * Instantly steht bewusst NICHT hier, sondern hat seinen eigenen Bereich
 * (/instantly) mit Mailboxen und Kampagnen; die Karte unten fuehrt nur
 * dorthin. Die anderen sind reine Lookup-Schluessel ohne eigene Oberflaeche.
 */
const PROVIDER_IDS = ["google_maps", "openai", "hunter", "apollo", "prospeo", "neverbounce"] as const;

/** Anbieter mit einem kostenlosen Endpunkt, an dem sich ein Key pruefen
 *  laesst. Beide sagen ausdruecklich nur "Key gueltig"; ob der TARIF die
 *  Personensuche bzw. die einzelnen Filter freigibt, beantwortet keiner von
 *  beiden (siehe die jeweilige health-Route). */
const TESTABLE: readonly string[] = ["apollo", "prospeo"];

export default function ApiKeysPage() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const [saved, setSaved] = useState<string[]>([]);
  const [keyHints, setKeyHints] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<string | null>(null);
  // Apollo hat einen kostenlosen Health-Endpunkt: damit laesst sich ein Key
  // pruefen, ohne eine Suche zu starten und Credits zu verbrennen. Die anderen
  // Provider bieten kein Gegenstueck, deshalb bewusst nur hier.
  const [keyTest, setKeyTest] = useState<Record<string, "idle" | "testing" | "ok" | "fail">>({});

  useEffect(() => {
    createClient()
      .from("api_keys")
      .select("provider, key_hint")
      .eq("workspace_id", workspaceId)
      .then(({ data }) => {
        setSaved((data ?? []).map((r) => r.provider));
        setKeyHints(Object.fromEntries((data ?? []).map((r) => [r.provider, r.key_hint ?? ""])));
      });
  }, [workspaceId]);

  const providerLabels: Record<string, string> = {
    google_maps: "Google Maps", openai: "OpenAI", hunter: "Hunter.io", apollo: "Apollo.io",
    prospeo: "Prospeo",
    neverbounce: "NeverBounce",
  };

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

  /**
   * Key pruefen. Verallgemeinert, als Prospeo als zweiter pruefbarer Anbieter
   * dazukam; eine zweite testProspeo()-Funktion daneben waere dieselbe
   * Funktion mit einem anderen Pfad gewesen.
   *
   * Beide Routen kosten nichts: Apollo hat einen Health-Endpunkt, Prospeo
   * seine kostenlose Suggestions-API.
   */
  async function testKey(provider: string) {
    setKeyTest((s) => ({ ...s, [provider]: "testing" }));
    const label = providerLabels[provider] ?? provider;
    try {
      const res = await fetch(`/api/${provider}/health`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && body.ok === true;
      setKeyTest((s) => ({ ...s, [provider]: ok ? "ok" : "fail" }));
      push(
        ok ? t.settings.keyTestOk(label) : t.settings.keyTestFail(label),
        ok ? "success" : "error"
      );
    } catch {
      setKeyTest((s) => ({ ...s, [provider]: "fail" }));
      push(t.settings.keyTestFail(label), "error");
    }
  }

  return (
    <div className="fade-up max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.settings.apiKeysHeading}</h1>
        <p className="text-sm text-faint">
          {t.settings.apiKeysDescription}{" "}
          <HelpLink section="keys" label={t.guide.helpLink} />
        </p>
      </div>

  <div>
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
            <button onClick={() => save(p)} className={primaryBtnCls}>{t.settings.save}</button>
            {TESTABLE.includes(p) && saved.includes(p) && (
              <button
                onClick={() => testKey(p)}
                disabled={keyTest[p] === "testing"}
                title={t.settings.keyTestTitle}
                className={
                  "rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 " +
                  (keyTest[p] === "ok"
                    ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                    : keyTest[p] === "fail"
                      ? "border-red-300 text-red-600 dark:border-red-500/30 dark:text-red-400"
                      : "border-edge2 text-soft hover:border-edge3 hover:text-ink")
                }
              >
                {keyTest[p] === "testing" ? t.settings.apolloTesting : t.settings.apolloTest}
              </button>
            )}
            {saved.includes(p) && (
              <button
                onClick={() => remove(p)}
                disabled={removing === p}
                className={dangerBtnCls}
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
    </div>
  );
}
