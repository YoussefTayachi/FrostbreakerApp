-- Das Schreibprotokoll des MCP-Servers lernt Kampagnen und das Zuruecknehmen.
--
-- ANLASS
--
-- Zwei neue Faelle, die Migration 0100 noch nicht kannte:
--
-- 1. Der MCP-Server kann jetzt einen Kampagnen-ENTWURF anlegen und
--    beschreiben (create_campaign, set_campaign_sequence, update_campaign).
--    Diese Schreibvorgaenge zeigen auf keinen Lead, keinen Kontakt und kein
--    Angebot -- der Check-Constraint aus 0100 ("genau eines von dreien")
--    wuerde sie zurueckweisen, und das zu Recht: eine Protokollzeile ohne
--    Ziel ist als Nachweis wertlos.
--
-- 2. Es gibt ein Mengenwerkzeug (set_lead_icebreakers, bis zu 50 Leads je
--    Aufruf) und damit erstmals ein Werkzeug, das es zuruecknehmen kann
--    (undo_writes). Vertretbar ist die Menge nur, weil sie umkehrbar ist --
--    die vollstaendige Begruendung steht in apps/web/lib/mcp/untrusted.ts.
--
-- WARUM undo_of UND KEIN BOOLEAN "undone"
--
-- Ein Flag wuerde sagen, DASS eine Zeile zurueckgedreht wurde, aber nicht
-- durch wen und wann. undo_of zeigt von der Wiederherstellung auf den
-- Schreibvorgang, den sie zuruecknimmt: damit steht beides in derselben
-- Tabelle, in derselben Zeitachse, mit demselben token_id und user_id daneben.
-- Die Wiederherstellung IST ein Schreibvorgang und wird deshalb wie einer
-- protokolliert; ohne diese Zeile gaebe es keine Spur davon, dass jemand
-- zurueckgedreht hat.
--
-- Der zweite Zweck ist praktisch: undo_writes ueberspringt Zeilen, auf die
-- bereits eine Wiederherstellung zeigt. Ohne diese Markierung waere ein
-- zweiter Aufruf mit demselben Zeitfenster ein Kippschalter -- er wuerde die
-- Wiederherstellung wieder zuruecknehmen und damit den urspruenglichen
-- Schreibvorgang wiederholen.
--
-- Hier ausnahmsweise MIT Fremdschluessel, anders als bei business_id,
-- contact_id und offer_id: die zeigen nach draussen auf Zeilen, die geloescht
-- werden duerfen (deshalb dort bewusst keine Referenz, das Protokoll soll das
-- Loeschen ueberleben). undo_of zeigt in dieselbe Tabelle, und aus ihr wird
-- nichts geloescht. "on delete set null" ist trotzdem gesetzt: wenn doch
-- einmal jemand aufraeumt, soll die Wiederherstellung stehen bleiben und nur
-- ihren Zeiger verlieren.

alter table public.mcp_write_log
  -- Ohne Fremdschluessel, wie die drei anderen Ziel-Spalten: wird ein Entwurf
  -- in der App geloescht, muss die Spur des Schreibvorgangs stehen bleiben.
  add column if not exists campaign_id uuid,
  add column if not exists undo_of uuid references public.mcp_write_log(id) on delete set null;

comment on column public.mcp_write_log.campaign_id is
  'Der betroffene Kampagnen-Entwurf (create_campaign, set_campaign_sequence, update_campaign). Ohne Fremdschluessel, wie contact_id und offer_id.';
comment on column public.mcp_write_log.undo_of is
  'Nur bei einer Wiederherstellung durch undo_writes: die Zeile, die zurueckgenommen wird. Zeilen, auf die eine solche Markierung zeigt, dreht undo_writes kein zweites Mal zurueck.';

-- Genau ein Ziel je Zeile, jetzt aus vieren.
--
-- Unveraendert die Begruendung aus 0100: eine Zeile, die auf nichts zeigt,
-- ist als Nachweis wertlos, und eine, die auf zweierlei zeigt, laesst offen,
-- was geaendert wurde. Beides faellt erst auf, wenn jemand das Protokoll
-- braucht -- also im schlechtesten Moment.
alter table public.mcp_write_log
  drop constraint if exists mcp_write_log_target_check;
alter table public.mcp_write_log
  add constraint mcp_write_log_target_check check (
    (business_id is not null)::int
    + (contact_id is not null)::int
    + (offer_id is not null)::int
    + (campaign_id is not null)::int
    = 1
  );

-- Gelesen wird "wurde diese Zeile schon zurueckgedreht" -- eine Abfrage mit
-- in (…) ueber bis zu 50 IDs, bei jedem Aufruf von undo_writes. Teilindex,
-- weil die Spalte in der ueberwaeltigenden Mehrheit der Zeilen null ist.
create index if not exists mcp_write_log_undo_of_idx
  on public.mcp_write_log (undo_of)
  where undo_of is not null;

comment on table public.mcp_write_log is
  'Jeder Schreibvorgang ueber den MCP-Server: businesses.personalization (einzeln und in Menge), contacts.outreach_status, notes.body, offers.<feld> und campaigns.* eines Entwurfs. Eine Zeile mit undo_of ist die Wiederherstellung eines frueheren Schreibvorgangs. Wird ausschliesslich mit Service-Role befuellt; fuer authenticated gibt es nur SELECT (Policy aus Migration 0099, unveraendert -- sie haengt an workspace_id und gilt fuer alle vier Zielarten).';
