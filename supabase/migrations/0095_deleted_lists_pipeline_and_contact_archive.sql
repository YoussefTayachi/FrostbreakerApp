-- Geloeschte Listen: raus aus der Pipeline, rein ins Gedaechtnis.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ZWEI BESCHWERDEN, DIE ZUSAMMENGEHOEREN
-- ═══════════════════════════════════════════════════════════════════════
--
-- Gemeldet am 2026-08-14, an einem Workspace mit 792 Kontakten:
--
--   1. "Ich habe alle Lead-Listen geloescht und die Pipeline zeigt trotzdem
--      alle Leads." -- Stimmt. pipeline_rows (0061/0063) liess Kontakte aus
--      geloeschten Suchen stehen, sobald ihr Status nicht mehr 'new' war. Der
--      Gedanke dahinter war richtig (wer geantwortet hat, ist ein echter
--      Interessent), die Wirkung nicht: wer eine Liste loescht, hat sie in der
--      Regel komplett angeschrieben -- und sieht danach exakt dieselbe
--      Pipeline wie vorher. Der Papierkorb fuehlte sich kaputt an.
--
--   2. "Trotzdem sollen die Adressen irgendwo bleiben, damit ich sie nicht ein
--      zweites Mal anschreibe und nicht doppelt Credits verbrenne."
--
-- Beides ist dieselbe Muenze. Solange geloeschte Listen den Trichter
-- verstopfen, raeumt niemand auf; und solange Aufraeumen das Gedaechtnis
-- mitloescht, ist Aufraeumen teuer.
--
-- ═══════════════════════════════════════════════════════════════════════
-- TEIL 1 -- WER EINE GELOESCHTE LISTE UEBERLEBT
-- ═══════════════════════════════════════════════════════════════════════
--
-- Nur noch 'customer'. Ein gewonnener Kunde darf nicht verschwinden, bloss
-- weil die Liste, aus der er stammte, im Papierkorb liegt -- alles andere
-- verschwindet mit der Liste.
--
-- Das ist bewusst schaerfer als vorher und es kostet etwas: ein Kontakt auf
-- 'replied' oder 'meeting_booked' faellt mit aus der Ansicht. Rueckholbar ist
-- er trotzdem, denn der Papierkorb ist eine Ruecknahme entfernt (deleted_at
-- zurueck auf null, siehe search-actions.tsx) -- und angeschrieben wird er
-- dank Teil 2 auch dann nicht erneut, wenn die Liste endgueltig weg ist.
--
-- ═══════════════════════════════════════════════════════════════════════
-- TEIL 2 -- DAS GEDAECHTNIS (contact_archive)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Der Dublettenschutz (worker/dedupe.py) haengt heute an public.businesses:
-- eine Firma, bei der schon jemand angeschrieben wurde, wird von einer neuen
-- Suche uebersprungen -- auch wenn ihre Suche im Papierkorb liegt. Das haelt,
-- solange die Zeilen existieren. Beim endgueltigen Loeschen ("Papierkorb
-- leeren", search-actions.tsx) verschwinden businesses und ueber den
-- Fremdschluessel auch contacts -- und mit ihnen jeder Hinweis darauf, dass
-- diese Firma bereits bearbeitet wurde. Die naechste Suche kauft sie erneut,
-- bei Apollo rund zwei Credits pro Lead, und schreibt dieselben Menschen ein
-- zweites Mal an.
--
-- contact_archive ist deshalb kein Verlauf zum Nachlesen, sondern der
-- Ersatz-Dublettenschutz fuer genau diesen Fall. Aufgenommen wird nur, wer
-- nicht mehr auf 'new' steht: ein nie beruehrter Lead ist keine Geschichte,
-- und ihn spaeter wiederzufinden ist erwuenscht.
--
-- Warum ein Trigger und keine Zeile im Loesch-Knopf: es gibt drei Wege, auf
-- denen Kontakte verschwinden (Einzelloeschung, "Endgueltig loeschen",
-- "Papierkorb leeren") und jeder kuenftige vierte wuerde das Archiv
-- stillschweigend umgehen. In der Datenbank gibt es diesen vierten Weg nicht.
--
-- Warum ZWEI Trigger: beim Loeschen einer Firma raeumt der Fremdschluessel
-- ihre Kontakte hinterher weg -- zu diesem Zeitpunkt ist die Firmenzeile schon
-- fort, ihre Website (und damit die Domain, die der Dublettenschutz braucht)
-- also nicht mehr lesbar. Der Trigger auf businesses laeuft davor und sieht
-- noch alles. Der Trigger auf contacts ist das Netz fuer die Einzelloeschung;
-- doppelte Eintraege verhindert der Schluessel auf (workspace_id, contact_id).
--
-- KEIN Backfill: was vor dieser Migration geloescht wurde, ist weg. Eine
-- erfundene Rekonstruktion waere schlimmer als die ehrliche Luecke.

-- ── Domain-Normalisierung ────────────────────────────────────────────────
-- Gleiche Regel wie domainOf() in apps/web/lib/suppression.ts: Schema weg,
-- Pfad weg, bei einer E-Mail der Teil hinter dem @, fuehrendes www. weg.
-- Die beiden muessen zusammenpassen, sonst sperrt die eine Seite, was die
-- andere durchlaesst.
create or replace function public.domain_of(v text)
returns text language sql immutable as $$
  select nullif(
    regexp_replace(
      lower(
        split_part(
          split_part(regexp_replace(coalesce(v, ''), '^https?://', ''), '/', 1),
          '@',
          -1
        )
      ),
      '^www\.',
      ''
    ),
    ''
  );
$$;

create table if not exists public.contact_archive (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Die urspruengliche contacts.id, absichtlich ohne Fremdschluessel: die
  -- Zeile, auf die sie zeigt, existiert per Definition nicht mehr. Sie dient
  -- nur dazu, dass die beiden Trigger denselben Kontakt nicht zweimal ablegen.
  contact_id uuid,
  email text,
  domain text,
  full_name text,
  company_name text,
  outreach_status text not null,
  list_name text,
  contact_created_at timestamptz,
  archived_at timestamptz not null default now()
);

create unique index if not exists contact_archive_contact_ux
  on public.contact_archive (workspace_id, contact_id) where contact_id is not null;
-- Eine Adresse, ein Eintrag. Welcher Status dabei stehen bleibt, ist fuer den
-- Zweck gleichgueltig: 'contacted' und 'not_interested' sperren beide.
create unique index if not exists contact_archive_email_ux
  on public.contact_archive (workspace_id, email) where email is not null;
create index if not exists contact_archive_domain_idx
  on public.contact_archive (workspace_id, domain) where domain is not null;

alter table public.contact_archive enable row level security;
drop policy if exists contact_archive_owner on public.contact_archive;
create policy contact_archive_owner on public.contact_archive for all
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

-- ── Trigger ──────────────────────────────────────────────────────────────
--
-- security definer, weil beide auch im Zuge eines Fremdschluessel-Aufraeumens
-- laufen und dabei nicht an der eigenen RLS-Policy scheitern duerfen.
--
-- Die Existenzpruefung auf workspaces ist kein Zierrat: wird ein Workspace
-- (oder ein Konto) geloescht, raeumt der Fremdschluessel die Kontakte
-- hinterher weg -- die Workspace-Zeile ist zu diesem Zeitpunkt aber schon
-- fort. Ohne die Pruefung liefe das Loeschen eines Workspaces in eine
-- Fremdschluessel-Verletzung und schluege fehl.

create or replace function public.archive_contacts_of_business()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  insert into public.contact_archive (
    workspace_id, contact_id, email, domain, full_name,
    company_name, outreach_status, list_name, contact_created_at
  )
  select
    c.workspace_id,
    c.id,
    lower(nullif(btrim(c.email), '')),
    -- Firmen-Website zuerst: der Dublettenschutz vergleicht Domains, und die
    -- Adresse eines Kontakts kann bei einem Freemail-Postfach liegen.
    coalesce(public.domain_of(old.website), public.domain_of(c.email)),
    c.full_name,
    old.name,
    c.outreach_status,
    coalesce(s.name, s.query),
    c.created_at
  from public.contacts c
  left join public.searches s on s.id = old.search_id
  where c.business_id = old.id and c.outreach_status <> 'new'
  on conflict do nothing;
  return old;
end;
$$;

create or replace function public.archive_contact_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.outreach_status = 'new' then
    return old;
  end if;
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  insert into public.contact_archive (
    workspace_id, contact_id, email, domain, full_name,
    company_name, outreach_status, list_name, contact_created_at
  )
  select
    old.workspace_id,
    old.id,
    lower(nullif(btrim(old.email), '')),
    coalesce(public.domain_of(b.website), public.domain_of(old.email)),
    old.full_name,
    b.name,
    old.outreach_status,
    coalesce(s.name, s.query),
    old.created_at
  -- Beim Aufraeumen nach einer geloeschten Firma ist b bereits weg. Der
  -- Trigger auf businesses hat den Eintrag dann schon mit allen Angaben
  -- geschrieben und (workspace_id, contact_id) faengt diesen hier ab.
  from (select 1) as _
  left join public.businesses b on b.id = old.business_id
  left join public.searches s on s.id = b.search_id
  on conflict do nothing;
  return old;
end;
$$;

drop trigger if exists archive_contacts_before_business_delete on public.businesses;
create trigger archive_contacts_before_business_delete
  before delete on public.businesses
  for each row execute function public.archive_contacts_of_business();

drop trigger if exists archive_contact_before_delete on public.contacts;
create trigger archive_contact_before_delete
  before delete on public.contacts
  for each row execute function public.archive_contact_row();

-- ── pipeline_rows ────────────────────────────────────────────────────────
--
-- Unveraendert gegenueber 0063 bis auf die where-Zeile in "base". Der Rest
-- steht hier trotzdem vollstaendig, weil create or replace keine Teilaenderung
-- kennt -- die Begruendungen zu Telefonnummer und stage_since gelten weiter
-- und sind in 0063 nachzulesen.
create or replace function public.pipeline_rows(
  p_workspace_id uuid,
  p_limit integer default 1000
)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (
  select p_workspace_id as id where public.is_workspace_owner(p_workspace_id)
),
base as (
  select
    c.id,
    c.full_name,
    c.first_name,
    c.last_name,
    c.title,
    c.email,
    coalesce(c.phone, b.phone_national) as phone,
    (c.phone is null and b.phone_national is not null) as phone_is_company,
    c.linkedin,
    c.outreach_status,
    c.business_id,
    c.created_at,
    b.name          as company_name,
    b.website       as company_website,
    s.id            as list_id,
    coalesce(s.name, s.query) as list_name,
    s.location      as list_location,
    s.source        as list_source
  from public.contacts c
  join ws on ws.id = c.workspace_id
  join public.businesses b on b.id = c.business_id
  left join public.searches s on s.id = b.search_id
  -- Papierkorb: die Liste nimmt ihre Kontakte mit. Nur ein gewonnener Kunde
  -- bleibt stehen -- er gehoert nicht mehr der Liste, sondern dem Betrieb.
  -- s.id is null heisst: die Firma haengt an gar keiner Suche (mehr). Solche
  -- Kontakte hat niemand geloescht, sie bleiben sichtbar.
  where s.id is null or s.deleted_at is null or c.outreach_status = 'customer'
  order by c.created_at desc
  limit greatest(p_limit, 1)
)
select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
from (
  select
    base.*,
    out_touch.at        as last_touch_at,
    out_touch.channel   as last_touch_channel,
    (select max(coalesce(m.sent_at, m.created_at))
       from public.messages m
      where m.contact_id = base.id and m.direction = 'inbound') as last_reply_at,
    due.due_at          as next_due_at,
    due.subject         as next_due_subject,
    due.channel         as next_due_channel,
    due.type            as next_due_type,
    coalesce(
      (select max(h.changed_at)
         from public.contact_status_history h
        where h.contact_id = base.id
          and h.new_status = base.outreach_status),
      base.created_at
    ) as stage_since
  from base
  left join lateral (
    select t.at, t.channel from (
      select a.occurred_at as at, a.channel
        from public.activities a
       where a.contact_id = base.id and a.occurred_at is not null
      union all
      select coalesce(m.sent_at, m.created_at) as at, 'email' as channel
        from public.messages m
       where m.contact_id = base.id and m.direction = 'outbound'
    ) t
    where t.at is not null
    order by t.at desc
    limit 1
  ) out_touch on true
  left join lateral (
    select a.due_at, a.subject, a.channel, a.type
      from public.activities a
     where a.contact_id = base.id
       and a.completed_at is null
       and a.due_at is not null
     order by a.due_at asc
     limit 1
  ) due on true
) x;
$$;
revoke execute on function public.pipeline_rows(uuid, integer) from public, anon;
grant execute on function public.pipeline_rows(uuid, integer) to authenticated;
