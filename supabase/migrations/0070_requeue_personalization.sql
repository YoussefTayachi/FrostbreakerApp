-- Aufhaenger aus der App heraus neu erzeugen lassen.
--
-- Die Pruefschleife (app/leads/icebreaker) braucht einen Weg, einen
-- misslungenen Aufhaenger nochmal vom Worker schreiben zu lassen. Ein Insert
-- in public.jobs direkt aus dem Browser geht dafuer nicht: die Tabelle hat
-- bewusst nur eine Lese-Policy, Jobs entstehen sonst ausschliesslich per
-- Trigger (0004) oder ueber die Service-Role des Workers. Das soll auch so
-- bleiben -- wer selbst Jobs einreihen darf, darf sich fremdes Guthaben
-- verbrennen.
--
-- Also eine eng geschnittene Funktion: nur dieser eine Jobtyp, nur fuer
-- eigene Firmen, und die Pruefung sitzt in der Datenbank statt in der Route.
--
-- DIE DOPPELUNGSSPERRE
--
-- Ohne sie legt ein zweiter Klick (oder ein Doppelklick) einen zweiten Job
-- an, und jeder personalize-Job ist ein bezahlter OpenAI-Aufruf. Bei einer
-- Sammelaktion ueber 700 Zeilen ist das kein Randfall, sondern der
-- wahrscheinlichste Verlauf. Steht schon ein Job offen, wird die Firma
-- stillschweigend uebersprungen: der Nutzer wollte "nochmal erzeugen", und
-- genau das passiert ja gerade.
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
    select e.workspace_id, 'personalize', jsonb_build_object('business_id', e.id)
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

-- Die Doppelungssperre oben sucht nach offenen personalize-Jobs einer Firma.
-- Ohne Index waere das ein Durchlauf ueber alle bisherigen Jobs (aktuell rund
-- 3900) je Firma -- bei einer Sammelaktion ueber hunderte Zeilen der
-- Unterschied zwischen sofort und spuerbar. Partiell auf die offenen: die
-- erledigten sind fuer diese Frage bedeutungslos und machen den Index sonst
-- mit der Zeit gross und langsam.
create index if not exists jobs_open_personalize_idx
  on public.jobs ((payload->>'business_id'))
  where type = 'personalize' and status in ('pending', 'running');
