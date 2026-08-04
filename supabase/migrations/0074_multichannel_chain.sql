-- Multichannel als EINE Kette statt drei getrennter Listen.
--
-- Die App hat alle drei Kanaele: Mail-Kampagne, LinkedIn-Arbeitsliste,
-- Anrufliste. Sie hat auch die Pipeline darunter. Was fehlte, war die
-- Verkettung -- der Nutzer musste selbst merken, dass ein Lead vor vier Tagen
-- angeschrieben wurde und nicht geantwortet hat, und ihn selbst in die
-- naechste Liste schieben. Genau das passiert im Alltag nicht, und deshalb
-- endet die Akquise fuer die meisten Leads nach einer Mail.
--
-- Das ist die Stelle, an der die App etwas kann, das die grossen
-- Cold-Mail-Werkzeuge nicht koennen: Instantly kennt kein LinkedIn und kein
-- Telefon, Pipedrive kennt keine Kampagne. Hier liegt beides in einer
-- Datenbank, und die Kette ist damit nur noch eine Regel.
--
-- DIE KETTE
--
--   Tag 0   Mail geht raus                (Instantly, wie bisher)
--   Tag 3   keine Antwort -> LinkedIn     (neue Regel no_reply_linkedin)
--   Tag 7   keine Antwort -> Anruf        (neue Regel no_reply_call)
--
-- Beide Regeln sind zeitbasiert und laufen im Tageslauf mit, den es seit
-- Migration 0066 gibt. Bewusst als zwei Regeln und nicht als eine
-- konfigurierbare Kette: eine Kette waere ein Baukasten, und niemand baut
-- sich eine Automatisierung aus dem Nichts zusammen (siehe die Begruendung
-- fuer die feste Auswahl in 0066). Zwei Karten zum Einschalten, mit je einer
-- Zahl -- das schaltet man ein, ein Baukasten bleibt leer.
--
-- WARUM DIE REIHENFOLGE VON ALLEIN STIMMT
--
-- automation_create_touch legt nichts an, solange eine offene Aufgabe
-- existiert -- dieselbe Sicherung wie in 0066. Dadurch entsteht der Anruf
-- erst, wenn die LinkedIn-Anfrage abgehakt ist. Die Kette braucht keinen
-- eigenen Zustand: der naechste Schritt ergibt sich daraus, dass der
-- vorherige erledigt ist.

alter table public.automation_rules drop constraint automation_rules_kind_check;
alter table public.automation_rules add constraint automation_rules_kind_check
  check (kind in ('reply_followup', 'meeting_prep', 'stale_reminder', 'no_reply_linkedin', 'no_reply_call'));

/**
 * Wie automation_create_task, aber mit Kanal und Art.
 *
 * 0066 legt ausschliesslich type='task' ohne Kanal an -- fuer "Wieder melden"
 * genau richtig. Eine LinkedIn-Anfrage und ein Anruf sind aber keine Notizen,
 * sondern Handgriffe in einem bestimmten Kanal: nur so landen sie in der
 * LinkedIn-Arbeitsliste bzw. in der Anrufliste, statt in einer allgemeinen
 * Aufgabenliste zu versauern, die niemand oeffnet.
 *
 * Die Doppelungssperre ist wortgleich dieselbe wie dort, und das ist Absicht:
 * eine Regel, die bei jedem Lauf erneut anlegt, erzeugt binnen einer Woche
 * hunderte Karteileichen.
 */
create or replace function public.automation_create_touch(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_subject text,
  p_days integer,
  p_type text,
  p_channel text
)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.activities a
     where a.contact_id = p_contact_id
       and a.completed_at is null
       and a.due_at is not null
  ) then
    return false;
  end if;

  insert into public.activities (workspace_id, contact_id, type, channel, subject, due_at)
  values (
    p_workspace_id,
    p_contact_id,
    p_type,
    p_channel,
    p_subject,
    -- Tagesende, wie ueberall sonst -- sonst gilt die Aufgabe ab 00:00 als
    -- ueberfaellig und die Anrufliste ist morgens schon rot.
    (current_date + p_days)::timestamptz + interval '23 hours 59 minutes 59 seconds'
  );
  return true;
end $$;
revoke execute on function public.automation_create_touch(uuid, uuid, text, integer, text, text)
  from public, anon, authenticated;

/**
 * Der Tageslauf, jetzt mit den beiden Kettenregeln.
 *
 * Ersetzt die Fassung aus 0066 vollstaendig; der stale_reminder-Teil ist
 * unveraendert uebernommen.
 *
 * Die Kettenregeln gelten ausschliesslich fuer outreach_status = 'contacted'.
 * Nicht 'new' (da ist noch gar nichts rausgegangen, es gibt nichts
 * nachzufassen) und ausdruecklich nicht 'replied' oder weiter -- wer
 * geantwortet hat, braucht keine LinkedIn-Anfrage, sondern eine Antwort. Das
 * ist der Unterschied zwischen einer Kette und einem Verfolgungsapparat.
 */
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
         and c.outreach_status in ('contacted', 'replied', 'meeting_booked')
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
