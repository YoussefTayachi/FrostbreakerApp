"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IconLock } from "../../icons";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";
import { inputCls, primaryBtnCls, dangerBtnCls, cardCls } from "@/lib/ui";

/**
 * Instantly-API-Key — fruehe stand das mit unter Einstellungen bei den
 * anderen BYOK-Providern (Google Maps/OpenAI/Hunter/NeverBounce), jetzt hier
 * unter dem eigenen Instantly-Bereich, weil alles rund um Versand hier
 * zusammengehoert und nicht mehr in den generischen Einstellungen versteckt
 * sein soll. Speichert weiterhin ueber denselben /api/keys-Endpoint wie die
 * anderen Provider — keine Backend-Aenderung noetig.
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
    <div className="fade-up max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.instantly.connection.title}</h1>
        <p className="text-sm text-faint">{t.instantly.connection.description}</p>
      </div>

      <div className={cardCls}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-medium text-ink">
            <IconLock className="h-4 w-4 text-mute" filled />
            Instantly.ai
          </h3>
          {saved && (
            <span className="flex items-center gap-2">
              {keyHint && <code className="rounded bg-panel2 px-1.5 py-0.5 font-mono text-[11px] text-mute">{keyHint}</code>}
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-600 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t.settings.saved}
              </span>
            </span>
          )}
        </div>
        <p className="mb-3 text-xs text-faint">{t.settings.providerHints.instantly}</p>
        <div className="flex gap-3">
          <input
            type="password"
            placeholder={saved ? t.settings.replaceKeyPlaceholder : t.settings.keyPlaceholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={inputCls + " flex-1"}
          />
          <button onClick={save} className={primaryBtnCls}>
            {t.settings.save}
          </button>
          {saved && (
            <button onClick={remove} disabled={removing} className={dangerBtnCls}>
              {removing ? t.settings.removing : t.common.delete}
            </button>
          )}
        </div>
        {status && (
          <p
            className={
              "mt-2 flex items-center gap-1.5 text-xs " +
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
