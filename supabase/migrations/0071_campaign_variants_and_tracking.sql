-- Mehrere Textfassungen je Sequenzschritt, und eine bewusste Entscheidung
-- ueber das Oeffnungs-Tracking.
--
-- VARIANTEN
--
-- buildCampaignSequence hat Instantly bis heute immer genau EINE Variante je
-- Schritt geschickt. Instantly kann mehrere, verteilt den Versand darauf und
-- zaehlt sie getrennt -- das ist der einzige eingebaute Weg herauszufinden,
-- welcher Text tatsaechlich Antworten bringt. Ohne Varianten gibt es keinen
-- Lernvorgang, egal wie viele Mails rausgehen; am 2026-08-04 waren es 312
-- ohne eine einzige vergleichbare Zahl.
--
-- Als jsonb an der bestehenden Zeile statt als eigene Tabelle: die Varianten
-- werden immer vollstaendig zusammen mit ihrem Schritt gelesen und
-- geschrieben, nie einzeln abgefragt. Eine zweite Tabelle brauchte einen
-- Join fuer jeden Zugriff und eine eigene Loeschordnung, ohne dass irgendeine
-- Abfrage davon profitieren wuerde.
--
-- subject/body bleiben stehen und fuehren weiterhin Variante A. Sie sind
-- damit kein toter Ballast, sondern die Antwort auf "was steht in diesem
-- Schritt" fuer alles, was die Spalten heute schon liest.
alter table public.campaign_steps
  add column if not exists variants jsonb not null default '[]'::jsonb;

-- Bestehende Schritte bekommen ihre eine Fassung als Variante A eingetragen,
-- damit ab sofort ueberall dieselbe Struktur gilt und der Lesecode keinen
-- Sonderfall fuer "alte Zeile" braucht.
update public.campaign_steps
   set variants = jsonb_build_array(
         jsonb_build_object('subject', coalesce(subject, ''), 'body', coalesce(body, ''))
       )
 where jsonb_array_length(variants) = 0;

comment on column public.campaign_steps.variants is
  'Alle Fassungen dieses Schritts: [{subject, body, disabled}]. Index 0 = Variante A und identisch mit subject/body.';

-- OEFFNUNGS-TRACKING
--
-- instantly_campaign_stats meldete am 2026-08-04 ueber ALLE Kampagnen
-- open_count = 0. Damit laesst sich "gar nicht zugestellt" nicht von
-- "gelesen, aber uninteressant" unterscheiden -- zwei voellig verschiedene
-- Krankheiten mit verschiedenen Behandlungen.
--
-- Die Einstellung gehoert bewusst gesetzt und nicht stillschweigend
-- uebernommen: Instantlys Vorgabe ist "an", und ein Zaehlpixel kostet
-- Zustellbarkeit. Deshalb wird der Wert ab jetzt bei jedem Anlegen
-- ausdruecklich mitgeschickt und hier gespiegelt, damit in der App steht,
-- was fuer diese Kampagne tatsaechlich gilt.
--
-- Null heisst "vor dieser Migration angelegt, Zustand unbekannt" -- und genau
-- so soll es in der Oberflaeche auch dastehen, statt eine Vermutung als
-- Tatsache auszugeben.
alter table public.campaigns
  add column if not exists open_tracking boolean,
  add column if not exists link_tracking boolean;

comment on column public.campaigns.open_tracking is
  'Zaehlpixel aktiv. Null = vor Migration 0071 angelegt, tatsaechlicher Zustand nur bei Instantly bekannt.';
