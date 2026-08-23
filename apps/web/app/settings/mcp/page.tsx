"use client";
import { useCallback, useEffect, useState } from "react";
import { cardCls, dangerBtnCls, inputCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import { formatDateTime } from "@/lib/format-time";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";

/**
 * Die Zugriffstoken fuer den MCP-Server: anlegen, ansehen, widerrufen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DER KLARTEXT EXISTIERT GENAU EINMAL
 * ═══════════════════════════════════════════════════════════════════════
 *
 * POST /api/settings/mcp-tokens liefert den Token im Klartext; gespeichert
 * sind nur Hash und Praefix (Migration 0099). Deshalb bleibt das Panel stehen,
 * bis der Mensch selbst auf "Fertig" klickt -- kein Timeout, kein Schliessen
 * durch einen Klick daneben. Wer ihn hier verliert, kann ihn nirgendwo
 * nachschlagen, auch der Support nicht; er muss dann einen neuen anlegen.
 *
 * Die Liste unten holt den Klartext nie wieder: die GET-Route gibt ihn nicht
 * heraus, weil es ihn nicht mehr gibt.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIE HERKUNFT AUS window.location.origin KOMMT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die Konfigurationszeilen sollen zum Kopieren taugen und nicht zum
 * Nacharbeiten. Ein Platzhalter <deine-domain> waere genau die Stelle, an der
 * die Einrichtung dann scheitert. origin ist immer die Adresse, unter der
 * dieser Mensch gerade eingeloggt ist -- lokal, Vorschau oder Produktion.
 */

type McpToken = {
  id: string;
  name: string;
  token_prefix: string;
  scope: "read" | "read_write";
  workspace_id: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

/** Muss zu EXPIRY_DAYS in app/api/settings/mcp-tokens/route.ts passen: die
 *  Route lehnt jede andere Zahl ab. "" ist "laeuft nicht ab" und wird als null
 *  geschickt. */
const EXPIRY_CHOICES = ["", "30", "90", "365"] as const;

function statusOf(token: McpToken): "active" | "revoked" | "expired" {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}

export default function McpPage() {
  const { t, lang } = useT();
  const { push } = useToast();
  const { workspaceId, workspaceName, workspaces } = useWorkspace();
  const T = t.settings.mcp;

  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "read_write">("read");
  // "" = alle Mitgliedschaften, sonst die id des aktiven Workspaces. Bewusst
  // keine Auswahlliste ueber alle Workspaces: die Einschraenkung meint immer
  // "dieser eine hier", und der aktive ist der, den der Mensch gerade vor sich
  // hat.
  const [limitToWorkspace, setLimitToWorkspace] = useState(false);
  const [expiry, setExpiry] = useState<(typeof EXPIRY_CHOICES)[number]>("");

  /** Der frisch erzeugte Klartext. null, solange keiner offen ist. */
  const [created, setCreated] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/mcp-tokens");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(String(body.error ?? res.status));
        setTokens([]);
      } else {
        setLoadError(null);
        setTokens((body.tokens as McpToken[]) ?? []);
      }
    } catch (e) {
      // Netzfehler sehen fuer den Menschen genauso aus wie ein Serverfehler:
      // die Liste bleibt leer. Deshalb dieselbe sichtbare Meldung statt einer
      // weissen Seite.
      setLoadError(e instanceof Error ? e.message : String(e));
      setTokens([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      push(T.copiedOk, "success");
    } catch {
      // Ohne sicheren Kontext (http auf einer fremden Adresse) gibt es keine
      // Zwischenablage. Der Text steht sichtbar daneben und laesst sich von
      // Hand markieren, deshalb hier nur der Hinweis, dass es nicht geklappt
      // hat.
      push(t.common.error + T.copyButton, "error");
    }
  }

  async function create() {
    const trimmed = name.trim();
    if (busy) return;
    if (!trimmed) {
      push(T.errNameRequired, "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          scope,
          workspace_id: limitToWorkspace ? workspaceId : null,
          expires_in_days: expiry === "" ? null : Number(expiry),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.token !== "string") {
        push(t.common.error + (body.error ?? T.errCreateFailed), "error");
        return;
      }
      setCreated(body.token);
      setName("");
      void load();
    } catch {
      push(T.errCreateFailed, "error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: McpToken) {
    if (!confirm(T.revokeConfirm(token.name))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/settings/mcp-tokens/${token.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        push(t.common.error + (body.error ?? T.errRevokeFailed), "error");
        return;
      }
      push(T.revokedOk, "success");
    } catch {
      push(T.errRevokeFailed, "error");
    } finally {
      setBusy(false);
      // Auch nach einem Fehlschlag neu laden. Der wahrscheinlichste Fehler ist
      // der 404 der Route "nicht gefunden oder bereits widerrufen" -- etwa aus
      // einem zweiten Tab. Danach zeigt die Liste den richtigen Zustand, statt
      // einen Knopf stehenzulassen, der nie wieder etwas bewirkt.
      void load();
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  /**
   * Der Token in den Konfigurationsschnipseln.
   *
   * Die Einrichtung steht seit dem 2026-08-23 dauerhaft auf der Seite und
   * nicht mehr nur im einmaligen Panel: wer gestern einen Token angelegt hat
   * und heute ein zweites Geraet einrichtet, kam sonst an die Anleitung nur
   * heran, indem er einen weiteren Token erzeugte.
   *
   * Der Klartext existiert aber weiterhin nur direkt nach dem Erzeugen, und
   * ein dauerhaft eingesetzter echter Token waere ein Geheimnis auf einer
   * Seite, die neben dem Nutzer auch jeder Mitleser sieht. Also: frischer
   * Token, solange einer offen ist, sonst der Platzhalter.
   */
  const snippetToken = created ?? T.setupTokenPlaceholder;

  const claudeCodeSnippet =
    `claude mcp add --transport http frostbreaker ${origin}/api/mcp ` +
    `--header "Authorization: Bearer ${snippetToken}"`;

  // ACHTUNG, diese Schreibweise ist kein Versehen und darf nicht "aufgeraeumt"
  // werden:
  //
  //  * "Authorization:${AUTH_HEADER}" OHNE Leerzeichen hinter dem Doppelpunkt,
  //    und der eigentliche Wert "Bearer <token>" in einer Umgebungsvariablen.
  //    Claude Desktop unter Windows und Cursor escapen Leerzeichen innerhalb
  //    von args beim Aufruf von npx nicht und zerreissen den Wert am
  //    Leerzeichen. In env sind Leerzeichen unproblematisch. Quelle: README von
  //    mcp-remote.
  //  * "--transport", "http-only" verhindert, dass mcp-remote auf das veraltete
  //    SSE zurueckfaellt, wenn unser Server auf GET planmaessig 405 antwortet.
  const claudeDesktopSnippet = `{
  "mcpServers": {
    "frostbreaker": {
      "command": "npx",
      "args": ["mcp-remote", "${origin}/api/mcp", "--transport", "http-only", "--header", "Authorization:\${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer ${snippetToken}" }
    }
  }
}`;

  const scopeLabel = { read: T.scopeRead, read_write: T.scopeReadWrite };
  const statusLabel = { active: T.statusActive, revoked: T.statusRevoked, expired: T.statusExpired };
  const statusCls = {
    active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    revoked: "border-edge2 bg-chip text-faint",
    expired: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  };

  return (
    <div className="fade-up max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{T.title}</h1>
        <p className="mt-1 text-sm leading-relaxed text-faint">{T.intro}</p>
        <p className="mt-3 text-xs font-medium text-ink">{T.examplesLabel}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm leading-relaxed text-soft">
          {T.examples.map((example) => (
            <li key={example}>&ldquo;{example}&rdquo;</li>
          ))}
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-faint">{T.boundary}</p>
      </div>

      {/* Der einmalige Moment. Steht ueber dem Formular, weil er alles andere
          verdraengt, solange er offen ist. */}
      {created && (
        <div className="rounded-lg border border-sky-500/40 bg-panel p-6">
          <h2 className="text-sm font-semibold text-ink">{T.tokenOnceTitle}</h2>
          <p className="mt-1 text-xs leading-relaxed text-faint">{T.tokenOnceBody}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-panel2 px-3 py-2 font-mono text-xs text-ink">
              {created}
            </code>
            <button onClick={() => copy(created)} className={secondaryBtnCls}>
              {T.copyButton}
            </button>
          </div>

          <button onClick={() => setCreated(null)} className={primaryBtnCls + " mt-5"}>
            {T.doneButton}
          </button>
        </div>
      )}

      <div className={cardCls}>
        <h2 className="text-sm font-semibold text-ink">{T.createButton}</h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink">{T.nameLabel}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder={T.namePlaceholder}
              maxLength={80}
              className={inputCls + " mt-1.5 w-full"}
            />
            <p className="mt-1 text-xs leading-relaxed text-faint">{T.nameHint}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink">{T.scopeLabel}</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "read" | "read_write")}
              className={inputCls + " mt-1.5 w-full"}
            >
              <option value="read">{T.scopeRead}</option>
              <option value="read_write">{T.scopeReadWrite}</option>
            </select>
            <p className="mt-1 text-xs leading-relaxed text-faint">{T.scopeHint}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink">{T.workspaceLabel}</label>
            <select
              value={limitToWorkspace ? "one" : "all"}
              onChange={(e) => setLimitToWorkspace(e.target.value === "one")}
              className={inputCls + " mt-1.5 w-full"}
            >
              <option value="all">{T.workspaceAll}</option>
              <option value="one">{T.workspaceOne + " — " + workspaceName}</option>
            </select>
            <p className="mt-1 text-xs leading-relaxed text-faint">{T.workspaceHint}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink">{T.expiryLabel}</label>
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as (typeof EXPIRY_CHOICES)[number])}
              className={inputCls + " mt-1.5 w-full"}
            >
              <option value="">{T.expiryNever}</option>
              <option value="30">{T.expiry30}</option>
              <option value="90">{T.expiry90}</option>
              <option value="365">{T.expiry365}</option>
            </select>
          </div>

          <button onClick={create} disabled={busy} className={primaryBtnCls}>
            {T.createButton}
          </button>
        </div>
      </div>

      {/* Die Einrichtung, dauerhaft sichtbar.
          Bis zum 2026-08-23 stand dieser ganze Block INNERHALB von
          {created && …}, also nur in den Minuten direkt nach dem Erzeugen
          eines Tokens. Am Live-Stand mit zwei bestehenden Tokens nachgesehen:
          die Seite zeigte Einleitung, Formular und Liste, aber keine
          Anleitung -- wer ein zweites Geraet einrichten wollte, musste einen
          ueberfluessigen Token erzeugen, nur um den Schnipsel wiederzusehen.
          Der Weg, die Pfade, die Warnung und die Reihenfolge stehen deshalb
          jetzt immer hier; geheim ist an ihnen nichts. Geheim ist allein der
          Token, und der ist hier ein Platzhalter, solange keiner frisch
          erzeugt wurde (siehe snippetToken oben). */}
      <div className={cardCls}>
        <h2 className="text-sm font-semibold text-ink">{T.setupHeading}</h2>
        {!created && (
          <p className="mt-1 text-xs leading-relaxed text-faint">{T.setupTokenPlaceholderHint}</p>
        )}

        <div className="mt-4">
          <p className="text-xs font-medium text-ink">{T.setupClaudeCodeLabel}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-faint">{T.setupClaudeCodeHint}</p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-panel2 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink">
            {claudeCodeSnippet}
          </pre>
          <button onClick={() => copy(claudeCodeSnippet)} className={secondaryBtnCls + " mt-2"}>
            {T.copyButton}
          </button>
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium text-ink">{T.setupClaudeDesktopLabel}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-faint">{T.setupClaudeDesktopHint}</p>
          {/* Nummerierte Schritte statt eines Fliesstextes: der Weg hat vier
              Stationen, und an zweien davon ist der Nutzer beim ersten
              Einrichten am 2026-08-22 tatsaechlich haengengeblieben -- er
              suchte die Konfigurationsdatei am dokumentierten Pfad (die
              Store-Fassung legt sie woanders ab) und schloss danach nur das
              Fenster, waehrend die alte Instanz mit der alten Konfiguration
              weiterlief. Beides steht deshalb ausdruecklich hier. */}
          <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-soft">
            {T.setupClaudeDesktopSteps.map((schritt) => (
              <li key={schritt}>{schritt}</li>
            ))}
          </ol>
          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-500">
            {T.setupClaudeDesktopQuitWarning}
          </p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-panel2 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink">
            {claudeDesktopSnippet}
          </pre>
          <button onClick={() => copy(claudeDesktopSnippet)} className={secondaryBtnCls + " mt-2"}>
            {T.copyButton}
          </button>
        </div>

        <p className="mt-5 text-xs leading-relaxed text-faint">{T.setupWebNote}</p>
      </div>

      <div className={cardCls}>
        {loading ? (
          <div className="space-y-3">
            <div className="h-4 w-40 animate-pulse rounded bg-chip" />
            <div className="h-4 w-64 animate-pulse rounded bg-chip" />
          </div>
        ) : loadError ? (
          // Ohne angewandte Migration 0099 antwortet die Route mit dem
          // Postgres-Fehler zur fehlenden Relation. Dass er hier sichtbar
          // steht statt in der Konsole, ist der Unterschied zwischen "die
          // Seite ist kaputt" und "die Tabelle fehlt noch".
          <p className="text-sm leading-relaxed text-red-600 dark:text-red-400">
            {t.common.error}
            {loadError}
          </p>
        ) : tokens.length === 0 ? (
          <div>
            <p className="text-sm font-medium text-ink">{T.emptyTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-faint">{T.emptyBody}</p>
          </div>
        ) : (
          <ul className="divide-y divide-edge/60">
            {tokens.map((token) => {
              const status = statusOf(token);
              const wsName = token.workspace_id
                ? (workspaces.find((w) => w.id === token.workspace_id)?.name ?? token.workspace_id)
                : T.workspaceAll;
              return (
                <li
                  key={token.id}
                  className={"py-4 first:pt-0 last:pb-0 " + (status === "active" ? "" : "opacity-60")}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{token.name}</p>
                      <code className="font-mono text-[11px] text-mute">{token.token_prefix}…</code>
                    </div>
                    <span
                      className={
                        "rounded-full border px-2.5 py-1 text-xs " + statusCls[status]
                      }
                    >
                      {statusLabel[status]}
                    </span>
                    {status === "active" && (
                      <button
                        onClick={() => revoke(token)}
                        disabled={busy}
                        className={dangerBtnCls + " py-1 text-xs"}
                      >
                        {T.revokeButton}
                      </button>
                    )}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-faint">{T.colScope}</dt>
                      <dd className="text-soft">{scopeLabel[token.scope]}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">{T.colWorkspace}</dt>
                      <dd className="truncate text-soft">{wsName}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">{T.colCreated}</dt>
                      <dd className="text-soft">{formatDateTime(token.created_at, lang)}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">{T.colLastUsed}</dt>
                      <dd className="text-soft">
                        {token.last_used_at ? formatDateTime(token.last_used_at, lang) : T.neverUsed}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-faint">{T.colExpires}</dt>
                      <dd className="text-soft">
                        {token.expires_at ? formatDateTime(token.expires_at, lang) : T.noExpiry}
                      </dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
