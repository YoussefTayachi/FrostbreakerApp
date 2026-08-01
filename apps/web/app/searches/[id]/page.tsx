import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { filterSuppressed } from "@/lib/suppression";
import { getLangServer, formatDate } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { searchSourceBadgeClass, searchSourceLabel } from "@/lib/search-source";
import LeadsTable from "../../leads/leads-table";
import SearchSettings from "./search-settings";
import CampaignLinkCard from "./campaign-link-card";

export default async function SearchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lang = await getLangServer();
  const t = dict[lang];
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;
  const workspaceId = ws.workspace.id;

  // .eq("workspace_id", workspaceId) auf der searches-Abfrage sorgt dafuer, dass
  // eine ID aus einem ANDEREN eigenen Workspace hier als "nicht gefunden" behandelt
  // wird, statt Daten aus dem falschen Workspace anzuzeigen -- RLS wuerde den
  // Zugriff technisch erlauben (gehoert ja demselben Account), aber es waere hier
  // der falsche Kontext.
  const [searchRes, contactsRes, suppressionRes, instantlyKeyRes, localCampaignRes] = await Promise.all([
    supabase.from("searches").select("*").eq("id", id).eq("workspace_id", workspaceId).single(),
    supabase
      .from("contacts")
      .select("*, businesses!inner(name, website, personalization, company_summary, search_id, address, phone_national, decisionmaker_status, hunter_status)")
      .eq("workspace_id", workspaceId)
      .eq("businesses.search_id", id)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("suppression_list").select("email,domain").eq("workspace_id", workspaceId),
    supabase.from("api_keys").select("provider").eq("workspace_id", workspaceId).eq("provider", "instantly").maybeSingle(),
    supabase
      .from("campaigns")
      .select("id, status")
      .eq("search_id", id)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const search = searchRes.data;

  if (!search) {
    return <p className="text-faint">{t.searchDetail.notFound}</p>;
  }

  const contacts = filterSuppressed(contactsRes.data ?? [], suppressionRes.data ?? []);

  return (
    <div className="fade-up space-y-6">
      <div>
        <Link href="/searches" className="text-xs text-faint hover:text-ink">
          {t.searchDetail.back}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <SearchSettings
            searchId={search.id}
            initialName={search.name ?? search.query}
            initialSchedule={search.schedule ?? "none"}
            initialInstantlyCampaignId={search.instantly_campaign_id ?? null}
          />
          <span
            className={
              "rounded-full border px-2 py-0.5 text-[11px] " + searchSourceBadgeClass(search.source)
            }
          >
            {searchSourceLabel(search.source)}
          </span>
        </div>
        <p className="text-sm text-faint">
          {search.query} · {search.location} · {formatDate(search.created_at, lang, { dateStyle: "long", timeStyle: "short" })}
        </p>
      </div>
      <CampaignLinkCard
        searchId={search.id}
        hasInstantlyKey={!!instantlyKeyRes.data}
        localCampaign={localCampaignRes.data}
        manuallyLinkedCampaignId={localCampaignRes.data ? null : (search.instantly_campaign_id ?? null)}
        contactsWithEmailCount={contacts.filter((c) => !!c.email).length}
      />
      <LeadsTable
        contacts={contacts}
        exportName={(search.name ?? search.query) + " - " + search.location}
      />
    </div>
  );
}
