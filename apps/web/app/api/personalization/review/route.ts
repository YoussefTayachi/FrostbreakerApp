import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import {
  reviewIcebreakers,
  reviewSettingsFromWorkspace,
  sortVerdicts,
  summarizeReview,
  type IcebreakerRow,
  type IcebreakerState,
  type ReviewSettings,
} from "@/lib/personalization/review";
import { validateIcebreaker } from "@/lib/personalization-defaults";

/**
 * Die Pruefschleife fuer die KI-Aufhaenger.
 *
 * Warum es diese Route gibt: businesses.personalization_needs_review wird vom
 * Worker gesetzt, wenn ein erzeugter Aufhaenger die Vorgaben zweimal
 * verfehlt. Am 2026-08-04 trugen 766 von 1032 Zeilen diese Markierung -- und
 * sie kam in der gesamten Web-App an keiner Stelle vor. Drei Viertel aller
 * Aufhaenger waren als mangelhaft bekannt und sind trotzdem rausgegangen.
 *
 * Alle Bewertung passiert in lib/personalization/review.ts (mit Tests). Hier
 * steht nur, woher die Zeilen kommen und was die drei Handgriffe in der
 * Datenbank bedeuten.
 */

/**
 * Obergrenze einer Abfrage.
 *
 * Die Bewertung laeuft ueber alle geladenen Zeilen -- das ist reines Rechnen
 * ohne Netzaufrufe und bei tausend Zeilen nicht messbar. Die Grenze schuetzt
 * vor einer Antwort, die zu gross zum Anzeigen wird, nicht vor Rechenlast.
 */
const MAX_ROWS = 2000;

const SELECT = "id, name, personalization, personalization_needs_review";

async function context(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const current = await getCurrentWorkspace(supabase);
  if (!current) return { error: NextResponse.json({ error: "kein Workspace" }, { status: 400 }) };
  return { workspaceId: current.workspace.id };
}

/**
 * Die Vorgaben, gegen die geprueft wird -- dieselben, die auch der Worker beim
 * Erzeugen anlegt (workspaces.personalization_*).
 */
async function loadSettings(
  supabase: SupabaseClient,
  workspaceId: string,
  lang: "de" | "en"
): Promise<ReviewSettings> {
  const { data } = await supabase
    .from("workspaces")
    .select("personalization_max_words, personalization_banned_words")
    .eq("id", workspaceId)
    .single();
  return reviewSettingsFromWorkspace(data, lang);
}

/**
 * Wie viele der betroffenen Firmen stecken schon in einer Instantly-Kampagne?
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DIE EINZIGE STELLE, AN DER "NEU ERZEUGEN" NICHT DURCHSCHLAEGT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die LinkedIn-Liste und die Lead-Ansichten lesen businesses.personalization
 * bei jedem Aufruf frisch -- dort ist ein neuer Text sofort da. Instantly
 * dagegen bekommt beim Export eine KOPIE als lead-Variable. Wird der Text
 * danach neu erzeugt, aendert sich unsere Zeile, die Kopie bei Instantly
 * nicht: die Mail geht mit dem alten Aufhaenger raus.
 *
 * Das laesst sich hier nicht heilen (Instantlys API kennt kein Aktualisieren
 * einer bereits uebergebenen Lead-Variable, und ein Loeschen samt neu Anlegen
 * wuerde den Sendestatus verlieren). Also wird es wenigstens gesagt -- eine
 * stille Abweichung zwischen dem, was in der App steht, und dem, was beim
 * Empfaenger ankommt, ist der schlimmere Zustand.
 */
