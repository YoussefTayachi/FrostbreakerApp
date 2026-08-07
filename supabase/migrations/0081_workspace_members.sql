-- ═══════════════════════════════════════════════════════════════════════
-- TEAM-ZUGAENGE: mehrere Menschen an einem Workspace.
--
-- Bis hierher war workspaces.owner_id = auth.uid() die EINZIGE Zugriffsregel
-- der ganzen App, durchgereicht ueber is_workspace_owner(ws) an 31 Policies.
-- Ein Workspace gehoerte genau einem Konto. Fuer eine Agentur mit einem Team
-- hiess das in der Praxis: ein geteiltes Passwort -- kein Nachvollziehen, wer
-- was getan hat, kein Entzug beim Ausscheiden, keine Abstufung fuer Freie.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WARUM DIE 31 POLICIES UNANGETASTET BLEIBEN
-- ═══════════════════════════════════════════════════════════════════════
--
-- Alle laufen ueber dieselbe Funktion. Statt 31 Policies zu droppen und neu
-- anzulegen -- jede davon eine Gelegenheit, eine Tabelle offen zu lassen --
-- bekommt die Funktion einen neuen Rumpf. Der Blast Radius einer falschen
-- Zeile ist damit eine Funktion statt einunddreissig Policies, und ein
-- Vertipper faellt sofort und ueberall auf statt an genau einer Tabelle.
--
-- is_workspace_owner heisst danach das Falsche. Sie bleibt trotzdem, als
-- ausdruecklich veralteter Aliasname mit Kommentar -- siehe unten.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WARUM DIE HILFSFUNKTIONEN KEINE ENDLOSSCHLEIFE BAUEN
-- ═══════════════════════════════════════════════════════════════════════
--
-- is_workspace_member liest aus workspace_members, und auf workspace_members
-- liegt eine Policy, die is_workspace_member aufruft. Das waere Rekursion --
-- waeren die Funktionen nicht "security definer". Als solche laufen sie mit
-- den Rechten des Definers, und fuer den greift RLS nicht. Genau deshalb war
-- schon is_workspace_owner so definiert; die Eigenschaft ist hier kein
-- Beiwerk, sondern die Voraussetzung.
-- ═══════════════════════════════════════════════════════════════════════

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  -- Null, solange die Einladung offen ist: der Mensch hat noch kein Konto.
  -- Angenommen wird sie beim Signup (handle_new_user unten).
  user_id uuid references auth.users(id) on delete cascade,

  -- Immer gesetzt, auch nach der Annahme. Sonst muesste die Mitgliederliste
  -- auth.users lesen, und das darf der Client nicht -- die Liste zeigte dann
  -- nur UUIDs.
  email text not null,

  -- 'admin' darf einladen, Rollen aendern, entfernen und die API-Schluessel
  -- sehen. 'member' darf alles Operative: suchen, schreiben, versenden,
  -- anrufen, Pipeline. Bewusst zwei Stufen und nicht fuenf -- eine Rolle, die
  -- niemand erklaeren kann, wird auf Verdacht hoch vergeben.
  role text not null default 'member' check (role in ('admin','member')),

  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- Zwei Unique-Indizes statt eines zusammengesetzten: user_id ist bei offenen
-- Einladungen null, und null gilt in einem Unique-Index als von allem
-- verschieden. Ohne den zweiten Index liesse sich dieselbe Adresse beliebig
-- oft einladen, und beim Signup entstuenden mehrere Mitgliedschaften.
create unique index workspace_members_user_uniq
  on public.workspace_members (workspace_id, user_id) where user_id is not null;
create unique index workspace_members_email_uniq
  on public.workspace_members (workspace_id, lower(email));
create index workspace_members_user_idx on public.workspace_members (user_id);

-- ─────────────────────────────────────────────────────────────────────
-- Backfill VOR der Policy-Umstellung: erst wenn jeder heutige Eigentuemer
-- als Mitglied eingetragen ist, darf die Zugriffsregel darauf umschalten.
-- Andersherum waeren alle Bestandskonten fuer die Dauer der Migration aus
-- ihren eigenen Daten ausgesperrt.
-- ─────────────────────────────────────────────────────────────────────
insert into public.workspace_members (workspace_id, user_id, email, role, accepted_at)
select w.id, w.owner_id, coalesce(u.email, ''), 'admin', w.created_at
  from public.workspaces w
  join auth.users u on u.id = w.owner_id;

-- ─────────────────────────────────────────────────────────────────────
-- Zugriffsregeln
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.is_workspace_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

