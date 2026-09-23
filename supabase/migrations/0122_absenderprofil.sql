-- Absenderprofil am Angebot: wer schreibt, Werdegang, These, was die Person
-- selbst tut. Zwei, drei Saetze je Absender.
--
-- Anlass (2026-09-23): die Schnipsel fuer die feste Copy (0121) waren
-- korrekt, aber gleichfoermig: "Email marketing for ecommerce" stand zehnmal
-- als thingWeHaveInCommon, weil das Modell nur das Angebot kannte und nicht
-- den Menschen dahinter. Mit dem Profil der Gruender (Chatarmin-Zeit,
-- Retention-These "der zweite Kauf ist der wichtigste", 200+ Ecoms) hat es
-- Stoff fuer eine Gemeinsamkeit je Lead, die stimmt.
--
-- Eine Spalte wie signature (0091), nicht eines der zwoelf Textfelder: die
-- zwoelf sind der Aufbau der ersten Mail und haengen an Vollstaendigkeit,
-- Karte und Coach. Das Profil ist Material fuer den Worker, keine Stufe.
alter table public.offers
  add column if not exists sender_profile text not null default '';

comment on column public.offers.sender_profile is
  'Wer schreibt: Werdegang, These, was die Person selbst tut. Material fuer die Personen-Schnipsel (thingWeHaveInCommon, thingWeHaveSynergyAround), nie woertlich in der Mail.';
