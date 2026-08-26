-- ═══════════════════════════════════════════════════════════════════════
-- DER MCP-ZUGANG WIRD EIN KONNEKTOR
--
-- Migration 0099 hat den statischen Bearer-Token angelegt: der Mensch erzeugt
-- ihn in den Einstellungen, kopiert ihn und traegt ihn in seinem Client ein.
-- Das funktioniert in Claude Code, wo eine Konfigurationsdatei einen eigenen
-- Header aufnehmen kann. Es funktioniert NICHT in claude.ai und in Claude
-- Desktop: deren Konnektor-Maske kennt nur "offen" oder "OAuth", ein Feld fuer
-- einen eigenen Header gibt es dort nicht.
--
-- Der Ausweg war bisher mcp-remote -- ein npx-Paket, das den Token als
-- Umgebungsvariable durchreicht. Es wird bei jedem Start aus dem Netz geladen,
-- zerbricht unter Windows an Leerzeichen in args und faellt bei einem 405 auf
-- GET auf das abgeschaffte SSE zurueck. Genau daher kommen die
-- wiederkehrenden MCP-Fehler, nicht aus dem Server.
--
-- Diese Migration legt an, was ein echter OAuth-Fluss an Zustand braucht: wer
-- sich registriert hat, und welcher Code gerade auf seinen Tausch wartet. Die
-- ausgestellten Zugriffstoken kommen bewusst NICHT in eine eigene Tabelle --
-- siehe unten.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WARUM KEIN CLIENT_SECRET
-- ═══════════════════════════════════════════════════════════════════════
--
-- Alle Clients hier sind "public" im Sinne von RFC 6749: eine Desktop-App und
-- eine Weboberflaeche koennen ein ausgeliefertes Geheimnis nicht geheim
-- halten. Ein client_secret waere eine Spalte, die Sicherheit behauptet und
-- keine liefert. Die Absicherung leistet PKCE (RFC 7636, S256): der
-- Autorisierungscode allein nuetzt niemandem, der den Verifier nicht hat, und
-- der verlaesst den anfragenden Client nie.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- WER SICH REGISTRIERT HAT
-- ═══════════════════════════════════════════════════════════════════════
--
-- Befuellt ausschliesslich ueber /api/oauth/register (RFC 7591, dynamische
-- Registrierung). Der Endpunkt ist offen, und das muss er sein: ohne ihn
-- muesste der Mensch sich in Frostbreaker eine client_id ausstellen lassen und
-- sie in claude.ai eintippen -- also genau das Abtippen, das dieser ganze
-- Umbau abschafft.
--
-- Offen heisst nicht wertlos: eine Registrierung allein gewaehrt nichts. Sie
-- erlaubt nur, einen Menschen um Zustimmung zu FRAGEN. Ohne dass jemand auf
-- der Zustimmungsseite klickt, entsteht kein Code und kein Token.
create table if not exists public.mcp_oauth_clients (
  -- Kein Geheimnis (RFC 6749 sagt das ausdruecklich), deshalb im Klartext.
  -- Zufaellig trotzdem, damit sie sich nicht ueber Kunden hinweg durchzaehlen
  -- laesst.
  client_id text primary key,

  -- Was auf der Zustimmungsseite steht ("Claude"). Kommt vom Client selbst und
  -- ist damit FREMDTEXT: die Seite rendert ihn als Text, nie als Markup.
  client_name text,

  -- Exakte Adressen, an die weitergeleitet werden darf. Der Vergleich in
  -- lib/mcp/oauth.ts ist ein Zeichenvergleich ohne Praefixe und ohne
  -- Platzhalter -- ein grosszuegigerer Vergleich waere die Stelle, an der der
  -- Autorisierungscode woanders landet.
  redirect_uris text[] not null check (array_length(redirect_uris, 1) between 1 and 10),

  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

comment on table public.mcp_oauth_clients is
  'Per RFC 7591 dynamisch registrierte OAuth-Clients fuer den MCP-Konnektor. Eine Zeile hier gewaehrt nichts; sie erlaubt nur, einen Menschen um Zustimmung zu fragen.';

-- ═══════════════════════════════════════════════════════════════════════
-- DER CODE, DER AUF SEINEN TAUSCH WARTET
-- ═══════════════════════════════════════════════════════════════════════
--
-- Lebt eine Minute und wird genau einmal eingeloest. Beides steht in Spalten
-- und nicht nur im Code, damit eine zweite Einloesung auch dann scheitert,
-- wenn zwei Anfragen gleichzeitig ankommen: der Tausch laeuft ueber ein
-- UPDATE ... WHERE consumed_at IS NULL RETURNING, und das gewinnt nur einer.
create table if not exists public.mcp_oauth_codes (
  -- Auch der Code wird nur verglichen, nie gelesen. Also derselbe SHA-256-Hex
  -- wie bei den Token; die Begruendung steht im Kopf von 0099.
  code_hash text primary key,

  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,

  -- Wer zugestimmt hat. Der spaeter ausgestellte Token haengt an dieser Zeile.
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Muss beim Tausch erneut mitgeschickt werden und uebereinstimmen
  -- (RFC 6749 §4.1.3). Sonst liesse sich ein abgefangener Code an einem
  -- anderen Ziel einloesen.
  redirect_uri text not null,

  -- PKCE. Ohne diese beiden Spalten waere der Code allein schon der Zugang.
  code_challenge text not null,
  code_challenge_method text not null default 'S256' check (code_challenge_method = 'S256'),

  scope text not null default 'read' check (scope in ('read', 'read_write')),

  -- Optionale Einschraenkung auf einen Workspace, aus der Zustimmungsseite.
  -- Dieselbe Bedeutung wie mcp_tokens.workspace_id: Schnittmenge, nie
  -- Erweiterung.
  workspace_id uuid references public.workspaces(id) on delete cascade,

  -- RFC 8707. Wird beim Tausch verglichen, damit ein Code fuer diese Ressource
  -- nicht gegen einen Token fuer eine andere getauscht werden kann.
  resource text,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

-- Fuer das Aufraeumen abgelaufener Codes.
create index if not exists mcp_oauth_codes_expiry_idx
  on public.mcp_oauth_codes (expires_at);

comment on table public.mcp_oauth_codes is
  'Autorisierungscodes des MCP-Konnektors. Einminuetig und einmalig einloesbar; die Einmaligkeit erzwingt der Tausch per UPDATE ... WHERE consumed_at IS NULL RETURNING, nicht eine Pruefung im Anwendungscode.';

-- ═══════════════════════════════════════════════════════════════════════
-- DIE AUSGESTELLTEN TOKEN BLEIBEN IN MCP_TOKENS
-- ═══════════════════════════════════════════════════════════════════════
--
-- Der wichtigste Entwurfsentscheid dieser Migration, und der am leichtesten
-- anders zu machende: ein OAuth-Zugriffstoken ist eine Zeile in mcp_tokens,
-- keine Zeile in einer neuen Tabelle.
--
-- Der Grund ist der Pruefpfad. app/api/mcp/route.ts schlaegt bei JEDEM Aufruf
-- genau einen Hash in genau einer Tabelle nach und wertet daran Gueltigkeit,
-- Scope und Reichweite aus. Eine zweite Tokentabelle waere ein zweiter
-- Pruefpfad -- und damit die Sorte Verdopplung, bei der ein halbes Jahr
-- spaeter ein Widerruf in der einen Tabelle wirkt und in der anderen nicht.
-- Mit dieser Loesung gilt jede bestehende Zeile in authorize.ts unveraendert
-- weiter, und der Widerruf ist fuer beide Sorten derselbe Knopf.
alter table public.mcp_tokens
  -- 'pat' = in den Einstellungen von Hand erzeugt (der Fall aus 0099),
  -- 'oauth' = ueber den Konnektor ausgestellt. Unterschieden werden muessen
  -- sie nur fuer die Anzeige und fuers Erneuern, nicht fuer die Pruefung.
  add column if not exists kind text not null default 'pat'
    check (kind in ('pat', 'oauth'));

alter table public.mcp_tokens
  add column if not exists client_id text
    references public.mcp_oauth_clients(client_id) on delete cascade;

-- on delete cascade oben ist Absicht: wird ein Client geloescht, sind seine
-- Token wertlos und sollen verschwinden. Das Schreibprotokoll ueberlebt das,
-- weil mcp_write_log.token_id auf "on delete set null" steht (0099).

alter table public.mcp_tokens
  -- Der Konnektor erneuert selbsttaetig. Deshalb darf der Zugriffstoken kurz
  -- leben (eine Stunde) -- ein Entzug wirkt dann spaetestens nach einer
  -- Stunde auch dann, wenn niemand den Client anfasst.
  add column if not exists refresh_token_hash text unique;

alter table public.mcp_tokens
  add column if not exists refresh_expires_at timestamptz;

-- Der Lookup beim Erneuern laeuft ueber diese Spalte.
create index if not exists mcp_tokens_refresh_idx
  on public.mcp_tokens (refresh_token_hash)
  where refresh_token_hash is not null;

comment on column public.mcp_tokens.kind is
  'pat = in den Einstellungen von Hand erzeugt (Migration 0099), oauth = ueber den Konnektor ausgestellt (0105). Fuer die Zugriffspruefung unerheblich: beide Sorten gehen durch denselben Hash-Lookup in app/api/mcp/route.ts.';

comment on column public.mcp_tokens.refresh_token_hash is
  'SHA-256 hex des Refresh-Tokens, nur bei kind = oauth gesetzt. Wird bei jedem Erneuern ROTIERT: der alte Wert wird ueberschrieben, ein zweites Einloesen desselben Refresh-Tokens findet nichts mehr.';

-- ═══════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════
--
-- Beide neuen Tabellen werden ausschliesslich mit Service-Role aus den
-- OAuth-Routen befuellt und gelesen. Fuer 'authenticated' gibt es deshalb gar
-- keine Policy -- und das ist die Absicht, nicht eine Luecke: RLS ohne
-- passende Policy verweigert alles.
--
-- Die eine Ausnahme ist die Zustimmungsseite, die den client_name anzeigen
-- muss. Sie laeuft als Server Component und liest ihn ueber den
-- Service-Client, nicht ueber die Sitzung des Nutzers -- ein Client-Name ist
-- kein persoenliches Datum, aber die Liste ALLER registrierten Clients
-- braucht trotzdem niemand im Browser.
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;

-- ═══════════════════════════════════════════════════════════════════════
-- AUFRAEUMEN
-- ═══════════════════════════════════════════════════════════════════════
--
-- Abgelaufene Codes sind wertlos, sammeln sich aber an: jeder Verbindungs-
-- versuch legt einen an, auch die abgebrochenen. Kein pg_cron-Eintrag dafuer,
-- sondern ein Aufruf im Token-Endpunkt selbst -- die Tabelle waechst nur
-- dort, wo auch aufgeraeumt wird, und eine Automatisierung, die irgendwo
-- anders steht, ist eine, die beim naechsten Umbau vergessen wird.
create or replace function public.purge_expired_oauth_codes()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.mcp_oauth_codes
  where expires_at < now() - interval '1 hour';
$$;

comment on function public.purge_expired_oauth_codes is
  'Loescht Autorisierungscodes, die seit ueber einer Stunde abgelaufen sind. Wird aus /api/oauth/token aufgerufen, nicht aus pg_cron.';
