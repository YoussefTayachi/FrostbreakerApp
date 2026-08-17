import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { runDeliverabilityCheck } from "@/lib/deliverability";
import { pickPrimaryContactPerBusiness, splitByEngagement, splitBySendability } from "@/lib/contacts";
import { filterSuppressed } from "@/lib/suppression";
import { assessCampaign, stepFacts, type DomainAuth, type ReadinessFacts } from "@/lib/campaign-readiness";
import { reviewIcebreaker, reviewSettingsFromWorkspace } from "@/lib/personalization/review";

/**
 * Die Fakten fuer den Torwart einsammeln.
 *
 * Die Bewertung selbst steht in lib/campaign-readiness.ts (mit Tests) — hier
 * geht es nur darum, WOHER die Zahlen kommen. Die Trennung ist bewusst: die
 * Schwellen sind eine Produktentscheidung, die man nachlesen und aendern will,
 * das Zusammensuchen aus fuenf Tabellen und dem DNS ist Mechanik.
 *
 * Laeuft beim Tippen im Kampagnenformular, deshalb POST (die Sequenz gehoert
 * mit in die Anfrage) und deshalb mit Blick auf die Kosten: die einzige
 * langsame Stelle ist die DNS-Abfrage, und die trifft nur die tatsaechlich
 * ausgewaehlten Absender-Domains.
 */
export const maxDuration = 30;

type Body = {
  searchIds?: string[];
  mailboxes?: string[];
  steps?: { subject?: string; body?: string }[];
};

/** Die Domain hinter einer Absenderadresse — SPF/DKIM/DMARC haengen an ihr, nicht am Postfach. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
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
  const mailboxes = (body.mailboxes ?? []).filter(Boolean);
  const steps = body.steps ?? [];

  const [{ data: workspace }, { data: suppression }, { data: stats }] = await Promise.all([
    supabase
      .from("workspaces")
      .select("personalization_max_words, personalization_banned_words")
      .eq("id", workspaceId)
      .single(),
    supabase.from("suppression_list").select("email, domain").eq("workspace_id", workspaceId),
    // Bounce-Quote ueber ALLE bisherigen Kampagnen, nicht je Kampagne: den Ruf
    // der Absender-Domain traegt der Workspace als Ganzes. Eine frische
    // Kampagne mit sauberer Liste heilt nicht, was die vorherige angerichtet hat.
    supabase
      .from("instantly_campaign_stats")
      .select("emails_sent_count, bounced_count")
      .eq("workspace_id", workspaceId),
  ]);

  const settings = reviewSettingsFromWorkspace(workspace, "de");

  /**
   * Dieselben Filter wie beim tatsaechlichen Anlegen (api/instantly/campaigns):
   * kein Interesse raus, gesperrte raus, ungueltige raus, eine Person je Firma.
   * Waere die Zahl hier anders, wuerde der Torwart eine Kampagne bewerten, die
   * so nie entsteht.
   */
  const { data: contactRows } = searchIds.length
    ? await supabase
        .from("contacts")
        .select(
          "id, email, title, business_id, is_primary, outreach_status, email_verification_status, " +
            "businesses!inner(search_id, website, personalization, personalization_needs_review, name, id)"
        )
        .eq("workspace_id", workspaceId)
        .in("businesses.search_id", searchIds)
        .not("email", "is", null)
        .limit(5000)
    : { data: [] };

  type Row = {
    email: string | null;
    title: string | null;
    business_id: string | null;
    is_primary: boolean;
    outreach_status: string;
    email_verification_status: string | null;
    businesses: {
      id: string;
      name: string | null;
      website: string | null;
      personalization: string | null;
      personalization_needs_review: boolean | null;
    } | null;
  };

  const rows = (contactRows ?? []) as unknown as Row[];
  // Dieselbe Regel wie beim tatsaechlichen Anlegen (lib/contacts.ts) — eine
  // Vorschau, die mehr zaehlt als spaeter rausgeht, ist keine Vorschau.
  const { contactable: notDeclined } = splitByEngagement(rows);
  const { sendable } = splitBySendability(filterSuppressed(notDeclined, suppression ?? []));
  const finalLeads = pickPrimaryContactPerBusiness(sendable) as unknown as Row[];

  // "Unverifiziert" meint ausdruecklich: nie geprueft. Als ungueltig erkannte
  // Adressen sind oben schon rausgefallen — die zaehlen hier nicht nochmal.
  const unverifiedLeads = finalLeads.filter((c) => !c.email_verification_status).length;

  let leadsWithoutIcebreaker = 0;
  let leadsWithFailingIcebreaker = 0;
  for (const lead of finalLeads) {
    const biz = lead.businesses;
    const text = (biz?.personalization ?? "").trim();
    if (!text) {
      leadsWithoutIcebreaker++;
      continue;
    }
    // Gegen die HEUTIGEN Vorgaben, nicht gegen die gespeicherte Markierung --
    // siehe lib/personalization/review.ts.
    const verdict = reviewIcebreaker(
      {
        id: biz!.id,
        name: biz!.name,
        personalization: text,
        personalization_needs_review: biz!.personalization_needs_review,
      },
      settings
    );
    if (verdict.state === "failing") leadsWithFailingIcebreaker++;
  }

  /**
   * DNS je Domain, nicht je Postfach.
   *
   * 19 Postfaecher liegen in der Praxis auf zwei, drei Domains — ohne diese
   * Zusammenfassung waeren es 19 mal dieselbe Abfrage. Faellt eine Abfrage aus
   * (Zeitueberschreitung, kein Netz), gilt der Eintrag als vorhanden statt als
   * fehlend: einen Blocker aufgrund eines eigenen Fehlers zu setzen waere die
   * schlimmere Fehlentscheidung.
   */
  const domains = [...new Set(mailboxes.map(domainOf).filter((d): d is string => Boolean(d)))];
  const domainAuth: DomainAuth[] = await Promise.all(
    domains.map(async (domain) => {
      try {
        const report = await runDeliverabilityCheck(domain);
        return {
          domain,
          spf: report.spf.status !== "missing",
          dkim: report.dkim.status !== "missing",
          dmarc: report.dmarc.status !== "missing",
        };
      } catch {
        return { domain, spf: true, dkim: true, dmarc: true };
      }
    })
  );

  const facts: ReadinessFacts = {
    sendableLeads: finalLeads.length,
    unverifiedLeads,
    leadsWithoutIcebreaker,
    leadsWithFailingIcebreaker,
    domains: domainAuth,
    sentSoFar: (stats ?? []).reduce((sum, s) => sum + (s.emails_sent_count ?? 0), 0),
    bouncedSoFar: (stats ?? []).reduce((sum, s) => sum + (s.bounced_count ?? 0), 0),
    steps: steps.map((s) => stepFacts(s.body ?? "", settings.maxWords)),
  };

  return NextResponse.json({ ...assessCampaign(facts), facts });
}
