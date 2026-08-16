-- Eine Mehrfach-Suche ist EINE Liste, nicht sechzig.
--
-- ═══════════════════════════════════════════════════════════════════════
-- DER ANLASS
-- ═══════════════════════════════════════════════════════════════════════
--
-- Am 2026-08-16 hat eine Laender-Abdeckung (4 Nischen x 15 Staedte) sechzig
-- Zeilen in searches angelegt -- und damit sechzig Eintraege auf der
-- Suchen-Seite, jeder mit eigenem Namen, eigenem Fortschritt und eigener
-- Lead-Liste. Der Nutzer hat EINEN Suchauftrag gestartet und sechzig Listen
-- bekommen. Genau das war schon beim handgetippten Fanout (mehrere Nischen
-- und Orte kommagetrennt) so, faellt aber erst bei sechzig auf.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WARUM GRUPPIERUNG UND NICHT EIN JOB FUER ALLE STAEDTE
-- ═══════════════════════════════════════════════════════════════════════
--
-- Die naheliegende Alternative waere gewesen, EINEN get_businesses-Job sechzig
-- Staedte nacheinander abarbeiten zu lassen. Das haette alles neu erfinden
-- muessen, was hier bereits steht und laeuft:
--
--   * eigener Retry je Teilsuche (jobs.attempts)
--   * Stornierung je Teilsuche (cancel_search, 0086)
--   * Rueckholen haengender Jobs nach 15 Minuten (0047)
--   * Verteilung auf beide Worker-Replicas -- ein Sammel-Job wuerde einen
--     Worker fuer die gesamte Dauer blockieren
--   * Fortschritts-Checkpointing bei Teilausfall (gibt es dann gar nicht:
--     stirbt der Job bei Stadt 47, faengt er von vorne an und kauft 46 Staedte
--     ein zweites Mal ein)
--
-- Die Buendelung passiert deshalb rein auf der Anzeigeebene. Die einzelnen
-- Jobs laufen exakt wie bisher, der Worker weiss von dieser Migration nichts.
--
-- ═══════════════════════════════════════════════════════════════════════
-- KEINE RUECKWIRKUNG AUF BESTAND
-- ═══════════════════════════════════════════════════════════════════════
--
-- Kein Backfill. Bestehende Suchen haben parent_search_id = null und
-- is_search_group = false und verhalten sich damit exakt wie vorher. Die am
-- 2026-08-16 laufende Testsuche (60 Zeilen, mehrere hundert Jobs in
-- Bearbeitung) bleibt so, wie der Nutzer sie kennt -- eine nachtraegliche
-- Zusammenfassung waere ein Eingriff in laufende Arbeit.

alter table public.searches
  add column if not exists parent_search_id uuid references public.searches(id) on delete cascade,
  add column if not exists is_search_group boolean not null default false;

comment on column public.searches.parent_search_id is
  'Teilsuche einer gebuendelten Mehrfach-Suche: zeigt auf die Gruppen-Huelle. '
  'Solche Zeilen tauchen in search_overview NICHT als eigener Eintrag auf, ihre '
  'Zahlen werden auf die Eltern-Zeile summiert (Migration 0096).';

comment on column public.searches.is_search_group is
  'Reine Gruppen-Huelle ohne eigenen Ort und ohne eigene Firmen. Fuer solche '
  'Zeilen feuert der Trigger on_search_created bewusst KEINEN get_businesses-Job '
  '(Migration 0096).';

-- Die Gruppenzeile fragt ihre Kinder bei jedem Laden der Suchen-Seite ab; ohne
-- Index waere das ein Sequential Scan ueber alle Suchen des Workspaces.
-- Teilindex, weil die ueberwaeltigende Mehrheit der Zeilen kein Elternteil hat.
create index if not exists searches_parent_idx
  on public.searches (parent_search_id) where parent_search_id is not null;

-- ═══════════════════════════════════════════════════════════════════════
-- TRIGGER: KEIN SUCHLAUF FUER EINE GRUPPEN-HUELLE
-- ═══════════════════════════════════════════════════════════════════════
--
-- on_search_created (0004) haengt an JEDEM Insert in searches. Eine
-- Gruppen-Huelle hat keinen Ort, den man geokodieren koennte -- der Job wuerde
-- Google-Maps-Guthaben verbrauchen und der Liste ein "fehlgeschlagen"
-- anschreiben, obwohl alle sechzig Teilsuchen tadellos laufen.
--
-- Die Ausnahme steht als when-Klausel am Trigger und NICHT als weiteres if in
-- enqueue_search_job (wie es 0075 fuer 'csv' getan hat): so entscheidet
-- Postgres selbst, ob die Funktion ueberhaupt gerufen wird, und die Funktion
-- bleibt unveraendert -- die csv-Ausnahme aus 0075 gilt weiter.
drop trigger if exists on_search_created on public.searches;
create trigger on_search_created after insert on public.searches
  for each row when (new.is_search_group is not true)
  execute function public.enqueue_search_job();

