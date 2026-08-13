-- Die Wortgrenze fuer Aufhaenger von 22 auf 35.
--
-- Gemessen, nicht geschaetzt: unter "Icebreaker pruefen" standen 737 erzeugte
-- Aufhaenger, davon 439 als fehlerhaft markiert -- fast alle mit derselben
-- Meldung "33 statt max. 22 Woerter". Das Modell hat die Grenze also nicht
-- knapp verfehlt, sondern durchgaengig.
--
-- Der Grund steht im Standardprompt selbst: er verlangt einen konkreten,
-- ueberpruefbaren Fakt UND den Anschluss "deswegen melde ich mich". Beides
-- zusammen ist in 22 Woertern nicht zu sagen. Die Grenze war damit keine
-- Qualitaetssicherung mehr, sondern Rauschen: wer 439 rote Zeilen sieht,
-- hoert auf hinzusehen, und dann faellt auch der echte Fehler nicht mehr auf.
--
-- Bestehende Zeilen werden mitgezogen, ABER nur die, die noch exakt auf dem
-- alten Standardwert stehen. Wer 18 oder 40 eingestellt hat, hat sich etwas
-- dabei gedacht; diese Migration darf keine Entscheidung ueberschreiben, die
-- jemand von Hand getroffen hat. Dass 22 in aller Regel keine Entscheidung
-- war, sondern der Spaltendefault, zeigen dieselben 439 Zeilen.
alter table public.workspaces
  alter column personalization_max_words set default 35;

update public.workspaces
   set personalization_max_words = 35
 where personalization_max_words = 22;

comment on column public.workspaces.personalization_max_words is
  'Wortgrenze fuer den Aufhaenger. Standard 35 (0094, vorher 22 -- bei 22 fielen '
  '439 von 737 erzeugten Aufhaengern durch). Begrenzt ueber {{personalization}} '
  'auch die LinkedIn-Vorlage, die nur 300 Zeichen hat.';
