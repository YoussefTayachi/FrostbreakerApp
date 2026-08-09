-- Tarife anteilig rechnen -- aber hoechstens fuer die Zeit, die es den
-- Workspace ueberhaupt gibt.
--
-- Youssef hat auf die Kachel gezeigt: "63 Kontakte aus 6 Suchen, und das soll
-- 32,77 $ gekostet haben?" Nachgerechnet stimmte die Summe rechnerisch --
-- 0,11 $ gemessener Verbrauch plus 70 $/Monat eingetragene Tarife, anteilig
-- fuer 14 Tage = 32,67 $ -- nur war der Workspace an dem Tag SECHS STUNDEN
-- alt. Die erste Firma darin ist vom 2026-08-09, 12:10 Uhr, alle sechs Suchen
-- liefen in rund zweieinhalb Stunden.
--
-- Migration 0077 hat die Tarife auf die Fensterlaenge umgelegt. Das ist
-- richtig fuer ein laufendes Konto und falsch fuer ein neues: Wer seit
-- Stunden Kunde ist, bekam vierzehn Tage Abo angerechnet, und auf der
-- Kostenseite machte der Knopf "30 Tage" daraus einen vollen Monatspreis fuer
-- einen Tag Arbeit. Ein Wechsel auf "1 Jahr" haette 850 $ ausgewiesen, ohne
-- dass ein einziger zusaetzlicher Aufruf stattgefunden haette.
--
-- Der Anteil beginnt deshalb fruehestens bei workspaces.created_at. Fuer
-- jeden Workspace, der laenger existiert als das Fenster, aendert sich
-- nichts -- die Deckelung greift genau dort, wo sie gebraucht wird.
--
-- Die Fensterlaenge selbst (win) bleibt unangetastet: Kacheln und ROI-Zeile
-- sollen weiterhin den gewaehlten Zeitraum zeigen. Gedeckelt wird nur die
-- Bezugsgroesse fuer die Umrechnung der Monatstarife.

create or replace function public.dashboard_stats(
  p_workspace_id uuid,
  p_days integer default 14,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (select p_workspace_id as id where public.is_workspace_owner(p_workspace_id)),
     range as (select greatest(least(coalesce(p_days, 14), 365), 1) as days),
     -- Das Fenster, an dem ALLES haengt: Kacheln, Kosten und die ROI-Zeile.
     win as (
       select
         case
           when p_from is not null then p_from
           when coalesce(p_days, 0) > 0 then now() - make_interval(days => least(p_days, 365))
           else null
         end as f,
         p_to as t
     ),
     -- Laenge des Fensters in Tagen, fuer die anteilige Umrechnung der
     -- Monatstarife. Beim Gesamtbestand ab der ersten erfassten Firma --
     -- sonst waere "anteilig" ohne Bezugsgroesse.
     --
     -- greatest(..., Workspace-Anlage) ist die Deckelung, um die es in dieser
     -- Migration geht: ein Abo kann nicht laenger gelaufen sein als das Konto,
     -- fuer das es eingetragen wurde.
     span as (
       select greatest(1.0, extract(epoch from (
                coalesce((select t from win), now())
                - greatest(
                    coalesce(
                      (select f from win),
                      (select min(b.created_at) from public.businesses b, ws where b.workspace_id = ws.id),
                      now() - interval '30 days'
                    ),
                    coalesce(
                      (select w.created_at from public.workspaces w, ws where w.id = ws.id),
                      now() - interval '30 days'
                    )
                  )
              )) / 86400.0) as days
     )
select jsonb_build_object(
  'searches_total',      (select count(*) from public.searches s, ws where s.workspace_id = ws.id
                            and ((select f from win) is null or s.created_at >= (select f from win))
                            and ((select t from win) is null or s.created_at < (select t from win))),
  'businesses_total',    (select count(*) from public.businesses b, ws where b.workspace_id = ws.id
                            and ((select f from win) is null or b.created_at >= (select f from win))
                            and ((select t from win) is null or b.created_at < (select t from win))),
  'contacts_total',      (select count(*) from public.contacts c, ws where c.workspace_id = ws.id
                            and ((select f from win) is null or c.created_at >= (select f from win))
                            and ((select t from win) is null or c.created_at < (select t from win))),
  'contacts_with_email', (select count(*) from public.contacts c, ws where c.workspace_id = ws.id and c.email is not null
                            and ((select f from win) is null or c.created_at >= (select f from win))
                            and ((select t from win) is null or c.created_at < (select t from win))),
  'personalized',        (select count(*) from public.businesses b, ws where b.workspace_id = ws.id and b.personalization is not null
                            and ((select f from win) is null or b.created_at >= (select f from win))
                            and ((select t from win) is null or b.created_at < (select t from win))),
  'emails_sent',         (select count(*) from public.messages m, ws where m.workspace_id = ws.id and m.status = 'sent'
                            and ((select f from win) is null or m.created_at >= (select f from win))
                            and ((select t from win) is null or m.created_at < (select t from win))),
  'replies',             (select count(*) from public.messages m, ws where m.workspace_id = ws.id and m.direction = 'inbound'
                            and ((select f from win) is null or m.created_at >= (select f from win))
                            and ((select t from win) is null or m.created_at < (select t from win))),
  'jobs_active',         (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.status in ('pending','running')),
  'jobs_failed',         (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.status = 'failed'),
  'jobs_geocode',        (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'get_businesses' and j.status = 'completed'),
  'jobs_decisionmaker',  (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'find_decisionmaker' and j.status = 'completed'),
  'jobs_personalize',    (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'personalize' and j.status = 'completed'),
  'jobs_hunter',         (select count(*) from public.jobs j, ws where j.workspace_id = ws.id and j.type = 'hunt_persons' and j.status = 'completed'),
  'meetings_booked',     (select count(*) from public.contacts c, ws where c.workspace_id = ws.id and c.outreach_status in ('meeting_booked','customer')
                            and ((select f from win) is null or c.created_at >= (select f from win))
                            and ((select t from win) is null or c.created_at < (select t from win))),
  'customers',           (select count(*) from public.contacts c, ws where c.workspace_id = ws.id and c.outreach_status = 'customer'
                            and ((select f from win) is null or c.created_at >= (select f from win))
                            and ((select t from win) is null or c.created_at < (select t from win))),
  -- Gemessener Verbrauch im Fenster (Migration 0054).
  'api_cost_usd',        (select coalesce(sum(u.cost_usd), 0) from public.api_usage u, ws
                            where u.workspace_id = ws.id
                            and ((select f from win) is null or u.created_at >= (select f from win))
                            and ((select t from win) is null or u.created_at < (select t from win))),
  'api_cost_since',      (select min(u.created_at) from public.api_usage u, ws where u.workspace_id = ws.id),
  -- Die Tarife: monatlich und anteilig auf die gedeckelte Spanne.
  'subscription_monthly_usd', (select coalesce(sum(ps.monthly_usd), 0)
                                 from public.provider_subscriptions ps, ws where ps.workspace_id = ws.id),
  'subscription_window_usd',  (select coalesce(sum(ps.monthly_usd), 0) * ((select days from span) / 30.0)
                                 from public.provider_subscriptions ps, ws where ps.workspace_id = ws.id),
  -- Die Zahl, die in der ROI-Zeile als "anteilig fuer N Tage" auftaucht. Sie
  -- muss die gedeckelte Spanne sein, nicht die Fensterlaenge -- sonst nennt
  -- der Satz vierzehn Tage und rechnet mit einem.
  'window_days',              (select round((select days from span))),
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
