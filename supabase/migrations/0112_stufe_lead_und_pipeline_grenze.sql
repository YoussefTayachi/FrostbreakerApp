-- Die Stufe 'lead', und eine Pipeline, die ihre spaeten Spalten wieder zeigt.
--
-- Drei Dinge, alle am 2026-09-12 am echten Bestand nachgemessen.
--
-- 1. ZWISCHEN "HAT GEANTWORTET" UND "TERMIN STEHT" FEHLT DIE ARBEIT.
--    30 Kontakte standen auf 'replied'. Darin: jede Abwesenheitsnotiz, jede
--    Absage, die freundlich begann, und die zwei, drei, mit denen gerade
--    geschrieben wird. Wer morgens in die Pipeline sieht, sucht die letzte
--    Sorte und muss sie aus den anderen heraussuchen. 'meeting_booked' ist
--    dafuer die falsche naechste Stufe: bei diesem Angebot laeuft der
--    Abschluss ueber einen Entwurf per Mail, nicht ueber einen
--    Kalendereintrag -- die Spalte stand deshalb bei 0.
--
-- 2. DIE PIPELINE ZEIGTE IHRE SPAETEN SPALTEN NICHT MEHR.
--    pipeline_rows nahm die 1000 zuletzt angelegten Kontakte. Von 5321
--    sichtbaren waren das ausschliesslich frische: das Brett zeigte
--    770 "Neu", 229 "Kontaktiert", 1 "Geantwortet" -- zusammen exakt die
--    1000 -- und "Kein Interesse" leer, obwohl 7 Kontakte darauf standen und
--    29 weitere auf 'replied'. Die Grenze schnitt genau das weg, wofuer man
--    eine Pipeline aufmacht.
--
-- 3. EINE ABMELDUNG IM BETREFF WAR KEINE.
--    Betreff "STOP", Text "Wish you all the best. Website is good for us."
--    Die Erkennung sah nur den Text, fand dort keine Abmeldeformel, und die
--    Adresse blieb von der Sperrliste fern. Der Code dazu steht in
--    lib/crm/opt-out.ts; hier wird der eine bereits eingegangene Fall
--    nachgetragen.

-- ── 1. Die Stufe ─────────────────────────────────────────────────────────
--
-- Die Rangfolge steht an drei Stellen und muss gleich bleiben:
-- lib/crm/stages.ts (STAGE_RANK), app/api/cron/instantly-sync (STATUS_RANK)
-- und hier. 'lead' liegt zwischen 'replied' und 'meeting_booked'.
alter table public.contacts drop constraint contacts_outreach_status_check;
alter table public.contacts
  add constraint contacts_outreach_status_check
  check (outreach_status in (
    'new', 'contacted', 'replied', 'lead', 'meeting_booked', 'customer', 'not_interested'
  ));

-- Die Aufgabe "Antwort beantworten" haengt an 'replied'. Seit eine als
-- 'interested' eingestufte Antwort direkt auf 'lead' hebt, bliebe sie sonst
-- ausgerechnet bei den Antworten aus, auf die es ankommt. Der Rest der
-- Funktion ist wortgleich aus 0066; Postgres kennt kein "Teil einer Funktion
-- ersetzen".
create or replace function public.apply_status_automations()
returns trigger language plpgsql security definer set search_path = public as $$
declare rule record;
begin
  if new.outreach_status is not distinct from old.outreach_status then
    return new;
  end if;

  -- Lead hat geantwortet: binnen 24 Stunden zurueckmelden. Bei Kaltakquise
  -- ist das genau das Fenster, in dem eine Antwort noch warm ist.
  if new.outreach_status in ('replied', 'lead') then
    select * into rule from public.automation_rules
     where workspace_id = new.workspace_id and kind = 'reply_followup' and enabled;
    if found then
      perform public.automation_create_task(
        new.workspace_id, new.id, 'Antwort beantworten', 1
      );
    end if;
  end if;

  -- Termin gebucht: vorbereiten. Ein unvorbereiteter Termin ist ein
  -- verschenkter Termin.
  if new.outreach_status = 'meeting_booked' then
    select * into rule from public.automation_rules
     where workspace_id = new.workspace_id and kind = 'meeting_prep' and enabled;
    if found then
      perform public.automation_create_task(
        new.workspace_id, new.id, 'Termin vorbereiten', 1
      );
    end if;
  end if;

  return new;
end $$;
revoke execute on function public.apply_status_automations() from public, anon, authenticated;

