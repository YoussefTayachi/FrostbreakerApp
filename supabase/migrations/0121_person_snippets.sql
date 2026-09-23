-- Personen-Schnipsel: sechs kurze Variablen je Kontakt fuer eine feste Copy.
--
-- Der Personen-Absatz (0118) steht als eigener Block vor der Copy. Youssef
-- will seit dem 2026-09-23 die Personalisierung IN der Copy: die Mail ist
-- fest geschrieben, nur sechs Schnipsel wechseln (thingWeHaveInCommon,
-- platformWhereIGotIt, whatTheySaid, thingWeHaveSynergyAround,
-- whatTheyDoWell, whatTheyLeaveOnTheTable). Sie entstehen im selben Lauf
-- wie der Absatz, aus demselben Fund, und gehen als Instantly-Custom-
-- Variables mit dem Lead hoch.
--
-- Ein jsonb statt sechs Spalten: die Menge der Schnipsel gehoert zur Copy,
-- nicht zum Schema, und eine siebte Variable soll keine Migration brauchen.
-- Status, Pruefflag und Provenienz teilen sie sich mit dem Absatz
-- (person_finding_status, person_finding_needs_review, person_finding_source).
alter table public.contacts
  add column if not exists person_snippets jsonb;

comment on column public.contacts.person_snippets is
  'Sechs Schnipsel fuer die feste Copy (Instantly-Custom-Variables), aus demselben Fund wie person_finding. Schluessel: thingWeHaveInCommon, platformWhereIGotIt, whatTheySaid, thingWeHaveSynergyAround, whatTheyDoWell, whatTheyLeaveOnTheTable.';
