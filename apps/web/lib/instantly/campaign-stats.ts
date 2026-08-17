/**
 * Welche Zeile aus instantly_campaign_stats fuer eine Kampagne gilt.
 *
 * DER FEHLER, DEN DAS VERHINDERT
 *
 * Die Tabelle ist nach search_id geschluesselt, ihr INHALT ist aber
 * kampagnenweit: syncCampaigns fragt je verknuepfter Suche
 * /api/v2/campaigns/analytics?id=<KAMPAGNE> ab, und Instantly kennt dort
 * keine Suchen. Jede Zeile traegt damit die Zahlen der ganzen Kampagne, nicht
 * den Anteil ihrer Suche.
 *
 * Wer aufaddiert, multipliziert. Gemessen am 2026-08-04 an der ersten
 * Kampagne mit fuenf Suchen: 406 Leads standen in der Liste als 2030, 17
 * Kontaktierte als 85. Genau der Faktor fuenf.
 *
 * Der Irrtum ist naheliegend genug, dass er mir an zwei Stellen unterlaufen
 * ist (Uebersicht und Detailseite). Deshalb steht die Entscheidung jetzt an
 * einer Stelle und mit Tests, statt zweimal ausgeschrieben in einer Route.
 */

/** Eine Zeile, wie sie aus instantly_campaign_stats kommt. */
export type StatsRow = Record<string, string | number | null | undefined> & {
  updated_at?: string | null;
};

/**
 * Die massgebliche Zeile: die zuletzt aktualisierte.
 *
 * Alle Zeilen einer Kampagne treffen dieselbe Aussage, werden aber zu
 * unterschiedlichen Zeitpunkten abgeholt — jede Suche hat ihren eigenen
 * Poll-Termin, und der Cron arbeitet nur ein paar je Durchlauf ab. Die
 * juengste ist damit der frischeste Stand derselben Wahrheit.
 */
export function campaignStatsRow(rows: StatsRow[]): StatsRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) =>
    String(row.updated_at ?? "") > String(best.updated_at ?? "") ? row : best
  );
}

/** Die Felder, die Liste und Detailseite anzeigen. */
export const CAMPAIGN_STAT_FIELDS = [
  "leads_count",
  "contacted_count",
  "emails_sent_count",
  "open_count",
  "reply_count_unique",
  "bounced_count",
] as const;

export type CampaignStats = Record<(typeof CAMPAIGN_STAT_FIELDS)[number], number>;

/** Die Zahlen der Kampagne, oder null wenn noch keine abgeholt wurden. */
export function campaignStats(rows: StatsRow[]): CampaignStats | null {
  const row = campaignStatsRow(rows);
  if (!row) return null;
  const out = {} as CampaignStats;
  for (const field of CAMPAIGN_STAT_FIELDS) out[field] = Number(row[field]) || 0;
  return out;
}
