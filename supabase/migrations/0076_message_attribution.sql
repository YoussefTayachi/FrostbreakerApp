-- Welcher Text hat diese Antwort ausgeloest?
--
-- Am 2026-08-05 war der Zustand: 753 Nachrichten, davon 0 mit `step_order`,
-- 0 mit `campaign_id`, und keine Spalte fuer die Variante. Die App konnte zu
-- keiner eingegangenen Antwort sagen, worauf sie eine Antwort ist. Die
-- Wirkungs-Ansicht schluesselte nach Lead-Liste, Wochentag und Tageszeit auf
-- -- also nach allem AUSSER dem, was tatsaechlich geschrieben wurde.
--
-- Das ist die Voraussetzung aus PRODUKTPLAN Saeule 2.1, seit dem 2026-08-03
-- unveraendert offen. Ohne sie ist der "geschlossene Kreis" nicht baubar:
-- Frostbreaker erzeugt den Text UND sieht die Antwort darauf, aber solange
-- beides nicht verbunden ist, ist der Burggraben nur eine Behauptung.
--
-- WOHER DIE DATEN KOMMEN
--
-- Nicht aus einem Textvergleich und nicht aus einer Schaetzung: Instantly
-- liefert die Zuordnung seit jeher mit. `GET /api/v2/emails` gibt je Mail
-- neunzehn Felder zurueck, der Typ im Sync deklarierte fuenf davon. Am
-- 2026-08-05 an 763 echten Mails nachgesehen:
--
--   step        "0_0_1"   Sequenz, Schritt, Variante -- je 0-basiert
--   campaign_id uuid      Instantlys Kampagne
--   thread_id   "60-vbu…" verbindet Antwort und ausloesende Mail
--   ue_type     1 | 2     1 = ausgehend, 2 = eingehend
--
-- Der Glueckfall dabei: eine EINGEHENDE Antwort traegt denselben `step`-Wert
-- wie die Mail, auf die sie antwortet. Instantly ordnet die Antwort also
-- bereits dem Schritt und der Variante zu. Die Zuordnung ist damit exakt und
-- nicht rekonstruiert -- kein Abgleich von Betreffzeilen, kein Raten ueber
-- Zeitfenster.
--
-- Die Zerlegung von `step` steht mit Tests in lib/instantly/step-ref.ts.

alter table public.messages
  add column if not exists variant_index integer,
  add column if not exists thread_id text,
  add column if not exists instantly_campaign_id text;

comment on column public.messages.step_order is
  'Schritt der Sequenz, 0-basiert wie campaign_steps.step_order. Aus Instantlys step-Feld. Null = nicht zuordenbar.';
comment on column public.messages.variant_index is
  'Fassung des Schritts, 0-basiert wie der Index in campaign_steps.variants (0 = Variante A). Null = nicht zuordenbar.';
comment on column public.messages.thread_id is
  'Instantlys Gespraechsfaden. Verbindet eine Antwort mit der Mail, die sie ausgeloest hat.';
comment on column public.messages.instantly_campaign_id is
  'Instantlys Kampagnen-UUID, auch wenn dazu lokal keine Zeile in campaigns existiert.';

-- WARUM instantly_campaign_id NEBEN campaign_id
--
-- Zwei der sechs Kampagnen, aus denen am 2026-08-05 Mails im Konto lagen,
-- haben lokal gar keine Zeile in `campaigns` -- sie wurden direkt bei
-- Instantly angelegt, bevor die App sie verwaltete. Ihre Mails haetten mit
-- einem reinen Fremdschluessel keine Kampagne, und in der Auswertung sae
-- eine Luecke, die wie ein Fehler aussieht.
--
-- Mit beiden Spalten gilt: `campaign_id` fuer alles, was die App kennt,
-- `instantly_campaign_id` als Beleg fuer den Rest. Eine spaeter angelegte
-- lokale Kampagne kann ihre Altmails darueber jederzeit einsammeln.

/**
 * Der Index fuer die Auswertung.
 *
 * Die Abfrage der Wirkungs-Ansicht lautet immer "alle Nachrichten dieses
 * Workspace, getrennt nach Richtung, gruppiert nach Kampagne, Schritt und
 * Variante". Genau in dieser Reihenfolge, damit der Index von links gelesen
 * werden kann.
 *
 * Teilindex auf "hat eine Zuordnung": nicht zuordenbare Zeilen werden in der
 * Auswertung ohnehin gesondert behandelt und muessen den Index nicht
 * aufblaehen.
 */
create index if not exists messages_attribution_idx
  on public.messages (workspace_id, direction, campaign_id, step_order, variant_index)
  where step_order is not null;

/**
 * Und einer fuer den Nachlauf.
 *
 * Die 753 vorhandenen Zeilen werden ueber ihre instantly_email_id
 * nachgetragen (siehe backfillAttribution im Sync). Ohne Index waere das
 * je Mail ein vollstaendiger Durchlauf der Tabelle.
 *
 * Es gibt bereits einen unique constraint auf (workspace_id,
 * instantly_email_id) aus Migration 0019 -- der traegt die Suche. Hier steht
 * deshalb kein zweiter Index, sondern nur dieser Hinweis, damit niemand ihn
 * "vermisst" und doppelt anlegt.
 */
