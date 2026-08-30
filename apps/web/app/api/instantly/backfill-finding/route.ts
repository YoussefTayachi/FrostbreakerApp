import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import { WEBSITE_FINDING_FIELD } from "@/lib/instantly/campaigns";

/**
 * Den Website-Befund bei bereits hochgeladenen Instantly-Leads nachtragen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ES DIESE ROUTE GIBT UND NICHT NUR EINMAL GEBRAUCHT WIRD
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Anlass war ein Fehler: bis zum 2026-08-27 legte buildInstantlyLead den
 * Befund als Feld auf oberster Ebene ab, wo Instantlys Schema ihn verwirft
 * (additionalProperties: false). 858 Leads lagen damit ohne Variable dort,
 * und in Mail 1 blieb {{websiteFinding}} leer.
 *
 * Der Fehler ist behoben, aber der Bedarf bleibt, und zwar aus einem
 * strukturellen Grund: Veroeffentlichen und Befundpruefung laufen
 * NEBENEINANDER. check_website und write_website_finding stehen als Jobs in
 * derselben Queue wie alles andere, und wer eine Kampagne anlegt, bevor sie
 * durch sind, laedt Leads ohne Befund hoch oder bekommt sie gar nicht erst
 * (splitByWebsiteFinding haelt sie zurueck). Genau das ist am 2026-08-27
 * passiert: um 10:16 veroeffentlicht, die Befunde kamen bis 17:00.
 *
 * Diese Route holt das nach, bei JEDEM Lead ohne gesetzte Variable. Warum
 * ohne Ruecksicht darauf, ob er schon eine Mail bekommen hat, steht weiter
 * unten an befundJeMail.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM PATCH UND NICHT NEU HOCHLADEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Weil Neuhochladen nichts tut. /api/v2/leads/add zaehlt eine bereits
 * vorhandene Adresse als duplicated_lead und ueberspringt sie; ein
 * Aktualisieren gibt es dort nicht (developer.instantly.ai, geprueft
 * 2026-08-27). Der einzige Weg an einen bestehenden Lead ist
 * PATCH /api/v2/leads/{id}.
 *
 * Beim LESEN heissen die eigenen Variablen uebrigens `payload`, beim
 * SCHREIBEN `custom_variables`. Das ist nicht schoen, steht aber so in ihrer
 * API, und wer es verwechselt, schreibt ins Leere.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Instantlys Seitengroesse fuer /leads/list. Mehr nimmt die API nicht. */
const PAGE = 100;

