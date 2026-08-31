-- DER BEFUND MERKT SICH, WENN ER OHNE BROWSER-DATEN GESCHRIEBEN WURDE
--
-- write_website_finding wartet auf beide Pruefstufen, aber hoechstens vier
-- Minuten ab businesses.created_at (AUDIT_WAIT_LIMIT). Laeuft die
-- Browser-Messung laenger, schreibt der Job den Satz aus dem rohen HTML,
-- und der Idempotenz-Schutz sorgte bisher dafuer, dass die spaeter
-- eintreffende Messung ihn nie mehr korrigiert.
--
-- Gemessen am 2026-08-31 an 240 Firmen: waehrend ~25 Browser-Messungen durch
-- waren, standen bereits ~75 fertige Saetze in der Datenbank, alle nur aus
-- dem HTML. 139 mussten von Hand mit force nachgezogen werden.
--
-- Diese Spalte schliesst die Luecke: write_website_finding setzt sie, wenn
-- es trotz laufender Browser-Stufe schreiben musste, und browser_check reiht
-- nach seiner Messung einen force-Nachtrag ein, der sie wieder loescht
-- (apps/worker/worker/pipelines/browser_check.py). Ein doppelter Modellaufruf
-- entsteht damit nur noch in genau dem Fall, in dem er noetig ist.

alter table public.businesses
  add column if not exists website_finding_pending_rewrite boolean not null default false;

comment on column public.businesses.website_finding_pending_rewrite is
  'Der Befundsatz wurde vor Abschluss der Browser-Messung geschrieben (Vier-Minuten-Deckel). browser_check reiht nach der Messung einen force-Nachtrag ein und der Nachtrag loescht die Markierung.';