-- ═══════════════════════════════════════════════════════════════════════
-- search_overview: Kinder verschwinden, ihre Zahlen bleiben
-- ═══════════════════════════════════════════════════════════════════════
--
-- Fortschreibung von 0089 (davor 0053/0049/0045/0017/0009). Neu:
--
--   1. Zeilen mit parent_search_id werden ausgeblendet.
--   2. Fuer eine Gruppe sind businesses/businesses_done/contacts/with_email/
--      target_email_count/max_results die SUMME ihrer Kinder. Die Gruppe selbst
--      hat keine eigenen Firmen.
--   3. Drei neue Felder fuer die Oberflaeche: is_search_group, child_count,
--      children_done, children_failed.
--
-- ── Die Statusregel ─────────────────────────────────────────────────────
--
--   laeuft mindestens ein Kind        -> 'running'
--   sind ALLE Kinder gescheitert      -> 'failed'
--   ist der Rest abgebrochen          -> 'cancelled'
--   sonst                             -> 'completed'
--
-- Der Punkt ist die dritte Zeile von unten: eine einzelne Stadt, in der Google
-- Maps nichts hergibt, faerbt die Liste NICHT rot. Bei sechzig Teilsuchen ist
-- ein Ausfall der Normalfall und kein Grund, eine Liste mit 800 Leads als
-- "fehlgeschlagen" auszuweisen. Wie viele es waren, sagt children_failed --
-- eine Zahl statt eines einzelnen Fehlertexts, der fuer 59 andere Teilsuchen
-- gar nicht gelten wuerde.
--
-- error und note bleiben bei einer Gruppe deshalb leer: beides sind Saetze
-- ueber EINE Suche ("keine Treffer in Alkmaar"), und einen davon
-- stellvertretend fuer sechzig anzuzeigen waere eine Behauptung ueber die
-- ganze Liste. Den Fehlgrund aus jobs.last_error ordnet die Suchen-Seite
-- weiterhin zu -- sie rechnet die Kind-ID auf das Elternteil hoch.
--
-- schedule/next_run_at kommen bei einer Gruppe aus den Kindern. Die Huelle
-- selbst traegt bewusst schedule = 'none': process_due_schedules im Worker
-- (worker/main.py) sucht faellige Suchen allein ueber schedule und
-- next_run_at und wuerde fuer eine Huelle einen get_businesses-Job einreihen --
-- genau den, den der Trigger oben verhindert. Das Abo haengt an den Kindern,
-- angezeigt wird es an der Gruppe.
drop function if exists public.search_overview(uuid);
create or replace function public.search_overview(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (select p_workspace_id as id where public.is_workspace_owner(p_workspace_id)),
-- Zaehler fuer JEDE Zeile des Workspaces, Kinder eingeschlossen: die Gruppe
-- braucht sie gleich als Summe, die Einzelsuche fuer sich.
row_counts as (
  select s.id, s.parent_search_id, s.status, s.schedule, s.next_run_at,
    s.target_email_count, s.max_results,
    (select count(*) from public.businesses b where b.search_id = s.id) as businesses,
    (select count(*) from public.businesses b where b.search_id = s.id
       and b.decisionmaker_status not in ('pending','running')) as businesses_done,
    (select count(*) from public.contacts c join public.businesses b on b.id = c.business_id
       where b.search_id = s.id) as contacts,
    (select count(*) from public.contacts c join public.businesses b on b.id = c.business_id
       where b.search_id = s.id and c.email is not null) as with_email
  from public.searches s, ws
  where s.workspace_id = ws.id and s.deleted_at is null
),
group_totals as (
  select rc.parent_search_id as id,
    count(*) as child_count,
    count(*) filter (where rc.status in ('pending','running')) as children_running,
    count(*) filter (where rc.status = 'completed') as children_done,
    count(*) filter (where rc.status = 'failed') as children_failed,
    count(*) filter (where rc.status = 'cancelled') as children_cancelled,
    -- Alle Kinder tragen dasselbe Abo; filter schliesst nur den Fall aus, dass
    -- 'none' alphabetisch ueber 'daily' gewinnt.
    max(rc.schedule) filter (where rc.schedule <> 'none') as child_schedule,
    min(rc.next_run_at) as child_next_run_at,
    sum(rc.businesses) as businesses,
    sum(rc.businesses_done) as businesses_done,
    sum(rc.contacts) as contacts,
    sum(rc.with_email) as with_email,
    sum(rc.target_email_count) as target_email_count,
    sum(rc.max_results) as max_results
  from row_counts rc
  where rc.parent_search_id is not null
  group by rc.parent_search_id
)
select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
from (
  select s.id, coalesce(s.name, s.query) as name, s.query, s.location, s.source,
    case
      -- g.id is null: Einzelsuche, oder eine Gruppe, deren Kinder alle im
      -- Papierkorb liegen. Dann gilt der eigene Status.
      when g.id is null then s.status
      when g.children_running > 0 then 'running'
      when g.children_failed = g.child_count then 'failed'
      when g.children_failed + g.children_cancelled = g.child_count then 'cancelled'
      else 'completed'
    end as status,
    case when g.id is null then s.error else null end as error,
    case when g.id is null then s.note else null end as note,
    coalesce(g.max_results, rc.max_results) as max_results,
    coalesce(g.target_email_count, rc.target_email_count) as target_email_count,
    s.created_at,
    coalesce(g.child_schedule, s.schedule) as schedule,
    coalesce(g.child_next_run_at, s.next_run_at) as next_run_at,
    s.archived_at, s.folder_id, s.is_search_group,
    coalesce(g.child_count, 0) as child_count,
    coalesce(g.children_done, 0) as children_done,
    coalesce(g.children_failed, 0) as children_failed,
    coalesce(g.businesses, rc.businesses) as businesses,
    coalesce(g.businesses_done, rc.businesses_done) as businesses_done,
    coalesce(g.contacts, rc.contacts) as contacts,
    coalesce(g.with_email, rc.with_email) as with_email
  from row_counts rc
  join public.searches s on s.id = rc.id
  left join group_totals g on g.id = s.id
  where rc.parent_search_id is null
) t;
$$;
revoke execute on function public.search_overview(uuid) from public, anon;
grant execute on function public.search_overview(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- cancel_search: eine Gruppe abbrechen bricht ihre Teilsuchen ab
-- ═══════════════════════════════════════════════════════════════════════
--
-- Unveraendert gegenueber 0086 bis auf den Umfang: aus "diese Suche" wird
-- "diese Suche und ihre Kinder". Ohne das waere "Abbrechen" an einer Gruppe
-- die teuerste denkbare Auslegung -- die Zeile faerbt sich, und sechzig
-- Teilsuchen kaufen munter weiter ein.
--
-- Die Begruendungen aus 0086 gelten weiter und sind dort nachzulesen: warum
-- cancelled und nicht failed, warum nur pending-Jobs aus der Queue genommen
-- werden, und warum die Folgearbeiten (find_decisionmaker, hunt_persons,
-- personalize) ueber businesses.search_id mitgefasst werden muessen.
create or replace function public.cancel_search(p_search_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_workspace uuid;
begin
  select workspace_id into v_workspace from public.searches where id = p_search_id;
  if v_workspace is null then
    return false;  -- unbekannt
  end if;
  if not public.is_workspace_owner(v_workspace) then
    return false;
  end if;

  -- Gibt es ueberhaupt noch etwas abzubrechen? Die Gruppen-Huelle selbst zaehlt
  -- dabei nicht mit: ihr Status bleibt lebenslang auf 'pending', weil kein
  -- Worker sie je anfasst. Wuerde sie mitzaehlen, meldete diese Funktion auch
  -- fuer eine laengst fertige Gruppe "abgebrochen".
  if not exists (
    select 1 from public.searches s
     where s.status in ('pending', 'running')
       and (
         (s.id = p_search_id and s.is_search_group is not true)
         or s.parent_search_id = p_search_id
       )
  ) then
    return false;  -- laengst fertig
  end if;

  update public.searches set status = 'cancelled'
   where (id = p_search_id or parent_search_id = p_search_id)
     and status in ('pending', 'running');

  update public.jobs j
     set status = 'cancelled'
   where j.status = 'pending'
     and (
       j.payload->>'search_id' in (
         select s.id::text from public.searches s
          where s.id = p_search_id or s.parent_search_id = p_search_id
       )
       or exists (
         select 1 from public.businesses b
          join public.searches s on s.id = b.search_id
          where b.id::text = j.payload->>'business_id'
            and (s.id = p_search_id or s.parent_search_id = p_search_id)
       )
     );
  return true;
end $$;

revoke execute on function public.cancel_search(uuid) from public, anon;
grant execute on function public.cancel_search(uuid) to authenticated;

comment on function public.cancel_search(uuid) is
  'Bricht eine laufende Suche ab: Status auf cancelled und alle wartenden Jobs '
  'dazu ebenfalls. Bei einer gebuendelten Mehrfach-Suche gilt das auch fuer alle '
  'Teilsuchen (Migration 0096). Der bereits laufende Job beendet sich selbst am '
  'naechsten Prueffpunkt (siehe apollo.enrich_people).';
