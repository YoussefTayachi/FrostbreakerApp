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
import AutoRefresh from "../../auto-refresh";
import LocalTime from "../../local-time";
import SaveAsPreset from "./save-as-preset";
import UsedFilters from "./used-filters";

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
  const [
    searchRes,
    contactsRes,
    suppressionRes,
    instantlyKeyRes,
    localCampaignRes,
    offeneAufhaengerRes,
  ] = await Promise.all([
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
    /**
     * Firmen dieser Suche, die noch auf ihren Aufhaenger warten.
     *
     * Genau das war die Frage eines Kunden am 2026-08-09: Er sah im
     * Seitenpanel den grauen Punkt bei "AI personalization" und schloss
     * daraus, die Personalisierung laufe gar nicht. Tatsaechlich war sie 46
     * Sekunden nach dem Start fertig -- seine Seite hat sich nur nie wieder
     * gemeldet. Die Bedingung hier ist dieselbe, nach der das Panel den
     * Punkt zeichnet: Website vorhanden, Aufhaenger noch nicht.
     */
    supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("search_id", id)
      .is("personalization", null)
      .not("website", "is", null),
  ]);
  const search = searchRes.data;

  if (!search) {
    return <p className="text-faint">{t.searchDetail.notFound}</p>;
  }

  const contacts = filterSuppressed(contactsRes.data ?? [], suppressionRes.data ?? []);

  // Solange die Suche laeuft oder noch ein Aufhaenger fehlt, holt sich die
  // Seite alle fuenf Sekunden den neuen Stand. Nach zehn Minuten hoert sie
  // auf: was dann noch fehlt, kommt nicht mehr von allein, und ein Tab, der
  // bis zum Abend weiterlaedt, hilft niemandem.
  const nochInArbeit =
    search.status === "pending" ||
    search.status === "running" ||
    (offeneAufhaengerRes.count ?? 0) > 0;

  return (
    <div className="fade-up space-y-6">
      {nochInArbeit && <AutoRefresh maxMs={10 * 60 * 1000} />}
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
          {search.query} · {search.location} ·{" "}
          <LocalTime
            iso={search.created_at}
            lang={lang}
            opts={{ dateStyle: "long", timeStyle: "short" }}
            serverFormatted={formatDate(search.created_at, lang, {
              dateStyle: "long",
              timeStyle: "short",
            })}
          />
        </p>
        {/* Beides beantwortet dieselbe Kundenfrage vom 2026-08-10 -- "was
            hatte ich nochmal ausgewaehlt": einmal zum Nachlesen, einmal zum
            Wiederverwenden. */}
        <UsedFilters row={search} lang={lang} />
        <div className="mt-2">
          <SaveAsPreset
            searchId={search.id}
            row={search}
            suggestedName={search.name ?? search.query ?? ""}
          />
        </div>
      </div>
      {/* Der Angebotsentwurf zu dieser Liste stand bis zum 2026-08-15 hier.
          Er sitzt jetzt im Angebotsformular (app/offers/offers-editor.tsx):
          zugeschnitten wird ein Angebot, das man dabei auch gleich sieht und
          weiterschreibt -- hier war es eine zweite Stelle, an der Angebote
          entstehen. */}
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
