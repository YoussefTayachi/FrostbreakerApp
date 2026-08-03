import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { getDefaultLinkedInTemplate } from "@/lib/crm/linkedin-message";
import LinkedInList, { type LinkedInLead } from "./linkedin-list";

/**
 * Die LinkedIn-Arbeitsliste: alle Kontakte mit Profil-URL, mit fertig
 * eingesetzter Nachricht daneben.
 *
 * Warum es diese Seite gibt: contacts fuehrt die Spalte linkedin seit
 * Migration 0001, und alle drei Pipelines befuellen sie. Am 2026-08-03 lagen
 * dort 908 Profile -- praktisch gleich viele wie E-Mail-Adressen (920). 230
 * dieser Kontakte haben ueberhaupt keine E-Mail-Adresse und waren fuer die App
 * damit unerreichbar, obwohl ihre Recherche bezahlt ist. 214 davon haben sogar
 * schon einen fertigen Icebreaker in businesses.personalization.
 *
 * Gesendet wird bewusst NICHT von hier. LinkedIn bietet keine API fuer
 * Nachrichten oder Kontaktanfragen; jede Automatisierung laeuft ueber
 * Browser-Steuerung, verstoesst gegen die Nutzervereinbarung und riskiert die
 * Sperrung des Kontos. Diese Seite bereitet vor (Profillink, fertige
 * Nachricht, Kopierknopf) und nimmt das Ergebnis auf -- dasselbe Prinzip wie
 * die Anrufliste unter /calls, wo auch mit dem eigenen Telefon gewaehlt wird.
 */

// Obergrenze wie in /calls. Anders als dort wird hier zusaetzlich die echte
// Gesamtzahl geholt und angezeigt, wenn sie darueber liegt: eine stumm
// gekuerzte Liste sieht genauso aus wie eine vollstaendige, und der Nutzer
// haette keine Chance zu merken, dass Leads fehlen.
const LIST_LIMIT = 300;

export default async function LinkedInPage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;
  const workspaceId = ws.workspace.id;

  const [{ data: workspaceRow }, { data, count }, { data: contacted }] = await Promise.all([
    supabase.from("workspaces").select("linkedin_message_template").eq("id", workspaceId).single(),
    supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, full_name, title, email, linkedin, outreach_status, business_id, " +
          "businesses!inner(name, website, personalization, company_summary)",
        { count: "exact" }
      )
      .eq("workspace_id", workspaceId)
      .not("linkedin", "is", null)
      // Dasselbe Sicherheitsnetz wie beim Anlegen einer Kampagne
      // (api/instantly/campaigns): wer schon abgesagt hat, taucht nicht in
      // einer Akquise-Liste wieder auf -- egal ueber welchen Kanal.
      .neq("outreach_status", "not_interested")
      .limit(LIST_LIMIT),
    // Wen habe ich ueber LinkedIn schon angeschrieben? Nur die IDs, der Rest
    // der Aktivitaet interessiert hier nicht.
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
  const rows = (data ?? []) as unknown as LinkedInLead[];

  // Sortierung im Speicher, nicht in der Abfrage: PostgREST kann nicht nach
  // einer Spalte der eingebetteten Tabelle sortieren. Die Reihenfolge ist die
  // Arbeitsreihenfolge -- noch nicht angeschrieben und mit fertigem Icebreaker
  // zuerst, denn diese Zeilen kosten nur noch einen Klick.
  const leads = rows
    .map((r) => ({ ...r, alreadyContacted: contactedIds.has(r.id) }))
    .sort((a, b) => {
      if (a.alreadyContacted !== b.alreadyContacted) return a.alreadyContacted ? 1 : -1;
      const aReady = a.businesses?.personalization ? 0 : 1;
      const bReady = b.businesses?.personalization ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      // Ohne E-Mail-Adresse ist LinkedIn der einzige Weg -- diese Kontakte
      // sind hier am wertvollsten und stehen deshalb vor denen, die man auch
      // per Kampagne erreichen wuerde.
      const aOnly = a.email ? 1 : 0;
      const bOnly = b.email ? 1 : 0;
      return aOnly - bOnly;
    });

  return (
    <div className="fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.linkedin.title}</h1>
        <p className="text-sm text-faint">{t.linkedin.subtitle}</p>
      </div>
      <LinkedInList
        leads={leads}
        template={workspaceRow?.linkedin_message_template ?? getDefaultLinkedInTemplate(lang)}
        isCustomTemplate={Boolean(workspaceRow?.linkedin_message_template)}
        totalCount={count ?? leads.length}
        listLimit={LIST_LIMIT}
      />
    </div>
  );
}
