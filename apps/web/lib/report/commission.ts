/**
 * Was eine eigene Kampagne eingebracht hat, wenn das Instantly-Konto jemand
 * anderem gehoert.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WOFUER
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Wer Kaltakquise fuer eine fremde Firma macht und nach Ergebnis bezahlt
 * wird, muss zwei Dinge belegen koennen: dass eine Antwort zu SEINER
 * Kampagne gehoert, und wie viele es waren. Das erste beantwortet Migration
 * 0117 (commission_campaigns), das zweite diese Datei.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM AUS DEN EIGENEN ZEILEN UND NICHT AUS INSTANTLYS ZAHLEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Dieselbe Begruendung wie in app/wirkung: Instantlys Oberflaeche zeigte am
 * 2026-09-12 "Reply rate 0%" ueber einer Tabelle mit vier Antworten. Eine
 * Zahl, die sich selbst widerspricht, taugt nicht als Abrechnungsgrundlage.
 * Gezaehlt wird deshalb, was im eigenen messages steht und nachlesbar ist.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WAS HIER BEWUSST GETRENNT WIRD
 * ═══════════════════════════════════════════════════════════════════════
 *
 * "Antwort" und "Antwort eines Menschen" sind nicht dasselbe, und der
 * Unterschied ist bei Kaltakquise gross genug, um eine Abrechnung zu
 * entscheiden. Am 2026-09-22 an einem echten Konto gemessen: 151 Leads
 * hatten geantwortet, aber 138 dieser Antworten waren Abwesenheitsnotizen
 * oder Formeln von Leuten, die die Firma verlassen haben. Uebrig blieben 13
 * Menschen.
 *
 * Eine Provision auf die 151 waere fuer den Auftraggeber unbezahlbar, eine
 * auf die 13 fuer den Auftragnehmer unfair, solange beide Zahlen nicht
 * nebeneinander stehen. Also stehen sie nebeneinander, und was davon zaehlt,
 * verhandeln zwei Menschen und nicht diese Datei.
 */

/** Eine Zeile aus messages, auf das reduziert, was gezaehlt wird. */
export type CommissionRow = {
  direction: string;
  from_email: string | null;
  instantly_campaign_id: string | null;
  ai_interest: string | null;
  sent_at: string | null;
  created_at: string;
};

export type CommissionTotals = {
  /** Verschiedene Adressen, an die etwas hinausgegangen ist. */
  contacted: number;
  /** Verschiedene Adressen, von denen irgendetwas zurueckkam. */
  replied: number;
  /**
   * Verschiedene Adressen, deren Antwort ein Mensch geschrieben hat.
   *
   * Alles ausser 'out_of_office'. Nachrichten ohne Etikett zaehlen mit: ein
   * fehlendes Etikett heisst "noch nicht eingestuft", nicht "Maschine", und
   * im Zweifel gegen den Abrechnenden zu zaehlen waere die falsche Richtung.
   */
  human: number;
  /** Davon: eingestuft als interessiert oder Rueckfrage. */
  positive: number;
};

export type CommissionCampaign = {
  instantlyCampaignId: string;
  label: string;
  totals: CommissionTotals;
};

/** Eine einzelne belegbare Antwort, fuer die Liste unter den Zahlen. */
export type CommissionReply = {
  email: string;
  campaignLabel: string;
  interest: string | null;
  at: string;
};

const MACHINE = "out_of_office";
const POSITIVE = new Set(["interested", "question"]);

function when(row: CommissionRow): string {
  return row.sent_at ?? row.created_at;
}

/**
 * Nach Monat gruppieren, im ISO-Format YYYY-MM.
 *
 * Nach Monat, weil danach abgerechnet wird. Ausdruecklich in UTC und nicht in
 * der Zeitzone des Browsers: sonst faellt dieselbe Antwort je nach Standort
 * des Betrachters in einen anderen Monat, und zwei Leute, die dieselbe Seite
 * ansehen, bekommen verschiedene Rechnungen.
 */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Die Zahlen je Kampagne, fuer einen Monat oder fuer alles.
 *
 * `month` null heisst: alles. Gezaehlt werden ADRESSEN und nicht Mails. Wer
 * dreimal geantwortet hat, ist eine Antwort, und wer vier Stufen bekommen
 * hat, ist ein angeschriebener Kontakt. Alles andere waere eine Zahl, die
 * mit der Laenge der Sequenz waechst statt mit dem Ergebnis.
 */
