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
  /** Herkunft fuer das Sendefenster (regionOf); ohne Angabe "us". */
  region?: Region;
};

export type Region = "us" | "uk";

/**
 * Woher ein Wartender kommt, fuer das Sendefenster.
 *
 * Gemessen am 2026-09-25 an den 114 Abwesenden im retaiyn-Workspace: 35 mit
 * .co.uk/.uk-Domain, 19 weitere mit britischen Hinweisen in der Notiz
 * ("annual leave", +44), 56 mit .com aus den alten Kampagnen "BERAT_SMBs
 * WhatsApp Marketing" und "RAMY_SMBs WhatsApp Marketing", die auf
 * europaeischer Zeit (09:00 bis 12:00) liefen, und nur 3 aus einer US-Kampagne.
 * Also: britische Domain oder Herkunft ohne US-Kampagne heisst "uk"; wer aus
 * einer Kampagne mit amerikanischer Zeitzone kam, heisst "us".
 */
export function regionOf(email: string | null | undefined, campaignTimezone: string | null | undefined): Region {
  const domain = (email ?? "").toLowerCase().split("@")[1] ?? "";
  if (/\.(co\.uk|uk)$/.test(domain)) return "uk";
  if (campaignTimezone && /^America\//.test(campaignTimezone)) return "us";
  return "uk";
}

/**
 * Sendefenster je Herkunft.
 *
 * US wie jede andere retaiyn-Kampagne (08:00 bis 17:00 New York, Detroit ist
 * Instantlys Name dafuer). UK: der britische Vormittag, 08:00 bis 12:00
 * London, das ist 09:00 bis 13:00 in Wien und trifft damit auch die
 * Leads vom Kontinent am Vormittag. Europe/Isle_of_Man ist Instantlys Name
 * fuer britische Zeit samt Sommerzeit (TIMEZONE_ALIASES).
 */
export const REGION_SCHEDULE: Record<Region, { timezone: string; from: string; to: string; label: string }> = {
  us: { timezone: "America/Detroit", from: "08:00", to: "17:00", label: "US" },
  uk: { timezone: "Europe/Isle_of_Man", from: "08:00", to: "12:00", label: "UK" },
};

export type WeekBucket<T extends WaitingContact> = {
  /** Montag der ISO-Woche, "YYYY-MM-DD". */
  week: string;
  sender: Sender;
  region: Region;
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
    const region = c.region ?? "us";
    const key = `${week}|${sender}|${region}`;
    const bucket = map.get(key) ?? { week, sender, region, contacts: [] };
    bucket.contacts.push(c);
    map.set(key, bucket);
  }
  return [...map.values()].sort(
    (a, b) =>
      a.week.localeCompare(b.week) || a.sender.localeCompare(b.sender) || b.region.localeCompare(a.region)
  );
}

/** "yoyo Klaviyo | Wiederkontakt KW 41 | UK | Berat", Region wie im Namensschema der Kampagnen. */
export function bucketName(week: string, sender: Sender, region?: Region): string {
  const r = region ? ` | ${REGION_SCHEDULE[region].label}` : "";
  return `yoyo Klaviyo | Wiederkontakt KW ${isoWeekNumber(week)}${r} | ${sender === "berat" ? "Berat" : "Ramy"}`;
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
 * Die Wiederkontakt-Sequenz: drei Stufen, ein Tag Abstand, jede mit eigenem
 * Winkel (Regel vom 2026-09-24: nie "bumping", immer neuer Wert).
 *
 * Format und CTA nach der Mail an Persona Nutrition vom 2026-09-23, die zu
 * einem Termin fuehrte: ein Satz zum Umsatz im zweiten Kauf, ein Satz zu
 * dem, was wir bauen, dann das kostenlose 5-Minuten-Video-Audit. "your shop"
 * statt Firmenname: bei den Kontakten aus Instantlys Historie ist nur die
 * Domain bekannt. Jede Stufe hat einen eigenen Betreff (Youssef, 2026-09-25).
 */
export function reengageSteps(sender: Sender) {
  const sig = SIGNATURE[sender];
  return [
    {
      step_order: 0,
      wait_days: 0,
      subject: "the second purchase",
      body:
        "Hey {{firstName}},\n\nYour shop's revenue sits in the second purchase, and it only happens when the right buyer group gets the right email at the right moment. With Q4 weeks away, that is the fastest revenue you can still unlock.\n\nWe build exactly that, for 200+ ecommerce brands.\n\nCan I send you a free 5-minute video audit of your Klaviyo emails, with the segments I'd build first for your shop?\n\n" +
        sig,
      variants: [] as { subject: string; body: string }[],
    },
    {
      step_order: 1,
      wait_days: 1,
      subject: "first-time vs repeat buyers",
      body:
        "Hey {{firstName}},\n\nThe first thing I check in a shop's Klaviyo emails: do first-time buyers and repeat buyers get different emails? When they don't, the second purchase is left to chance.\n\nSplitting those two groups is the fastest lift we know, up to 30% more revenue from customers you already have.\n\nCan I show you in a free 5-minute video how that looks for your shop?\n\n" +
        sig,
      variants: [],
    },
    {
      step_order: 2,
      wait_days: 1,
      subject: "3 fixes for your flows",
      body:
        "Hey {{firstName}},\n\nLast one from me. The free audit is still yours: a 5-minute video with three concrete points you can change in your Klaviyo emails right away, no call needed.\n\nReply yes and you have it within two days.\n\n" +
        sig,
      variants: [],
    },
  ];
}
