"use client";
import { useState } from "react";
import { inputCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import { useT } from "../../language-provider";
import type { WorkspaceSummary } from "@/lib/workspace/shared";

/**
 * Das Formular, mit dem zugestimmt wird.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EIN ECHTES FORMULAR, KEIN FETCH
 * ═══════════════════════════════════════════════════════════════════════
 *
 * method="post" auf /api/oauth/authorize, und die Route antwortet mit einer
 * 303 auf das Ruecksprungziel. Kein fetch, kein window.location, kein JSON
 * dazwischen. Der Grund ist nicht Sparsamkeit: das Ruecksprungziel ist bei
 * Desktop-Clients ein http://127.0.0.1:PORT/callback, und eine Weiterleitung
 * dorthin per fetch waere eine Cross-Origin-Anfrage, die der Browser blockt.
 * Als Formularabsendung ist es eine gewoehnliche Navigation, und die darf
 * ueberall hin.
 *
 * Der Nebeneffekt: die Seite funktioniert auch dann, wenn JavaScript
 * scheitert. Bei einer Seite, deren einzige Aufgabe eine bewusste
 * Entscheidung ist, ist das die richtige Richtung.
 *
 * Der Client-Name kommt aus der dynamischen Registrierung und ist damit
 * Fremdtext. Er wird hier als Textknoten gerendert -- React maskiert das von
 * sich aus. Wer hier jemals dangerouslySetInnerHTML einbaut, oeffnet die
 * Zustimmungsseite fuer eine gefaelschte Absenderangabe.
 */
export function ConsentForm({
  clientName,
  clientId,
  redirectUri,
  state,
  codeChallenge,
  resource,
  wantsWrite,
  userEmail,
  workspaces,
}: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string | null;
  wantsWrite: boolean;
  userEmail: string;
  workspaces: WorkspaceSummary[];
}) {
  const { t } = useT();
  const T = t.settings.mcp;
  const [scope, setScope] = useState<"read" | "read_write">(wantsWrite ? "read_write" : "read");
  const [workspaceId, setWorkspaceId] = useState("");
  const [busy, setBusy] = useState(false);

  // Nur der Host, nicht die ganze Adresse: der Mensch soll sehen, WOHIN das
  // geht, ohne einen 200 Zeichen langen Rueckweg mit Zustandsparametern zu
  // entziffern.
  let ziel = redirectUri;
  try {
    ziel = new URL(redirectUri).host;
  } catch {
    /* Bleibt die Rohadresse. Geprueft ist sie ohnehin schon. */
  }

  return (
    <div className="dot-grid flex min-h-screen items-center justify-center px-4 py-10">
      <form
        method="post"
        action="/api/oauth/authorize"
        onSubmit={() => setBusy(true)}
        className="fade-up w-full max-w-md"
      >
        <div className="mb-6">
          <span className="text-3xl font-extrabold tracking-tighter text-[#0EA5E9]">frostbreaker</span>
        </div>

        <div className="rounded-lg border border-edge/60 bg-panel p-6 shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight text-ink">{T.consentTitle(clientName)}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-faint">{T.consentAs(userEmail, ziel)}</p>

          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink">{T.consentScopeLabel}</label>
              <select
                name="scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as "read" | "read_write")}
                className={inputCls + " mt-1.5 w-full"}
              >
                <option value="read">{T.scopeRead}</option>
                <option value="read_write">{T.scopeReadWrite}</option>
              </select>
              <p className="mt-1 text-xs leading-relaxed text-faint">
                {scope === "read" ? T.consentScopeReadHint : T.consentScopeWriteHint}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink">{T.consentWorkspaceLabel}</label>
              <select
                name="workspace_id"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                className={inputCls + " mt-1.5 w-full"}
              >
                <option value="">{T.workspaceAll}</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {T.consentWorkspaceOne(w.name)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Alles, was der Fluss braucht, unveraendert weitergereicht. Die
              Route prueft es erneut gegen die Datenbank -- ein verstecktes
              Feld ist ein Vorschlag des Browsers, keine Tatsache. */}
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          {state !== null && <input type="hidden" name="state" value={state} />}
          {resource !== null && <input type="hidden" name="resource" value={resource} />}

          <div className="mt-6 flex gap-2">
            <button
              type="submit"
              name="decision"
              value="allow"
              disabled={busy}
              className={primaryBtnCls + " flex-1"}
            >
              {busy ? T.consentAllowBusy : T.consentAllow}
            </button>
            <button
              type="submit"
              name="decision"
              value="deny"
              disabled={busy}
              className={secondaryBtnCls}
            >
              {T.consentDeny}
            </button>
          </div>
        </div>

        <p className="mt-4 text-center text-xs leading-relaxed text-mute">{T.consentRevokeNote}</p>
      </form>
    </div>
  );
}
