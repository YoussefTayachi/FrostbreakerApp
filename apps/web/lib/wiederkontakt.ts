/**
 * Wiederkontakt: Abwesende nach der Rueckkehr noch einmal anschreiben.
 *
 * Reine Logik ohne Datenbank, damit sie unter Test steht: welcher Absender
 * ein Postfach ist, wie die Wartenden in Wochen fallen, und wie die
 * Wiederkontakt-Sequenz je Absender aussieht. Der Ablauf (Kopie der
 * Kontakte in eine eigene Liste, Entwurf, Postfaecher) steht in
 * app/api/wiederkontakt/route.ts und wird vom Wochen-Cron
 * (app/api/cron/wiederkontakt) mit denselben Funktionen aufgerufen.
 */
import { isoWeekStart } from "./crm/ooo-date";

export type Sender = "berat" | "ramy";

/**
 * Welcher Absender hinter einem Postfach steht.
 *
 * Dieselbe Regel wie beim Aufteilen der 50 retaiyn-Postfaecher am 2026-09-23:
 * berat, guen, gun oder ein Kuerzel aus b und g heisst Berat; alles andere
 * (ramy, tichy, rt, tr, r.t ...) heisst Ramy. Unbekannte Postfaecher fallen
 * auf Berat, damit eine Liste nie ohne Absender bleibt.
 */
export function senderOfMailbox(eaccount: string | null | undefined): Sender {
  const local = (eaccount ?? "").toLowerCase().split("@")[0];
  if (!local) return "berat";
  if (/berat|guen|gun|^gb$|^bg$|^b\.|^g\./.test(local)) return "berat";
  return "ramy";
}

export type WaitingContact = {
  id: string;
  ooo_until: string;
  ooo_estimated: boolean;
  /** Postfach, von dem die erste Mail ging (messages.eaccount); leer, wenn
   *  die Abwesenheitsnotiz ohne ausgehende Mail bekannt ist. */
  eaccount: string | null;
};

export type WeekBucket<T extends WaitingContact> = {
  /** Montag der ISO-Woche, "YYYY-MM-DD". */
  week: string;
  sender: Sender;
  contacts: T[];
};

/**
 * Die Wartenden nach Rueckkehrwoche und Absender.
 *
 * Woche statt Monat: bei Monatsgruppen wartet, wer am 2. zurueckkommt, bis
 * zu vier Wochen, und wer am 30. zurueckkommt, bekommt die Mail am ersten
 * Tag. Die Woche trifft "zwei, drei Tage nach der Rueckkehr", wenn das
 * Postfach abgearbeitet ist. Wer schon vor der laufenden Woche zurueck war
 * und noch nie eine Wiederkontakt-Mail bekam, faellt in die laufende Woche,
 * nicht in eine vergangene.
 */
export function groupByWeek<T extends WaitingContact>(contacts: T[], today: Date): WeekBucket<T>[] {
  const current = isoWeekStart(today);
  const map = new Map<string, WeekBucket<T>>();
  for (const c of contacts) {
    let week = isoWeekStart(new Date(c.ooo_until + "T00:00:00Z"));
    if (week < current) week = current;
    const sender = senderOfMailbox(c.eaccount);
    const key = `${week}|${sender}`;
    const bucket = map.get(key) ?? { week, sender, contacts: [] };
    bucket.contacts.push(c);
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => (a.week === b.week ? a.sender.localeCompare(b.sender) : a.week.localeCompare(b.week)));
}

/** "yoyo Klaviyo | Wiederkontakt KW 41 | Berat" */
export function bucketName(week: string, sender: Sender): string {
  return `yoyo Klaviyo | Wiederkontakt KW ${isoWeekNumber(week)} | ${sender === "berat" ? "Berat" : "Ramy"}`;
}

export function isoWeekNumber(isoDate: string): number {
  const d = new Date(isoDate + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const diff = d.getTime() - firstThursday.getTime();
  return 1 + Math.round((diff / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

const SIGNATURE: Record<Sender, string> = {
  berat:
    "Kind regards from Vienna,\nBerat Günes\nCEO & Co-Founder\nberat@retaiyn.com\n+1 (283) 300-4592\nlinkedin.com/in/bero\nReply \"stop\" and I'll take you off the list.",
  ramy:
    "Kind regards from Vienna,\nRamy Tichy\nCRO & Co-Founder\nramy@retaiyn.com\n+1 (283) 300-4592\nlinkedin.com/in/ramy-tichy\nReply \"stop\" and I'll take you off the list.",
};

/**
 * Die Wiederkontakt-Sequenz: drei Stufen, ein Tag Abstand, jede mit einem
 * anderen Angebot (Regel vom 2026-09-24: nie "bumping", immer neuer Wert).
 * Stufe 1 nennt den ersten Versuch beim Namen; das ist der Grund, warum die
 * Mail jetzt kommt, und kein Trick.
 */
export function reengageSteps(sender: Sender) {
  const sig = SIGNATURE[sender];
  return [
    {
      step_order: 0,
      wait_days: 0,
      subject: "while you were out",
      body:
        "Hey {{firstName}},\n\nI wrote while you were out, so once more, short: we run email marketing for 200+ ecommerce shops and know how to lift revenue from the customers you already have by up to 30%.\n\nWant to see how that works for you? Just reply yes.\n\n" +
        sig,
      variants: [] as { subject: string; body: string }[],
    },
    {
      step_order: 1,
      wait_days: 1,
      subject: "",
      body:
        "Hey {{firstName}},\n\nYou are a good fit for what we do. When email brings less than it should, the reason is almost always segmentation: everyone gets the same email, so the right customer never gets the right one.\n\nI will tell you for free how to fix that in your shop. Reply yes.\n\n" +
        sig,
      variants: [],
    },
    {
      step_order: 2,
      wait_days: 1,
      subject: "",
      body:
        "Hey {{firstName}},\n\nLast one from me: we audit your email marketing for free and send you three concrete points you can improve right away, no call needed.\n\nReply yes and it is yours within two days.\n\n" +
        sig,
      variants: [],
    },
  ];
}
