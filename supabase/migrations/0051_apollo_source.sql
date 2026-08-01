-- Apollo.io als dritte Lead-Quelle neben Maps (Google Places) und Corporate
-- (Hunter Discover).
--
-- Der entscheidende Unterschied zu den beiden bestehenden Quellen: Apollos
-- People-Search liefert Firma UND Ansprechpartner samt verifizierter E-Mail in
-- EINEM Aufruf. Die bisherigen Wege finden erst Firmen und reichern danach an
-- (find_decisionmaker per KI-Websuche: gemessen ~22% E-Mail-Trefferquote, siehe
-- Kommentar in worker/pipelines/get_businesses.py). Deshalb bekommt Apollo eine
-- eigene Pipeline, die beides zusammen macht, statt sich in die
-- Anreicherungskette einzuhaengen.
alter table public.searches drop constraint if exists searches_source_check;
alter table public.searches add constraint searches_source_check
  check (source in ('maps', 'corporate', 'apollo'));

-- contacts.source benennt, WER den Kontakt gefunden hat (bisher Hunter
-- Domain-Search, KI-Websuche oder Handeintrag). Apollo ist eine weitere solche
-- Herkunft und muss unterscheidbar bleiben -- die Leads-Tabelle zeigt sie an
-- (sourceLabels in lib/i18n/dict.ts).
alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source in ('hunter', 'ai_websearch', 'apollo', 'manual'));

-- target_email_count (0049) war auf 1..20 begrenzt, weil dieser Wert an der
-- ~20%-Trefferquote der KI-Websuche haengt: mehr als 20 E-Mails sind bei 100
-- Rohfirmen pro Suche nicht erreichbar. Fuer Apollo gilt diese Rechnung nicht --
-- dort ist die angefragte Zahl gleich der Zahl der Personen mit verifizierter
-- E-Mail. Die Obergrenze steigt deshalb auf 1000 (= 10 Apollo-Seiten a 100
-- Treffern, siehe APOLLO_MAX_PER_SEARCH in worker/pipelines/apollo.py). Welche
-- Grenze pro Modus tatsaechlich gilt, setzt das Formular; die Pruefregel hier
-- ist nur die aeussere Schranke gegen unsinnige Werte.
alter table public.searches drop constraint if exists searches_target_email_count_check;
alter table public.searches add constraint searches_target_email_count_check
  check (target_email_count is null or target_email_count between 1 and 1000);
