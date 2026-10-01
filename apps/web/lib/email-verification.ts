/**
 * Wann eine Adresse noch durch NeverBounce muss.
 *
 * GEMESSEN AM 2026-10-01, Workspace retaiyn (82aa389f): 2663 von 2886
 * Kontakten mit Adresse tragen email_verification_status 'verified', gesetzt
 * von Apollo, nicht von uns. /api/verify-emails nahm bis dahin nur Kontakte
 * OHNE Status, also wurde keine einzige Apollo-Adresse je von NeverBounce
 * geprueft. Apollos 'verified' ist eine Aussage aus Apollos Datenbank, keine
 * Live-Pruefung am Postfach, deshalb zaehlt es hier nicht als geprueft.
 *
 * Hunter-Status bleiben dagegen stehen: Hunter prueft live, ein zweiter
 * Durchlauf wuerde dieselbe Antwort doppelt bezahlen.
 */
export type VerifiableContact = {
  email: string | null;
  email_verification_status: string | null;
  email_verified_by?: string | null;
  sources: string[];
};

export function needsNeverBounce(c: VerifiableContact): boolean {
  if (!c.email) return false;
  if (c.email_verified_by === "neverbounce") return false;
  if (!c.email_verification_status) return true;
  return c.sources.includes("apollo");
}
