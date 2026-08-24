/**
 * Wenn "nochmal erzeugen" an einer fehlenden Datenbankfunktion scheitert.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ES DAS BRAUCHT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die beiden Handgriffe zum Neuerzeugen laufen ueber RPC-Funktionen, die aus
 * Migrationen stammen (requeue_personalization: 0070/0084,
 * requeue_website_finding: 0104). Eine Migration, die im Repo liegt, ist
 * damit noch nicht angewendet. Vercel deployt bei jedem Push, Supabase nicht.
 * Zwischen "der Code ist live" und "die Funktion existiert" liegt also ein
 * Fenster, und in diesem Fenster meldet PostgREST:
 *
 *   Could not find the function public.requeue_website_finding(p_business_ids)
 *   in the schema cache
 *
 * Diese Meldung unveraendert in die Oberflaeche zu reichen, hiesse, jemanden
 * mit einem englischen Schema-Cache-Hinweis stehen zu lassen und ihn den
 * Fehler bei seinem Klick suchen zu lassen. Er hat aber nichts falsch
 * gemacht, und mit erneutem Klicken wird es nicht besser.
 *
 * Der Fehlercode ist PGRST202 (PostgREST, "function not found"). HIER NICHT
 * NACHGEMESSEN, weil die Funktion aus 0104 in dieser Datenbank noch nicht
 * angelegt ist: deshalb erkennt isMissingFunction den Fall zusaetzlich am
 * Text der Meldung, statt sich allein auf den Code zu verlassen. Sobald die
 * Migration angewendet ist, tritt der Fall nicht mehr auf und diese Datei
 * bleibt einfach still -- sie braucht dann keine Aenderung.
 */

/** Woher die Funktion kommt, fuer die Auskunft an den Betreiber. */
export const REQUEUE_MIGRATIONS: Record<string, string> = {
  requeue_personalization: "supabase/migrations/0084_requeue_personalization_force.sql",
  requeue_website_finding: "supabase/migrations/0104_requeue_website_finding.sql",
};

export type PostgrestLikeError = { code?: string | null; message?: string | null };

export function isMissingFunction(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return true;
  return /could not find the function/i.test(error.message ?? "");
}

/**
 * Die Meldung, die ein Mensch lesen soll.
 *
 * Sie nennt die Migration beim Namen: der einzige Handgriff, der hilft, ist
 * sie anzuwenden, und wer diese Meldung sieht, ist auch die Person, die das
 * tun kann.
 */
export function missingFunctionMessage(fn: string): string {
  const migration = REQUEUE_MIGRATIONS[fn];
  return (
    `Die Datenbankfunktion ${fn} gibt es in dieser Datenbank noch nicht, deshalb ` +
    "lässt sich der Text gerade nicht neu erzeugen. " +
    (migration
      ? `Die Migration ${migration} ist noch nicht angewendet.`
      : "Die zugehörige Migration ist noch nicht angewendet.")
  );
}

/** Was die Route zurueckgeben soll: Meldung plus HTTP-Status. */
export type RequeueFailure = { error: string; reason: "missing_migration" | "rpc_failed"; status: number };

export function requeueFailure(fn: string, error: PostgrestLikeError): RequeueFailure {
  if (isMissingFunction(error)) {
    // 503 und nicht 500: der Aufruf war richtig, es fehlt ein Stueck
    // Einrichtung. Der Unterschied entscheidet, ob es sich lohnt, es spaeter
    // nochmal zu versuchen.
    return { error: missingFunctionMessage(fn), reason: "missing_migration", status: 503 };
  }
  return { error: error.message ?? "Unbekannter Datenbankfehler", reason: "rpc_failed", status: 500 };
}
