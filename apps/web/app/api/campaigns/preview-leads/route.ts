import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { CONTACT_COLUMNS, planCampaignLeads, type CampaignContactRow } from "@/lib/instantly/create-campaign";
import { pickPreviewLeads } from "@/lib/instantly/preview";
import { PREVIEW_BROWSE_LIMIT } from "@/lib/instantly/preview-selection";
import type { MergeTagSource } from "@/lib/instantly/campaigns";

/**
 * Die Leads, an denen die Mail-Vorschau im Kampagnenformular gezeigt wird.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM EINE EIGENE ROUTE UND NICHT DIE ABFRAGE IM BROWSER
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Das Formular holt sich die Empfaengerzahl heute schon selbst
 * (campaigns/new/page.tsx): bis zu 5000 Kontakte ueber den Browser-Client,
 * durch dieselben Filter gerechnet wie der Server-Pfad. Diese Abfrage haette
 * man um first_name, businesses.name, personalization und website_finding
 * erweitern koennen und waere mit einer Runde ausgekommen.
 *
 * Dagegen sprach die Groesse: Icebreaker und Website-Befund sind GANZE
 * SAETZE, nicht Flags. Drei Textspalten mal 5000 Zeilen sind ein paar Megabyte
 * ueber die Leitung des Nutzers, jedes Mal neu, wenn ein Haken bei einer
 * Lead-Liste gesetzt wird -- fuer eine Vorschau, die zwoelf davon anzeigt.
 *
 * Hier laeuft dieselbe grosse Abfrage weiter, aber in fra1 neben der Datenbank
 * (Vercel-Region, siehe docs/BETRIEB.md), und zum Browser gehen nur die
 * zwoelf ausgewaehlten Zeilen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DIE HARTE ANFORDERUNG: NUR LEADS, DIE AUCH WIRKLICH MITGINGEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Eine Vorschau auf "die ersten aus der Tabelle" zeigt womoeglich eine Mail an
 * jemanden, der nie eine bekommt (gesperrt, ungueltig, hat laengst geantwortet,
 * zweite Person derselben Firma). Deshalb dieselbe Abfrage (CONTACT_COLUMNS)
 * und dieselbe Filterkette (planCampaignLeads) wie der tatsaechliche Versand,
 * beide aus lib/instantly/create-campaign.ts importiert statt nachgebaut.
 *
 * NICHT gefiltert wird hier splitByWebsiteFinding, und das ist Absicht: ein
 * Lead ohne Website-Befund IST der Fall, den die Vorschau zeigen soll. Ob er
 * zurueckgehalten wuerde, haengt am Sequenztext, der sich beim Tippen aendert;
 * diese Entscheidung faellt deshalb im Browser (isHeldBack in
 * lib/instantly/preview-selection.ts) und nicht hier, sonst muesste die Route
 * bei jedem Tastendruck neu laufen.
 */
export const maxDuration = 30;

type Body = { searchIds?: string[]; limit?: number };

/** Nur die Spalten, aus denen mergeTagValues Werte zieht. Der Rest der
 *  Kontaktzeile (id, title, outreach_status, ...) bleibt auf dem Server: die
 *  Vorschau rendert Text, sie verwaltet keine Kontakte. */
function toPreviewLead(row: CampaignContactRow): MergeTagSource {
  return {
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    businesses: {
      name: row.businesses?.name ?? null,
      personalization: row.businesses?.personalization ?? null,
      website_finding: row.businesses?.website_finding ?? null,
    },
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const current = await getCurrentWorkspace(supabase);
  if (!current) return NextResponse.json({ error: "kein Workspace" }, { status: 400 });
  const workspaceId = current.workspace.id;

  const body = (await req.json().catch(() => ({}))) as Body;
  const searchIds = (body.searchIds ?? []).filter(Boolean);
  // Obergrenze auch dann, wenn der Aufrufer etwas anderes schickt: die Antwort
  // traegt ganze Saetze je Lead, und niemand blaettert durch hundert Mails.
  const limit = Math.min(Math.max(Math.trunc(body.limit ?? PREVIEW_BROWSE_LIMIT) || 0, 1), PREVIEW_BROWSE_LIMIT);

  if (searchIds.length === 0) return NextResponse.json({ leads: [], sendable: 0 });

  const [{ data: contacts }, { data: suppression }, { data: archived }] = await Promise.all([
    supabase
      .from("contacts")
      .select(CONTACT_COLUMNS)
      // RLS sagt nur, auf welche Accounts jemand zugreifen darf, nicht,
      // welcher der eigenen Workspaces gemeint ist (siehe CLAUDE.md).
      .eq("workspace_id", workspaceId)
      .in("businesses.search_id", searchIds)
      .not("email", "is", null)
      .limit(5000),
    supabase.from("suppression_list").select("email, domain").eq("workspace_id", workspaceId),
    supabase.from("contact_archive").select("email").eq("workspace_id", workspaceId).not("email", "is", null),
  ]);

  const { rows } = planCampaignLeads(
    (contacts ?? []) as unknown as CampaignContactRow[],
    (suppression ?? []) as { email: string | null; domain: string | null }[],
    ((archived ?? []) as { email: string | null }[]).map((a) => a.email)
  );

  return NextResponse.json({
    // Die Auswahl trifft pickPreviewLeads: erst je ein Vertreter mit und ohne
    // Website-Befund, dann auffuellen. Die ersten beiden sind damit das
    // kontrastierende Paar, und der erste Klick auf "weiter" ist der Sprung
    // von der vollstaendigen Mail zu der mit dem Loch.
    leads: pickPreviewLeads(rows, limit).map(toPreviewLead),
    /** Wie viele es insgesamt waeren. Die Vorschau sagt damit "3 von 274",
     *  statt eine Stichprobe wie die ganze Liste aussehen zu lassen. */
    sendable: rows.length,
  });
}
