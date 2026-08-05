-- Prospeo als vierter Suchweg.
--
-- WARUM
--
-- Apollos API-Zugang haengt am Tarif: Free und Basic haben gar keinen, der
-- Master-Key ist an die Organization-Stufe gebunden (ab $119 je Nutzer und
-- Monat, mindestens drei Sitze). Fuer ein BYOK-Produkt ist das die
-- teuerste Stelle der Einstiegshuerde -- der Kunde muss einen Tarif buchen,
-- der ein Vielfaches von Frostbreaker selbst kostet. Der 403, den Apollo dabei
-- wirft, steht seit Wochen in worker/pipelines/apollo.py:421 dokumentiert.
--
-- Prospeo laesst den API-Schluessel bereits im kostenlosen Tarif anlegen
-- (am 2026-08-05 am eigenen Konto nachgesehen: "Create API Key" ist dort
-- nicht gesperrt) und rechnet je Konto ab statt je Sitz. Die Suche kostet
-- 1 Credit je 25 Ergebnisse, die Anreicherung 1 Credit je gefundener Adresse.
--
-- WAS PROSPEO ZUSAETZLICH KANN
--
-- Filter, die es bei den bisherigen drei Wegen nicht gibt und die fuer die
-- Ansprache mehr wert sind als jede Groessenangabe:
--
--   company_job_posting_hiring_for   wer gerade wofuer Stellen ausschreibt
--   company_website_traffic          Besuche, Wachstum, Herkunftslaender
--   company_intent                   Kaufabsicht je Thema
--   company_technology               Wappalyzer-Erkennung, 4946 Werte
--
-- Der Technologie-Filter setzt Prospeos Starter-Tarif voraus, der
-- Traffic-Filter den Pro-Tarif. Das ist eine Tarif-Sperre des Anbieters, kein
-- Fehler: die App muss sie benennen koennen, statt an einem 403 zu scheitern
-- (siehe worker/provider_errors.py).
--
-- ZWEI SCHRITTE STATT EINEM
--
-- search-person liefert bewusst KEINE Adressen -- die Felder email und mobile
-- existieren, bleiben aber leer. Die Adresse kommt aus einem zweiten Aufruf
-- (bulk-enrich-person, bis zu 50 Personen je Anfrage). Dieselbe Zweiteilung
-- wie bei Apollo (api_search + bulk_match), nur mit anderen Namen.

alter table public.searches drop constraint searches_source_check;
alter table public.searches add constraint searches_source_check
  check (source = any (array['maps', 'corporate', 'apollo', 'csv', 'prospeo']));

alter table public.contacts drop constraint contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source = any (array['hunter', 'ai_websearch', 'apollo', 'manual', 'prospeo']));

alter table public.api_keys drop constraint api_keys_provider_check;
alter table public.api_keys add constraint api_keys_provider_check
  check (provider = any (array['google_maps', 'openai', 'hunter', 'apollo', 'neverbounce', 'instantly', 'prospeo']));

alter table public.api_usage drop constraint api_usage_provider_check;
alter table public.api_usage add constraint api_usage_provider_check
  check (provider = any (array['openai', 'hunter', 'apollo', 'neverbounce', 'google_maps', 'prospeo']));

alter table public.provider_subscriptions drop constraint provider_subscriptions_provider_check;
alter table public.provider_subscriptions add constraint provider_subscriptions_provider_check
  check (provider = any (array['openai', 'hunter', 'apollo', 'neverbounce', 'google_maps', 'instantly', 'prospeo']));

-- Der Trigger aus Migration 0004 legt fuer jede neue Suche einen
-- get_businesses-Job an. Fuer 'prospeo' gilt dasselbe wie fuer 'maps',
-- 'corporate' und 'apollo' -- nur 'csv' ist ausgenommen (Migration 0075).
-- Hier ist deshalb NICHTS zu aendern; dieser Hinweis steht da, damit niemand
-- die Ausnahme sucht und sie fuer vergessen haelt.