export function byCampaign(
  rows: CommissionRow[],
  marked: Map<string, string>,
  month: string | null
): CommissionCampaign[] {
  const acc = new Map<
    string,
    { contacted: Set<string>; replied: Set<string>; human: Set<string>; positive: Set<string> }
  >();

  for (const row of rows) {
    const id = row.instantly_campaign_id;
    if (!id || !marked.has(id)) continue;
    if (month && monthOf(when(row)) !== month) continue;
    const email = (row.from_email ?? "").trim().toLowerCase();
    if (!email) continue;

    let bucket = acc.get(id);
    if (!bucket) {
      bucket = { contacted: new Set(), replied: new Set(), human: new Set(), positive: new Set() };
      acc.set(id, bucket);
    }

    // from_email traegt in BEIDE Richtungen die Adresse des Leads, nicht die
    // des Postfachs (siehe processEmail im Sync-Cron). Deshalb zaehlt
    // dieselbe Spalte hier einmal als "angeschrieben" und einmal als
    // "hat geantwortet".
    if (row.direction === "outbound") {
      bucket.contacted.add(email);
      continue;
    }
    bucket.replied.add(email);
    if (row.ai_interest !== MACHINE) bucket.human.add(email);
    if (row.ai_interest && POSITIVE.has(row.ai_interest)) bucket.positive.add(email);
  }

  return [...acc.entries()]
    .map(([instantlyCampaignId, b]) => ({
      instantlyCampaignId,
      label: marked.get(instantlyCampaignId) ?? instantlyCampaignId,
      totals: {
        contacted: b.contacted.size,
        replied: b.replied.size,
        human: b.human.size,
        positive: b.positive.size,
      },
    }))
    .sort((a, b) => b.totals.human - a.totals.human || a.label.localeCompare(b.label));
}

/** Dieselben Zahlen, aber ueber alle markierten Kampagnen zusammen. */
export function sumUp(campaigns: CommissionCampaign[]): CommissionTotals {
  return campaigns.reduce(
    (acc, c) => ({
      contacted: acc.contacted + c.totals.contacted,
      replied: acc.replied + c.totals.replied,
      human: acc.human + c.totals.human,
      positive: acc.positive + c.totals.positive,
    }),
    { contacted: 0, replied: 0, human: 0, positive: 0 }
  );
}

/**
 * Die Antworten selbst, neueste zuerst.
 *
 * Die Zahlen daneben sind eine Zusammenfassung; strittig wird eine
 * Abrechnung immer an einer einzelnen Zeile. Deshalb gibt es sie: Adresse,
 * Kampagne, Einstufung, Datum. Je Adresse die ERSTE Antwort, weil die
 * Provision an der Antwort haengt und nicht am Umfang des Hin und Her
 * danach.
 */
export function replies(
  rows: CommissionRow[],
  marked: Map<string, string>,
  month: string | null
): CommissionReply[] {
  const erste = new Map<string, CommissionReply>();
  for (const row of rows) {
    if (row.direction !== "inbound") continue;
    const id = row.instantly_campaign_id;
    if (!id || !marked.has(id)) continue;
    const at = when(row);
    if (month && monthOf(at) !== month) continue;
    const email = (row.from_email ?? "").trim().toLowerCase();
    if (!email) continue;

    const vorhanden = erste.get(email);
    if (!vorhanden || at < vorhanden.at) {
      erste.set(email, {
        email,
        campaignLabel: marked.get(id) ?? id,
        interest: row.ai_interest,
        at,
      });
    }
  }
  return [...erste.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/** Alle Monate, in denen ueberhaupt etwas passiert ist, neueste zuerst. */
export function monthsPresent(rows: CommissionRow[], marked: Map<string, string>): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.instantly_campaign_id && marked.has(row.instantly_campaign_id)) {
      set.add(monthOf(when(row)));
    }
  }
  return [...set].sort().reverse();
}

/**
 * Die Liste als CSV.
 *
 * Weil eine Abrechnung den Weg aus der App hinaus finden muss und ein
 * Bildschirmfoto kein Beleg ist. Semikolon als Trenner: Excel in
 * deutschsprachigen Gebietsschemata zerlegt eine Komma-CSV nicht in Spalten,
 * und diese Datei wird in Excel geoeffnet und nicht in einem Editor.
 */
export function toCsv(rows: CommissionReply[]): string {
  const escape = (v: string) => (/[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const lines = ["email;kampagne;einstufung;datum"];
  for (const r of rows) {
    lines.push(
      [escape(r.email), escape(r.campaignLabel), escape(r.interest ?? ""), escape(r.at)].join(";")
    );
  }
  return lines.join("\n");
}
