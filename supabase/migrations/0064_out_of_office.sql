-- Abwesenheitsnotizen sind keine Absage.
--
-- Die KI-Einstufung kannte nur 'interested', 'not_interested' und 'question'.
-- Eine Abwesenheitsnotiz passt in keine davon und landete deshalb bei
-- 'not_interested'. Gemessen am 2026-08-03 traf das beide vorhandenen
-- Auto-Antworten:
--
--   "Automatic reply: after-hours product questions"  -> not_interested
--   "BA SLOW TO RESPOND Re: customer support costs"   -> not_interested
--
-- Das ist inhaltlich falsch und praktisch teuer. Wer im Urlaub ist, hat nicht
-- abgelehnt -- man kann ihn in zwei Wochen wieder anschreiben. Als "kein
-- Interesse" gefuehrt faellt er dagegen dauerhaft aus jeder kuenftigen
-- Kampagne heraus, weil api/instantly/campaigns diesen Status ausschliesst.
--
-- Seit derselben Sitzung setzt der Inbox-Sync bei 'not_interested' zusaetzlich
-- den Kontaktstatus. Ohne diese Migration haetten die beiden Kontakte oben
-- also nicht nur ein falsches Etikett, sondern waeren dauerhaft verbrannt.
alter table public.messages drop constraint messages_ai_interest_check;
alter table public.messages
  add constraint messages_ai_interest_check
  check (ai_interest in ('interested', 'not_interested', 'question', 'out_of_office'));

-- Die beiden falsch eingestuften Faelle richtigstellen. Bewusst eng gefasst
-- ueber die tatsaechlichen Betreffzeilen statt ueber ein breites Muster: eine
-- echte Absage versehentlich zu "abwesend" zu machen waere der schlimmere
-- Fehler -- sie kaeme dann in der naechsten Kampagne wieder vor.
update public.messages
   set ai_interest = 'out_of_office'
 where direction = 'inbound'
   and ai_interest = 'not_interested'
   and (
     subject ilike '%automatic reply%'
     or subject ilike '%auto-reply%'
     or subject ilike '%out of office%'
     or subject ilike '%out of the office%'
     or subject ilike '%slow to respond%'
     or subject ilike '%delay in response%'
   );

-- Und den Kontaktstatus zurueckdrehen, der daraufhin gesetzt wurde. Nur von
-- 'not_interested' aus: wer inzwischen aus einem anderen Grund weiter ist,
-- bleibt es.
update public.contacts c
   set outreach_status = 'contacted'
 where c.outreach_status = 'not_interested'
   and exists (
     select 1 from public.messages m
      where m.contact_id = c.id
        and m.ai_interest = 'out_of_office'
   )
   and not exists (
     select 1 from public.messages m
      where m.contact_id = c.id
        and m.ai_interest = 'not_interested'
   );
