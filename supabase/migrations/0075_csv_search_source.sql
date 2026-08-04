-- CSV-Import wird eine Lead-Liste wie jede andere.
--
-- Bis hierher hat der Import (app/settings/import-csv.tsx) Firmen mit
-- search_id = null angelegt. Sie tauchten damit unter "Alle Leads" auf, aber
-- in keiner Liste -- also nirgends dort, wo man Leads tatsaechlich auswaehlt:
-- nicht in der Suchenuebersicht, nicht als Quelle einer Kampagne, nicht in
-- der Aufschluesselung der Wirkungs-Ansicht. Wer 300 Kontakte aus Pipedrive
-- mitbrachte, konnte sie anschliessend nicht anschreiben, ohne sie von Hand
-- wieder zusammenzusuchen.
--
-- Ab jetzt legt der Import eine Zeile in searches an, und die Firmen haengen
-- daran. Damit gilt fuer sie alles, was fuer eine gesuchte Liste auch gilt.

alter table public.searches drop constraint searches_source_check;
alter table public.searches add constraint searches_source_check
  check (source = any (array['maps', 'corporate', 'apollo', 'csv']));

/**
 * Keinen Suchlauf fuer importierte Listen einreihen.
 *
 * Der Trigger aus Migration 0004 haengt an JEDEM Insert in searches und legt
 * einen get_businesses-Job an. Fuer eine CSV-Liste gibt es nichts zu holen --
 * die Firmen stehen schon in der Datei. Ohne diese Ausnahme liefe der Worker
 * gegen eine Suche ohne Suchbegriff und ohne Ort, verbraucht dabei
 * Google-Maps- oder Apollo-Guthaben und schriebe der Liste am Ende ein
 * "fehlgeschlagen" an, obwohl der Import geklappt hat.
 *
 * Der Status wird beim Anlegen direkt auf 'completed' gesetzt (in der Route),
 * damit die Liste nicht ewig als "laeuft" in der Uebersicht steht.
 */
create or replace function public.enqueue_search_job()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'csv' then
    return new;
  end if;
  insert into public.jobs (workspace_id, type, payload)
  values (new.workspace_id, 'get_businesses', jsonb_build_object('search_id', new.id, 'auto_enrich', true));
  return new;
end $$;
revoke execute on function public.enqueue_search_job() from public, anon, authenticated;
