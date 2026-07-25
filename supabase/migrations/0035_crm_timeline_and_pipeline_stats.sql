-- CRM Phase 2 (Kern): eine Timeline-Abfrage statt vier Client-Roundtrips.
--
-- Das Frontend braucht E-Mails, Notizen, Status-Wechsel, Aktivitaeten und Deals
-- chronologisch gemischt. Vier einzelne Queries + Sortieren im Client waere
-- fehleranfaellig (jede neue Quelle muesste an drei Stellen nachgezogen werden)
-- und wuerde bei jedem Oeffnen eines Leads vier Requests kosten. Als Funktion
-- bleibt das Mischen an einer Stelle, gleiches Muster wie dashboard_stats().
--
-- Zwei Scopes:
--   crm_timeline(p_contact_id => ...)  -> dieser Kontakt + firmenweite Notizen
--   crm_timeline(p_business_id => ...) -> alle Kontakte dieser Firma
create or replace function public.crm_timeline(
  p_contact_id uuid default null,
  p_business_id uuid default null
)
returns jsonb language sql stable security definer set search_path = public as $$
with scope as (
  select
    coalesce(
      (select c.business_id from public.contacts c where c.id = p_contact_id),
      p_business_id
    ) as business_id,
    coalesce(
      (select c.workspace_id from public.contacts c where c.id = p_contact_id),
      (select b.workspace_id from public.businesses b where b.id = p_business_id)
    ) as workspace_id
),
-- Ohne Treffer hier bleiben alle folgenden CTEs leer und die Funktion liefert
-- '[]' -- eine fremde oder unbekannte ID gibt also nie Daten zurueck.
authorized as (
  select s.business_id, s.workspace_id
  from scope s
  where s.workspace_id is not null and public.is_workspace_owner(s.workspace_id)
),
contact_ids as (
  select c.id
  from public.contacts c, authorized a
  where c.workspace_id = a.workspace_id
    and (
      (p_contact_id is not null and c.id = p_contact_id)
      or (p_contact_id is null and c.business_id = a.business_id)
    )
),
events as (
  -- E-Mails (ein- und ausgehend), gespiegelt von poll_instantly.py
  select
    case when m.direction = 'inbound' then 'email_in' else 'email_out' end as kind,
    m.id,
    coalesce(m.sent_at, m.created_at) as at,
    m.contact_id,
    m.subject as title,
    m.body,
    jsonb_build_object('ai_interest', m.ai_interest, 'status', m.status) as meta
  from public.messages m
  where m.contact_id in (select id from contact_ids)

  union all

  -- Notizen des Vertrieblers, kontakt- oder firmenweit
  select
    'note',
    n.id,
    n.created_at,
    n.contact_id,
    null::text,
    n.body,
    jsonb_build_object(
      'scope', case when n.business_id is not null then 'business' else 'contact' end,
      'author_email', (select u.email::text from auth.users u where u.id = n.author_user_id),
      'edited', n.updated_at > n.created_at
    )
  from public.notes n, authorized a
  where n.workspace_id = a.workspace_id
    and (n.contact_id in (select id from contact_ids) or n.business_id = a.business_id)

  union all

  -- Status-Bewegungen (Trigger aus 0032)
  select
    'status',
    h.id,
    h.changed_at,
    h.contact_id,
    null::text,
    null::text,
    jsonb_build_object(
      'old_status', h.old_status,
      'new_status', h.new_status,
      -- changed_by ist null, wenn der Worker den Status automatisch angehoben hat
      'automatic', h.changed_by is null
    )
  from public.contact_status_history h
  where h.contact_id in (select id from contact_ids)

  union all

  -- Aktivitaeten: geloggte Anrufe und Aufgaben
  select
    'activity',
    act.id,
    coalesce(act.occurred_at, act.completed_at, act.due_at, act.created_at),
    act.contact_id,
    act.subject,
    act.note,
    jsonb_build_object(
      'type', act.type,
      'outcome', act.outcome,
      'duration_seconds', act.duration_seconds,
      'due_at', act.due_at,
      'completed_at', act.completed_at,
      'scope', case when act.contact_id is null then 'business' else 'contact' end
    )
  from public.activities act, authorized a
  where act.workspace_id = a.workspace_id
    and (act.contact_id in (select id from contact_ids) or act.business_id = a.business_id)

  union all

  -- Deals: haengen an der Firma, tauchen darum auch im Kontakt-Scope auf
  select
    'deal',
    d.id,
    d.updated_at,
    d.contact_id,
    d.title,
    d.lost_reason,
    jsonb_build_object(
      'value', d.value,
      'currency', d.currency,
      'stage', d.stage,
      'status', d.status,
      'probability', d.probability,
      'expected_close_date', d.expected_close_date,
      'closed_at', d.closed_at
    )
  from public.deals d, authorized a
  where d.workspace_id = a.workspace_id
    and (d.contact_id in (select id from contact_ids) or d.business_id = a.business_id)
)
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'kind', e.kind,
      'id', e.id,
      'at', e.at,
      'contact_id', e.contact_id,
      'title', e.title,
      'body', e.body,
      'meta', e.meta
    ) order by e.at desc
  ),
  '[]'::jsonb
)
from events e;
$$;
revoke execute on function public.crm_timeline(uuid, uuid) from public, anon;
grant execute on function public.crm_timeline(uuid, uuid) to authenticated;


