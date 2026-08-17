/**
 * Gemeinsame Typen der LinkedIn-Ansicht.
 *
 * Eigene Datei, weil sie von der Server-Seite (page.tsx) und beiden
 * Client-Komponenten gebraucht werden — ein Import aus einer "use client"-
 * Datei in eine Server-Komponente waere zwar erlaubt, aber irrefuehrend.
 *
 * Der Lead ist hier bereits flachgeklopft: die verschachtelten Felder aus
 * businesses/searches sind in company_name, personalization und listId
 * aufgeloest. So braucht die Oberflaeche nichts ueber den Aufbau der Abfrage
 * zu wissen, und ein veraenderter Join zieht keine Aenderung durch die
 * Komponenten nach sich.
 */

export type LinkedInLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  email: string | null;
  linkedin: string;
  outreach_status: string;
  business_id: string | null;
  company_name: string | null;
  /** Icebreaker aus businesses.personalization — vom Worker erzeugt, hier nur eingesetzt. */
  personalization: string | null;
  /** ID der Suche, aus der dieser Kontakt stammt. */
  listId: string;
  alreadyContacted: boolean;
  /**
   * Faelligkeit der offenen Nachfass-Aufgabe ("nachschauen, ob geantwortet
   * wurde"), oder null. Entsteht beim Protokollieren einer gesendeten
   * Nachricht und schliesst sich, sobald eine Antwort oder ein "keine
   * Antwort" eingetragen wird.
   */
  followUpDueAt: string | null;
  /**
   * Ob diese Erinnerung jetzt faellig ist. Bewusst auf dem Server entschieden
   * und nicht im Browser aus followUpDueAt abgeleitet: ein "jetzt" im Client
   * weicht beim ersten Rendern vom "jetzt" des Servers ab, und da die
   * Faelligkeit die Sortierung und die Abzeichen steuert, waere das ein
   * Hydration-Unterschied im Markup.
   */
  followUpDue: boolean;
};

/** Eine Lead-Liste (= eine Suche) mit den Zahlen, die vor dem Hineinklicken zaehlen. */
export type LeadListSummary = {
  id: string;
  /** Der vom Nutzer vergebene Name, sonst die Suchanfrage selbst. */
  name: string;
  location: string | null;
  /** 'apollo' | 'maps' | 'corporate' — woher die Kontakte stammen. */
  source: string | null;
  note: string | null;
  total: number;
  withoutEmail: number;
  withIcebreaker: number;
  contacted: number;
  /** Faellige Nachfass-Aufgaben in dieser Liste — die eigentliche Arbeit von heute. */
  followUpsDue: number;
};
