-- Automatisierungen: kein Vorgang ohne naechsten Schritt.
--
-- Das Pipeline-Board sagt es am 2026-08-03 sehr deutlich:
--
--   Neu          515 Kontakte, 515 ohne naechsten Schritt
--   Kontaktiert   54 Kontakte,  53 ohne naechsten Schritt
--   Geantwortet    1 Kontakt,    1 ohne naechsten Schritt
--
-- Praktisch niemand hat eine geplante Folgehandlung. Genau das ist die Luecke,
-- fuer die Pipedrive seine Automatisierungen anbietet -- ihre sechs
-- vorgeschlagenen Vorlagen sagen alle dasselbe: kein Vorgang ohne naechsten
-- Schritt, keiner bleibt unbemerkt liegen.
--
-- ZWEI ARTEN VON REGELN, ZWEI AUSFUEHRUNGSWEGE:
--
--   Ereignis   "Lead antwortet"      -> Trigger auf contacts, sofort
--   Zeit       "seit 30 Tagen nichts" -> Tageslauf, vom Cron angestossen
--
-- Ein einziger Mechanismus fuer beides waere entweder traege (ein Tageslauf
-- fuer eine Antwort, auf die man binnen Stunden reagieren sollte) oder
-- verschwenderisch (ein Trigger, der jede Minute die ganze Tabelle prueft).
--
-- IDEMPOTENZ ist bei beiden der heikle Teil. Eine Regel, die bei jedem Lauf
-- erneut eine Aufgabe anlegt, erzeugt binnen einer Woche hunderte Karteileichen
-- und macht die Anrufliste unbrauchbar -- also genau das Gegenteil dessen,
-- wofuer sie da ist. Beide Regelarten pruefen deshalb vorher, ob fuer den
-- Kontakt bereits eine offene Aufgabe existiert. Bei den zeitbasierten Regeln
-- ist das zugleich die Bedingung selbst: sobald eine Aufgabe entsteht, trifft
-- die Regel nicht mehr zu. Sie begrenzt sich damit von allein.

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Feste Auswahl statt freier Baukasten. Pipedrive zeigt seinen Nutzern
  -- sechs fertige Karten mit Vorschau, keinen leeren Editor -- niemand baut
  -- sich eine Automatisierung aus dem Nichts. Neue Regeln kommen hier als
  -- Wert dazu, nicht als Konfiguration in der Oberflaeche.
  kind text not null check (kind in ('reply_followup', 'meeting_prep', 'stale_reminder')),
  enabled boolean not null default false,
  -- Nur das, was der Nutzer je Regel einstellen kann (z.B. {"days": 30}).
  config jsonb not null default '{}'::jsonb,
  -- Nur fuer zeitbasierte Regeln: wann lief der Tageslauf zuletzt.
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  -- Jede Regelart hoechstens einmal je Workspace.
  unique (workspace_id, kind)
);

alter table public.automation_rules enable row level security;
create policy automation_rules_owner on public.automation_rules for all
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

/**
 * Legt eine Aufgabe an, sofern fuer diesen Kontakt keine offene existiert.
 *
 * Die gemeinsame Sicherung gegen Doppelungen -- von beiden Regelarten
 * benutzt. Gibt true zurueck, wenn tatsaechlich etwas angelegt wurde, damit
 * der Tageslauf zaehlen kann, was er getan hat.
 *
 * Faelligkeit auf Tagesende, wie ueberall sonst (ActivityComposer,
 * Rueckruf-Knopf): sonst gilt die Aufgabe ab 00:00 als ueberfaellig.
 */
create or replace function public.automation_create_task(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_subject text,
  p_days integer
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
    'task',
    null,
    p_subject,
    (current_date + p_days)::timestamptz + interval '23 hours 59 minutes 59 seconds'
  );
  return true;
end $$;
revoke execute on function public.automation_create_task(uuid, uuid, text, integer)
  from public, anon, authenticated;

