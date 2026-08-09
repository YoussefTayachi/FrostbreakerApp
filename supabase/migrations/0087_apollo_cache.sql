-- Nichts zweimal bei Apollo bezahlen, was dasselbe Konto schon bezahlt hat.
--
-- DER BEFUND
--
-- Apollos Doku ist eindeutig: "If you call Apollo API to enrich data for the
-- same people in the future, you can potentially use more credits to access
-- the same data you already accessed." Die Sichtbarkeit im Apollo-Fenster
-- gilt nur fuer Personen, die dort als CONTACT angelegt wurden -- ein
-- bulk_match ueber die API tut das nicht.
--
-- Gemessen am 2026-08-09: 1106 Apollo-Kontakte im Bestand, davon 1050
-- eindeutige Adressen. 56 Credits wurden also nachweislich doppelt bezahlt --
-- und das ist die Untergrenze, denn Faelle, in denen bezahlt und danach als
-- Dublette verworfen wurde, hinterlassen ueberhaupt keine Zeile.
--
-- WARUM CACHE UND NICHT "UEBERSPRINGEN"
--
-- Der naheliegende Griff waere, bekannte Personen einfach nicht mehr
-- anzureichern. Das spart Credits und verliert den Lead: sucht ein zweiter
-- Workspace dieselbe Firma, bekaeme er sie gar nicht. Der Cache loest beides
-- -- der Datensatz kommt aus der eigenen Ablage statt von Apollo, kostet
-- nichts und landet trotzdem vollstaendig beim Nutzer.
--
-- WARUM PRO API-KEY UND NICHT PRO WORKSPACE
--
-- Credits haengen am Apollo-Konto, nicht am Workspace. Wer eine Agentur mit
-- mehreren Kunden-Workspaces und einem Apollo-Vertrag betreibt, zahlt sonst
-- fuer dieselbe Person so oft, wie er Kunden hat.
--
-- Gespeichert wird der FINGERABDRUCK des Schluessels (sha256), nie der
-- Schluessel selbst: die Tabelle soll auch dann nichts hergeben, wenn jemand
-- sie zu Gesicht bekommt. Zwei Workspaces teilen sich den Cache genau dann,
-- wenn sie denselben Apollo-Schluessel hinterlegt haben -- also genau dann,
-- wenn sie sich auch die Rechnung teilen.
--
-- ZUR DATENTRENNUNG
--
-- Der Cache enthaelt fremde Personendaten und darf deshalb NIE im Browser
-- landen. Er hat RLS und bewusst KEINE Policy: damit kommt ausschliesslich
-- die Service-Role des Workers heran. Ein Workspace sieht nie, was ein
-- anderer gefunden hat -- er bekommt nur seinen eigenen Lead, ohne dafuer ein
-- zweites Mal zu zahlen.

create table public.apollo_cache (
  -- sha256 des API-Schluessels, hex. Nicht der Schluessel.
  key_fingerprint text not null,
  -- 'person'  -> external_id ist Apollos Personen-ID (steht in der KOSTENLOSEN
  --              Vorschau, deshalb laesst sich vor dem Bezahlen nachsehen)
  -- 'organization' -> external_id ist die Firmendomain
  kind text not null check (kind in ('person', 'organization')),
  external_id text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (key_fingerprint, kind, external_id)
);

alter table public.apollo_cache enable row level security;
-- Absichtlich keine Policy: nur die Service-Role (Worker) greift zu.

-- Fuer das Aufraeumen veralteter Zeilen.
create index apollo_cache_age_idx on public.apollo_cache (fetched_at);

comment on table public.apollo_cache is
  'Bereits bei Apollo bezahlte Personen- und Firmendaten, je API-Schluessel. '
  'Verhindert, dass dieselbe Person mehrfach Credits kostet. Enthaelt fremde '
  'Personendaten -- RLS ohne Policy, nur der Worker liest und schreibt.';

comment on column public.apollo_cache.fetched_at is
  'Wann der Datensatz von Apollo kam. Der Worker holt aelteres neu (APOLLO_CACHE_MAX_AGE_DAYS): '
  'eine E-Mail von vor einem Jahr gratis auszuliefern waere billig und falsch.';
