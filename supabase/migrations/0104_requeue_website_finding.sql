-- Den Website-Befund aus der App heraus neu erzeugen lassen.
--
-- WARUM ES DIESE FUNKTION GIBT
--
-- Der Job write_website_finding (Migration 0103) kann schon alles, was dafuer
-- noetig ist: run() in apps/worker/worker/pipelines/website_finding.py liest
-- force aus dem Payload und ueberspringt damit die Abkuerzung "es steht schon
-- ein Satz drin, also nichts zu tun" -- wortgleiche Bedeutung wie bei
-- personalize (Migration 0084). Eingereiht hat diesen Job bisher aber
-- ausschliesslich die Pipeline selbst. Der Prueflisten-Handgriff "nochmal
-- erzeugen", den es fuer den Icebreaker seit 0070/0084 gibt, lief fuer den
-- Befund deshalb ins Leere: es gab keinen Weg, ihn anzustossen.
--
-- Der Weg ist derselbe wie in 0070 und aus demselben Grund: public.jobs hat
-- bewusst nur eine Lese-Policy. Jobs entstehen sonst nur per Trigger (0004)
-- oder ueber die Service-Role des Workers. Wer selbst Jobs einreihen darf,
-- darf sich fremdes Guthaben verbrennen.
--
-- WARUM KEINE GEMEINSAME FUNKTION FUER BEIDE JOB-TYPEN
--
-- Ein requeue_job(p_type text, p_business_ids uuid[]) waere kuerzer und waere
-- genau die Tuer, die 0070 zugemacht hat. Der Jobtyp kaeme dann vom Aufrufer,
-- und die Funktion muesste ihn gegen eine Liste erlaubter Werte pruefen -- ein
-- zweiter Ort, an dem eine Erlaubnis gepflegt werden muss, und einer, den man
-- beim Hinzufuegen eines Jobtyps vergisst. Ein Aufrufer, der sich den Typ
-- aussuchen kann, reiht sonst get_businesses ein und loest damit eine
-- vollstaendige, bezahlte Suche aus. Zwei Funktionen mit je einem fest
-- verdrahteten Typ im Rumpf koennen das nicht, auch nicht versehentlich. Die
-- Doppelung sind hier zwoelf Zeilen SQL; die Alternative ist eine
-- Rechtepruefung zur Laufzeit.
--
-- FORCE HAENGT AM JOB, NICHT AN DER FIRMA
--
-- Uebernommen aus 0084, dort ausfuehrlich begruendet: force beschreibt eine
-- Absicht ("dieser eine Lauf soll ueberschreiben"), keinen Zustand. An der
-- Firma waere es ein Schalter, den danach jemand zuruecksetzen muesste.
--
-- DIE DOPPELUNGSSPERRE BLEIBT
--
-- Wortgleich aus 0070: sie verhindert den Doppelklick, nicht den Neuversuch.
-- Steht schon ein Job desselben Typs offen, wird die Firma stillschweigend
-- uebersprungen -- der Nutzer wollte "nochmal erzeugen", und genau das
-- passiert ja gerade. Ohne die Sperre legt ein zweiter Klick einen zweiten
-- Job an, und der kann ein bezahlter OpenAI-Aufruf sein (nicht jeder ist
-- einer: liegt kein Website-Befund vor, steigt der Job vor dem Modellaufruf
-- aus, siehe website_finding.py).
create or replace function public.requeue_website_finding(p_business_ids uuid[])
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
    select e.workspace_id, 'write_website_finding',
           jsonb_build_object('business_id', e.id, 'force', true)
      from erlaubt e
     where not exists (
       select 1 from public.jobs j
        where j.type = 'write_website_finding'
          and j.status in ('pending', 'running')
          and j.payload->>'business_id' = e.id::text
     )
    returning 1
  )
  select count(*) into inserted from neu;
  return inserted;
end $$;

revoke execute on function public.requeue_website_finding(uuid[]) from public, anon;
grant execute on function public.requeue_website_finding(uuid[]) to authenticated;

-- Derselbe partielle Index wie jobs_open_personalize_idx aus 0070, aus
-- demselben Grund: die Doppelungssperre oben sucht je Firma nach offenen
-- Jobs dieses Typs. Ohne Index ist das ein Durchlauf ueber alle bisherigen
-- Jobs pro Zeile, und dieser Handgriff wird auf Sammelauswahlen geklickt.
-- Partiell auf die offenen: die erledigten sind fuer diese Frage bedeutungslos
-- und wuerden den Index mit der Zeit nur gross und langsam machen.
create index if not exists jobs_open_website_finding_idx
  on public.jobs ((payload->>'business_id'))
  where type = 'write_website_finding' and status in ('pending', 'running');
