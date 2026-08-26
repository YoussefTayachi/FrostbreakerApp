import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listWorkspaces } from "@/lib/workspace/server";
import {
  OAUTH_SCOPE_WRITE,
  errorRedirect,
  isValidCodeChallenge,
  redirectUriAllowed,
} from "@/lib/mcp/oauth";
import { redirect } from "next/navigation";
import { ConsentForm } from "./consent-form";

/**
 * Die Zustimmungsseite: der eine Moment, in dem ein Mensch entscheidet.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIESE SEITE NICHT IN DER AUSNAHMELISTE DER MIDDLEWARE STEHT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Alles andere unter /api/oauth/ ist dort ausgenommen, diese Seite bewusst
 * nicht: wer zustimmen soll, muss angemeldet sein, und die Umleitung auf
 * /login ist genau das gewuenschte Verhalten. Die Middleware haengt dabei seit
 * dem 2026-08-26 ein ?next= an, das Pfad UND Parameter traegt -- ohne das kam
 * der Mensch nach dem Anmelden auf dem Dashboard heraus, und der Konnektor
 * wartete auf einen Code, der nie kam.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ZWEI SORTEN FEHLER, ZWEI ORTE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ist client_id oder redirect_uri faul, bleibt der Fehler HIER. Weiterzuleiten
 * hiesse, einer ungeprueften Adresse zu glauben -- und damit waere dieser
 * Endpunkt eine Umleitungsmaschine, mit der sich beliebige Ziele hinter dem
 * guten Namen der eigenen Domain verstecken lassen (RFC 6749 §4.1.2.1 sagt
 * das ausdruecklich).
 *
 * Stimmen beide und etwas anderes fehlt, geht der Fehler zum Client zurueck:
 * dort kann er ihn dem Nutzer anzeigen, und der Fluss endet sauber statt in
 * einer Sackgasse.
 */
export const dynamic = "force-dynamic";

type Suche = Record<string, string | string[] | undefined>;

function einzeln(v: string | string[] | undefined): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Suche> }) {
  const params = await searchParams;
  const clientId = einzeln(params.client_id);
  const redirectUri = einzeln(params.redirect_uri);
  const responseType = einzeln(params.response_type);
  const state = einzeln(params.state);
  const codeChallenge = einzeln(params.code_challenge);
  const codeChallengeMethod = einzeln(params.code_challenge_method) ?? "S256";
  const scope = einzeln(params.scope);
  const resource = einzeln(params.resource);

  // ── Der Teil, der hier bleibt ────────────────────────────────────────
  if (!clientId || !redirectUri) {
    return <Abbruch grund="Der Aufruf nennt keine client_id oder kein redirect_uri." />;
  }

  const service = createServiceClient();
  const { data: client } = await service
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle<{ client_id: string; client_name: string | null; redirect_uris: string[] }>();

  if (!client) {
    return <Abbruch grund="Diese Anwendung ist bei Frostbreaker nicht registriert." />;
  }
  if (!redirectUriAllowed(client.redirect_uris, redirectUri)) {
    return (
      <Abbruch grund="Die Ruecksprungadresse gehoert nicht zu dieser Anwendung. Der Vorgang wurde abgebrochen." />
    );
  }

  // ── Ab hier darf der Fehler zum Client zurueck ───────────────────────
  if (responseType !== "code") {
    redirect(
      errorRedirect(redirectUri, "unsupported_response_type", 'Only response_type=code is supported.', state)
    );
  }
  if (codeChallengeMethod !== "S256" || !isValidCodeChallenge(codeChallenge)) {
    redirect(
      errorRedirect(
        redirectUri,
        "invalid_request",
        "A code_challenge with code_challenge_method=S256 is required.",
        state
      )
    );
  }

  // ── Wer stimmt hier zu ───────────────────────────────────────────────
  // Die Middleware garantiert eine Sitzung; getUser bestaetigt sie und liefert
  // die Adresse, die auf der Seite steht. Ein Mensch, der zwei Konten hat,
  // soll sehen, welches er gerade verbindet.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(params as Record<string, string>).toString()}`)}`);
  }

  const workspaces = await listWorkspaces(supabase);

  return (
    <ConsentForm
      clientName={client.client_name ?? "Unbenannte Anwendung"}
      clientId={client.client_id}
      redirectUri={redirectUri}
      state={state}
      codeChallenge={codeChallenge as string}
      resource={resource}
      wantsWrite={typeof scope === "string" && scope.includes(OAUTH_SCOPE_WRITE)}
      userEmail={user.email ?? ""}
      workspaces={workspaces}
    />
  );
}

/** Der Fehler, der die Seite nicht verlaesst. Bewusst ohne "zurueck"-Knopf:
 *  es gibt kein vertrauenswuerdiges Ziel, sonst waere er weitergeleitet
 *  worden. */
function Abbruch({ grund }: { grund: string }) {
  return (
    <div className="dot-grid flex min-h-screen items-center justify-center px-4">
      <div className="fade-up w-full max-w-md rounded-lg border border-red-500/30 bg-panel p-6">
        <h1 className="text-base font-semibold text-ink">Verbindung nicht moeglich</h1>
        <p className="mt-2 text-sm leading-relaxed text-soft">{grund}</p>
        <p className="mt-4 text-xs leading-relaxed text-faint">
          Es wurde nichts freigegeben. Wenn du diesen Vorgang nicht selbst gestartet hast, kannst du
          das Fenster einfach schliessen.
        </p>
      </div>
    </div>
  );
}
