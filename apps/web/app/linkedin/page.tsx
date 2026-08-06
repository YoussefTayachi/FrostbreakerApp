import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { getDefaultLinkedInTemplate } from "@/lib/crm/linkedin-message";
import LinkedInOverview from "./linkedin-overview";
import LinkedInList from "./linkedin-list";
import type { LinkedInTemplateRow } from "./linkedin-template";
import type { LinkedInLead, LeadListSummary } from "./types";
import HelpLink from "../help-link";

/**
 * LinkedIn-Akquise, zweistufig: erst die Lead-Listen, dann die Profile einer
 * Liste.
 *
 * Warum zweistufig und nicht eine Liste: der Bestand verteilt sich am
 * 2026-08-03 auf 21 Suchen, die groesste mit 300 Profilen. Flach
 * untereinander ist das eine Wand aus Namen ohne jeden Zusammenhang -- man
 * sieht nicht, ob man gerade US-Agenturen oder DACH-Shops anschreibt, und
 * genau das entscheidet ueber die Ansprache. Die Suche ist ausserdem die
 * Einheit, in der hier tatsaechlich gearbeitet wird (eine Nische, ein Ort,
 * eine Kampagne).
 *
 * Nebeneffekt: eine Liste ist damit ueberschaubar gross, statt bei einer
 * festen Obergrenze stumm abgeschnitten zu werden.
 *
 * Gesendet wird nicht von hier. LinkedIn bietet keine API fuer Nachrichten
 * oder Kontaktanfragen; jede Automatisierung laeuft ueber Browser-Steuerung,
 * verstoesst gegen die Nutzervereinbarung und riskiert die Sperrung des
 * Kontos. Diese Seite bereitet vor und protokolliert -- dasselbe Prinzip wie
 * /calls, wo auch mit dem eigenen Telefon gewaehlt wird.
 */

// Grosszuegig: der gesamte Bestand liegt aktuell bei rund 900 Profilen, und
// die Gruppenzahlen sollen stimmen. Waere hier zu frueh Schluss, zeigte die
// Uebersicht falsche Summen -- schlimmer als eine lange Liste.
const MAX_ROWS = 3000;

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  email: string | null;
  linkedin: string;
  outreach_status: string;
  business_id: string | null;
  businesses: {
    name: string | null;
    website: string | null;
    personalization: string | null;
    company_summary: string | null;
    search_id: string | null;
    // Dank searches!inner nie null -- siehe Begruendung an der Abfrage.
    searches: {
      id: string;
      name: string | null;
      query: string;
      location: string;
      source: string | null;
      note: string | null;
    };
  } | null;
};

