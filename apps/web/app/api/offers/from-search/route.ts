import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { callOpenAi } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import { OFFER_COLUMNS, type Offer } from "@/lib/offers";
import { searchFilterLines } from "@/lib/search-filter-lines";
import type { SearchRowForPreset } from "@/lib/search-presets";
import {
  SUMMARY_SAMPLE_SIZE,
  buildOfferFromSearchPrompt,
  parseOfferFromSearch,
  sampleSummaries,
} from "@/lib/copy/offer-from-search";
import { cleanProduct } from "@/lib/copy/offer-products";

/**
 * Aus einer Lead-Liste Vorschlaege fuer die nischen-spezifischen
 * Angebotsfelder machen.
 *
 * ZWEI TEILE, NUR EINER KOSTET
 *
 * Was der Absender verkauft, worauf er sich beruft und wie er klingt, steht
 * bereits im Angebot und wird hier NICHT neu erzeugt -- kein Website-Abruf,
 * kein zweiter Ton, kein neuer Beleg. Der Modellaufruf betrifft nur die
 * Felder, die von der Nische abhaengen (siehe lib/copy/offer-from-search.ts).
 *
 * DAS ANGEBOT KOMMT ALS ID MIT
 *
 * Und zwar das, das im Formular gerade offen steht -- nicht das
 * Standardangebot. Grund: outcome und mechanism werden fuer diese Zielgruppe
 * UMFORMULIERT, und eine Umformulierung des falschen Angebots waere keine
 * Umformulierung, sondern ein fremder Satz.
 *
 * Was zurueckkommt, wird NICHT gespeichert. Es landet als Vorschlag unter dem
 * jeweiligen Feld, und der Nutzer uebernimmt oder verwirft einzeln. Gleiche
 * Begruendung wie bei api/offers/from-website: ein falsch gelesenes Feld
 * vergiftet sonst unsichtbar jede Mail, die danach aus diesem Angebot
 * entsteht.
 *
 * Der Aufruf laeuft hier und nicht im Worker: ein einzelner, interaktiver
 * Handgriff mit sofortiger Antwort.
 */
export const maxDuration = 45;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const current = await getCurrentWorkspace(supabase);
  if (!current) return NextResponse.json({ error: "kein Workspace" }, { status: 400 });
  const workspaceId = current.workspace.id;

  const body = await req.json().catch(() => ({}));
  const searchId = (body?.searchId as string | undefined)?.trim();
  const offerId = (body?.offerId as string | undefined)?.trim();
  if (!searchId) return NextResponse.json({ error: "searchId fehlt" }, { status: 400 });
  if (!offerId) return NextResponse.json({ error: "offerId fehlt" }, { status: 400 });
  /**
   * Auf welche der verkauften Sachen diese Liste zielt -- optional.
   *
   * Gesetzt nur, wenn api/offers/detect-products mehrere gefunden HAT und der
   * Nutzer danach eine gewaehlt hat (auch von Hand eingetippt). Fehlt der
   * Wert, ist der Prompt Wort fuer Wort der von vorher. Der Wert wird
   * bewusst nicht gegen die Erkennung geprueft: das Freitextfeld in der
   * Oberflaeche existiert genau fuer den Fall, dass die Erkennung danebenlag.
   */
  const product = cleanProduct(body?.product);

  // Workspace-Filter zusaetzlich zur RLS: RLS regelt, auf welche Accounts
  // jemand zugreifen darf -- nicht, welcher der eigenen Workspaces gemeint ist
  // (siehe CLAUDE.md).
  const { data: search } = await supabase
    .from("searches")
    .select("id, name, query, location, source, filters, status, radius_m")
    .eq("id", searchId)
    .eq("workspace_id", workspaceId)
    .single();
  if (!search) return NextResponse.json({ error: "Suche nicht gefunden." }, { status: 404 });

  // Dieselbe Bedingung, mit der die Suchdetailseite "noch in Arbeit" anzeigt.
  // Eine laufende Suche hat ihre Firmenbeschreibungen noch nicht vollstaendig,
  // und ein Entwurf aus den ersten drei Treffern beschreibt die Nische nicht.
  if (search.status === "pending" || search.status === "running") {
    return NextResponse.json({ error: "Die Suche läuft noch." }, { status: 409 });
  }

  const { data: offerRow } = await supabase
    .from("offers")
    .select(OFFER_COLUMNS)
    .eq("id", offerId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!offerRow) {
    return NextResponse.json({ error: "Angebot nicht gefunden." }, { status: 404 });
  }
  const offer = offerRow as unknown as Offer;

  const openaiKey = await getApiKey(supabase, workspaceId, "openai");
  if (!openaiKey) {
    return NextResponse.json(
      { error: "Kein OpenAI-Schluessel hinterlegt. Unter Einstellungen eintragen." },
      { status: 400 }
    );
  }

  // count zaehlt ALLE Treffer, limit holt nur die Stichprobe -- so steht im
  // Prompt, wie gross die Liste wirklich ist, ohne sie ganz zu laden.
  const {
    data: businesses,
    count,
  } = await supabase
    .from("businesses")
    .select("name, company_summary", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("search_id", searchId)
    .not("company_summary", "is", null)
    .limit(SUMMARY_SAMPLE_SIZE);

  const summaries = sampleSummaries(businesses ?? []);
  if (summaries.length === 0) {
    // Ehrlich melden statt das Modell aus vier Filterzeilen eine Nische
    // erfinden zu lassen. Haeufigster Fall dahinter: die Recherche der
    // Firmenbeschreibungen lief fuer diese Liste nie (kein OpenAI-Schluessel
    // zum Zeitpunkt der Suche) oder die Quelle liefert keine.
    return NextResponse.json(
      { error: "Zu dieser Liste gibt es keine Firmenbeschreibungen." },
      { status: 422 }
    );
  }

  const prompt = buildOfferFromSearchPrompt(
    {
      name: search.name ?? search.query ?? "",
      query: search.query ?? "",
      location: search.location ?? "",
      source: search.source ?? null,
      filters: searchFilterLines(search as SearchRowForPreset),
      summaries,
      totalWithSummary: count ?? summaries.length,
    },
    offer,
    product
  );

  const result = await callOpenAi(openaiKey, [{ role: "user", content: prompt }]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  await recordOpenAiUsage(supabase, workspaceId, "offer_from_search", result.json);

  const suggestion = parseOfferFromSearch(result.text);
  if (Object.keys(suggestion).length === 0) {
    return NextResponse.json(
      { error: "Aus dieser Liste liess sich nichts ableiten. Bitte von Hand ausfüllen." },
      { status: 422 }
    );
  }
  return NextResponse.json({ suggestion });
}
