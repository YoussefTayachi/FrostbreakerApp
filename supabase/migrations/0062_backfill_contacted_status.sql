-- Nachtragen: wer nachweislich angeschrieben wurde, steht nicht mehr auf "neu".
--
-- Der Inbox-Sync hob den Kontaktstatus bislang nur bei einer EINGEHENDEN
-- Antwort an. Fuer hinausgegangene Mails passierte nichts -- wer angeschrieben
-- wurde und (noch) nicht geantwortet hat, also die grosse Mehrheit, blieb
-- dauerhaft auf 'new'. Im Pipeline-Board landete er damit in der Spalte "Neu",
-- obwohl die Mail nachweislich raus war.
--
-- Gemessen am 2026-08-03: 21 Kontakte mit ausgehender Mail in public.messages,
-- alle noch auf 'new'. Insgesamt stand genau EIN Kontakt auf 'contacted', und
-- den hatte jemand von Hand gesetzt.
--
-- Die Ursache ist in api/cron/instantly-sync behoben. Der Sync holt aber nur
-- Mails ab, die neuer sind als sein letzter Lauf (instantly_last_polled_at
-- bzw. instantly_inbox_synced_at) -- die bereits gespeicherten Faelle wuerde
-- er also nie nachziehen. Deshalb hier einmalig aus dem Bestand abgeleitet.
--
-- Bewusst nur von 'new' aus: 'replied', 'meeting_booked' oder 'customer'
-- duerfen dabei nicht zurueckfallen. Und bewusst ohne Zeitstempel-Fenster --
-- eine ausgehende Mail ist eine ausgehende Mail, egal wie alt.
--
-- Der Trigger aus 0032 schreibt die Bewegung in contact_status_history. Weil
-- diese Migration ohne auth.uid() laeuft, erscheint sie dort korrekt als
-- "automatisch" -- was sie ja auch ist.
update public.contacts c
   set outreach_status = 'contacted'
 where c.outreach_status = 'new'
   and exists (
     select 1 from public.messages m
      where m.contact_id = c.id
        and m.direction = 'outbound'
   );
