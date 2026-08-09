-- LinkedIn zuerst, Mail danach -- und niemand zweimal.
--
-- ANLASS
--
-- Ein neues Postfach braucht zwei bis vier Wochen Warmup. Wer heute anfaengt,
-- kann in dieser Zeit nicht mailen -- wohl aber auf LinkedIn schreiben. Der
-- naheliegende Ablauf ist deshalb umgekehrt zu dem, was 0074 annimmt:
--
--   Woche 1-2   LinkedIn-Arbeitsliste abarbeiten, Antworten eintragen
--   ab Woche 3  Mail-Kampagne -- aber nur an die, die NICHT geantwortet haben
--
-- WAS DAFUER GEBAUT WURDE, UND WO
--
-- Der Ausschluss der Antwortenden liegt bewusst NICHT hier, sondern in
-- lib/contacts.ts (isColdContactable): eine Antwort setzt contacts
-- .outreach_status auf 'replied'/'meeting_booked'/'not_interested', und alle
-- vier Wege in eine Kampagne fragen dieselbe Funktion. Damit gibt es keine
-- Kanal-Sonderregel, die beim naechsten Kanal noch einmal geschrieben werden
-- muesste -- und die Kette unten profitiert davon ohne eine Zeile Aenderung,
-- weil ihre drei Schritte ohnehin nur ueber 'contacted' laufen.
--
-- WAS HIER TATSAECHLICH FEHLTE
--
-- Genau eine Bedingung, und sie faellt nur im LinkedIn-first-Ablauf auf:
-- Schritt 2 der Kette pruefte nicht, ob auf LinkedIn bereits geschrieben
-- wurde. Sie misst die Wartezeit ab der letzten ausgehenden MAIL, und wenn es
-- keine gibt, ab contacts.created_at. Drei Tage nach dem Anlegen der Leads
-- haette sie also fuer jeden bereits angeschriebenen Kontakt eine Aufgabe
-- "Auf LinkedIn anschreiben" erzeugt -- also fuer genau die Liste, die man
-- gerade abgearbeitet hat.
--
-- Der Rest der Funktion ist wortgleich aus 0074 uebernommen; Postgres kennt
-- kein "Teil einer Funktion ersetzen".

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
