/**
 * Der IMAP-Server zu einer Adresse, soweit er sich raten laesst.
 *
 * EIGENE DATEI, NICHT ZU lib/imap.ts: das Formular (sent-sync-panel.tsx,
 * eine Client-Komponente) braucht genau diese Funktion als Vorbelegung.
 * lib/imap.ts importiert Nodes "tls", und ein Client-Import von dort liess
 * am 2026-09-12 jeden Vercel-Build scheitern ("Module not found: Can't
 * resolve 'tls'"); zwei Deployments hintereinander standen auf ERROR,
 * waehrend Produktion auf dem Stand davor haengen blieb. Reine
 * String-Logik hierher, alles mit Sockets bleibt drueben.
 *
 * Nur als VORBELEGUNG im Formular gedacht, nicht als Automatik: geraten wird
 * hier aus der Domain, und wer ein eigenes Postfach betreibt, traegt den
 * Server ohnehin selbst ein. Die Liste enthaelt die Anbieter, die in diesem
 * Konto tatsaechlich vorkommen.
 */
export function guessImapHost(email: string): string {
  const domain = (email.split("@")[1] ?? "").toLowerCase();
  if (domain.endsWith("gmail.com") || domain.endsWith("googlemail.com")) return "imap.gmail.com";
  if (/(^|\.)(outlook|hotmail|live)\./.test("." + domain) || domain === "outlook.com")
    return "outlook.office365.com";
  if (domain.endsWith("ionos.de") || domain.endsWith("1und1.de")) return "imap.ionos.de";
  if (domain.endsWith("ionos.com") || domain.endsWith("ionos.co.uk")) return "imap.ionos.co.uk";
  // Eigene Domain bei IONOS ist der haeufigste Fall hier: die Postfaecher
  // dieses Workspace laufen auf marketing.frostbreaker.app, gehostet bei
  // IONOS. Raten heisst raten, das Feld bleibt aenderbar.
  return "imap.ionos.de";
}
