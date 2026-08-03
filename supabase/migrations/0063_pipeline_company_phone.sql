-- Pipeline: Firmennummer als Rueckfall, wie in der Anrufliste.
--
-- Fehler in 0061, aufgefallen beim Ansehen der fertigen Seite: pipeline_rows
-- las nur contacts.phone. In der Liste war das Telefonsymbol damit bei
-- praktisch jedem Kontakt ausgegraut -- also die Aussage "den kann man nicht
-- anrufen", obwohl eine Nummer da ist.
--
-- Gemessen am Bestand vom 2026-08-03:
--
--   contacts.phone              318
--   businesses.phone_national  1355
--   NUR Firmennummer           1196   <- alle faelschlich als "keine Nummer"
--   in der Pipeline anrufbar    484   <- angezeigt wurden 0
--
-- Bei Leads aus Google Maps ist die Firmennummer sogar der Normalfall: Places
-- liefert die Nummer des Betriebs, keine Durchwahl. Gerade fuer die
-- Telefon-Akquise, fuer die diese Ansicht gebaut wurde, war damit die
-- wichtigste Angabe unsichtbar.
--
-- /calls macht es laengst richtig (call-list.tsx, resolve(): "Die persoenliche
-- Durchwahl des Kontakts gewinnt vor der Firmennummer"). Dieselbe Regel gilt
-- jetzt hier -- inklusive der Unterscheidung, WELCHE Nummer es ist: wer eine
-- Zentrale anruft, meldet sich anders als bei einer Durchwahl.
--
-- ZWEITE ERGAENZUNG: stage_since, fuer die Stagnations-Anzeige.
--
-- Pipedrive markiert Vorgaenge, die zu lange in derselben Phase liegen
-- ("rotting deals") -- laut ihren eigenen Automatisierungs-Vorlagen ist das
-- neben "kein naechster Schritt" ihr zentraler Mechanismus. Die Daten dafuer
-- liegen bei uns seit Migration 0032 in contact_status_history und es hat nur
-- nie jemand danach gefragt.
--
-- Wer die Stufe nie gewechselt hat, hat keinen Eintrag in der Historie -- dann
-- gilt der Zeitpunkt, an dem der Kontakt angelegt wurde. Sonst haetten
-- ausgerechnet die unberuehrten Kontakte, um die es geht, gar kein Alter.
--
-- "Kein naechster Schritt" braucht uebrigens KEIN eigenes Feld: das ist exakt
-- next_due_at IS NULL, und das steht schon da.
create or replace function public.pipeline_rows(
  p_workspace_id uuid,
  p_limit integer default 1000
)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (
  select p_workspace_id as id where public.is_workspace_owner(p_workspace_id)
),
base as (
  select
    c.id,
    c.full_name,
    c.first_name,
    c.last_name,
    c.title,
    c.email,
    -- Durchwahl gewinnt, Firmennummer springt ein.
    coalesce(c.phone, b.phone_national) as phone,
    -- Damit die Oberflaeche sagen kann, was sie anbietet.
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
  -- Papierkorb: Kontakte aus geloeschten Suchen fliegen raus, ABER nur solange
  -- sie unberuehrt sind. Wer schon angeschrieben wurde oder geantwortet hat,
  -- ist ein echter Interessent und darf nicht verschwinden, bloss weil die
  -- Liste, aus der er stammte, im Papierkorb liegt.
  where s.deleted_at is null or c.outreach_status <> 'new'
  order by c.created_at desc
  limit greatest(p_limit, 1)
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
    -- Seit wann steht der Kontakt auf seiner jetzigen Stufe? Ohne Eintrag in
    -- der Historie: seit er angelegt wurde.
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
