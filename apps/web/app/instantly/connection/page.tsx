"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IconLock } from "../../icons";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";
import { inputCls, primaryBtnCls, dangerBtnCls, cardCls } from "@/lib/ui";

/**
 * Instantly-API-Key, fruehe stand das mit unter Einstellungen bei den
 * anderen BYOK-Providern (Google Maps/OpenAI/Hunter/NeverBounce), jetzt hier
 * unter dem eigenen Instantly-Bereich, weil alles rund um Versand hier
 * zusammengehoert und nicht mehr in den generischen Einstellungen versteckt
 * sein soll. Speichert weiterhin ueber denselben /api/keys-Endpoint wie die
 * anderen Provider, keine Backend-Aenderung noetig.
 */
export default function InstantlyConnectionPage() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const [saved, setSaved] = useState(false);
  const [keyHint, setKeyHint] = useState("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("api_keys")
      .select("provider, key_hint")
      .eq("workspace_id", workspaceId)
      .eq("provider", "instantly")
      .maybeSingle()
      .then(({ data }) => {
        setSaved(!!data);
        setKeyHint(data?.key_hint ?? "");
      });
  }, [workspaceId]);

  async function save() {
    if (!value) return;
    setStatus("...");
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "instantly", key: value }),
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus(t.settings.encryptedOk);
      setSaved(true);
      if (body.key_hint) setKeyHint(body.key_hint);
      setValue("");
      push("Instantly.ai: " + t.settings.encryptedOk, "success");
    } else {
      const body = await res.json().catch(() => ({}));
      const message = t.common.error + (body.error ?? res.status);
      setStatus(message);
      push(message, "error");
    }
  }

  async function remove() {
    setRemoving(true);
    const res = await fetch("/api/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "instantly" }),
    });
    setRemoving(false);
    if (res.ok) {
      setSaved(false);
      setKeyHint("");
      setStatus("");
      push("Instantly.ai: " + t.settings.removed, "success");
    } else {
      const body = await res.json().catch(() => ({}));
      push(t.common.error + (body.error ?? res.status), "error");
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.instantly.connection.title}</h1>
        <p className="mt-1 text-sm text-faint">{t.instantly.connection.description}</p>
      </div>

      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-ink">
            <IconLock className="h-4 w-4 text-mute" filled />
            Instantly.ai
          </h2>
          {saved && (
            <span className="flex items-center gap-2">
              {keyHint && <code className="rounded-md bg-chip px-1.5 py-0.5 font-mono text-2xs text-mute">{keyHint}</code>}
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {t.settings.saved}
              </span>
            </span>
          )}
        </div>
        <p className="mb-4 mt-1 text-sm text-faint">{t.settings.providerHints.instantly}</p>
        {/* Unter sm untereinander: Feld plus zwei Knoepfe nebeneinander
            ergeben auf 390 Pixel drei Spalten von je 110 Pixel, in denen
            weder der Schluessel noch die Beschriftung lesbar bleibt. */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="password"
            placeholder={saved ? t.settings.replaceKeyPlaceholder : t.settings.keyPlaceholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={inputCls + " w-full sm:flex-1"}
          />
          <div className="flex gap-3">
            <button onClick={save} className={primaryBtnCls + " flex-1 sm:flex-none"}>
              {t.settings.save}
            </button>
            {saved && (
              <button onClick={remove} disabled={removing} className={dangerBtnCls + " flex-1 sm:flex-none"}>
                {removing ? t.settings.removing : t.common.delete}
              </button>
            )}
          </div>
        </div>
        {status && (
          <p
            className={
              "mt-3 flex items-center gap-1.5 text-xs " +
              (status.includes(t.settings.encryptedOk) ? "lock-pop font-medium text-emerald-600 dark:text-emerald-400" : "text-faint")
            }
          >
            <IconLock
              className={"h-3.5 w-3.5 " + (status === "..." ? "lock-spin text-mute" : status.includes(t.settings.encryptedOk) ? "text-emerald-500" : "text-mute")}
              filled={status.includes(t.settings.encryptedOk)}
            />
            {status === "..." ? t.settings.encrypting : status}
          </p>
        )}
      </div>
    </div>
  );
}
