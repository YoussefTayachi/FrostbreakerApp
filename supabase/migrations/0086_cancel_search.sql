-- Eine laufende Suche abbrechen koennen.
--
-- DER ANLASS
--
-- Wer sich bei der Zielzahl vertippt (100 statt 10) oder den falschen Filter
-- stehen laesst, konnte bisher nur zusehen. Die Suche lief zu Ende und
-- verbrauchte dabei echte Credits: bei Apollo 1 pro freigeschalteter Adresse
-- plus 1 pro Firma, dazu je Lead ein OpenAI-Aufruf fuer den Aufhaenger.
--
-- WARUM EIN STATUS ALLEIN NICHT REICHT
--
-- Der Worker laeuft in einem anderen Prozess. Ein "cancelled" in der
-- Datenbank aendert von sich aus gar nichts -- er merkt es nur, wenn er
-- nachsieht. Diese Migration liefert deshalb nur die halbe Loesung: den
-- Zustand und den Weg, ihn zu setzen. Die andere Haelfte steht im Worker, der
-- vor jedem kostenpflichtigen Schritt nachfragt (apollo.enrich_people).
--
-- Dass er zwischen zwei Prueffpunkten noch ein Paket bezahlt, laesst sich
-- nicht ausschliessen -- ein laufender HTTP-Aufruf ist nicht zurueckholbar.
-- Die Pruefung sitzt deshalb dort, wo die Pakete klein sind: vor jedem
-- bulk_match-Chunk, also hoechstens zehn Adressen. Aus "100 Leads" werden
-- damit hoechstens zehn statt hundert.
--
-- WARUM cancelled UND NICHT failed
--
-- failed heisst "etwas ging schief" und wird vom Queue-Retry spaeter erneut
-- versucht (Migration 0047). Genau das darf hier nicht passieren -- ein
-- abgebrochener Job, der von selbst wieder anlaeuft, waere die teuerste
-- denkbare Auslegung von "Abbrechen". Ausserdem ist es fuer den Nutzer eine
-- andere Auskunft: er hat es so gewollt, es ist kein Fehler.

alter table public.searches drop constraint searches_status_check;
alter table public.searches add constraint searches_status_check
  check (status in ('pending', 'running', 'completed', 'failed', 'cancelled'));

alter table public.jobs drop constraint jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('pending', 'running', 'completed', 'failed', 'cancelled'));

/**
 * Suche abbrechen: Zustand setzen und alles Offene aus der Queue nehmen.
 *
 * Als Funktion und nicht als zwei Updates aus dem Browser, aus demselben
 * Grund wie bei requeue_personalization (0070): public.jobs hat bewusst nur
 * eine Lese-Policy. Wer selbst an Jobs schreiben darf, darf auch fremde
 * anhalten.
 *
 * Erfasst werden ZWEI Sorten offener Jobs:
 *
 *   1. der Suchlauf selbst (payload->>'search_id')
 *   2. die Folgearbeiten an den bereits gefundenen Firmen -- Entscheider-
 *      Recherche, Adresssuche, Aufhaenger. Die tragen nur eine business_id im
 *      payload, haengen aber ueber businesses.search_id an derselben Suche.
 *      Ohne sie waere "Abbrechen" ein leeres Versprechen: der teuerste Teil
 *      (je Lead ein OpenAI-Aufruf) liefe munter weiter.
 *
 * Nur pending: ein Job, der gerade laeuft, wird nicht aus der Queue gerissen.
 * Er sieht den abgebrochenen Zustand beim naechsten Prueffpunkt selbst und
 * beendet sich geordnet -- ihn hier auf 'cancelled' zu setzen wuerde nur
 * dazu fuehren, dass der Worker den Status danach wieder ueberschreibt.
 */
create or replace function public.cancel_search(p_search_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_workspace uuid;
begin
  select workspace_id into v_workspace
    from public.searches
   where id = p_search_id
     and status in ('pending', 'running');
  if v_workspace is null then
    return false;  -- unbekannt oder laengst fertig
  end if;
  if not public.is_workspace_owner(v_workspace) then
    return false;
  end if;

  update public.searches set status = 'cancelled' where id = p_search_id;

  update public.jobs j
     set status = 'cancelled'
   where j.status = 'pending'
     and (
       j.payload->>'search_id' = p_search_id::text
       or exists (
         select 1 from public.businesses b
          where b.id::text = j.payload->>'business_id'
            and b.search_id = p_search_id
       )
     );
  return true;
end $$;

revoke execute on function public.cancel_search(uuid) from public, anon;
grant execute on function public.cancel_search(uuid) to authenticated;

comment on function public.cancel_search(uuid) is
  'Bricht eine laufende Suche ab: Status auf cancelled und alle wartenden Jobs '
  'dazu ebenfalls. Der bereits laufende Job beendet sich selbst am naechsten '
  'Prueffpunkt (siehe apollo.enrich_people).';
