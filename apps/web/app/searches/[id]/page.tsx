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
  // wird, statt Daten aus dem falschen Workspace anzuzeigen: RLS wuerde den
  // Zugriff technisch erlauben (gehoert ja demselben Account), aber es waere hier
  // der falsche Kontext.
  const [
    searchRes,
    kinderRes,
    contactsRes,
    suppressionRes,
    instantlyKeyRes,
    localCampaignRes,
    offeneAufhaengerRes,
  ] = await Promise.all([
    supabase.from("searches").select("*").eq("id", id).eq("workspace_id", workspaceId).single(),
    /**
     * Die Teilsuchen dieser Zeile, falls es eine gebuendelte Mehrfach-Suche ist
     * (Migration 0096).
     *
     * Laeuft fuer JEDE Suchdetailseite mit, auch fuer gewoehnliche Suchen;
     * dort kommt eine leere Liste zurueck. Das kostet eine indizierte Abfrage
     * und erspart die Fallunterscheidung "erst nachsehen, ob es eine Gruppe
     * ist, dann nochmal fragen", die jeden Seitenaufruf um eine Serverrunde
     * verlaengert haette.
     */
    supabase
      .from("searches")
      .select("id, status, schedule")
      .eq("workspace_id", workspaceId)
      .eq("parent_search_id", id),
    supabase
      .from("contacts")
      // website_audit* seit Migration 0102, siehe leads/page.tsx.
      .select("*, businesses!inner(name, website, personalization, company_summary, search_id, address, phone_national, decisionmaker_status, hunter_status, website_audit, website_audit_status, website_audit_at)")
      .eq("workspace_id", workspaceId)
      .eq("businesses.search_id", id)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("suppression_list").select("email,domain").eq("workspace_id", workspaceId),
    supabase.from("api_keys").select("provider").eq("workspace_id", workspaceId).eq("provider", "instantly").maybeSingle(),
    supabase
      .from("campaigns")
      /**
       * instantly_campaign_id und activated_at gehoeren dazu, weil daran
       * haengt, WOHIN die Karte verlinkt.
       *
       * Seit dem MCP-Werkzeug create_campaign (2026-08-22) kann eine
       * campaigns-Zeile existieren, die NUR bei uns liegt: ein Entwurf ohne
       * Instantly-Zwilling. /instantly/campaigns/[id] antwortet fuer ihn mit
       * "Kampagne nicht gefunden"; er wird deshalb im Kampagnenformular
       * geoeffnet (?draft=), siehe campaign-link-card.tsx.
       */
      .select("id, name, status, instantly_campaign_id, activated_at")
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
     * Sekunden nach dem Start fertig; seine Seite hat sich nur nie wieder
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

  /**
   * Die Leads einer Gruppe stehen bei ihren Teilsuchen.
   *
   * An der Gruppen-Huelle selbst haengt keine einzige Firma: ohne diesen
   * zweiten Durchgang zeigte die Seite, in die man gerade wegen der Leads
   * geklickt hat, eine leere Tabelle. Nur fuer Gruppen: bei einer
   * gewoehnlichen Suche ist kinder leer und oben steht bereits alles.
   */
  const kinder = (kinderRes.data ?? []) as { id: string; status: string; schedule: string }[];
  const istGruppe = kinder.length > 0;
  const leadIds = istGruppe ? kinder.map((k) => k.id) : [id];
  // Der zweite Durchgang laeuft nur fuer Gruppen. Die drei Abfragen aus dem
  // ersten sind fuer sie in Sekundenbruchteilen leer zurueckgekommen (an der
  // Huelle haengt nichts) und werden hier mit dem richtigen Umfang wiederholt.
  const [gruppenContactsRes, gruppenAufhaengerRes, gruppenCampaignRes] = istGruppe
    ? await Promise.all([
        supabase
          .from("contacts")
          .select("*, businesses!inner(name, website, personalization, company_summary, search_id, address, phone_national, decisionmaker_status, hunter_status, website_audit, website_audit_status, website_audit_at)")
          .eq("workspace_id", workspaceId)
          .in("businesses.search_id", leadIds)
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("businesses")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .in("search_id", leadIds)
          .is("personalization", null)
          .not("website", "is", null),
        // Die Kampagne haengt an einer Teilsuche: api/instantly/campaigns
        // schreibt campaigns.search_id und searches.instantly_campaign_id auf
        // die ausgewaehlten IDs, und ausgewaehlt sind bei einer Gruppe ihre
        // Kinder. Ohne diese Zeile boete die Karte darunter ewig an, eine
        // zweite Kampagne fuer dieselben Leads anzulegen.
        supabase
          .from("campaigns")
          // Wie oben: mit den Spalten, an denen haengt, ob das ein Entwurf ist.
          .select("id, name, status, instantly_campaign_id, activated_at")
          .in("search_id", leadIds)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
    : [contactsRes, offeneAufhaengerRes, localCampaignRes];

  const contacts = filterSuppressed(gruppenContactsRes.data ?? [], suppressionRes.data ?? []);

  // Solange die Suche laeuft oder noch ein Aufhaenger fehlt, holt sich die
  // Seite alle fuenf Sekunden den neuen Stand. Nach zehn Minuten hoert sie
  // auf: was dann noch fehlt, kommt nicht mehr von allein, und ein Tab, der
  // bis zum Abend weiterlaedt, hilft niemandem.
  //
  // Bei einer Gruppe zaehlt der Zustand der Teilsuchen. Ihr eigener bleibt
  // lebenslang auf 'pending' (kein Worker fasst sie an); danach zu gehen
  // hiesse, dass die Seite bis zum Timeout weiterlaedt.
  const nochInArbeit =
    (istGruppe
      ? kinder.some((k) => k.status === "pending" || k.status === "running")
      : search.status === "pending" || search.status === "running") ||
    (gruppenAufhaengerRes.count ?? 0) > 0;

  // Das Abo haengt bei einer Gruppe an den Teilsuchen, nicht an der Huelle,
  // siehe new-search-form.tsx: haette sie eins, wuerde process_due_schedules
  // im Worker fuer sie einen Suchlauf ohne Ort einreihen.
  const scheduleTargetIds = istGruppe ? leadIds : [id];
  const schedule = istGruppe
    ? (kinder.find((k) => k.schedule && k.schedule !== "none")?.schedule ?? "none")
    : (search.schedule ?? "none");

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
            scheduleTargetIds={scheduleTargetIds}
            initialName={search.name ?? search.query}
            initialSchedule={schedule}
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
        {/* Erklaert, warum in dieser einen Liste Leads aus mehreren Orten
            stehen — ohne den Satz sieht die Zusammenfassung wie ein Fehler
            aus. */}
        {istGruppe && (
          <p className="mt-1 text-xs text-mute">
            {t.searchDetail.groupHint(
              kinder.length,
              kinder.filter((k) => k.status === "completed").length
            )}
          </p>
        )}
        {/* Beides beantwortet dieselbe Kundenfrage vom 2026-08-10 — "was
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
          weiterschreibt — hier war es eine zweite Stelle, an der Angebote
          entstehen. */}
      <CampaignLinkCard
        searchIds={leadIds}
        hasInstantlyKey={!!instantlyKeyRes.data}
        localCampaign={gruppenCampaignRes.data}
        manuallyLinkedCampaignId={gruppenCampaignRes.data ? null : (search.instantly_campaign_id ?? null)}
        contactsWithEmailCount={contacts.filter((c) => !!c.email).length}
      />
      <LeadsTable
        contacts={contacts}
        exportName={(search.name ?? search.query) + " - " + search.location}
      />
    </div>
  );
}