async function countExported(
  supabase: SupabaseClient,
  workspaceId: string,
  businessIds: string[]
): Promise<number> {
  if (businessIds.length === 0) return 0;
  // Ueber die Kontakte: campaign_leads haengt am Kontakt, nicht an der Firma.
  const { count } = await supabase
    .from("campaign_leads")
    .select("contact_id, contacts!inner(business_id)", { count: "exact", head: true })
    .in("contacts.business_id", businessIds);
  return count ?? 0;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const ctx = await context(supabase);
  if ("error" in ctx) return ctx.error;

  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "de";
  const settings = await loadSettings(supabase, ctx.workspaceId, lang);

  /**
   * Bewusst ALLE Firmen mit Aufhaenger, nicht nur die markierten.
   *
   * Ein Filter auf personalization_needs_review wuerde genau die Zeilen
   * verstecken, die nie markiert wurden und heute trotzdem gegen die Vorgaben
   * verstossen -- an echten Daten 31 Stueck. Siehe die ausfuehrliche
   * Begruendung in lib/personalization/review.ts.
   *
   * Suchen im Papierkorb bleiben draussen: an deren Texten will niemand mehr
   * arbeiten. Der !inner-Join ist dafuer notwendig -- ein loser Join wuerde
   * die Firmenzeile behalten und nur die eingebettete Suche auf null setzen.
   */
  const { data, error } = await supabase
    .from("businesses")
    .select(`${SELECT}, searches!inner(deleted_at)`)
    .eq("workspace_id", ctx.workspaceId)
    .is("searches.deleted_at", null)
    .not("personalization", "is", null)
    .limit(MAX_ROWS);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const verdicts = sortVerdicts(reviewIcebreakers((data ?? []) as unknown as IcebreakerRow[], settings));
  return NextResponse.json({
    settings: { maxWords: settings.maxWords, bannedWords: settings.bannedWords },
    summary: summarizeReview(verdicts),
    items: verdicts,
    truncated: (data?.length ?? 0) >= MAX_ROWS,
  });
}

/**
 * Einen selbst geschriebenen Text speichern.
 *
 * Die Markierung faellt genau dann, wenn der neue Text die Vorgaben besteht.
 * Sie blind zu loeschen, weil jemand etwas eingetippt hat, wuerde die
 * Pruefliste zu einer Liste machen, aus der man sich herausklickt, statt zu
 * einer, die man abarbeitet.
 */
