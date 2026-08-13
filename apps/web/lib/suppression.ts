type SuppressionRow = { email: string | null; domain: string | null };

/** Was gesperrt sein kann: eine Adresse und die Firmenseite dahinter. */
type Sperrbar = { email: string | null; businesses: { website: string | null } | null };

function domainOf(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.trim().toLowerCase();
  const raw = v.includes("@") ? v.split("@").pop()! : v.replace(/^https?:\/\//, "").split("/")[0];
  return raw.replace(/^www\./, "") || null;
}

/**
 * Steht dieser Kontakt auf der Blockliste?
 *
 * Eine einzige Stelle, weil die Antwort an zwei Orten verschieden gebraucht
 * wird: Kampagnen und Leads WERFEN Gesperrte raus, der Posteingang ZEIGT sie
 * mit dem Vermerk "abgemeldet". Zwei Kopien der Regel wuerden frueher oder
 * spaeter auseinanderlaufen -- und dann steht jemand in der Inbox ohne
 * Vermerk, den die Kampagne stillschweigend uebergeht.
 */
export function isSuppressed(kontakt: Sperrbar, suppression: SuppressionRow[]): boolean {
  if (suppression.length === 0) return false;
  const emails = new Set(suppression.filter((s) => s.email).map((s) => s.email!.toLowerCase()));
  const domains = new Set(suppression.filter((s) => s.domain).map((s) => s.domain!.toLowerCase()));
  return trifft(kontakt, emails, domains);
}

function trifft(kontakt: Sperrbar, emails: Set<string>, domains: Set<string>): boolean {
  const email = kontakt.email?.toLowerCase();
  if (email && emails.has(email)) return true;
  const emailDomain = domainOf(email);
  if (emailDomain && domains.has(emailDomain)) return true;
  const siteDomain = domainOf(kontakt.businesses?.website);
  if (siteDomain && domains.has(siteDomain)) return true;
  return false;
}

// Entfernt Kontakte, deren E-Mail oder Firmen-Domain auf der Blockliste steht
export function filterSuppressed<T extends Sperrbar>(
  contacts: T[],
  suppression: SuppressionRow[]
): T[] {
  if (suppression.length === 0) return contacts;
  const emails = new Set(suppression.filter((s) => s.email).map((s) => s.email!.toLowerCase()));
  const domains = new Set(suppression.filter((s) => s.domain).map((s) => s.domain!.toLowerCase()));
  return contacts.filter((c) => !trifft(c, emails, domains));
}
