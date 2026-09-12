-- Die Spalte "Lead" mit dem fuellen, was schon da ist.
--
-- 0112 hat die Stufe angelegt, aber niemanden hineingestellt: der Sync setzt
-- sie erst bei der naechsten eingehenden Antwort. Eine nagelneue, leere
-- Spalte sieht aus wie ein Fehler -- genau der Eindruck, der zu diesem
-- Umbau gefuehrt hat.
--
-- Die Bedingung ist dieselbe, die der Sync von jetzt an anwendet: auf
-- 'replied' stehen UND die letzte eingegangene Mail ist als 'interested'
-- eingestuft. Am 2026-09-12 trifft das im gesamten Bestand auf 2 von 30
-- Kontakten zu. Die anderen 28 sind Abwesenheitsnotizen -- das ist der
-- gemessene Beleg dafuer, dass 'replied' allein nichts aussagt.
--
-- Bewusst nur die LETZTE eingegangene Mail: wer erst zusagt und danach
-- absagt, ist kein Lead mehr. Die Reihenfolge entscheidet, nicht die Menge.
update public.contacts c
   set outreach_status = 'lead'
 where c.outreach_status = 'replied'
   and (
     select m.ai_interest
       from public.messages m
      where m.contact_id = c.id
        and m.direction = 'inbound'
      order by coalesce(m.sent_at, m.created_at) desc
      limit 1
   ) = 'interested';