export async function PATCH(req: Request) {
  const supabase = await createClient();
  const ctx = await context(supabase);
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const id = (body?.id as string | undefined)?.trim();
  const text = (body?.text as string | undefined)?.trim();
  const lang = body?.lang === "en" ? "en" : "de";
  if (!id || !text) return NextResponse.json({ error: "id und text noetig" }, { status: 400 });

  const settings = await loadSettings(supabase, ctx.workspaceId, lang);
  const problems = validateIcebreaker(text, settings.maxWords, settings.bannedWords, lang);

  const { error } = await supabase
    .from("businesses")
    .update({ personalization: text, personalization_needs_review: problems.length > 0 })
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, problems });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await context(supabase);
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => ({}));
  const action = body?.action as string | undefined;
  const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : [];
  const lang = body?.lang === "en" ? "en" : "de";

  if (action === "accept") {
    // Von Hand abgenommen: der Text bleibt, wie er ist. Das ist die Antwort
    // auf "die Regel passt hier nicht", und die darf ein Mensch geben.
    if (ids.length === 0) return NextResponse.json({ error: "ids noetig" }, { status: 400 });
    const { error } = await supabase
      .from("businesses")
      .update({ personalization_needs_review: false })
      .in("id", ids)
      .eq("workspace_id", ctx.workspaceId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, accepted: ids.length });
  }

  if (action === "acceptStale") {
    /**
     * Die veralteten Markierungen in einem Zug abraeumen.
     *
     * Der Sinn der ganzen Ansicht: nach der Bindestrich-Korrektur vom
     * 2026-08-02 tragen hunderte Zeilen eine Markierung, die keine Aussage
     * mehr hat. Die einzeln wegzuklicken waere Beschaeftigung, keine Arbeit.
     *
     * Welche Zeilen das sind, wird HIER neu berechnet und nicht vom Aufrufer
     * uebernommen: eine Liste von IDs aus dem Browser koennte veraltet sein
     * oder Zeilen enthalten, die inzwischen doch auffallen -- und die duerfen
     * nicht durch eine Sammelaktion durchrutschen.
     */
    const settings = await loadSettings(supabase, ctx.workspaceId, lang);
    const { data, error } = await supabase
      .from("businesses")
      .select(SELECT)
      .eq("workspace_id", ctx.workspaceId)
      .eq("personalization_needs_review", true)
      .not("personalization", "is", null)
      .limit(MAX_ROWS);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const stale = reviewIcebreakers((data ?? []) as IcebreakerRow[], settings)
      .filter((v) => v.state === "stale")
      .map((v) => v.id);
    if (stale.length === 0) return NextResponse.json({ ok: true, accepted: 0 });

    const { error: updateError } = await supabase
      .from("businesses")
      .update({ personalization_needs_review: false })
      .in("id", stale)
      .eq("workspace_id", ctx.workspaceId);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    return NextResponse.json({ ok: true, accepted: stale.length });
  }

  if (action === "regenerate") {
    /**
     * Neu erzeugen lassen: ein personalize-Job je Firma.
     *
     * Ueber die Funktion aus Migration 0070 statt per Insert -- public.jobs
     * hat bewusst nur eine Lese-Policy. Dort sitzen auch die beiden
     * Pruefungen, die hier nicht verlassen werden duerfen: nur eigene Firmen,
     * und kein zweiter Job, solange noch einer offen ist (jeder ist ein
     * bezahlter Modellaufruf).
     *
     * Derselbe Jobtyp, den auch die Suche einreiht -- der Worker holt sich
     * die aktuellen Vorgaben des Workspaces selbst. Eine geaenderte
     * Wortgrenze wirkt damit sofort, ohne dass hier etwas mitgegeben werden
     * muesste.
     */
    if (ids.length === 0) return NextResponse.json({ error: "ids noetig" }, { status: 400 });
    const { data: queued, error } = await supabase.rpc("requeue_personalization", {
      p_business_ids: ids,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      queued: queued ?? 0,
      // Die Oberflaeche braucht die IDs, um die Zeilen als "wird neu erzeugt"
      // zu markieren und auf das Ergebnis zu warten -- der Worker ist ein
      // paar Sekunden unterwegs, und ohne diese Rueckmeldung sieht ein
      // erfolgreicher Klick aus wie ein wirkungsloser.
      ids,
      alreadyExported: await countExported(supabase, ctx.workspaceId, ids),
    });
  }

  if (action === "regenerateAll") {
    /**
     * Alles neu erzeugen -- der Fall "die Vorgaben haben sich grundlegend
     * geaendert", etwa nach dem Umstellen der Sprache.
     *
     * Ohne diesen Weg muesste man 55 Kaestchen anhaken, und bei einem
     * groesseren Bestand waere es gar nicht mehr zu machen.
     *
     * Welche Zeilen betroffen sind, wird HIER berechnet und nicht vom
     * Aufrufer uebernommen -- dieselbe Begruendung wie bei acceptStale: eine
     * Liste aus dem Browser kann veraltet sein. Der optionale Zustandsfilter
     * spiegelt genau die Chips der Ansicht, damit "alle" bedeutet, was dort
     * gerade zu sehen ist.
     */
    const settings = await loadSettings(supabase, ctx.workspaceId, lang);
    const state = body?.state as IcebreakerState | undefined;

    const { data, error } = await supabase
      .from("businesses")
      .select(`${SELECT}, searches!inner(deleted_at)`)
      .eq("workspace_id", ctx.workspaceId)
      .is("searches.deleted_at", null)
      .not("personalization", "is", null)
      .limit(MAX_ROWS);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const verdicts = reviewIcebreakers((data ?? []) as unknown as IcebreakerRow[], settings);
    const targets = (state ? verdicts.filter((v) => v.state === state) : verdicts).map((v) => v.id);
    if (targets.length === 0) return NextResponse.json({ ok: true, queued: 0, alreadyExported: 0 });

    const { data: queued, error: rpcError } = await supabase.rpc("requeue_personalization", {
      p_business_ids: targets,
    });
    if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      queued: queued ?? 0,
      ids: targets,
      alreadyExported: await countExported(supabase, ctx.workspaceId, targets),
      truncated: (data?.length ?? 0) >= MAX_ROWS,
    });
  }

  return NextResponse.json({ error: "unbekannte Aktion" }, { status: 400 });
}