/**
 * Ereignisregeln: haengen am Statuswechsel eines Kontakts.
 *
 * Als eigener Trigger neben log_contact_status_change (Migration 0032) und
 * nicht in dieselbe Funktion hineingeschrieben: dort wird Historie
 * protokolliert, hier werden Seiteneffekte ausgeloest. Zwei Aufgaben, zwei
 * Trigger -- sonst haette ein Fehler in der Automatisierung die
 * Statushistorie mit blockiert.
 *
 * Die Betreffzeilen stehen bewusst hier und nicht in der Oberflaeche: sie
 * landen in der Datenbank und muessen auch dann stimmen, wenn die Regel von
 * einem Cron statt von einem Browser ausgeloest wird. Deutsch, weil die App
 * auf Deutsch bedient wird; eine Uebersetzung waere nur dann richtig, wenn
 * die Sprache am Workspace haengen wuerde, und das tut sie nicht.
 */
create or replace function public.apply_status_automations()
returns trigger language plpgsql security definer set search_path = public as $$
declare rule record;
begin
  if new.outreach_status is not distinct from old.outreach_status then
    return new;
  end if;

  -- Lead hat geantwortet: binnen 24 Stunden zurueckmelden. Bei Kaltakquise
  -- ist das genau das Fenster, in dem eine Antwort noch warm ist.
  if new.outreach_status = 'replied' then
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

create trigger contacts_status_automations
  after update of outreach_status on public.contacts
  for each row execute function public.apply_status_automations();

/**
 * Zeitregeln: einmal am Tag ueber den Bestand.
 *
 * Wird vom Cron aufgerufen (api/cron/instantly-sync, laeuft jede Minute) --
 * die Bremse sitzt deshalb HIER und nicht im Aufrufer: last_run_at verhindert,
 * dass daraus ein Minutenlauf wird. Der Aufrufer muss davon nichts wissen.
 *
 * 20 Stunden statt 24, damit sich der Lauf nicht taeglich nach hinten
 * schiebt und irgendwann mitten in der Nacht liegt.
 */
create or replace function public.run_time_automations()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rule record;
  target record;
  created integer := 0;
  total integer := 0;
begin
  for rule in
    select * from public.automation_rules
     where kind = 'stale_reminder'
       and enabled
       and (last_run_at is null or last_run_at < now() - interval '20 hours')
  loop
    created := 0;

    -- Kontakte, an denen etwas laeuft, die aber liegengeblieben sind.
    -- Bewusst NICHT 'new': ein unberuehrter Lead in einer Sequenz ist kein
    -- Versaeumnis, sondern der Normalfall. Und bewusst nicht 'customer' oder
    -- 'not_interested': das sind Ergebnisse, keine offenen Vorgaenge.
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
         -- Seit wann unberuehrt? Letzte Aktivitaet oder letzte Nachricht,
         -- was spaeter war. Ohne beides gilt der Kontakt selbst als Datum.
         and coalesce(
               greatest(
                 (select max(a.occurred_at) from public.activities a where a.contact_id = c.id),
                 (select max(coalesce(m.sent_at, m.created_at)) from public.messages m where m.contact_id = c.id)
               ),
               c.created_at
             ) < now() - make_interval(days => coalesce((rule.config->>'days')::int, 30))
       -- Obergrenze je Lauf: eine Regel, die beim ersten Einschalten
       -- fuenfhundert Aufgaben erzeugt, macht die Anrufliste unbrauchbar und
       -- wird sofort wieder abgeschaltet. Lieber ueber Tage einsickern.
       limit 25
    loop
      if public.automation_create_task(
           rule.workspace_id, target.id, 'Wieder melden', 0
         ) then
        created := created + 1;
      end if;
    end loop;

    update public.automation_rules set last_run_at = now() where id = rule.id;
    total := total + created;
  end loop;

  return jsonb_build_object('tasks_created', total);
end $$;
revoke execute on function public.run_time_automations() from public, anon, authenticated;