-- CRM Phase 5: Forecast- und Aufgaben-Kennzahlen fuer das Dashboard.
--
-- Absichtlich eine eigene Funktion und keine weitere Erweiterung von
-- dashboard_stats(): die ist inzwischen gross, wird bei jedem Dashboard-Aufruf
-- komplett ausgewertet und hat einen anderen Lebenszyklus. Zwei parallele RPCs
-- in einem Promise.all kosten nichts.
create or replace function public.crm_pipeline_stats(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (select p_workspace_id as id where public.is_workspace_owner(p_workspace_id))
select jsonb_build_object(
  'deals_open',
    (select count(*) from public.deals d, ws where d.workspace_id = ws.id and d.status = 'open'),
  'value_open',
    (select coalesce(sum(d.value), 0) from public.deals d, ws
      where d.workspace_id = ws.id and d.status = 'open'),
  -- Gewichteter Forecast: Summe aus Wert x Abschlusswahrscheinlichkeit
  'value_weighted',
    (select coalesce(round(sum(d.value * d.probability / 100.0), 2), 0) from public.deals d, ws
      where d.workspace_id = ws.id and d.status = 'open'),
  'deals_won_30d',
    (select count(*) from public.deals d, ws
      where d.workspace_id = ws.id and d.status = 'won' and d.closed_at >= now() - interval '30 days'),
  'value_won_30d',
    (select coalesce(sum(d.value), 0) from public.deals d, ws
      where d.workspace_id = ws.id and d.status = 'won' and d.closed_at >= now() - interval '30 days'),
  'deals_lost_30d',
    (select count(*) from public.deals d, ws
      where d.workspace_id = ws.id and d.status = 'lost' and d.closed_at >= now() - interval '30 days'),
  'by_stage',
    (select coalesce(jsonb_object_agg(x.stage, x.agg), '{}'::jsonb) from (
      select d.stage, jsonb_build_object('count', count(*), 'value', coalesce(sum(d.value), 0)) as agg
      from public.deals d, ws
      where d.workspace_id = ws.id and d.status = 'open'
      group by d.stage
    ) x),
  -- "Faellig" heisst heute oder ueberfaellig -- genau die Menge, die der
  -- Vertriebler heute abarbeiten muss. Tagesgrenze in DB-Zeitzone (UTC), fuer
  -- ein Tageszaehler-Widget ausreichend genau.
  'activities_due',
    (select count(*) from public.activities a, ws
      where a.workspace_id = ws.id and a.completed_at is null
        and a.due_at is not null and a.due_at < (current_date + 1)),
  'activities_overdue',
    (select count(*) from public.activities a, ws
      where a.workspace_id = ws.id and a.completed_at is null
        and a.due_at is not null and a.due_at < current_date)
);
$$;
revoke execute on function public.crm_pipeline_stats(uuid) from public, anon;
grant execute on function public.crm_pipeline_stats(uuid) to authenticated;
