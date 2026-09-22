-- Welche Antworten auf die eigene Kampagne gehen, wenn das Instantly-Konto
-- jemand anderem gehoert.
--
-- ═══════════════════════════════════════════════════════════════════════
-- DER FALL, DER DAS AUSGELOEST HAT
-- ═══════════════════════════════════════════════════════════════════════
--
-- Ein Nutzer uebernimmt die Kaltakquise fuer eine fremde Firma und wird nach
-- Ergebnis bezahlt. Gesendet wird aus DEREN Instantly-Konto, weil dort die
-- Postfaecher und die Zustellbarkeit sitzen. Der Antwort-Sync holt damit
-- zwangslaeufig auch alles herein, was die Firma selbst verschickt.
--
-- Gemessen am 2026-09-22 an dem Konto, um das es geht: 50 Postfaecher, alle
-- auf derselben Domain, zwei Absendernamen, EINE Kampagne, 2776 ausgehende
-- und 163 eingegangene Mails. Kommt die eigene Kampagne dazu, liegen beide
-- Antwortstroeme im selben Posteingang, und die Frage "welche Antwort habe
-- ich verdient" ist von Hand nicht mehr zu beantworten.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WARUM EINE TABELLE UND KEINE SPALTE AUF campaigns
-- ═══════════════════════════════════════════════════════════════════════
--
-- Weil die fremden Kampagnen in campaigns gar nicht vorkommen. Eine Kampagne
-- bekommt dort nur eine Zeile, wenn sie in Frostbreaker entstanden ist; die
-- 2776 Mails oben tragen alle eine instantly_campaign_id, aber campaign_id
-- ist bei jeder einzelnen null. Eine Spalte auf campaigns koennte also genau
-- die Faelle nicht ausdruecken, die den Unterschied machen.
--
-- Der Schluessel ist deshalb die instantly_campaign_id, dasselbe Feld, das
-- auch in messages steht. Die Zuordnung ist damit ein Vergleich und keine
-- Vermutung.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WAS HIER BEWUSST NICHT STEHT
-- ═══════════════════════════════════════════════════════════════════════
--
-- Kein Provisionssatz, kein Betrag, keine Waehrung. Was eine Antwort wert
-- ist, steht in einer Abmachung zwischen zwei Menschen und aendert sich,
-- ohne dass die Software davon erfaehrt. Diese Tabelle beantwortet die eine
-- Frage, die sie belegen kann: welche Kampagne war meine. Den Rest rechnet,
-- wer die Abmachung kennt.
create table public.commission_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  -- Instantlys eigene Kampagnen-UUID, als Text wie ueberall sonst
  -- (messages.instantly_campaign_id, campaigns.instantly_campaign_id).
  instantly_campaign_id text not null,

  -- Wofuer die Zeile steht, in der Sprache des Nutzers. Zeigt der
  -- Posteingang neben der Unterhaltung an, damit die Zuordnung sichtbar ist
  -- und nicht nur gefiltert wird.
  label text not null default 'Meine Kampagne',

  -- Wer sie markiert hat und wann. Ein Provisionsnachweis, den jemand
  -- nachtraeglich lautlos umschreiben kann, ist keiner.
  marked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  unique (workspace_id, instantly_campaign_id)
);

alter table public.commission_campaigns enable row level security;
create policy commission_campaigns_member on public.commission_campaigns
  for all using (public.is_workspace_member(workspace_id));

-- Der Zugriffsweg ist immer derselbe: "ist DIESE Kampagne meine".
create index commission_campaigns_lookup_idx
  on public.commission_campaigns (workspace_id, instantly_campaign_id);

-- Und der Gegenweg, den die Auswertung braucht: alle Mails einer markierten
-- Kampagne. messages hat bisher keinen Index auf instantly_campaign_id;
-- ohne ihn liest die Provisionsseite die ganze Tabelle des Workspaces.
create index if not exists messages_instantly_campaign_idx
  on public.messages (workspace_id, instantly_campaign_id, direction);
