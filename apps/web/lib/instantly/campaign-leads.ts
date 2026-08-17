/**
 * Einordnung der Leads einer Kampagne.
 *
 * Reine Logik, damit die Zuordnung "wer gilt als kontaktiert" pruefbar ist:
 * sie ist der Kern dieser Ansicht und beruht auf einer Entscheidung, die man
 * falsch treffen kann.
 *
 * DIE ENTSCHEIDUNG: "kontaktiert" wird an timestamp_last_contact festgemacht
 * und NICHT an Instantlys Zahlencode status. Der steht auch waehrend einer
 * laufenden Sequenz auf 1 und sagt damit nichts darueber, ob schon eine Mail
 * rausging. Der Zeitstempel wird gesetzt, sobald die erste tatsaechlich
 * versendet wurde.
 *
 * Und ausdruecklich nicht aus unseren eigenen Daten: contacts.outreach_status
 * haengt daran, dass der Inbox-Sync die ausgehende Mail gesehen hat. Gemessen
 * am 2026-08-04 meldete Instantly fuer eine Kampagne 45 kontaktierte Leads,
 * unsere Daten kannten 10.
 */

export type CampaignLead = {
  id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  /** Zeitpunkt der ersten Zustellung. Null = noch nicht angeschrieben. */
  contacted_at: string | null;
  opens: number;
  clicks: number;
  replies: number;
  bounced: boolean;
  unsubscribed: boolean;
};

export const LEAD_FILTERS = ["all", "contacted", "pending", "replied", "problem"] as const;
export type LeadFilter = (typeof LEAD_FILTERS)[number];

export function isContacted(lead: CampaignLead): boolean {
  return Boolean(lead.contacted_at);
}

/**
 * Bounces und Abmeldungen in einem Topf.
 *
 * Fuer die Arbeit mit der Liste sind sie derselbe Fall: an diese Adresse geht
 * nichts mehr raus, und man sollte hinschauen. Getrennt aufzufuehren waere
 * eine Unterscheidung ohne Konsequenz; welcher der beiden es war, steht in
 * der Zeile selbst.
 */
export function hasProblem(lead: CampaignLead): boolean {
  return lead.bounced || lead.unsubscribed;
}

export function matchesFilter(lead: CampaignLead, filter: LeadFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "contacted":
      return isContacted(lead);
    case "pending":
      // Ein Bounce ist nicht "ausstehend": dort wird nichts mehr passieren.
      return !isContacted(lead) && !hasProblem(lead);
    case "replied":
      return lead.replies > 0;
    case "problem":
      return hasProblem(lead);
  }
}

export type LeadCounts = Record<LeadFilter, number>;

/** Zahlen fuer die Filterleiste; eine Schaltflaeche, die auf 0 fuehrt, ist eine Sackgasse. */
export function countLeads(leads: CampaignLead[]): LeadCounts {
  return {
    all: leads.length,
    contacted: leads.filter(isContacted).length,
    pending: leads.filter((l) => matchesFilter(l, "pending")).length,
    replied: leads.filter((l) => l.replies > 0).length,
    problem: leads.filter(hasProblem).length,
  };
}

/**
 * Arbeitsreihenfolge: was Aufmerksamkeit braucht, steht oben.
 *
 * Antworten zuerst: sie sind der Grund, warum die Kampagne laeuft. Dann
 * Probleme, weil sie die Zustellbarkeit betreffen. Danach die noch
 * Ausstehenden, und ganz unten die bereits Kontaktierten, bei denen gerade
 * nichts zu tun ist.
 */
export function sortLeads(leads: CampaignLead[]): CampaignLead[] {
  const rank = (l: CampaignLead) =>
    l.replies > 0 ? 0 : hasProblem(l) ? 1 : !isContacted(l) ? 2 : 3;
  return [...leads].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    // Innerhalb derselben Gruppe die zuletzt angefassten zuerst.
    return (b.contacted_at ?? "").localeCompare(a.contacted_at ?? "");
  });
}
