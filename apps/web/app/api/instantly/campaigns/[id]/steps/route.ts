import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import { loadOwnedCampaign } from "@/lib/instantly/campaigns";
import { assessSteps, type VariantStats } from "@/lib/instantly/variant-winner";

/**
 * Wie sich die Varianten dieser Kampagne schlagen.
 *
 * Quelle ist Instantlys /campaigns/analytics/steps -- der einzige Ort, an dem
 * je Schritt UND je Variante gezaehlt wird. Aus unseren eigenen Daten liesse
 * sich das nicht rekonstruieren: welche Fassung ein Empfaenger bekommen hat,
 * entscheidet Instantly beim Versand und teilt es uns nirgends mit.
 *
 * Live abgefragt statt gespiegelt. Die Seite wird gelegentlich geoeffnet, die
 * Zahlen sind dann garantiert aktuell, und es braucht keine weitere Tabelle,
 * die selbst wieder veralten kann.
 *
 * Die Bewertung ("darf man daraus schon einen Gewinner ableiten") steht in
 * lib/instantly/variant-winner.ts und ist dort mit 16 Faellen abgesichert --
 * es ist die Stelle, an der man sich am leichtesten selbst betruegt.
 */

/** Instantlys Zeile je Schritt und Variante, auf das Gelesene reduziert. */
type StepAnalyticsRow = {
  step?: number | null;
  variant?: number | null;
  sent?: number | null;
  opened?: number | null;
  unique_replies?: number | null;
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const local = await loadOwnedCampaign(supabase, ctx.workspace.id, id);
  if (!local || !local.instantly_campaign_id) {
    return NextResponse.json({ error: "Kampagne nicht gefunden" }, { status: 404 });
  }

  let rows: StepAnalyticsRow[];
  try {
    rows = await instantlyRequest<StepAnalyticsRow[]>(
      ctx.apiKey,
      `/api/v2/campaigns/analytics/steps?campaign_id=${local.instantly_campaign_id}`
    );
  } catch (e) {
    const status = e instanceof InstantlyApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  // Laut Doku koennen step und variant null sein -- fuer Ereignisse ausserhalb
  // einer Kampagnensequenz. Die gehoeren nicht in einen Variantenvergleich.
  const stats: VariantStats[] = (Array.isArray(rows) ? rows : [])
    .filter((r) => r.step != null && r.variant != null)
    .map((r) => ({
      step: Number(r.step),
      variant: Number(r.variant),
      sent: r.sent ?? 0,
      opened: r.opened ?? 0,
      unique_replies: r.unique_replies ?? 0,
    }));

  return NextResponse.json({
    steps: assessSteps(stats),
    // Ob ueberhaupt gezaehlt wird, gehoert zur Aussagekraft der Zahlen
    // daneben: bei abgeschaltetem Zaehlpixel ist "0 Oeffnungen" keine
    // Beobachtung, sondern eine fehlende Messung.
    openTracking: local.open_tracking,
  });
}
