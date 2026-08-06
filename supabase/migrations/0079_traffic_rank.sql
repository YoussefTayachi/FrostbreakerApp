-- Wie gross ist der Laden? Ein Popularitaetsrang je Firma.
--
-- WARUM
--
-- Prospeos Website-Traffic-Filter ist der schaerfste Filter dieser Art --
-- und der teuerste: er setzt Prospeos Pro-Tarif voraus ($199/Monat). Bevor
-- man den bucht, lohnt der Blick auf das, was ohnehin schon durchs Haus
-- laeuft.
--
-- Apollos organizations/bulk_enrich liefert je Firma ein `alexa_ranking`
-- mit. Dieser Endpunkt wird von run_apollo ohnehin bei JEDER Apollo-Suche
-- aufgerufen (fuer die Firmenbeschreibung) und kostet keine Credits -- Apollo
-- rechnet nur Exporte ab. Das Feld wurde bisher schlicht weggeworfen.
--
-- Am 2026-08-05 an echten Domains geprueft, die Rangfolge passt:
--
--     shopify.com        134
--     thredup.com     19 072
--     1stphorm.com   137 318
--     mtailor.com    633 392
--     chatarmin.com      —      (zu klein fuer die Liste)
--
-- WARUM DREI SPALTEN UND NICHT EINE
--
-- Weil die Zahl allein nicht ehrlich waere.
--
--   traffic_rank         der Rang selbst. Kleiner = groesser.
--   traffic_rank_source  woher er stammt.
--   traffic_rank_at      wann er erhoben wurde.
--
-- Der Grund ist Alexa: der Dienst wurde 2022 eingestellt. Apollos Feld
-- traegt also Altbestand -- fuer alles, was seither gestartet oder gewachsen
-- ist, fehlt der Wert oder er stimmt nicht mehr. chatarmin.com steht deshalb
-- ohne Rang da, obwohl die Seite existiert.
--
-- Ein Rang ohne Quelle und Datum waere damit eine Zahl, der man nicht ansieht,
-- wie alt sie ist. Genau die Sorte Angabe, gegen die die Wirkungs-Ansicht und
-- die Kostenseite in dieser App argumentieren.
--
-- Die Quelle ist ausserdem vorbereitet fuer den naechsten Schritt: Tranco
-- (tranco-list.eu) veroeffentlicht taeglich eine freie Liste der Top 1 Mio.
-- Domains -- aktueller als Alexa und ohne Schluessel. Wer sie spaeter
-- einspielt, fuellt dieselbe Spalte mit source='tranco', und beide Werte
-- bleiben unterscheidbar. Ohne die Quellspalte muesste die Spalte dafuer
-- umbenannt oder verdoppelt werden.
--
-- WAS DER RANG NICHT IST
--
-- Keine Besuchszahl. Man kann damit sortieren und filtern ("nur Firmen unter
-- Rang 200 000"), aber nicht sagen "40 000 Besucher im Monat". Und ein
-- fehlender Rang heisst "unbekannt", nicht "wenig" -- deshalb ist die Spalte
-- nullable und wird nirgends mit 0 vorbelegt.

alter table public.businesses
  add column if not exists traffic_rank integer,
  add column if not exists traffic_rank_source text,
  add column if not exists traffic_rank_at timestamptz;

alter table public.businesses drop constraint if exists businesses_traffic_rank_source_check;
alter table public.businesses add constraint businesses_traffic_rank_source_check
  check (traffic_rank_source is null or traffic_rank_source in ('apollo_alexa', 'tranco'));

-- Ein Rang ist immer positiv. 0 oder negativ waere ein Uebertragungsfehler,
-- und den will man beim Schreiben merken statt beim Filtern.
alter table public.businesses drop constraint if exists businesses_traffic_rank_check;
alter table public.businesses add constraint businesses_traffic_rank_check
  check (traffic_rank is null or traffic_rank > 0);

comment on column public.businesses.traffic_rank is
  'Popularitaetsrang der Website, kleiner = groesser. KEINE Besuchszahl. Null = unbekannt, nicht "wenig".';
comment on column public.businesses.traffic_rank_source is
  'apollo_alexa (Altbestand, Alexa wurde 2022 eingestellt) oder tranco (taeglich aktuell, nur Top 1 Mio.).';
comment on column public.businesses.traffic_rank_at is
  'Wann der Rang erhoben wurde. Ohne Datum liesse sich ein alter Alexa-Wert nicht von einem frischen unterscheiden.';

/**
 * Teilindex fuer das Sortieren und Filtern.
 *
 * Nur ueber die Zeilen, die einen Rang haben: die Mehrheit der Firmen aus
 * Google Maps wird nie einen bekommen (lokale Betriebe stehen in keiner
 * Popularitaetsliste), und die gehoeren nicht in den Index.
 */
create index if not exists businesses_traffic_rank_idx
  on public.businesses (workspace_id, traffic_rank)
  where traffic_rank is not null;
