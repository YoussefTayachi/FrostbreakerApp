import Link from "next/link";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { STATUS_BADGE_CLS } from "@/lib/ui";

/**
 * Kompakter Ersatz fuer das alte, komplett inline eingebettete Kampagnen-
 * Formular (siehe git history: instantly-campaign-builder.tsx). Anlegen und
 * Verwalten passiert jetzt zentral im /instantly-Bereich; diese Karte hier
 * zeigt nur noch den Link-Status und fuehrt dorthin. Drei Zustaende:
 *  1. Keine Kampagne verknuepft -> Button zum Anlegen (vorausgefuellt mit dieser Suche)
 *  2. Nativ angelegte Kampagne (lokale campaigns-Zeile vorhanden) -> Status-Badge + Link ins Kampagnen-Detail
 *  3. Nur manuell per ID verknuepft (searches.instantly_campaign_id gesetzt, aber keine lokale Zeile;
 *     der alte manuelle Weg aus SearchSettings) -> unveraendert wie bisher, Hinweis auf Instantly direkt
 */
export default async function CampaignLinkCard({
  hasInstantlyKey,
  localCampaign,
  manuallyLinkedCampaignId,
  contactsWithEmailCount,
  searchIds,
}: {
  hasInstantlyKey: boolean;
  localCampaign: { id: string; status: string } | null;
  manuallyLinkedCampaignId: string | null;
  contactsWithEmailCount: number;
  /** Die Listen, aus denen die Kampagne ihre Empfaenger zieht. Bei einer
   *  gebuendelten Mehrfach-Suche sind das ihre Teilsuchen und nicht sie selbst:
   *  an der Gruppen-Huelle haengt keine Firma (Migration 0096). */
  searchIds: string[];
}) {
  const lang = await getLangServer();
  const t = dict[lang];
  const C = t.instantly.campaigns;

  if (!hasInstantlyKey) return null;

  if (localCampaign) {
    return (
      <Link
        href={`/instantly/campaigns/${localCampaign.id}`}
        className="flex items-center justify-between rounded-lg border border-edge2 bg-panel px-4 py-3 text-sm transition-colors hover:border-sky-500/50"
      >
        <span className="flex items-center gap-2.5">
          <span className={"rounded-full border px-2 py-0.5 text-[11px] " + (STATUS_BADGE_CLS[localCampaign.status] ?? "")}>
            {t.instantly.statusLabels[localCampaign.status as keyof typeof t.instantly.statusLabels] ?? localCampaign.status}
          </span>
          <span className="text-faint">{C.manage}</span>
        </span>
        <span className="text-faint">→</span>
      </Link>
    );
  }

  if (manuallyLinkedCampaignId) {
    return (
      <div className="rounded-lg border border-edge2 bg-panel px-4 py-3 text-sm text-faint">
        {t.searchDetail.campaignBuilder.linkedHeading}{" "}
        <code className="rounded bg-panel2 px-1.5 py-0.5 font-mono text-[11px] text-mute">{manuallyLinkedCampaignId}</code>
        <span className="ml-2">{t.searchDetail.campaignBuilder.linkedHint}</span>
      </div>
    );
  }

  return (
    <Link
      href={`/instantly/campaigns/new?${searchIds.map((id) => `searchId=${id}`).join("&")}`}
      className="flex items-center justify-between rounded-lg border border-dashed border-edge3 px-4 py-3 text-sm text-faint transition-colors hover:border-sky-500/60 hover:text-sky-600 dark:hover:text-sky-400"
    >
      <span>{t.searchDetail.campaignBuilder.description(contactsWithEmailCount)}</span>
      <span>→</span>
    </Link>
  );
}
