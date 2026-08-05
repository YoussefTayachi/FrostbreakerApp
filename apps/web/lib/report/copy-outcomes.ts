/**
 * Welcher Text bringt was.
 *
 * DIE REGEL, DIE DIESE DATEI TRAEGT
 *
 * Eine Antwortquote allein ist die falsche Zielgroesse.
 *
 * Das ist keine Theorie, es stand am 2026-08-05 in den Daten: in der einzigen
 * Kampagne mit zwei Fassungen brachte Variante A 0 Antworten auf 144 Kontakte
 * und Variante B 2 Antworten auf 149. Auf die Quote geschaut gewinnt B --
 * beide Antworten waren Absagen. Wer nur die Quote optimiert, sucht den Text,
 * der am zuverlaessigsten ein Nein erzeugt.
 *
 * Deshalb traegt jede Zeile hier fuenf Zahlen statt einer: Antworten,
 * interessiert, Absagen, Fragen, Termine. Die Oberflaeche darf hervorheben,
 * was sie will -- was sie nicht darf, ist die Quote allein zeigen.
 *
 * WIE EINE ANTWORT IHREM TEXT ZUGEORDNET WIRD
 *
 * Nicht geraten und nicht ueber Zeitfenster rekonstruiert: Instantly gibt
 * einer eingehenden Antwort denselben `step`-Wert wie der Mail, auf die sie
 * antwortet (nachgesehen am 2026-08-05, siehe Migration 0076). Die Zuordnung
 * ist damit exakt.
 *
 * TERMINE HAENGEN AN DER ANTWORT, NICHT AM KONTAKT
 *
 * Ein Termin gehoert zu dem Text, auf den der Kontakt geantwortet hat -- das
 * ist die einzige nachvollziehbare Kette. Wer nur "Kontakt hat Termin" zaehlt,
 * schreibt den Termin jedem Schritt gut, den dieser Kontakt je bekommen hat,
 * und der vierte Bump erbt den Erfolg des ersten Satzes.
 *
 * GEMESSEN AN KONTAKTEN, NICHT AN MAILS
 *
 * Wie in effectiveness.ts: eine Sequenz schickt mehrere Mails an dieselbe
 * Person. Ein Kontakt zaehlt je Schritt einmal.
 */

import { MIN_SAMPLE } from "./effectiveness";

export { MIN_SAMPLE };

/** Eine versendete Mail mit ihrer Zuordnung. */
export type OutboundRow = {
  contactId: string;
  campaignId: string | null;
  /** Name der Kampagne, oder null fuer die, die nur bei Instantly existieren. */
  campaignName: string | null;
  step: number | null;
  variant: number | null;
};

/** Eine eingegangene Antwort mit der Zuordnung der Mail, die sie ausgeloest hat. */
export type ReplyRow = {
  contactId: string;
  step: number | null;
  variant: number | null;
  /** interested | not_interested | question | out_of_office | null */
  interest: string | null;
  campaignId: string | null;
};

export type CopyBucket = {
  key: string;
  campaignName: string;
  step: number;
  variant: number;
  /** Angeschriebene Kontakte in diesem Schritt. */
  contacts: number;
  /** Echte Antworten -- Abwesenheitsnotizen zaehlen NICHT mit. */
  replies: number;
  interested: number;
  notInterested: number;
  questions: number;
  /** Termine, die aus einer Antwort auf genau diesen Text entstanden sind. */
  meetings: number;
  /** Abwesenheitsnotizen, gesondert ausgewiesen statt verschwiegen. */
  autoReplies: number;
  /** Null, solange die Grundlage unter MIN_SAMPLE liegt. */
  replyRate: number | null;
  /** Anteil interessierter Antworten -- die Zahl, auf die es ankommt. */
  positiveRate: number | null;
};

/**
 * Abwesenheitsnotizen sind keine Antwort.
 *
 * Dieselbe Entscheidung wie in der Wirkungs-Ansicht: ein Autoresponder ist
 * kein Mensch, der reagiert hat. Am 2026-08-04 machte das den Unterschied
 * zwischen 2,4 und 0,3 Prozent.
 */
const AUTO = "out_of_office";

function bucketKey(campaignId: string | null, step: number, variant: number): string {
  return `${campaignId ?? "extern"}|${step}|${variant}`;
}

/**
 * Auswertung je Kampagne, Schritt und Fassung.
 *
 * `meetingContacts` sind die Kontakte, die es bis zu einem Termin gebracht
 * haben (outreach_status meeting_booked oder customer).
 */
