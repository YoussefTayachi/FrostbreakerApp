-- Dashboard-Kacheln reagieren jetzt auf den gewaehlten Zeitraum.
--
-- Bisher betraf p_days ausschliesslich den Chart -- die sechs Kacheln darueber
-- (Suchen, Firmen, Kontakte, mit E-Mail, personalisiert) blieben immer
-- Gesamtbestand. Wer wissen wollte "was hat die Kampagne diese Woche
-- gebracht", bekam die Summe seit Beginn und musste im Kopf abziehen.
--
-- p_from/p_to sind bewusst timestamptz und nicht "Anzahl Tage": eine
-- Kalenderauswahl kann damit einen beliebigen Zeitraum abbilden, auch einen,
-- der nicht heute endet. Beide NULL bedeutet weiterhin Gesamtbestand -- so
-- bleibt der bisherige Aufruf ohne die neuen Parameter unveraendert gueltig.
--
-- Nicht gefiltert werden die Job-Zaehler und die Instantly-Aggregate: erstere
-- sind reine Betriebszahlen, letztere kommen als fertige Summen von Instantly
-- und lassen sich nicht nachtraeglich auf einen Zeitraum aufteilen. Sie
-- taeten nur so, als waeren sie zeitraumbezogen.
create or replace function public.dashboard_stats(
  p_workspace_id uuid,
  p_days integer default 14,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (select p_workspace_id as id where public.is_workspace_owner(p_workspace_id)),
     range as (select greatest(least(coalesce(p_days, 14), 365), 1) as days)
select jsonb_build_object(
  'searches_total',      (select count(*) from public.searches s, ws where s.workspace_id = ws.id
                            and (p_from is null or s.created_at >= p_from)
                            and (p_to is null or s.created_at < p_to)),
  'businesses_total',    (select count(*) from public.businesses b, ws where b.workspace_id = ws.id
                            and (p_from is null or b.created_at >= p_from)
                            and (p_to is null or b.created_at < p_to)),
  'contacts_total',      (select count(*) from public.contacts c, ws where c.workspace_id = ws.id
                            and (p_from is null or c.created_at >= p_from)
                            and (p_to is null or c.created_at < p_to)),
  'contacts_with_email', (select count(*) from public.contacts c, ws where c.workspace_id = ws.id and c.email is not null
                            and (p_from is null or c.created_at >= p_from)
                            and (p_to is null or c.created_at < p_to)),
  'personalized',        (select count(*) from public.businesses b, ws where b.workspace_id = ws.id and b.personalization is not null
                            and (p_from is null or b.created_at >= p_from)
                            and (p_to is null or b.created_at < p_to)),
  'emails_sent',         (select count(*) from public.messages m, ws where m.workspace_id = ws.id and m.status = 'sent'
                            and (p_from is null or m.created_at >= p_from)
                            and (p_to is null or m.created_at < p_to)),
  'replies',             (select count(*) from public.messages m, ws where m.workspace_id = ws.id and m.direction = 'inbound'
                            and (p_from is null or m.created_at >= p_from)
                            and (p_to is null or m.created_at < p_to)),
  'jobs_active',         (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.status in ('pending','running')),
  'jobs_failed',         (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.status = 'failed'),
  'jobs_geocode',        (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'get_businesses' and j.status = 'completed'),
  'jobs_decisionmaker',  (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'find_decisionmaker' and j.status = 'completed'),
  'jobs_personalize',    (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'personalize' and j.status = 'completed'),
  'jobs_hunter',         (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'hunt_persons' and j.status = 'completed'),
  'meetings_booked',     (select count(*) from public.contacts c, ws where c.workspace_id = ws.id and c.outreach_status in ('meeting_booked','customer')
                            and (p_from is null or c.created_at >= p_from)
                            and (p_to is null or c.created_at < p_to)),
  'customers',           (select count(*) from public.contacts c, ws where c.workspace_id = ws.id and c.outreach_status = 'customer'
                            and (p_from is null or c.created_at >= p_from)
                            and (p_to is null or c.created_at < p_to)),
  -- Echte, gemessene API-Kosten fuer denselben Zeitraum (Migration 0054).
  -- Loest die Hochrechnung aus Job-Zaehlern im Frontend ab.
  'api_cost_usd',        (select coalesce(sum(u.cost_usd), 0) from public.api_usage u, ws
                            where u.workspace_id = ws.id
                            and (p_from is null or u.created_at >= p_from)
                            and (p_to is null or u.created_at < p_to)),
  'instantly', (
    select jsonb_build_object(
      'emails_sent',      coalesce(sum(ics.emails_sent_count), 0),
      'replies_unique',   coalesce(sum(ics.reply_count_unique), 0),
      'bounced',           coalesce(sum(ics.bounced_count), 0),
      'opportunities',     coalesce(sum(ics.total_opportunities), 0),
      'opportunity_value', coalesce(sum(ics.total_opportunity_value), 0),
      'campaigns_linked',  count(*)
    )
    from public.instantly_campaign_stats ics, ws where ics.workspace_id = ws.id
  ),
  -- Der Chart folgt derselben Auswahl: mit p_from/p_to genau dieser Zeitraum,
  -- ohne sie weiterhin die letzten p_days.
  'activity', (
    select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'DD.MM'), 'leads', coalesce(x.cnt, 0)) order by d.day), '[]'::jsonb)
    from range,
         generate_series(
           coalesce(p_from::date, current_date - (range.days - 1)),
           coalesce((p_to - interval '1 day')::date, current_date),
           interval '1 day'
         ) as d(day)
    left join (
      select c.created_at::date as day, count(*) as cnt
      from public.contacts c, ws where c.workspace_id = ws.id
      group by 1
    ) x on x.day = d.day::date
  )
);
$$;
revoke execute on function public.dashboard_stats(uuid, integer, timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_stats(uuid, integer, timestamptz, timestamptz) to authenticated;
