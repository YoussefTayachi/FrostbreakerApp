-- Deal-Board: alles, was eine Deal-Karte traegt, in einer Abfrage.
--
-- Bis hierher war die Deal-Pipeline in Frostbreaker unsichtbar. Die Tabelle
-- public.deals gibt es seit Migration 0034, angezeigt wurde sie aber nur im
-- Drawer eines einzelnen Kontakts (DealsPanel) -- man musste also wissen, wo
-- ein Deal haengt, um ihn zu sehen. Eine Uebersicht "was ist gerade offen und
-- wie viel Geld steht darin" gab es nicht.
--
-- Fuer einen Pipedrive-Umsteiger ist genau das DIE Pipeline. Deren Spalten
-- fuehren Deals mit Wert und Abschlussdatum, nicht Kontakte mit Status.
-- Unsere Kontakt-Pipeline bleibt daneben bestehen: sie beantwortet "wen
-- spreche ich an", das Deal-Board beantwortet "was kommt davon zurueck".
--
-- Dieselbe Begruendung wie bei pipeline_rows (0061): "naechste Aktivitaet" und
-- "seit wann in dieser Stufe" sind Aggregate ueber activities bzw. die
-- Historie. Einzeln je Deal abgefragt waeren das zwei Rundreisen pro Karte.

/**
 * Offene Deals eines Workspaces, aufbereitet fuer das Board.
 *
 * Nur offene: gewonnene und verlorene gehoeren in eine Auswertung, nicht in
 * ein Arbeitsbrett. Pipedrive blendet sie ebenfalls aus und bietet
 * "Geschlossene Deals anzeigen" als eigene Umschaltung an -- die kann hier
 * spaeter dazukommen, ohne dass sich diese Funktion aendern muss.
 */
create or replace function public.deal_board_rows(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (
  select p_workspace_id as id where public.is_workspace_owner(p_workspace_id)
),
base as (
  select
    d.id,
    d.title,
    d.value,
    d.currency,
    d.stage,
    d.probability,
    d.expected_close_date,
    d.created_at,
    d.updated_at,
    d.business_id,
    d.contact_id,
    b.name    as company_name,
    b.website as company_website,
    c.full_name,
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    c.linkedin
  from public.deals d
  join ws on ws.id = d.workspace_id
  join public.businesses b on b.id = d.business_id
  left join public.contacts c on c.id = d.contact_id
  where d.status = 'open'
)
select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc), '[]'::jsonb)
from (
  select
    base.*,
    -- Naechster offener Termin: dieselbe Zeile, die auch unter /calls steht.
    -- Traegt den gruen/grauen Kreis auf der Karte, genau wie im
    -- Kontakt-Board (siehe pipeline-board.tsx).
    due.due_at   as next_due_at,
    due.subject  as next_due_subject,
    -- Wie lange liegt der Deal schon unberuehrt? Pipedrive nennt das
    -- "rotting" und faerbt solche Karten ein. Anders als beim Kontakt gibt es
    -- hier keine Status-Historie, deshalb dient updated_at als Ersatz -- jede
    -- Aenderung am Deal (Stufe, Wert, Titel) setzt ihn zurueck.
    extract(day from now() - base.updated_at)::int as days_idle
  from base
  left join lateral (
    select a.due_at, a.subject
      from public.activities a
     where a.completed_at is null
       and a.due_at is not null
       -- Ein Termin haengt bei uns am Kontakt oder an der Firma, nicht am
       -- Deal. Beides zaehlt: wer die Firma anruft, arbeitet am Deal.
       and (
         (base.contact_id is not null and a.contact_id = base.contact_id)
         or a.business_id = base.business_id
       )
     order by a.due_at asc
     limit 1
  ) due on true
) x;
$$;
revoke execute on function public.deal_board_rows(uuid) from public, anon;
grant execute on function public.deal_board_rows(uuid) to authenticated;
