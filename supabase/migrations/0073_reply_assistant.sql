-- Was der Antwort-Assistent wissen muss.
--
-- Am 2026-08-04 lagen 8 eingegangene Mails im Posteingang und 0 vereinbarte
-- Termine. Zwischen "hat geantwortet" und "hat gekauft" liegt genau eine
-- Stelle, und dort passierte bisher nichts: die Antwort kam an, wurde
-- eingestuft, und dann musste der Nutzer selbst formulieren -- meist Stunden
-- spaeter, wenn die Antwort nicht mehr warm ist.
--
-- Beide Felder sind optional. Ohne sie funktioniert der Assistent, er hat
-- dann nur weniger Anhaltspunkte -- und genau das ist der Grund, warum sie
-- hier stehen und nicht im Prompt geraten werden:
--
-- Ein Sprachmodell, dem ein Terminlink fehlt, ERFINDET einen plausiblen
-- (calendly.com/vorname). Der Fehler faellt niemandem auf, der die Mail
-- schreibt -- er faellt dem Empfaenger auf, wenn er darauf klickt, und dann
-- ist die Antwort verbrannt. Ist das Feld leer, weist der Prompt das Modell
-- ausdruecklich an, keinen zu erfinden, und laesst stattdessen konkrete
-- Zeitfenster vorschlagen.
alter table public.workspaces
  add column if not exists calendar_link text,
  add column if not exists reply_sender_name text;

comment on column public.workspaces.calendar_link is
  'Terminbuchungs-Link (Cal.com, Calendly, ...). Leer = der Assistent schlaegt Zeitfenster vor, statt einen Link zu erfinden.';
comment on column public.workspaces.reply_sender_name is
  'Name unter der Antwort. Leer = der Entwurf endet ohne Unterschrift, statt einen Namen zu raten.';
