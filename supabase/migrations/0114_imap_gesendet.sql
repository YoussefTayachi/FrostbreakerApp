-- Was du selbst schreibst, soll auch in der App stehen.
--
-- GEMESSEN AM 2026-09-12, an Ken Vallens (kvallens@ctscement.com):
--
--   Instantly kennt zu diesem Thread     5 Mails
--   Frostbreaker kennt                   dieselben 5
--   Youssefs eigene Antworten aus IONOS  0 von 4
--       (30.08., 01.09. zweimal, 12.09. um 08:04)
--
-- Der Sync arbeitet korrekt, er holt alles, was da ist. Die Luecke sitzt
-- eine Stufe frueher: Instantlys Hilfeseite zu Unibox V2 sagt, dass
-- EINGEHENDE Mails synchronisiert werden. Der Gesendet-Ordner eines
-- verbundenen Postfachs wird nicht gelesen. Was ueber IONOS, das Handy oder
-- irgendeinen anderen Client hinausgeht, sieht Instantly nie, und damit
-- kann Frostbreaker es auch nicht zeigen.
--
-- Das ist keine reine Anzeigeluecke. In der Pipeline stand als "letzter
-- eigener Kontakt" bei Ken der 28.08. (die Kampagnenmail), obwohl am selben
-- Morgen eine Antwort rausging. Die Erinnerungs-Automatik haette ihn als
-- liegengeblieben gemeldet.
--
-- Frostbreaker liest das Postfach deshalb selbst, per IMAP, an Instantly
-- vorbei. Nur der Gesendet-Ordner: die Eingaenge liefert Instantly bereits
-- vollstaendig, und beide Quellen fuer dasselbe zu fahren waere doppelte
-- Arbeit mit doppelter Fehlerquelle.

-- ── Der gemeinsame Schluessel beider Quellen ─────────────────────────────
--
-- Die RFC-822-Message-ID. Instantly liefert sie in jedem Mailobjekt mit
-- (Feld message_id, am 2026-09-12 an einer echten Mail geprueft), und im
-- IMAP-Ordner steht sie im Kopf derselben Mail. Damit laesst sich sagen
-- "diese Mail steht schon da", ohne auf Betreff und Zeitstempel zu raten.
--
-- Partiell unique: Altbestand hat keine, und null ist hier kein Fehler,
-- sondern "noch nicht bekannt". Ein gewoehnlicher Unique-Index waere daran
-- nicht gescheitert (null kollidiert in Postgres nie), der partielle sagt
-- die Absicht aber ausdruecklich.
alter table public.messages add column if not exists message_id text;
create unique index if not exists messages_workspace_message_id_key
  on public.messages (workspace_id, message_id)
  where message_id is not null;

-- ── Die Postfaecher, die Frostbreaker selbst liest ───────────────────────
create table if not exists public.imap_mailboxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Die Adresse, unter der die Mails rausgehen. Entspricht messages.eaccount
  -- und dem Postfach in Instantly; darueber gehoeren beide Quellen zusammen.
  email text not null,
  host text not null,
  port integer not null default 993,
  username text not null,
  -- Fernet, derselbe APP_ENCRYPTION_KEY wie bei api_keys.key_ciphertext.
  -- Bewusst NICHT in api_keys mit abgelegt: dort steht je Provider genau ein
  -- Geheimnis, hier gehoeren Host, Port und Benutzername dazu, und ein
  -- Postfach-Passwort ist etwas anderes als ein API-Schluessel.
  password_ciphertext text not null,
  -- Null heisst: beim Verbinden selbst suchen (IMAP kennzeichnet den Ordner
  -- ueber \Sent, die Namen unterscheiden sich je Anbieter und Sprache).
  sent_folder text,
  enabled boolean not null default true,
  -- Der Wasserstand. UIDVALIDITY gehoert zwingend dazu: benennt der Server
  -- den Ordner neu oder baut ihn um, beginnt die UID-Zaehlung von vorn, und
  -- ein alter last_uid wuerde dann alles Neue ueberspringen.
  last_uid bigint,
  uid_validity bigint,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create unique index if not exists imap_mailboxes_workspace_email_key
  on public.imap_mailboxes (workspace_id, lower(email));

alter table public.imap_mailboxes enable row level security;
-- Wie api_keys: ein Postfach-Passwort ist Sache der Workspace-Verwaltung,
-- nicht jedes Mitglieds. Der Worker liest mit Service-Role an RLS vorbei.
drop policy if exists imap_mailboxes_admin on public.imap_mailboxes;
create policy imap_mailboxes_admin on public.imap_mailboxes
  for all using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

-- ── Der Job, der das Lesen erledigt ──────────────────────────────────────
--
-- Im Python-Worker und nicht als Vercel-Route: IMAP ist eine langlebige
-- TCP-Verbindung, imaplib liegt in der Standardbibliothek, und der Worker
-- laeuft ohnehin durch. Eine serverlose Funktion mit 60 Sekunden Deckel und
-- einer zusaetzlichen npm-Abhaengigkeit waere der schlechtere Ort.
--
-- Das Einreihen braucht kein HTTP und kein Geheimnis, es ist ein INSERT.
-- Die not-exists-Bedingung ist der ganze Trick: laeuft oder wartet noch ein
-- Job fuer dieses Postfach, kommt keiner dazu. Ohne sie haette ein
-- haengendes Postfach nach einer Stunde zwoelf Jobs in der Schlange.
create or replace function public.enqueue_sent_sync()
returns integer language plpgsql security definer set search_path = public as $$
declare eingereiht integer;
begin
  insert into public.jobs (workspace_id, type, payload)
  select m.workspace_id, 'sync_sent', jsonb_build_object('mailbox_id', m.id)
    from public.imap_mailboxes m
   where m.enabled
     and not exists (
       select 1 from public.jobs j
        where j.type = 'sync_sent'
          and j.status in ('pending', 'running')
          and j.payload->>'mailbox_id' = m.id::text
     );
  get diagnostics eingereiht = row_count;
  return eingereiht;
end $$;
revoke execute on function public.enqueue_sent_sync() from public, anon, authenticated;

-- Alle fuenf Minuten, also im selben Takt wie der Instantly-Mailbox-Sync.
-- Haeufiger brauchte es einen Grund: eine selbst geschriebene Mail ist keine
-- Antwort, auf die jemand wartet, sie soll nur nicht verlorengehen.
select cron.schedule(
  'sent-sync-enqueue',
  '*/5 * * * *',
  $$select public.enqueue_sent_sync()$$
);
