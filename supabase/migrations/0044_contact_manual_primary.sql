-- Manuelle Auswahl, wer von mehreren bei einer Firma gefundenen Kontakten
-- tatsaechlich angeschrieben wird. Ohne Auswahl entscheidet weiterhin
-- lib/contacts.ts (Rang nach Jobtitel) -- ist is_primary gesetzt, gewinnt
-- dieser Kontakt immer, unabhaengig vom Titel.
alter table public.contacts add column is_primary boolean not null default false;

-- Stellt sicher, dass pro Firma hoechstens ein Kontakt manuell ausgewaehlt ist,
-- selbst falls die App-Logik (zwei sequentielle Updates: erst alle loeschen,
-- dann einen setzen) an dieser Stelle je einen Fehler haette.
create unique index contacts_one_primary_per_business
  on public.contacts (business_id) where is_primary;
