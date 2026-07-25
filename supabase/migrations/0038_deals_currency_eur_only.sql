-- Nachtrag zu 0034: deals.currency war frei editierbar, aber
-- crm_pipeline_stats() summiert value ueber alle offenen Deals einer Firma OHNE
-- nach Waehrung zu gruppieren, und ForecastCards/DealsPanel zeigen das Ergebnis
-- mit einem einzigen angenommenen Symbol an. Bei zwei Deals mit
-- unterschiedlicher Waehrung waere die Summe still falsch beschriftet gewesen.
--
-- App-seitig ist die Eingabe bereits entfernt (deals-panel.tsx setzt immer
-- 'EUR'), hier zusaetzlich in der DB erzwungen statt sich allein auf den
-- Client zu verlassen -- gleiches Prinzip wie die uebrigen CHECK-Constraints
-- in diesem Bereich (z.B. deals_closed_at_check).
--
-- Per Postgres-Konvention ergaenzt eine zweite CHECK-Bedingung die bestehende
-- aus 0034 (char_length(currency) = 3), beide muessen erfuellt sein --
-- kein DROP/ADD noetig, um eine bestehende Bedingung zu verschaerfen.
alter table public.deals
  add constraint deals_currency_eur_only check (currency = 'EUR');
