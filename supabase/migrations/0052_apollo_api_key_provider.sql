-- Nachtrag zu 0051: Apollo war als Lead-Quelle (searches.source) freigegeben,
-- aber nicht als BYOK-Provider. Die Liste der erlaubten Provider steht an zwei
-- Stellen -- im Code (PROVIDERS in app/api/keys/route.ts) und als
-- CHECK-Constraint hier -- und nur die erste war erweitert. Folge: das
-- Einfuegen des Apollo-Keys scheiterte in den Einstellungen mit
-- "violates check constraint api_keys_provider_check", obwohl die Oberflaeche
-- das Feld anbot.
--
-- Zuletzt gesetzt in 0019 (Instantly als 5. Provider), davor 0013 (NeverBounce).
alter table public.api_keys drop constraint if exists api_keys_provider_check;
alter table public.api_keys add constraint api_keys_provider_check
  check (provider in ('google_maps', 'openai', 'hunter', 'apollo', 'neverbounce', 'instantly'));
