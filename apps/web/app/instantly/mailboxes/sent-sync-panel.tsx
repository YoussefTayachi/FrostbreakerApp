"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRelative } from "@/lib/format-time";
import { guessImapHost } from "@/lib/imap-host";
import { cardCls, inputCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";

/**
 * Postfaecher, deren Gesendet-Ordner Frostbreaker selbst liest.
 *
 * Steht neben der Instantly-Mailbox-Verwaltung und nicht darin, obwohl es um
 * dieselben Adressen geht: die Liste darueber kommt live aus Instantlys API
 * und beschreibt das Versenden. Das hier sind eigene Zugangsdaten in der
 * eigenen Datenbank und beschreibt das Mitlesen. In eine Liste gemischt
 * waere bei jeder Zeile unklar, wem sie gehoert.
 *
 * Warum es das ueberhaupt gibt, steht in Migration 0114 und in
 * worker/pipelines/sync_sent.py -- kurz: Instantly synchronisiert nur
 * Eingaenge, und damit fehlte im Verlauf jede Antwort, die Youssef selbst
 * ueber IONOS geschrieben hat.
 */
type Mailbox = {
  email: string;
  host: string;
  port: number;
  username: string;
  sent_folder: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

const LEER = { email: "", host: "", port: "993", username: "", password: "", sentFolder: "" };

export default function SentSyncPanel() {
  const { t, lang } = useT();
  const S = t.settings.sentSync;
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [rows, setRows] = useState<Mailbox[] | null>(null);
  const [form, setForm] = useState(LEER);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await createClient()
      .from("imap_mailboxes")
      .select("email, host, port, username, sent_folder, last_sync_at, last_error")
      .eq("workspace_id", workspaceId)
      .order("email");
    setRows(data ?? []);
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  // Der Server laesst sich aus der Adresse raten, und das Feld bleibt
  // aenderbar. Nur solange niemand selbst getippt hat: eine Vorbelegung, die
  // eine Eingabe ueberschreibt, ist keine Hilfe mehr.
  function setEmail(email: string) {
    setForm((f) => ({
      ...f,
      email,
      host: f.host && f.host !== guessImapHost(f.email) ? f.host : guessImapHost(email),
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/mailboxes/imap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, port: Number(form.port) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t.common.error);
      push(body.sentFolder ? S.connected(body.sentFolder) : S.connectedUnknown, "success");
      setForm(LEER);
      setOpen(false);
      await load();
    } catch (e) {
      push((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(email: string) {
    if (!window.confirm(S.removeConfirm)) return;
    setRemoving(email);
    try {
      const res = await fetch("/api/mailboxes/imap", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t.common.error);
      await load();
    } catch (e) {
      push((e as Error).message, "error");
    } finally {
      setRemoving(null);
    }
  }

  const kannSpeichern = form.email.includes("@") && form.host.trim() && form.password.length > 0;

  return (
    <section className={cardCls + " space-y-4"}>
      <div>
        <h2 className="text-base font-semibold text-ink">{S.heading}</h2>
        <p className="mt-1 text-sm leading-relaxed text-faint">{S.description}</p>
      </div>

      {rows === null ? (
        <div className="skeleton h-16" aria-hidden />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-edge2 px-4 py-10 text-center text-sm text-faint">
          {S.empty}
        </p>
      ) : (
        <ul className="divide-y divide-edge/70 overflow-hidden rounded-lg border border-edge/70">
          {rows.map((box) => (
            <li key={box.email} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-wash">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{box.email}</p>
                <p className="mt-0.5 truncate text-xs text-faint">
                  {box.host}
                  {box.sent_folder ? " · " + box.sent_folder : ""}
                  {" · "}
                  {box.last_sync_at ? S.lastSync(formatRelative(box.last_sync_at, lang)) : S.neverSynced}
                </p>
                {/* Der Fehler steht am Postfach und nicht in einem Protokoll:
                    ein abgelaufenes Passwort merkt sonst niemand, weil der
                    Job still weiterlaeuft und nichts mehr findet. */}
                {box.last_error && (
                  <p className="mt-1 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                    {box.last_error}
                  </p>
                )}
              </div>
              <button
                onClick={() => remove(box.email)}
                disabled={removing === box.email}
                className={secondaryBtnCls + " w-full sm:w-auto"}
              >
                {removing === box.email ? S.removing : S.remove}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <button onClick={() => setOpen(true)} className={secondaryBtnCls}>
          {S.add}
        </button>
      ) : (
        <div className="pop-in space-y-4 rounded-xl border border-edge/70 bg-panel2 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-faint">{S.emailLabel}</span>
              <input
                value={form.email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@deine-domain.de"
                className={inputCls}
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-faint">{S.hostLabel}</span>
              <input
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                placeholder="imap.ionos.de"
                className={inputCls}
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-faint">{S.portLabel}</span>
              <input
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                inputMode="numeric"
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-faint">{S.passwordLabel}</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className={inputCls}
                autoComplete="new-password"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-faint">{S.userLabel}</span>
              <input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder={form.email || "name@deine-domain.de"}
                className={inputCls}
                autoComplete="off"
              />
              <span className="text-xs text-mute">{S.userHint}</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-faint">{S.folderLabel}</span>
              <input
                value={form.sentFolder}
                onChange={(e) => setForm((f) => ({ ...f, sentFolder: e.target.value }))}
                placeholder="Sent"
                className={inputCls}
                autoComplete="off"
              />
              <span className="text-xs text-mute">{S.folderHint}</span>
            </label>
          </div>
          <p className="text-xs text-mute">{S.onlyKnownContacts}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={save} disabled={!kannSpeichern || saving} className={primaryBtnCls + " flex-1 sm:flex-none"}>
              {saving ? S.saving : S.save}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setForm(LEER);
              }}
              className={secondaryBtnCls + " flex-1 sm:flex-none"}
            >
              {S.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