-- VERALTET. Heisst "owner", bedeutet seit dieser Migration "Mitglied".
--
-- Sie bleibt ausschliesslich, damit die 31 bestehenden Policies unveraendert
-- weiterlaufen; ein Umschreiben waere 31 Gelegenheiten gewesen, eine Tabelle
-- offen zu lassen. NEUE Policies verwenden is_workspace_member oder
-- is_workspace_admin und niemals diese hier. Wer eine Policy aus einem
-- anderen Grund ohnehin anfasst, zieht sie bei der Gelegenheit mit um.
create or replace function public.is_workspace_owner(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_workspace_member(ws);
$$;
comment on function public.is_workspace_owner(uuid) is
  'VERALTET seit 0081: prueft Mitgliedschaft, nicht Eigentum. Neue Policies nutzen is_workspace_member/is_workspace_admin.';

revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.is_workspace_admin(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- workspaces: lesen darf jedes Mitglied, sonst waere der Workspace-Umschalter
-- fuer eingeladene Leute leer. Umbenennen ist Admin-Sache. Loeschen bleibt
-- beim tatsaechlichen owner_id und nicht bei jedem Admin: ein Kundenkonto mit
-- allen Leads ist nichts, was ein zweiter Admin versehentlich wegraeumen darf.
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists workspaces_owner on public.workspaces;

create policy workspaces_select on public.workspaces for select
  using (public.is_workspace_member(id));
create policy workspaces_insert on public.workspaces for insert
  with check (owner_id = auth.uid());
create policy workspaces_update on public.workspaces for update
  using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));
create policy workspaces_delete on public.workspaces for delete
  using (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- api_keys: BYOK-Schluessel sind Zugangsdaten mit echtem Geldwert. Sie
-- laufen ueber is_workspace_owner und waeren durch die Umstellung fuer jedes
-- Mitglied lesbar geworden -- das ist der eine Ort, an dem die Umstellung
-- ohne diese Zeilen zu weit gegangen waere.
--
-- Der Worker liest die Schluessel serverseitig mit Service-Role, das laeuft
-- unabhaengig weiter. Ein Mitglied kann also suchen und versenden, nur die
-- Schluessel selbst nicht sehen oder aendern.
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists api_keys_owner on public.api_keys;
create policy api_keys_admin on public.api_keys for all
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

-- ─────────────────────────────────────────────────────────────────────
-- workspace_members selbst
-- ─────────────────────────────────────────────────────────────────────
alter table public.workspace_members enable row level security;

-- Jedes Mitglied sieht, wer sonst im Workspace ist. Wer nicht weiss, wer
-- mitliest, arbeitet anders.
create policy members_select on public.workspace_members for select
  using (public.is_workspace_member(workspace_id));

create policy members_insert on public.workspace_members for insert
  with check (public.is_workspace_admin(workspace_id));
create policy members_update on public.workspace_members for update
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));
create policy members_delete on public.workspace_members for delete
  using (public.is_workspace_admin(workspace_id));

-- Der letzte Admin darf nicht verschwinden -- weder durch Entfernen noch
-- durch Herabstufen. Sonst steht ein Workspace ohne jemanden da, der noch
-- einladen oder Schluessel pflegen kann, und das laesst sich aus der App
-- heraus nicht mehr reparieren.
create or replace function public.guard_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_ws uuid := coalesce(old.workspace_id, new.workspace_id);
  remaining int;
begin
  -- Nur pruefen, wenn tatsaechlich ein Admin wegfaellt.
  if tg_op = 'UPDATE' and not (old.role = 'admin' and new.role <> 'admin') then
    return new;
  end if;
  if tg_op = 'DELETE' and old.role <> 'admin' then
    return old;
  end if;

  select count(*) into remaining
    from public.workspace_members m
   where m.workspace_id = target_ws and m.role = 'admin' and m.id <> old.id;

  if remaining = 0 then
    raise exception 'Der letzte Admin eines Workspaces kann nicht entfernt oder herabgestuft werden.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger trg_guard_last_admin
  before update or delete on public.workspace_members
  for each row execute function public.guard_last_admin();
revoke execute on function public.guard_last_admin() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Neu angelegter Workspace bekommt seinen Ersteller als Admin-Mitglied.
-- Als Trigger und nicht im Anwendungscode: workspaces werden an mehreren
-- Stellen angelegt (Umschalter im Frontend, handle_new_user beim Signup),
-- und ein Workspace ohne Mitglied waere fuer seinen eigenen Ersteller
-- unsichtbar -- der Fehler faende sich erst beim Nutzer.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, email, role, accepted_at)
  select new.id, new.owner_id, coalesce(u.email, ''), 'admin', now()
    from auth.users u where u.id = new.owner_id
  on conflict do nothing;
  return new;
end;
$$;
create trigger on_workspace_created after insert on public.workspaces
  for each row execute function public.handle_new_workspace();
revoke execute on function public.handle_new_workspace() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Signup: offene Einladungen annehmen.
--
-- Erweitert handle_new_user aus 0024 (Workspace + Trial-Abo). Neu ist der
-- erste Schritt und die Bedingung um den Workspace: wer eingeladen wurde,
-- bekommt KEINEN eigenen "Mein Workspace". Sonst stuende der als erster in
-- der Liste, und die erste Suche eines neuen Teammitglieds liefe im falschen
-- Workspace -- mit fremden Leads in der eigenen Liste.
--
-- Das Trial-Abo entsteht weiterhin fuer jeden: es haengt an owner_id, und
-- ein eingeladenes Mitglied koennte spaeter selbst einen Workspace anlegen.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  claimed int;
begin
  update public.workspace_members
     set user_id = new.id, accepted_at = now()
   where user_id is null and lower(email) = lower(new.email);
  get diagnostics claimed = row_count;

  if claimed = 0 then
    insert into public.workspaces (owner_id, name) values (new.id, 'Mein Workspace');
  end if;

  insert into public.subscriptions (owner_id) values (new.id);
  return new;
end;
$$;
