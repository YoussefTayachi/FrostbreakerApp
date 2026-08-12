-- Unter welchem Namen die Mail rausgeht.
--
-- ANLASS
--
-- Die erzeugten Mails hatten keine Anrede und keinen Gruss. Der Grund stand
-- im Prompt: "No sender name is known. End without a signature line rather
-- than inventing a name." Das war richtig gedacht -- ein erfundener Name ist
-- schlimmer als keiner -- aber es fehlte die Stelle, an der man ihn HINSCHREIBEN
-- kann. Der Prompt hat also eine Luecke verwaltet, statt sie zu schliessen.
--
-- WARUM AM ANGEBOT UND NICHT NUR AM WORKSPACE
--
-- workspaces.reply_sender_name (Migration 0073) gibt es schon, es gilt fuer
-- den Antwortassistenten. Es bleibt der Rueckfall, wenn hier nichts steht --
-- zwei Wahrheiten fuer dieselbe Sache waeren genau der Fehler, den 0083
-- gekostet hat.
--
-- Trotzdem gehoert die Signatur zusaetzlich ans Angebot: eine Agentur, die
-- zwei Nischen bedient, unterschreibt in beiden verschieden ("Youssef von
-- Frostbreaker" gegenueber "Youssef | Retourenheld"). Genau dafuer gibt es
-- mehrere Angebote je Workspace (Migration 0090).
--
-- Mehrzeilig, nicht nur ein Name: "Beste Grüße\nYoussef\nFrostbreaker" ist
-- der Normalfall. Ein reines Namensfeld haette den Gruss dem Modell
-- ueberlassen, und das ist die Zeile, an der eine Mail am schnellsten falsch
-- klingt.
alter table public.offers
  add column if not exists signature text not null default '';

comment on column public.offers.signature is
  'Gruss und Unterschrift, mehrzeilig, z. B. "Beste Grüße" + Name. Leer = Rueckfall auf workspaces.reply_sender_name (Migration 0073); ist auch das leer, endet die Mail ohne Unterschrift, statt einen Namen zu erfinden.';
