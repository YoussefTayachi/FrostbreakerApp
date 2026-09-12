-- Kampagnen aus der Wirkungs-Auswertung ausblenden koennen.
--
-- Anlass (2026-09-12): die Wirkungs-Seite zeigt jede Kampagne, die je Mails
-- versendet hat, fuer immer. Bei 16+ Kampagnen ist die Liste laenger als der
-- Bildschirm, und abgeschlossene Tests verdecken die laufenden. Zwei Wege
-- fuellen die Spalte:
--
--   1. Von Hand: der Ausblenden-Knopf auf der Wirkungs-Seite.
--   2. Automatisch: instantly-sync erkennt eine bei Instantly geloeschte
--      Kampagne (Analytics liefert 200 mit leerem Array, der direkte GET
--      dann 404 -- am 2026-09-12 gemessen) und traegt das Datum ein.
--
-- Bewusst KEIN Loeschen: die Zeile und ihre messages bleiben, nur die
-- Auswertung blendet sie in den eingeklappten Archivbereich. Wird die
-- Kampagne in Frostbreaker selbst geloescht, faellt sie ohnehin aus der
-- Auswertung (messages.campaign_id steht auf on delete set null).
alter table public.campaigns
  add column if not exists stats_archived_at timestamptz;

comment on column public.campaigns.stats_archived_at is
  'Ausgeblendet aus der Wirkungs-Auswertung (von Hand oder automatisch, wenn die Kampagne bei Instantly geloescht wurde). NULL = sichtbar.';
