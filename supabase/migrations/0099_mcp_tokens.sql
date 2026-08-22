-- ═══════════════════════════════════════════════════════════════════════
-- MCP-ZUGANG: der Nutzer liest seine Frostbreaker-Daten aus SEINEM Claude.
--
-- Bisher kommt man an die Daten dieser App nur durch die Oberflaeche. Wer
-- fuenfzig Icebreaker umschreiben will, klickt fuenfzig Mal. Wer mit dem
-- eigenen Claude-Abo arbeitet, kann das dort in einem Zug tun -- vorausgesetzt,
-- Claude darf die Lead-Listen lesen und genau ein Feld zurueckschreiben.
--
-- Diese Migration legt nur das an, was ein solcher Zugang an Zustand braucht:
-- den Token und die Spur seiner Schreibvorgaenge. Der Server selbst
-- (app/api/mcp/route.ts) ist zustandslos.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WARUM DER TOKEN AM MENSCHEN HAENGT UND NICHT AM WORKSPACE
-- ═══════════════════════════════════════════════════════════════════════
--
-- user_id ist die einzige Pflicht-Verknuepfung. Damit ist die Reichweite des
-- Tokens immer genau die Menge der Workspaces, in denen dieser Mensch laut
-- workspace_members Mitglied ist -- ausgewertet bei JEDEM Aufruf neu, nicht
-- beim Anlegen eingefroren.
--
-- Der Gewinn zeigt sich beim Ausscheiden: wer aus einem Workspace entfernt
-- wird, verliert den Zugriff sofort, ohne dass irgendjemand daran denken muss,
-- einen Token zu widerrufen. Ein workspace-gebundener Token haette eine
-- zweite Liste erzeugt, die jemand haendisch mit workspace_members synchron
-- halten muesste -- und genau solche zweiten Listen sind es, die nach einem
-- halben Jahr nicht mehr stimmen.
--
-- workspace_id ist trotzdem da, aber nur als EINSCHRAENKUNG: gesetzt heisst
-- "dieser Token darf ausserdem nur diesen einen Workspace sehen" (der Fall
-- "ein Token je Endkunde" bei einer Agentur). Die Auswertung ist immer eine
-- SCHNITTMENGE mit der Mitgliedschaft, nie eine Erweiterung -- ein Token auf
-- einen Workspace, aus dem der Mensch ausgetreten ist, sieht nichts. Die eine
-- Stelle, an der das entschieden wird, ist lib/mcp/authorize.ts.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WARUM UNGESALZENES SHA-256 UND WEDER FERNET NOCH BCRYPT
-- ═══════════════════════════════════════════════════════════════════════
--
-- NICHT Fernet (wie api_keys.key_ciphertext): die BYOK-Schluessel dort muessen
-- entschluesselbar sein, weil sie an fremde APIs weitergereicht werden. Ein
-- eigener Zugriffstoken muss das nie -- er wird nur VERGLICHEN. Wer ihn
-- verliert, legt einen neuen an. Etwas entschluesselbar zu speichern, das
-- niemand entschluesseln muss, ist reines Risiko ohne Gegenwert.
--
-- NICHT bcrypt/argon2: deren Rechenaufwand schuetzt gegen Woerterbuecher, und
-- ein Woerterbuch braucht ein vom Menschen gewaehltes Passwort. Der Token hier
-- sind 256 Bit aus einem CSPRNG -- es gibt nichts zu raten. Was ein
-- Langsam-Hash zusaetzlich kostet, ist die Pruefung selbst: sie laeuft bei
-- JEDEM Werkzeugaufruf. Mit einem Unique-Index auf dem Hex-Digest ist sie ein
-- einziger indizierter Lookup statt eines Tabellendurchlaufs mit einem
-- Vergleich je Zeile (bcrypt-Hashes sind gesalzen und damit nicht indizierbar).
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),

  -- Der Mensch. Siehe Kopfkommentar: die Reichweite ergibt sich aus
  -- workspace_members, nicht aus dieser Zeile.
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Optionale Einschraenkung auf genau einen Workspace. NULL = alle
  -- Mitgliedschaften. Immer Schnittmenge, nie Erweiterung.
  workspace_id uuid references public.workspaces(id) on delete cascade,

  -- Damit sich mehrere unterscheiden lassen ("Laptop", "Kunde Meier").
  name text not null,

  -- SHA-256 als Hex, 64 Zeichen. Unique, weil der Lookup ueber diese Spalte
  -- laeuft und zwei Zeilen mit demselben Hash zwei Zeilen mit demselben Token
  -- waeren.
  token_hash text not null unique,

  -- Die ersten Zeichen im Klartext, ausschliesslich zur Wiedererkennung in der
  -- Liste ("fbk_mcp_7Qa..."). Kein Geheimnis und kein Suchkriterium.
  token_prefix text not null,

  -- 'read' ist die Voreinstellung, weil der Schreibfall (set_lead_icebreaker)
  -- die Ausnahme ist und nicht versehentlich mitkommen soll.
  scope text not null default 'read' check (scope in ('read', 'read_write')),

  created_at timestamptz not null default now(),

  -- Gedrosselt fortgeschrieben (nur wenn aelter als 5 Minuten), sonst kostete
  -- jeder einzelne Werkzeugaufruf einen zusaetzlichen Schreibvorgang.
  last_used_at timestamptz,

  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists mcp_tokens_user_idx on public.mcp_tokens (user_id);

