-- Die Sprache der Icebreaker wird eine eigene, gespeicherte Einstellung.
--
-- DER FEHLER
--
-- Gemeldet: "Die Icebreaker sind auf Deutsch, obwohl der AI-Agent auf Englisch
-- steht." Nachgemessen am 2026-08-09: personalization_prompt ist bei ALLEN
-- acht Workspaces null -- auch bei dem, dessen Oberflaeche den englischen
-- Prompt anzeigte.
--
-- Der Weg dorthin, in drei Schritten:
--
--   1. Die Web-Oberflaeche zeigt getDefaultPrompt(lang), wobei lang die
--      SPRACHE DER OBERFLAECHE ist. Auf Englisch steht dort also der
--      englische Standardprompt -- sichtbar, aber nur angezeigt.
--   2. Beim Speichern galt: "Text unveraendert gegenueber dem Standard? Dann
--      null speichern." Gut gemeint (Verbesserungen am Standard sollen
--      durchschlagen), aber damit verschwand die einzige Spur der Sprache.
--   3. Der Worker sah null und nahm DEFAULT_PROMPT -- und der war dort fest
--      auf Deutsch verdrahtet.
--
-- Ergebnis: Was die Oberflaeche zeigte, war nicht das, was lief. Fuer den
-- Nutzer sah es aus wie ein ignorierter Prompt.
--
-- WARUM EINE EIGENE SPALTE UND NICHT NUR EIN ANDERER DEFAULT
--
-- Man koennte im Worker die UI-Sprache nachbauen. Dann haenge die Sprache der
-- Kaltakquise aber daran, in welcher Sprache jemand die App zuletzt bedient
-- hat -- zwei voellig verschiedene Dinge. Wer eine deutsche Oberflaeche
-- bevorzugt und amerikanische Firmen anschreibt, ist der Normalfall, nicht
-- die Ausnahme.
--
-- Der Standard ist 'de', nicht 'en': bisher erzeugte der Worker fuer JEDEN
-- Workspace deutsche Texte (alle acht hatten null). 'de' aendert damit fuer
-- niemanden etwas Bestehendes; 'en' haette still die Sprache aller laufenden
-- Kampagnen umgestellt.

alter table public.workspaces
  add column if not exists personalization_language text not null default 'de'
    check (personalization_language in ('de', 'en'));

comment on column public.workspaces.personalization_language is
  'Ausgabesprache der KI-Icebreaker. Unabhaengig von der Sprache der Oberflaeche '
  'und wird auch bei selbst geschriebenem Prompt durchgesetzt (constraint_block '
  'in personalize.py) -- sonst gaebe es zwei Wahrheiten fuer dieselbe Sache.';