export default async function LinkedInPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const lang = await getLangServer();
  const t = dict[lang];
  const params = await searchParams;
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;
  const workspaceId = ws.workspace.id;

  const [{ data: templateRows }, { data }, { data: contacted }] = await Promise.all([
    // Seit Migration 0080 liegen die Vorlagen in einer eigenen Tabelle statt
    // als eine Textspalte am Workspace -- benannt, mehrere, eine davon
    // vorausgewaehlt.
    supabase
      .from("linkedin_templates")
      .select("id, name, body, is_default")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
    supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, full_name, title, email, linkedin, outreach_status, business_id, " +
          "businesses!inner(name, website, personalization, company_summary, search_id, " +
          "searches!inner(id, name, query, location, source, note))"
      )
      .eq("workspace_id", workspaceId)
      .not("linkedin", "is", null)
      // Dasselbe Sicherheitsnetz wie beim Anlegen einer Kampagne
      // (api/instantly/campaigns): wer abgesagt hat, taucht in keiner
      // Akquise-Liste wieder auf, egal ueber welchen Kanal.
      .neq("outreach_status", "not_interested")
      // Papierkorb ausblenden. Ohne diesen Filter zeigte die Seite auch Leads
      // aus geloeschten Suchen -- gemessen am Bestand vom 2026-08-03 waren das
      // 360 von 908 Profilen aus 16 Papierkorb-Listen, also 40% der Seite.
      //
      // Der Filter sitzt in der Abfrage und nicht im Speicher, weil sonst ein
      // erheblicher Teil der Obergrenze fuer Zeilen draufginge, die ohnehin
      // weggeworfen werden.
      //
      // searches!inner statt eines lockeren Joins: nur so schliesst PostgREST
      // die Eltern-Zeile aus. Bei einem lockeren Join bliebe der Kontakt
      // stehen und nur die eingebettete Suche waere null. Der Preis dafuer --
      // Kontakte ohne zugeordnete Suche fallen raus -- ist hier keiner: das
      // endgueltige Loeschen entfernt die Firmen mit (search-actions.tsx),
      // und deren Kontakte haengen per Kaskade daran. Nachgemessen: null
      // Kontakte ohne Suche.
      .is("businesses.searches.deleted_at", null)
      .limit(MAX_ROWS),
    supabase
      .from("activities")
      .select("contact_id")
      .eq("workspace_id", workspaceId)
      .eq("channel", "linkedin")
      .not("contact_id", "is", null),
  ]);

  const contactedIds = new Set((contacted ?? []).map((a) => a.contact_id as string));

  // Cast an der Vertrauensgrenze wie in /leads, /inbox und /calls: der
  // Supabase-Client ist untypisiert und leitet 1:1-Relationen bei
  // verschachtelten Selects als Array her.
  const rows = (data ?? []) as unknown as ContactRow[];

  const leads: LinkedInLead[] = rows.map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    full_name: r.full_name,
    title: r.title,
    email: r.email,
    linkedin: r.linkedin,
    outreach_status: r.outreach_status,
    business_id: r.business_id,
    company_name: r.businesses?.name ?? null,
    personalization: r.businesses?.personalization ?? null,
    listId: r.businesses!.searches.id,
    alreadyContacted: contactedIds.has(r.id),
  }));

  // Gruppieren und je Gruppe die Zahlen bilden, die vor dem Hineinklicken
  // ueber die Reihenfolge entscheiden: wie viel ist offen, wie viel davon
  // ist ohne E-Mail nur hier erreichbar, wie viel hat schon einen Icebreaker.
  const byList = new Map<string, LeadListSummary>();
  for (const row of rows) {
    const search = row.businesses!.searches;
    const id = search.id;
    let entry = byList.get(id);
    if (!entry) {
      entry = {
        id,
        name: search.name || search.query,
        location: search.location,
        source: search.source,
        note: search.note,
        total: 0,
        withoutEmail: 0,
        withIcebreaker: 0,
        contacted: 0,
      };
      byList.set(id, entry);
    }
    entry.total++;
    if (!row.email) entry.withoutEmail++;
    if (row.businesses?.personalization) entry.withIcebreaker++;
    if (contactedIds.has(row.id)) entry.contacted++;
  }

  // Reihenfolge der Uebersicht: wo am meisten Arbeit offen ist, zuerst.
  const lists = [...byList.values()].sort((a, b) => b.total - b.contacted - (a.total - a.contacted));

  const templates = (templateRows ?? []) as LinkedInTemplateRow[];
  // Vorausgewaehlt ist die als Standard markierte, sonst die erste. Gibt es
  // noch gar keine, steht die Vorgabe aus dem Code im Feld -- der Nutzer
  // sieht also nie ein leeres Blatt.
  const initial = templates.find((x) => x.is_default) ?? templates[0] ?? null;
  const template = initial?.body ?? getDefaultLinkedInTemplate(lang);
  const selected = params.list ? lists.find((l) => l.id === params.list) : undefined;

  return (
    <div className="fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.linkedin.title}</h1>
        <p className="text-sm text-faint">
          {t.linkedin.subtitle} <HelpLink section="calls" label={t.guide.helpLink} />
        </p>
      </div>

      {selected ? (
        <LinkedInList
          list={selected}
          leads={leads.filter((l) => l.listId === selected.id)}
          templates={templates}
          initialTemplateId={initial?.id ?? null}
          template={template}
        />
      ) : (
        <LinkedInOverview
          lists={lists}
          templates={templates}
          initialTemplateId={initial?.id ?? null}
          template={template}
          firstLead={leads[0] ?? null}
          truncated={rows.length >= MAX_ROWS}
          maxRows={MAX_ROWS}
        />
      )}
    </div>
  );
}