comment on table public.mcp_tokens is
  'Statische Bearer-Token fuer app/api/mcp. Haengen am Menschen (user_id); die Reichweite ist die Schnittmenge aus workspace_members und dem optionalen workspace_id, bei jedem Aufruf neu ausgewertet (lib/mcp/authorize.ts).';

comment on column public.mcp_tokens.workspace_id is
  'NULL = alle Workspaces der Mitgliedschaft. Gesetzt = zusaetzliche Einschraenkung auf diesen einen. Immer SCHNITTMENGE mit workspace_members, nie Erweiterung.';

comment on column public.mcp_tokens.token_hash is
  'SHA-256 hex des Klartext-Tokens. Bewusst ungesalzen und ohne Langsam-Hash: 256 Zufallsbits haben kein Woerterbuch, und die Pruefung laeuft bei jedem Werkzeugaufruf -- siehe Kopfkommentar dieser Migration.';

-- ═══════════════════════════════════════════════════════════════════════
-- DIE SPUR DER SCHREIBVORGAENGE
-- ═══════════════════════════════════════════════════════════════════════
--
-- Genau ein Werkzeug darf schreiben (set_lead_icebreaker, ein Lead je
-- Aufruf). Trotzdem -- oder gerade deshalb -- wird jeder Schreibvorgang
-- protokolliert: es ist der einzige Weg, auf dem Daten dieser App durch ein
-- fremdes Modell veraendert werden koennen. Ohne alten Wert liesse sich
-- hinterher nicht sagen, was ein missverstandener Prompt ueberschrieben hat.
--
-- Geschrieben wird ausschliesslich mit Service-Role aus der Route. Deshalb
-- gibt es unten fuer 'authenticated' nur eine SELECT-Policy: ein Protokoll,
-- das der Protokollierte aendern kann, ist keins.
create table if not exists public.mcp_write_log (
  id uuid primary key default gen_random_uuid(),

  -- on delete set null und NICHT cascade: das Protokoll muss das Loeschen des
  -- Tokens ueberleben. Mit cascade verschwaende beim Aufraeumen eines
  -- verdaechtigen Tokens genau die Spur, fuer die diese Tabelle angelegt wurde.
  token_id uuid references public.mcp_tokens(id) on delete set null,

  -- Ohne FK, aus demselben Grund: wer als Nutzer geloescht wird, soll den
  -- Nachweis nicht mitnehmen.
  user_id uuid,

  workspace_id uuid not null,
  business_id uuid not null,
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

-- Gelesen wird immer "was ist in diesem Workspace zuletzt passiert".
create index if not exists mcp_write_log_workspace_idx
  on public.mcp_write_log (workspace_id, created_at desc);

comment on table public.mcp_write_log is
  'Jeder Schreibvorgang ueber den MCP-Server (heute nur businesses.personalization). Wird ausschliesslich mit Service-Role befuellt; fuer authenticated gibt es nur SELECT.';

-- ═══════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════
--
-- Die Route selbst laeuft mit Service-Role und umgeht das hier komplett --
-- ohne Supabase-Session ist auth.uid() NULL, jede Policy waere false und der
-- Server bekaeme null Zeilen. Diese Policies gelten fuer die Oberflaeche
-- (Auftrag B, Einstellungen), in der ein eingeloggter Mensch seine Token
-- anlegt und widerruft.

alter table public.mcp_tokens enable row level security;

-- Token sind persoenlich: auch ein Workspace-Admin sieht die Token seiner
-- Kollegen nicht. Ein Token ist ein Zugangsmittel, keine Workspace-Einstellung.
drop policy if exists mcp_tokens_own on public.mcp_tokens;
create policy mcp_tokens_own on public.mcp_tokens for select
  using (user_id = auth.uid());

-- Beim Anlegen zusaetzlich: wer auf einen Workspace einschraenkt, muss dort
-- Mitglied sein. Ohne diese Bedingung liesse sich ein Token auf eine fremde
-- workspace_id ausstellen. Er saehe dank der Schnittmenge in authorize.ts zwar
-- nichts, aber eine Zeile, die etwas Falsches behauptet, gehoert gar nicht
-- erst in die Tabelle.
drop policy if exists mcp_tokens_insert on public.mcp_tokens;
create policy mcp_tokens_insert on public.mcp_tokens for insert
  with check (
    user_id = auth.uid()
    and (workspace_id is null or public.is_workspace_member(workspace_id))
  );

-- Widerrufen und umbenennen. Der Wechsel auf einen fremden Besitzer ist durch
-- das with check ausgeschlossen.
drop policy if exists mcp_tokens_update on public.mcp_tokens;
create policy mcp_tokens_update on public.mcp_tokens for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (workspace_id is null or public.is_workspace_member(workspace_id))
  );

drop policy if exists mcp_tokens_delete on public.mcp_tokens;
create policy mcp_tokens_delete on public.mcp_tokens for delete
  using (user_id = auth.uid());

alter table public.mcp_write_log enable row level security;

-- Lesen darf jedes Mitglied des betroffenen Workspaces -- nicht nur der
-- Token-Besitzer. Wer mit den Leads arbeitet, muss sehen koennen, dass ein
-- Icebreaker nicht aus der App, sondern aus einem Modell kam.
drop policy if exists mcp_write_log_member on public.mcp_write_log;
create policy mcp_write_log_member on public.mcp_write_log for select
  using (public.is_workspace_member(workspace_id));