export function byCopy(
  outbound: OutboundRow[],
  replies: ReplyRow[],
  meetingContacts: Set<string>
): CopyBucket[] {
  type Acc = {
    campaignName: string;
    step: number;
    variant: number;
    contacts: Set<string>;
    replies: number;
    interested: number;
    notInterested: number;
    questions: number;
    autoReplies: number;
    meetings: Set<string>;
  };
  const acc = new Map<string, Acc>();

  function ensure(
    campaignId: string | null,
    campaignName: string | null,
    step: number,
    variant: number
  ): Acc {
    const key = bucketKey(campaignId, step, variant);
    let a = acc.get(key);
    if (!a) {
      a = {
        campaignName: campaignName ?? "",
        step,
        variant,
        contacts: new Set(),
        replies: 0,
        interested: 0,
        notInterested: 0,
        questions: 0,
        autoReplies: 0,
        meetings: new Set(),
      };
      acc.set(key, a);
    }
    // Ein spaeter gesehener Name gewinnt gegen einen leeren -- die Reihenfolge
    // der Zeilen soll das Ergebnis nicht bestimmen.
    if (!a.campaignName && campaignName) a.campaignName = campaignName;
    return a;
  }

  for (const row of outbound) {
    // Ohne Zuordnung gibt es keine Aussage ueber den Text. Solche Zeilen
    // stillschweigend Schritt 0 zuzuschlagen waere genau der Fehler, gegen den
    // parseStepRef null zurueckgibt.
    if (row.step === null || row.variant === null || !row.contactId) continue;
    ensure(row.campaignId, row.campaignName, row.step, row.variant).contacts.add(row.contactId);
  }

  for (const reply of replies) {
    if (reply.step === null || reply.variant === null || !reply.contactId) continue;
    const key = bucketKey(reply.campaignId, reply.step, reply.variant);
    // Nur in Gruppen zaehlen, die es aus dem Versand heraus gibt. Eine Antwort
    // auf einen Schritt, aus dem laut Datenlage nie etwas rausging, ist ein
    // Hinweis auf ein Datenproblem und keine Grundlage fuer eine Quote.
    const a = acc.get(key);
    if (!a) continue;

    if (reply.interest === AUTO) {
      a.autoReplies++;
      continue;
    }
    a.replies++;
    if (reply.interest === "interested") a.interested++;
    else if (reply.interest === "not_interested") a.notInterested++;
    else if (reply.interest === "question") a.questions++;

    if (meetingContacts.has(reply.contactId)) a.meetings.add(reply.contactId);
  }

  return [...acc.entries()]
    .map(([key, a]) => {
      const n = a.contacts.size;
      const enough = n >= MIN_SAMPLE;
      const meetings = a.meetings.size;
      /**
       * Interessiert ODER Termin, nicht die Summe.
       *
       * Ein Kontakt mit Termin hat fast immer auch eine als "interested"
       * eingestufte Antwort -- beides zu addieren wuerde ihn doppelt zaehlen
       * und die Quote ueber den Anteil der Angeschriebenen heben koennen.
       * Gezaehlt wird die groessere der beiden Mengen als Untergrenze.
       */
      const positive = Math.max(a.interested, meetings);
      return {
        key,
        campaignName: a.campaignName || "(nur bei Instantly)",
        step: a.step,
        variant: a.variant,
        contacts: n,
        replies: a.replies,
        interested: a.interested,
        notInterested: a.notInterested,
        questions: a.questions,
        meetings,
        autoReplies: a.autoReplies,
        replyRate: enough ? a.replies / n : null,
        positiveRate: enough ? positive / n : null,
      };
    })
    .sort(sortForReading);
}

/**
 * Sortierung: erst nach Kampagne, dann in Sequenzreihenfolge.
 *
 * Bewusst NICHT nach Quote wie in effectiveness.ts. Eine Sequenz liest man
 * der Reihe nach -- die Frage lautet "wo bricht es ab", und ein nach Erfolg
 * umsortierter Ablauf beantwortet sie nicht.
 */
function sortForReading(a: CopyBucket, b: CopyBucket): number {
  if (a.campaignName !== b.campaignName) return a.campaignName.localeCompare(b.campaignName);
  if (a.step !== b.step) return a.step - b.step;
  return a.variant - b.variant;
}

/** Variante 0 heisst A, 1 heisst B -- wie im Kampagnen-Editor. */
export function variantLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

export type CopySummary = {
  /** Nachrichten ohne Zuordnung. Über 0 heisst: die Auswertung ist unvollstaendig. */
  unattributed: number;
  buckets: number;
};

export function summarize(outbound: OutboundRow[], buckets: CopyBucket[]): CopySummary {
  return {
    unattributed: outbound.filter((r) => r.step === null || r.variant === null).length,
    buckets: buckets.length,
  };
}
