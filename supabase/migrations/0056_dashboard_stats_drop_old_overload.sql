-- Die alte Zwei-Parameter-Fassung muss weg, sonst ist jeder Aufruf mehrdeutig:
-- beide Signaturen haben Defaults, Postgres kann zwischen
-- dashboard_stats(uuid, integer) und
-- dashboard_stats(uuid, integer, timestamptz, timestamptz) nicht waehlen und
-- bricht mit "function is not unique" ab. Ohne diesen Schritt haette 0055 das
-- Dashboard beim ersten Aufruf zerlegt -- aufgefallen beim Nachmessen, nicht
-- im Code-Review.
drop function if exists public.dashboard_stats(uuid, integer);
