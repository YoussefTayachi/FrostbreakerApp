-- Zwei Fehler in der Kostenrechnung des Dashboards.
--
-- Youssef hat auf die ROI-Zeile gezeigt: "511,1 Stunden manuelle Recherche
-- gespart, entspricht ~22998 EUR bei 0,33 $ API-Kosten -- das kann ja nicht
-- sein, es muss an den Zeitraum gebunden sein und sich nicht die ganze Zeit
-- summieren."
--
-- FEHLER 1: DIE ZEITRAUM-KNOEPFE FILTERTEN DIE KACHELN NIE
--
-- Migration 0055 hat p_from/p_to eingefuehrt und alle Kacheln daran gehaengt.
-- Die Knoepfe 7/14/30/90 auf dem Dashboard setzen aber p_days, nicht
-- p_from/p_to -- und p_days steuerte ausschliesslich den Chart. Ohne
-- Kalenderauswahl blieben also alle Kacheln Gesamtbestand, genau das, was
-- 0055 abschaffen wollte.
--
-- Nachgerechnet: 3115 Kontakte * 8 min + 1436 Aufhaenger * 4 min = 30664 min
-- = 511,1 h * 45 EUR = 22998 EUR. Alles seit Beginn.
--
-- Ab jetzt leitet die Funktion das Fenster selbst ab:
--   p_from gesetzt        -> genau dieser Zeitraum (Kalender)
--   sonst p_days > 0      -> die letzten p_days
--   sonst                 -> Gesamtbestand
--
-- p_days = 0 ist damit die ausdrueckliche Anforderung "alles". Das Dashboard
-- bekommt dafuer einen eigenen Knopf -- der Gesamtbestand bleibt erreichbar,
-- er ist nur nicht mehr die stille Voreinstellung.
--
-- FEHLER 2: ZWEI ZEITRAEUME IN EINEM SATZ
--
-- Die 0,33 $ stammen aus api_usage, das erst seit dem 2026-08-02 schreibt und
-- am 2026-08-04 die ersten Zeilen bekam. Die 511 Stunden stammen aus dem
-- gesamten Bestand seit Juli. Der Satz stellte also einen Nutzen aus sechs
-- Wochen neben Kosten aus einem Tag. Mit Fehler 1 behoben liegen beide im
-- selben Fenster.
--
-- FEHLER 3 (Youssefs zweite Nachricht): INSTANTLY UND APOLLO FEHLEN GANZ
--
-- api_usage kennt nur Verbrauchsanbieter, und selbst dort steht bei Apollo und
-- Hunter bewusst kein Betrag, weil der Wert eines Credits am gebuchten Paket
-- haengt (siehe Kommentar in 0054). Instantly kommt gar nicht vor -- es ist
-- ein reines Abo, es gibt keinen Aufruf, den man zaehlen koennte.
--
-- Deshalb eine zweite Kostenart neben dem gemessenen Verbrauch: was der Kunde
-- monatlich fuer seine Tarife zahlt. Die App kann das nicht wissen -- niemand
-- kann von aussen sehen, welches Apollo-Paket jemand gebucht hat -- also wird
-- es eingetragen statt geraten. Das ist dieselbe Entscheidung wie in 0054:
-- lieber "unbekannt" als eine erfundene Zahl.

create table if not exists public.provider_subscriptions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in
    ('openai','hunter','apollo','neverbounce','google_maps','instantly')),
  -- Monatlicher Tarifpreis. 0 bedeutet "kostet mich nichts" (Free-Plan) und
  -- ist etwas anderes als "nicht eingetragen" -- deshalb keine Zeile statt 0,
  -- wenn nichts bekannt ist.
  monthly_usd numeric not null check (monthly_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider)
);

alter table public.provider_subscriptions enable row level security;
drop policy if exists provider_subscriptions_owner on public.provider_subscriptions;
create policy provider_subscriptions_owner on public.provider_subscriptions
  for all using (public.is_workspace_owner(workspace_id));

comment on table public.provider_subscriptions is
  'Was der Workspace monatlich fuer die Tarife der Anbieter zahlt. Vom Nutzer eingetragen, nicht messbar.';

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
     -- Frueher galt es nur, wenn der Kalender benutzt wurde.
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
     span as (
       select greatest(1.0, extract(epoch from (
                coalesce((select t from win), now())
                - coalesce((select f from win),
                           (select min(b.created_at) from public.businesses b, ws where b.workspace_id = ws.id),
                           now() - interval '30 days')
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
  -- Ab wann ueberhaupt gemessen wurde. Die Oberflaeche braucht das, um nicht
  -- Kosten aus einem Tag neben einen Nutzen aus sechs Wochen zu stellen --
  -- genau der Fehler, der diese Migration ausgeloest hat.
  'api_cost_since',      (select min(u.created_at) from public.api_usage u, ws where u.workspace_id = ws.id),
  -- Die Tarife: monatlich und anteilig aufs Fenster.
  'subscription_monthly_usd', (select coalesce(sum(ps.monthly_usd), 0)
                                 from public.provider_subscriptions ps, ws where ps.workspace_id = ws.id),
  'subscription_window_usd',  (select coalesce(sum(ps.monthly_usd), 0) * ((select days from span) / 30.0)
                                 from public.provider_subscriptions ps, ws where ps.workspace_id = ws.id),
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
