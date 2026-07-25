-- Dashboard-Chart war fest auf "letzte 14 Tage" verdrahtet (generate_series
-- current_date - 13). p_days macht den Zeitraum waehlbar, betrifft bewusst nur
-- den 'activity'-Teil -- die KPI-Kacheln oben (Suchen/Firmen/Kontakte total)
-- bleiben Gesamtbestand, unabhaengig vom gewaehlten Chart-Zeitraum.
create or replace function public.dashboard_stats(p_workspace_id uuid, p_days integer default 14)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (select p_workspace_id as id where public.is_workspace_owner(p_workspace_id)),
     range as (select greatest(least(coalesce(p_days, 14), 365), 1) as days)
select jsonb_build_object(
  'searches_total',      (select count(*) from public.searches s, ws where s.workspace_id = ws.id),
  'businesses_total',    (select count(*) from public.businesses b, ws where b.workspace_id = ws.id),
  'contacts_total',      (select count(*) from public.contacts c, ws where c.workspace_id = ws.id),
  'contacts_with_email', (select count(*) from public.contacts c, ws where c.workspace_id = ws.id and c.email is not null),
  'personalized',        (select count(*) from public.businesses b, ws where b.workspace_id = ws.id and b.personalization is not null),
  'emails_sent',         (select count(*) from public.messages m, ws where m.workspace_id = ws.id and m.status = 'sent'),
  'replies',             (select count(*) from public.messages m, ws where m.workspace_id = ws.id and m.direction = 'inbound'),
  'jobs_active',         (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.status in ('pending','running')),
  'jobs_failed',         (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.status = 'failed'),
  'jobs_geocode',        (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'get_businesses' and j.status = 'completed'),
  'jobs_decisionmaker',  (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'find_decisionmaker' and j.status = 'completed'),
  'jobs_personalize',    (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'personalize' and j.status = 'completed'),
  'jobs_hunter',         (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'hunt_persons' and j.status = 'completed'),
  'meetings_booked',     (select count(*) from public.contacts c, ws where c.workspace_id = ws.id and c.outreach_status in ('meeting_booked','customer')),
  'customers',           (select count(*) from public.contacts c, ws where c.workspace_id = ws.id and c.outreach_status = 'customer'),
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
  'activity', (
    select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'DD.MM'), 'leads', coalesce(x.cnt, 0)) order by d.day), '[]'::jsonb)
    from range, generate_series(current_date - (range.days - 1), current_date, interval '1 day') as d(day)
    left join (
      select c.created_at::date as day, count(*) as cnt
      from public.contacts c, ws where c.workspace_id = ws.id
      group by 1
    ) x on x.day = d.day::date
  )
);
$$;
revoke execute on function public.dashboard_stats(uuid, integer) from public, anon;
grant execute on function public.dashboard_stats(uuid, integer) to authenticated;

-- Alte Ein-Parameter-Signatur wird durch den Default-Wert ueberfluessig --
-- ohne drop wuerden zwei ueberladene Funktionen nebeneinander existieren.
drop function if exists public.dashboard_stats(uuid);
