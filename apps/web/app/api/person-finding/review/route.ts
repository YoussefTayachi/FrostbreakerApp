import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { parseBannedWords } from "@/lib/personalization/review";
import {
  personReviewPatch,
  validatePersonFindingText,
  type PersonFindingSource,
  type PersonReviewAction,
  type PersonReviewRow,
} from "@/lib/person-finding/review";

/**
 * Die Kontakt-Prueflliste fuer den Personen-Befund (Migrationen 0118, 0119).
 *
 * GET liefert die Kontakte des Workspaces, deren Absatz ein Mensch sehen
 * soll, bevor er rausgeht. PATCH fuehrt einen der drei Handgriffe aus. Die
 * Logik dahinter steht in lib/person-finding/review.ts und ist dort getestet;
 * diese Route holt Daten und schreibt sie.
 *
 * Workspace-Scoping ausdruecklich ueber eq("workspace_id"): RLS regelt nur,
 * auf welche Accounts jemand zugreifen darf, nicht, welcher seiner
 * Workspaces gemeint ist (siehe CLAUDE.md).
 */
const MAX_ROWS = 500;

const SELECT =
  "id, full_name, title, email, person_finding, person_finding_needs_review, person_finding_source, " +
  "businesses!inner(name, searches!inner(deleted_at))";

type RawRow = PersonReviewRow & {
  businesses: { name: string | null; searches: { deleted_at: string | null } | { deleted_at: string | null }[] | null } | null;
};

function inPapierkorb(row: RawRow): boolean {
  const s = row.businesses?.searches;
  const rel = Array.isArray(s) ? s[0] : s;
  return !!rel?.deleted_at;
}

export async function GET() {
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "kein Workspace" }, { status: 401 });

  const { data, error } = await supabase
    .from("contacts")
    .select(SELECT)
    .eq("workspace_id", ws.workspace.id)
    .eq("person_finding_needs_review", true)
    .not("person_finding", "is", null)
    // Im SQL und nicht erst danach: sonst koennte das Limit von 500 mit
    // Papierkorb-Zeilen vollaufen und aktive Zeilen dahinter verstecken
    // (Codex-Review nach dem Bau).
    .is("businesses.searches.deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((data ?? []) as unknown as RawRow[]).filter((r) => !inPapierkorb(r));
  const items: PersonReviewRow[] = rows.map((r) => ({
    id: r.id,
    full_name: r.full_name,
    title: r.title,
    email: r.email,
    person_finding: r.person_finding,
    person_finding_needs_review: r.person_finding_needs_review,
    person_finding_source: r.person_finding_source,
    businesses: r.businesses ? { name: r.businesses.name } : null,
  }));
  return NextResponse.json({ items, truncated: (data ?? []).length >= MAX_ROWS });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "kein Workspace" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = (body?.id as string | undefined)?.trim();
  const action = body?.action as PersonReviewAction | undefined;
  const text = (body?.text as string | undefined)?.trim();
  const lang: "de" | "en" = body?.lang === "en" ? "en" : "de";
  if (!id || !action || !["approve", "discard", "save"].includes(action)) {
    return NextResponse.json({ error: "id und action noetig" }, { status: 400 });
  }
  if (action === "save" && !text) {
    return NextResponse.json({ error: "text noetig" }, { status: 400 });
  }

  // Provenienz und Verbotsliste, beides nur fuer discard und save gebraucht.
  const [{ data: contact }, { data: wsRow }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, person_finding_source")
      .eq("id", id)
      .eq("workspace_id", ws.workspace.id)
      // Nur, was wirklich in der Pruefung steht: sonst koennte ein
      // gebastelter Aufruf einen freigegebenen Absatz verwerfen oder einen
      // beliebigen Kontakt beschreiben (Codex-Review nach dem Bau).
      .eq("person_finding_needs_review", true)
      .not("person_finding", "is", null)
      .maybeSingle(),
    supabase
      .from("workspaces")
      .select("personalization_banned_words")
      .eq("id", ws.workspace.id)
      .maybeSingle(),
  ]);
  if (!contact) return NextResponse.json({ error: "Kontakt nicht gefunden" }, { status: 404 });

  const banned = parseBannedWords(wsRow?.personalization_banned_words ?? null);
  const problems = action === "save" ? validatePersonFindingText(text ?? "", banned, lang) : [];
  const patch = personReviewPatch(
    action,
    (contact.person_finding_source as PersonFindingSource | null) ?? null,
    text,
    problems
  );

  const { data: updated, error } = await supabase
    .from("contacts")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", ws.workspace.id)
    .eq("person_finding_needs_review", true)
    .not("person_finding", "is", null)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Keine Zeile getroffen: jemand anderes war schneller (freigegeben oder
  // verworfen). Das ist kein Fehler des Aufrufers, aber auch kein Erfolg.
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "schon bearbeitet" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, problems });
}
