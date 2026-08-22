-- Das Schreibprotokoll des MCP-Servers kann jetzt auf drei Dinge zeigen.
--
-- ANLASS
--
-- Migration 0099 hat mcp_write_log fuer genau einen Fall gebaut: es gab genau
-- ein Schreibwerkzeug (set_lead_icebreaker), es aenderte genau ein Feld an
-- genau einem Lead, und deshalb war business_id "not null" richtig.
--
-- Mit set_contact_status, add_note und set_offer_field stimmt diese Annahme
-- nicht mehr. Ein Status haengt an einem Kontakt, ein Angebotsfeld an einem
-- Angebot, und eine Notiz an dem einen ODER dem anderen -- so, wie es in
-- public.notes selbst steht (Migration 0031).
--
-- WARUM DREI SPALTEN UND KEIN target_type/target_id
--
-- Ein Paar aus Typ und ID waere kuerzer und haette keinen Fremdschluessel:
-- Postgres kann nicht pruefen, ob eine ID mit target_type='contact' auch
-- wirklich in contacts steht. Genau das ist bei einem Protokoll die falsche
-- Sparsamkeit -- es ist der einzige Nachweis darueber, was ein fremdes Modell
-- in dieser Datenbank veraendert hat, und ein Nachweis, der auf nichts
-- zeigt, ist keiner. Drei benannte Spalten kosten drei Nullwerte je Zeile und
-- sagen dem Leser sofort, worum es ging.
--
-- KEIN on delete cascade, wie schon bei token_id in 0099: wird ein Lead
-- geloescht, muss die Spur des Schreibvorgangs stehen bleiben. Deshalb gibt
-- es hier bewusst gar keine Fremdschluessel-Aktion, sondern nur die Referenz
-- mit "set null" -- die Zeile ueberlebt, sie verliert nur ihren Zeiger.

alter table public.mcp_write_log
  -- Der Grund fuer diese Migration: eine Statusaenderung und eine
  -- Kontaktnotiz haben kein Business.
  alter column business_id drop not null,
  add column if not exists contact_id uuid,
  add column if not exists offer_id uuid;

comment on column public.mcp_write_log.business_id is
  'Der betroffene Lead. Null, wenn der Schreibvorgang an einem Kontakt oder einem Angebot hing -- seit Migration 0100 nullable.';
comment on column public.mcp_write_log.contact_id is
  'Der betroffene Kontakt (set_contact_status, add_note mit contact_id). Ohne Fremdschluessel, wie user_id: das Protokoll soll das Loeschen des Kontakts ueberleben.';
comment on column public.mcp_write_log.offer_id is
  'Das betroffene Angebot (set_offer_field). Ohne Fremdschluessel, aus demselben Grund wie contact_id.';

-- Genau ein Ziel je Zeile.
--
-- Ohne diesen Zwang koennte eine Zeile auf nichts zeigen (dann ist sie als
-- Nachweis wertlos) oder auf zweierlei (dann ist unklar, was geaendert wurde).
-- Beides faellt beim Lesen nicht auf, sondern erst, wenn jemand das Protokoll
-- braucht -- also im schlechtesten Moment.
alter table public.mcp_write_log
  drop constraint if exists mcp_write_log_target_check;
alter table public.mcp_write_log
  add constraint mcp_write_log_target_check check (
    (business_id is not null)::int
    + (contact_id is not null)::int
    + (offer_id is not null)::int
    = 1
  );

-- Gelesen wird auch "was ist an DIESEM Kontakt passiert" -- die Timeline
-- eines Leads ist der Ort, an dem ein Mensch bemerken soll, dass ein Status
-- nicht aus der App, sondern aus einem Modell kam. Teilindizes, weil je Zeile
-- nur eine der drei Spalten gefuellt ist und ein voller Index ueberwiegend
-- Nullwerte enthielte.
create index if not exists mcp_write_log_contact_idx
  on public.mcp_write_log (contact_id, created_at desc)
  where contact_id is not null;

create index if not exists mcp_write_log_business_idx
  on public.mcp_write_log (business_id, created_at desc)
  where business_id is not null;

comment on table public.mcp_write_log is
  'Jeder Schreibvorgang ueber den MCP-Server: businesses.personalization, contacts.outreach_status, notes.body und offers.<feld>. Wird ausschliesslich mit Service-Role befuellt; fuer authenticated gibt es nur SELECT (Policy aus Migration 0099, unveraendert -- sie haengt an workspace_id und gilt fuer alle drei Zielarten).';
