-- "Neu erzeugen" erzeugt jetzt tatsaechlich neu.
--
-- DER FEHLER
--
-- Gemeldet: "Beim Punkt Icebreaker funktioniert das Retry nicht -- es wird
-- kein neuer Icebreaker erstellt, es passiert nichts."
--
-- Es lag nicht daran, dass nichts passierte, sondern daran, dass alles
-- passierte und trotzdem nichts heraus kam. Nachweis in den Daten vom
-- 2026-08-09: die Firma "Productowner.nl" traegt DREI personalize-Jobs, zwei
-- davon um 12:32 -- beide sauber auf 'completed'. Der Text davor und danach
-- ist derselbe. Die anderen vier gemeldeten Firmen haben je genau einen Job,
-- dort wurde nicht geklickt.
--
-- Die Ursache steht in personalize.py, gleich zu Beginn von run():
--
--     if biz.get("personalization"):
--         return
--
-- Ein Schutz gegen doppeltes Bezahlen: liegt schon ein Aufhaenger vor, ist
-- nichts zu tun. Fuer die Such-Pipeline richtig -- dort kann ein Job durch
-- einen Neustart des Workers ein zweites Mal ankommen.
--
-- Fuer "neu erzeugen" ist es toedlich, und zwar strukturell: dieser Knopf
-- wird ausschliesslich auf Zeilen geklickt, die BEREITS einen Text haben.
-- Die Bedingung war also immer erfuellt. Der Job wurde angelegt, sofort
-- wieder verlassen und als erledigt vermerkt -- die Oberflaeche meldete
-- "1 eingereiht", und es aenderte sich nie etwas.
--
-- DIE LOESUNG
--
-- Der Job sagt jetzt, warum es ihn gibt. Kommt er von diesem Knopf, traegt
-- er force=true im payload, und run() ueberspringt die Abkuerzung. Die
-- Pipeline-Jobs bleiben unveraendert und damit auch ihr Schutz.
--
-- Das Merkmal gehoert an den Job und nicht an die Firma: es beschreibt eine
-- Absicht ("dieser eine Lauf soll ueberschreiben"), keinen Zustand. An der
-- Firma waere es ein Schalter, den jemand zuruecksetzen muesste.
--
-- Die Doppelungssperre bleibt, wortgleich: sie verhindert den Doppelklick,
-- nicht den Neuversuch.
create or replace function public.requeue_personalization(p_business_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  inserted integer;
begin
  with erlaubt as (
    select b.id, b.workspace_id
      from public.businesses b
     where b.id = any(p_business_ids)
       and public.is_workspace_owner(b.workspace_id)
  ), neu as (
    insert into public.jobs (workspace_id, type, payload)
    select e.workspace_id, 'personalize',
           jsonb_build_object('business_id', e.id, 'force', true)
      from erlaubt e
     where not exists (
       select 1 from public.jobs j
        where j.type = 'personalize'
          and j.status in ('pending', 'running')
          and j.payload->>'business_id' = e.id::text
     )
    returning 1
  )
  select count(*) into inserted from neu;
  return inserted;
end $$;

revoke execute on function public.requeue_personalization(uuid[]) from public, anon;
grant execute on function public.requeue_personalization(uuid[]) to authenticated;
