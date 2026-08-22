/**
 * Wer darf ueber MCP welche Workspaces sehen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DIE EINE STELLE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Der MCP-Server laeuft mit Service-Role und umgeht damit RLS vollstaendig
 * (Begruendung in app/api/mcp/route.ts). Das heisst: die Datenbank sagt hier
 * NICHT mehr nein. Der gesamte Zuschnitt haengt an diesen vier Funktionen und
 * daran, dass jede Abfrage in lib/mcp/tools.ts zusaetzlich auf eine
 * workspace_id filtert, die vorher durch assertWorkspaceAllowed gegangen ist.
 *
 * Deshalb steht hier kein Supabase-Import und kein IO: die Funktionen sind
 * rein und vollstaendig testbar, und lib/mcp/authorize.test.ts ist der
 * wichtigste Test dieses Features.
 *
 * Die Regel in einem Satz: Reichweite = (Mitgliedschaften des Menschen)
 * geschnitten mit (optionale Einschraenkung des Tokens). Eine Schnittmenge
 * kann nur kleiner werden, nie groesser -- ein Token auf einen Workspace, aus
 * dem der Mensch ausgetreten ist, ergibt die leere Menge.
 */

export type McpScope = "read" | "read_write";

/** Die Spalten aus mcp_tokens, auf die hier entschieden wird. Absichtlich nur
 *  diese: was die Funktion nicht kennt, kann sie nicht falsch gewichten. */
export type McpTokenRow = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  scope: McpScope;
  expires_at: string | null;
  revoked_at: string | null;
};

/**
 * Ist der Token ueberhaupt noch gueltig?
 *
 * Wird bei JEDEM Aufruf geprueft, nicht einmal beim Verbinden -- der Server
 * ist zustandslos, ein "Verbinden" gibt es nicht. Ein Widerruf wirkt damit ab
 * dem naechsten Werkzeugaufruf, nicht erst beim naechsten Neustart des
 * Clients.
 *
 * Unparsbare Zeitangaben gelten als abgelaufen: bei einem kaputten Wert ist
 * "gilt nicht mehr" die einzige Antwort, die nicht zu viel erlaubt.
 */
export function isTokenUsable(row: McpTokenRow, now: Date = new Date()): boolean {
  if (row.revoked_at !== null && row.revoked_at !== undefined) return false;
  if (row.expires_at === null || row.expires_at === undefined) return true;
  const expires = Date.parse(row.expires_at);
  if (Number.isNaN(expires)) return false;
  return expires > now.getTime();
}

/**
 * Die Schnittmenge aus Mitgliedschaft und Token-Einschraenkung.
 *
 * memberWorkspaceIds kommt frisch aus workspace_members (nicht aus dem Token
 * und nicht aus einem Cache) -- genau deshalb verliert ein entferntes Mitglied
 * den Zugriff sofort, ohne dass jemand einen Token anfassen muss.
 *
 * Doppelte Eintraege werden entfernt: workspace_members hat zwar einen
 * Unique-Index je (workspace_id, user_id), aber die Reichweite ist eine Menge,
 * und eine Liste mit Dubletten waere spaeter eine Zahl, die zweimal zaehlt.
 */
export function allowedWorkspaceIds(
  memberWorkspaceIds: readonly string[],
  tokenWorkspaceId: string | null | undefined
): string[] {
  const members = [...new Set(memberWorkspaceIds.filter((id) => typeof id === "string" && id))];
  if (tokenWorkspaceId === null || tokenWorkspaceId === undefined || tokenWorkspaceId === "") {
    return members;
  }
  // Der entscheidende Punkt: die Einschraenkung ADDIERT nichts. Steht der
  // Workspace nicht in der Mitgliedschaft, ist das Ergebnis leer.
  return members.includes(tokenWorkspaceId) ? [tokenWorkspaceId] : [];
}

/**
 * Der Text, mit dem jeder verweigerte Workspace-Zugriff beantwortet wird.
 *
 * EINE Formulierung fuer "gibt es nicht" und fuer "darfst du nicht". Ein
 * Unterschied zwischen beiden waere ein Orakel: wer fremde UUIDs durchprobiert,
 * koennte daraus ablesen, welche Workspaces existieren. Der Test in
 * authorize.test.ts prueft ausdruecklich, dass beide Faelle denselben String
 * ergeben.
 */
export const WORKSPACE_DENIED_MESSAGE =
  "Unknown workspace_id, or this token has no access to it. Call list_workspaces to see the workspaces this token can use.";

export type WorkspaceCheck = { ok: true; workspaceId: string } | { ok: false; message: string };

/**
 * Darf dieser Aufruf gegen diesen Workspace laufen?
 *
 * Liefert ein Ergebnis statt zu werfen: die Ablehnung ist ein fachlicher
 * Fehler und wird dem Modell als Werkzeugfehler (isError) zugestellt, damit es
 * sich selbst korrigieren kann -- nicht als Protokollfehler, der die
 * Verbindung als kaputt erscheinen liesse.
 */
export function assertWorkspaceAllowed(
  allowedIds: readonly string[],
  requested: unknown
): WorkspaceCheck {
  if (typeof requested !== "string" || requested.trim() === "") {
    return { ok: false, message: WORKSPACE_DENIED_MESSAGE };
  }
  const wanted = requested.trim();
  if (!allowedIds.includes(wanted)) {
    return { ok: false, message: WORKSPACE_DENIED_MESSAGE };
  }
  return { ok: true, workspaceId: wanted };
}

/**
 * Reicht der Scope des Tokens fuer dieses Werkzeug?
 *
 * read_write schliesst read ein, read schliesst read_write nicht ein. Ein
 * unbekannter Wert in der Spalte (haende voraus, jemand erweitert den
 * Check-Constraint) gilt als "reicht nicht".
 */
export function requireScope(scope: McpScope | string, needed: McpScope): boolean {
  if (needed === "read") return scope === "read" || scope === "read_write";
  return scope === "read_write";
}

/** Der Text bei fehlendem Schreibrecht. Nennt ausdruecklich den Weg
 *  darum herum, weil der Nutzer ihn in der App selbst gehen kann. */
export const SCOPE_DENIED_MESSAGE =
  "This token is read-only. Create a token with the read_write scope in Frostbreaker under Settings to use this tool.";