-- Und die Erinnerung an Liegengebliebenes gilt fuer 'lead' erst recht: ein
-- Gespraech, das seit Wochen steht, ist genau der Fall, fuer den es sie gibt.
-- Geaendert ist allein die Statusliste der ersten Regel, der Rest ist
-- wortgleich aus 0082.
create or replace function public.run_time_automations()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rule record;
  target record;
  created integer := 0;
  total integer := 0;
  linkedin_created integer := 0;
  calls_created integer := 0;
begin
  for rule in
    select * from public.automation_rules
     where kind = 'stale_reminder'
       and enabled
       and (last_run_at is null or last_run_at < now() - interval '20 hours')
  loop
    created := 0;

    for target in
      select c.id
        from public.contacts c
       where c.workspace_id = rule.workspace_id
         and c.outreach_status in ('contacted', 'replied', 'lead', 'meeting_booked')
         and not exists (
           select 1 from public.activities a
            where a.contact_id = c.id
              and a.completed_at is null
              and a.due_at is not null
         )
         and coalesce(
               greatest(
                 (select max(a.occurred_at) from public.activities a where a.contact_id = c.id),
                 (select max(coalesce(m.sent_at, m.created_at)) from public.messages m where m.contact_id = c.id)
               ),
               c.created_at
             ) < now() - make_interval(days => coalesce((rule.config->>'days')::int, 30))
       limit 25
    loop
      if public.automation_create_task(rule.workspace_id, target.id, 'Wieder melden', 0) then
        created := created + 1;
      end if;
    end loop;

    update public.automation_rules set last_run_at = now() where id = rule.id;
    total := total + created;
  end loop;

  -- KETTE, SCHRITT 2: keine Antwort -> LinkedIn
  for rule in
    select * from public.automation_rules
     where kind = 'no_reply_linkedin'
       and enabled
       and (last_run_at is null or last_run_at < now() - interval '20 hours')
  loop
    created := 0;

    for target in
      select c.id
        from public.contacts c
       where c.workspace_id = rule.workspace_id
         and c.outreach_status = 'contacted'
         -- Ohne Profil gibt es nichts anzuklicken. Eine Aufgabe "auf LinkedIn
         -- anschreiben" ohne Adresse ist eine Recherche-Aufgabe, und die
         -- gehoert nicht in eine Arbeitsliste, die man abarbeiten soll.
         and coalesce(c.linkedin, '') <> ''
         -- NEU (0082): wer auf LinkedIn schon angeschrieben wurde, bekommt
         -- die Aufgabe nicht noch einmal. Bei der urspruenglichen Mail-first-
         -- Kette konnte das nicht vorkommen -- dort war die LinkedIn-Nachricht
         -- immer erst die Folge dieser Aufgabe. Beim LinkedIn-first-Ablauf ist
         -- sie das Erste, was passiert, und die Regel haette drei Tage spaeter
         -- eine Aufgabe fuer jeden bereits angeschriebenen Kontakt erzeugt.
         -- Die Doppelungssperre in automation_create_touch greift dort nicht:
         -- sie sieht nur OFFENE Aufgaben, und eine protokollierte Nachricht
         -- ist eine erledigte.
         and not exists (
           select 1 from public.activities a
            where a.contact_id = c.id
              and a.channel = 'linkedin'
              and a.completed_at is not null
         )
         and not exists (
           select 1 from public.activities a
            where a.contact_id = c.id
              and a.completed_at is null
              and a.due_at is not null
         )
         -- Gemessen an der letzten ausgehenden Mail: das ist der Beginn des
         -- Wartens. Die Aktivitaeten des Kontakts spielen hier keine Rolle,
         -- weil es bei 'contacted' noch keine geben kann.
         and coalesce(
               (select max(coalesce(m.sent_at, m.created_at)) from public.messages m
                 where m.contact_id = c.id and m.direction = 'outbound'),
               c.created_at
             ) < now() - make_interval(days => coalesce((rule.config->>'days')::int, 3))
       limit 25
    loop
      if public.automation_create_touch(
           rule.workspace_id, target.id, 'Auf LinkedIn anschreiben', 0, 'message', 'linkedin'
         ) then
        created := created + 1;
      end if;
    end loop;

    update public.automation_rules set last_run_at = now() where id = rule.id;
    linkedin_created := linkedin_created + created;
  end loop;

  -- KETTE, SCHRITT 3: immer noch keine Antwort -> anrufen
  for rule in
    select * from public.automation_rules
     where kind = 'no_reply_call'
       and enabled
       and (last_run_at is null or last_run_at < now() - interval '20 hours')
  loop
    created := 0;

    for target in
      select c.id
        from public.contacts c
        left join public.businesses b on b.id = c.business_id
       where c.workspace_id = rule.workspace_id
         and c.outreach_status = 'contacted'
         -- Die Firmennummer zaehlt mit. Gemessen am 2026-08-03 hatten 1196
         -- Kontakte ausschliesslich businesses.phone_national -- nur auf
         -- contacts.phone zu schauen haette die Regel fast leer laufen lassen.
         and (coalesce(c.phone, '') <> '' or coalesce(b.phone_national, '') <> '')
         and not exists (
           select 1 from public.activities a
            where a.contact_id = c.id
              and a.completed_at is null
              and a.due_at is not null
         )
         and coalesce(
               greatest(
                 (select max(a.occurred_at) from public.activities a where a.contact_id = c.id),
                 (select max(coalesce(m.sent_at, m.created_at)) from public.messages m
                   where m.contact_id = c.id and m.direction = 'outbound')
               ),
               c.created_at
             ) < now() - make_interval(days => coalesce((rule.config->>'days')::int, 7))
       limit 25
    loop
      if public.automation_create_touch(
           rule.workspace_id, target.id, 'Anrufen', 0, 'call', 'phone'
         ) then
        created := created + 1;
      end if;
    end loop;

    update public.automation_rules set last_run_at = now() where id = rule.id;
    calls_created := calls_created + created;
  end loop;

  return jsonb_build_object(
    'tasks_created', total,
    'linkedin_created', linkedin_created,
    'calls_created', calls_created
  );