type InstantlyLead = {
  id: string;
  email: string | null;
  payload?: Record<string, unknown> | null;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run !== false; // Vorsicht als Voreinstellung.

  // Die Kampagnen dieses Workspaces, die tatsaechlich bei Instantly liegen.
  const { data: kampagnen, error: kFehler } = await supabase
    .from("campaigns")
    .select("id, name, instantly_campaign_id")
    .eq("workspace_id", ctx.workspace.id)
    .not("instantly_campaign_id", "is", null);
  if (kFehler) {
    return NextResponse.json({ error: kFehler.message }, { status: 500 });
  }

  /**
   * Jede Adresse, zu der wir einen Befund haben.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * OHNE STATUSBEDINGUNG, UND DAS WAR EINE KORREKTUR
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Der erste Wurf dieser Route nahm nur Kontakte mit outreach_status 'new',
   * mit der Begruendung: wer schon kontaktiert wurde, hat Mail 1 mit der
   * leeren Stelle ohnehin bekommen. Zwei Dinge waren daran falsch.
   *
   * Erstens ist contacts.outreach_status nicht dasselbe wie Instantlys Sicht.
   * Gemessen am 2026-08-28: Instantly meldete 590 kontaktierte Leads von 858,
   * unsere Daten kannten 546. Der Lauf mit Statusbedingung trug deshalb nur
   * 44 von 268 offenen Leads nach; 224 blieben ohne Variable zurueck, obwohl
   * sie ihre erste Mail noch vor sich haben. Dieselbe Untertreibung steht als
   * gemessene Beobachtung schon in campaigns/[id]/leads/route.ts.
   *
   * Zweitens gilt "aendert nichts mehr" nur, solange die Variable allein in
   * Mail 1 steht. Sobald eine Folgemail sie benutzt, braucht auch ein laengst
   * kontaktierter Lead seinen Befund.
   *
   * Beides zusammen heisst: die Zuordnung Adresse -> Befund wird vollstaendig
   * aufgebaut, und was tatsaechlich noch offen ist, entscheidet Instantly.
   */
  const { data: kontakte, error: cFehler } = await supabase
    .from("contacts")
    .select("email, businesses!inner(website_finding)")
    .eq("workspace_id", ctx.workspace.id)
    .not("email", "is", null);
  if (cFehler) {
    return NextResponse.json({ error: cFehler.message }, { status: 500 });
  }

  const befundJeMail = new Map<string, string>();
  for (const k of (kontakte ?? []) as unknown as {
    email: string;
    businesses: { website_finding: string | null } | null;
  }[]) {
    const befund = (k.businesses?.website_finding ?? "").trim();
    if (befund) befundJeMail.set(k.email.toLowerCase(), befund);
  }

  const bericht: Record<string, unknown>[] = [];
  let geprueft = 0;
  let nachgetragen = 0;
  let fehler = 0;

  for (const kampagne of kampagnen ?? []) {
    const instantlyId = kampagne.instantly_campaign_id as string;
    let cursor: string | null = null;
    let inDieserKampagne = 0;
    let uebersprungen = 0;

    // Seitenweise, bis Instantly keinen Cursor mehr liefert.
    for (;;) {
      let seite: { items?: InstantlyLead[]; next_starting_after?: string | null };
      try {
        seite = await instantlyRequest(ctx.apiKey, "/api/v2/leads/list", {
          method: "POST",
          body: JSON.stringify({
            campaign: instantlyId,
            limit: PAGE,
            ...(cursor ? { starting_after: cursor } : {}),
          }),
        });
      } catch (e) {
        const status = e instanceof InstantlyApiError ? e.status : 500;
        return NextResponse.json(
          { error: `Leads von Instantly nicht lesbar (${status}): ${(e as Error).message}` },
          { status: 502 }
        );
      }

      const items = seite.items ?? [];
      for (const lead of items) {
        geprueft += 1;
        const mail = (lead.email ?? "").toLowerCase();
        const befund = befundJeMail.get(mail);
        if (!befund) {
          uebersprungen += 1;
          continue;
        }
        // Schon gesetzt? Dann nichts tun. Ein zweiter Durchlauf dieser Route
        // soll folgenlos sein.
        const vorhanden = String(lead.payload?.[WEBSITE_FINDING_FIELD] ?? "").trim();
        if (vorhanden) {
          uebersprungen += 1;
          continue;
        }

        if (dryRun) {
          inDieserKampagne += 1;
          continue;
        }

        try {
          await instantlyRequest(ctx.apiKey, `/api/v2/leads/${lead.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              custom_variables: { ...(lead.payload ?? {}), [WEBSITE_FINDING_FIELD]: befund },
            }),
          });
          inDieserKampagne += 1;
          nachgetragen += 1;
        } catch (e) {
          // Einzelne Fehlschlaege duerfen den Lauf nicht abbrechen: der
          // naechste Lead ist davon unberuehrt, und ein Abbruch nach der
          // Haelfte waere der schlechteste aller Zustaende.
          fehler += 1;
          console.error(`[backfill-finding] ${lead.email}:`, (e as Error).message);
        }
      }

      cursor = seite.next_starting_after ?? null;
      if (!cursor || items.length === 0) break;
    }

    bericht.push({
      kampagne: kampagne.name,
      nachzutragen: inDieserKampagne,
      uebersprungen,
    });
  }

  return NextResponse.json({
    dry_run: dryRun,
    geprueft,
    nachgetragen: dryRun ? 0 : nachgetragen,
    fehler,
    kampagnen: bericht,
    hinweis: dryRun
      ? "Probelauf. Nichts geaendert. Mit {\"dry_run\": false} wirklich ausfuehren."
      : "Nachgetragen. Angefasst wurde jeder Lead ohne gesetzte Variable, unabhaengig davon, ob er schon eine Mail bekommen hat.",
  });
}