end $$;
revoke execute on function public.run_time_automations() from public, anon, authenticated;

-- ── 2. pipeline_rows: die spaeten Spalten sind immer vollstaendig ─────────
--
-- Die Grenze bleibt, sie gilt nur noch dort, wo sie hingehoert. 'new' und
-- 'contacted' sind die beiden Spalten, die mit jeder Suche um Tausende
-- wachsen und die niemand vollstaendig durchsieht -- fuer sie bleibt es beim
-- Fenster der zuletzt angelegten Kontakte. Alles ab 'replied' kommt
-- vollstaendig: das sind die Kontakte, die reagiert haben, ihre Zahl waechst
-- nicht mit der Listengroesse, sondern mit dem Erfolg, und ein fehlender
-- darunter ist genau der, den man sucht. Am 2026-09-12 waren es 37 von 5321.
--
-- Unveraendert gegenueber 0095 bis auf diese Aufteilung in "base"; die
-- Begruendungen zu Telefonnummer und stage_since stehen in 0063.
create or replace function public.pipeline_rows(
  p_workspace_id uuid,
  p_limit integer default 1000
)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (
  select p_workspace_id as id where public.is_workspace_owner(p_workspace_id)
),
sichtbar as (
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
),
base as (
  select * from sichtbar
   where outreach_status not in ('new', 'contacted')
  union all
  select * from (
    select * from sichtbar
     where outreach_status in ('new', 'contacted')
     order by created_at desc
     limit greatest(p_limit, 1)
  ) frisch
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

-- ── 3. Die Abmeldung im Betreff nachtragen ───────────────────────────────
--
-- Der laufende Sync sieht eine einmal gespeicherte Mail nie wieder (er steigt
-- bei bekannter instantly_email_id sofort aus), die Korrektur im Code greift
-- also nur fuer kuenftige Antworten. Dieses Muster ist absichtlich enger als
-- das in opt-out.ts: nur ein Betreff, der AUSSER dem Abmeldewort nichts
-- enthaelt. Am 2026-09-12 trifft es genau eine Nachricht. Eine faelschlich
-- gesperrte Adresse bekaeme nie wieder Post -- deshalb im Zweifel keine.
insert into public.suppression_list (workspace_id, email, reason)
select distinct m.workspace_id, lower(m.from_email), 'unsubscribed'
  from public.messages m
 where m.direction = 'inbound'
   and m.from_email is not null
   and regexp_replace(coalesce(m.subject, ''), '^\s*((re|aw|fw|fwd|wg)\s*:\s*)+', '', 'i')
       ~* '^\s*(stop|unsubscribe|opt[ -]?out|abmelden|austragen|remove me)[\s.!]*$'
on conflict do nothing;

-- Und den Kontakt dazu auf "kein Interesse". Wer sich abmeldet, hat keins;
-- ohne diese Zeile stuende er weiter als offene Antwort im Trichter.
update public.contacts c
   set outreach_status = 'not_interested'
 where c.outreach_status <> 'not_interested'
   and exists (
     select 1 from public.messages m
      where m.contact_id = c.id
        and m.direction = 'inbound'
        and regexp_replace(coalesce(m.subject, ''), '^\s*((re|aw|fw|fwd|wg)\s*:\s*)+', '', 'i')
            ~* '^\s*(stop|unsubscribe|opt[ -]?out|abmelden|austragen|remove me)[\s.!]*$'
   );
