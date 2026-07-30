// Alles rund um das Mapping zwischen unserer eigenen Kampagnen-Form und dem,
// was Instantlys /api/v2/campaigns erwartet/liefert (siehe
// https://developer.instantly.ai/api-reference/schemas/campaign). Bewusst
// getrennt von lib/instantly.ts (das bleibt der generische API-Client), damit
// dieser Datei-Kopf als einziger Ort gilt, an dem man nachschauen muss, wenn
// sich Instantlys Kampagnen-Schema aendert.

export type SequenceStep = { subject: string; body: string; delayDays?: number };

export type CampaignScheduleInput = {
  days: number[]; // 0=Sonntag..6=Samstag, wie JS Date#getDay()
  from: string; // "09:00"
  to: string; // "17:00"
  timezone: string; // z.B. "Europe/Vienna"
};

/**
 * Instantly akzeptiert fuer campaign_schedule.timezone nur eine feste, per
 * Enum validierte Liste an IANA-Zone-Strings (Fehler bei Verstoss: "must be
 * equal to one of the allowed values"). Ein paar gaengige Namen fehlen darin,
 * weil sie in der aktuellen IANA-tzdata nur noch als Backward-Link auf
 * denselben Regelsatz gefuehrt werden -- z.B. Europe/Vienna, das seit 1980
 * exakt dieselben Uhrzeiten/DST-Regeln wie Europe/Berlin hat und deshalb nur
 * noch als veralteter Alias existiert. Deshalb: kuratierte Auswahl statt
 * freier Texteingabe im Formular, plus eine Normalisierung hier als
 * Sicherheitsnetz fuer evtl. noch gespeicherte alte Werte.
 */
/**
 * Instantly validiert campaign_schedule.timezone serverseitig gegen eine
 * FESTE, ungewoehnlich kleine Enum-Liste (102 Werte, per api.instantly.ai/
 * openapi/api_v2.json abgerufen und geprueft am 2026-07-21) -- keine freie
 * IANA-Zeitzone. Die Liste enthaelt pro UTC-Offset+DST-Regelwerk jeweils nur
 * EINEN Vertreter, nicht zwingend die bekannteste Stadt: Mitteleuropa (Berlin,
 * Wien, Zuerich, Paris, Rom, Madrid, Amsterdam, Prag, Warschau, Budapest,
 * Stockholm, Kopenhagen, Oslo -- alle identische MEZ/MESZ-Regeln) wird
 * ausschliesslich durch "Europe/Belgrade" repraesentiert, GB/Irland/Portugal
 * durch "Europe/Isle_of_Man", US-Ostkueste durch "America/Detroit". Weder
 * "Europe/Berlin" noch "Europe/Vienna" noch "America/New_York" sind gueltige
 * Werte, obwohl das intuitiv naheliegen wuerde -- deshalb bewusst ein
 * Dropdown mit verstaendlichen Labels statt Freitext, und eine Alias-Map als
 * Sicherheitsnetz fuer irgendwo frei eingetippte/importierte Werte.
 */
export const INSTANTLY_TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "Europe/Belgrade", label: "Mitteleuropa – Berlin, Wien, Zürich, Paris, Rom, Madrid (MEZ/MESZ)" },
  { value: "Europe/Isle_of_Man", label: "Großbritannien, Irland, Portugal (GMT/BST)" },
  { value: "Europe/Helsinki", label: "Osteuropa – Helsinki, Athen, Kiew, Riga (OEZ/OESZ)" },
  { value: "Europe/Istanbul", label: "Istanbul / Türkei" },
  { value: "Europe/Kaliningrad", label: "Kaliningrad" },
  { value: "Africa/Casablanca", label: "Marokko" },
  { value: "Africa/Cairo", label: "Kairo / Ägypten" },
  { value: "Asia/Dubai", label: "Dubai / VAE" },
  { value: "Asia/Tehran", label: "Teheran / Iran" },
  { value: "Asia/Karachi", label: "Karatschi / Pakistan" },
  { value: "Asia/Kolkata", label: "Indien (Neu-Delhi, Mumbai)" },
  { value: "Asia/Dhaka", label: "Dhaka / Bangladesch" },
  { value: "Asia/Hong_Kong", label: "Hongkong / China" },
  { value: "Asia/Taipei", label: "Taiwan" },
  { value: "Asia/Pyongyang", label: "Japan / Südkorea (UTC+9)" },
  { value: "Australia/Perth", label: "Perth (Westaustralien)" },
  { value: "Australia/Melbourne", label: "Sydney / Melbourne (Ostaustralien)" },
  { value: "Pacific/Auckland", label: "Auckland / Neuseeland" },
  { value: "America/Detroit", label: "US-Ostküste – New York, Miami, Boston (Eastern)" },
  { value: "America/Chicago", label: "US Zentral – Chicago, Dallas (Central)" },
  { value: "America/Boise", label: "US Mountain – Denver-nah (Mountain)" },
  { value: "America/Creston", label: "US/Kanada Westküste-nah – ganzjährig UTC-7, keine Sommerzeit" },
  { value: "America/Sao_Paulo", label: "São Paulo / Brasilien" },
  { value: "America/Bogota", label: "Bogotá / Kolumbien" },
  { value: "America/Santiago", label: "Santiago / Chile" },
];

/**
 * Frei eingetippte/importierte IANA-Namen (z.B. aus alten Datensaetzen oder
 * versehentlich per Browser-Erkennung) auf den naechstliegenden, tatsaechlich
 * von Instantly akzeptierten Wert aus der Liste oben abbilden. Nach
 * UTC-Offset+DST-Regel gruppiert, nicht 1:1 nach Stadtname.
 */
const TIMEZONE_ALIASES: Record<string, string> = {
  // Mitteleuropa (MEZ/MESZ) -> Europe/Belgrade
  "Europe/Vienna": "Europe/Belgrade",
  "Europe/Berlin": "Europe/Belgrade",
  "Europe/Paris": "Europe/Belgrade",
  "Europe/Rome": "Europe/Belgrade",
  "Europe/Madrid": "Europe/Belgrade",
  "Europe/Amsterdam": "Europe/Belgrade",
  "Europe/Brussels": "Europe/Belgrade",
  "Europe/Zurich": "Europe/Belgrade",
  "Europe/Prague": "Europe/Belgrade",
  "Europe/Warsaw": "Europe/Belgrade",
  "Europe/Budapest": "Europe/Belgrade",
  "Europe/Stockholm": "Europe/Belgrade",
  "Europe/Copenhagen": "Europe/Belgrade",
  "Europe/Oslo": "Europe/Belgrade",
  "Europe/Vaduz": "Europe/Belgrade",
  "Europe/Busingen": "Europe/Belgrade",
  "Europe/San_Marino": "Europe/Belgrade",
  "Europe/Vatican": "Europe/Belgrade",
  "Europe/Bratislava": "Europe/Belgrade",
  "Europe/Ljubljana": "Europe/Belgrade",
  "Europe/Podgorica": "Europe/Belgrade",
  "Europe/Skopje": "Europe/Belgrade",
  "Europe/Zagreb": "Europe/Belgrade",
  "Europe/Luxembourg": "Europe/Belgrade",
  // GB/Irland/Portugal (GMT/BST) -> Europe/Isle_of_Man
  "Europe/London": "Europe/Isle_of_Man",
  "Europe/Dublin": "Europe/Isle_of_Man",
  "Europe/Lisbon": "Europe/Isle_of_Man",
  // Osteuropa (OEZ/OESZ)
  "Europe/Athens": "Europe/Helsinki",
  "Europe/Bucharest": "Europe/Helsinki",
  // US-Ostkueste
  "America/New_York": "America/Detroit",
  "America/Toronto": "America/Detroit",
  // US Westkueste (kein exakter Treffer in Instantlys Liste verfuegbar)
  "America/Los_Angeles": "America/Creston",
  "America/Vancouver": "America/Creston",
  "America/Denver": "America/Boise",
  // Ostasien
  "Asia/Tokyo": "Asia/Pyongyang",
  "Asia/Seoul": "Asia/Pyongyang",
  "Asia/Shanghai": "Asia/Hong_Kong",
  "Asia/Singapore": "Asia/Hong_Kong",
  "Europe/Moscow": "Europe/Kaliningrad",
};

export function normalizeInstantlyTimezone(tz: string): string {
  if (INSTANTLY_TIMEZONE_OPTIONS.some((o) => o.value === tz)) return tz;
  return TIMEZONE_ALIASES[tz] ?? "Europe/Belgrade";
}


/** Browser-erkannte Zone (typischerweise ein bei Instantly ungueltiger Name wie Europe/Vienna) auf eine der kuratierten, garantiert gueltigen Optionen abbilden. */
export function defaultInstantlyTimezone(): string {
  if (typeof Intl === "undefined") return "Europe/Belgrade";
  return normalizeInstantlyTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** Instantlys campaign_schedule-Objekt: schedules[] mit name, timing.from/to, days (Objekt mit boolean-Keys "0".."6"), timezone. */
export function buildCampaignSchedule({ days, from, to, timezone }: CampaignScheduleInput) {
  const daysObj: Record<string, boolean> = {};
  for (let d = 0; d <= 6; d++) daysObj[String(d)] = days.includes(d);
  return { schedules: [{ name: "Standard", timing: { from, to }, days: daysObj, timezone: normalizeInstantlyTimezone(timezone) }] };
}

/**
 * Instantly speichert einen Mailtext NUR, wenn er wie HTML aussieht.
 *
 * Gegen die Live-API ausgemessen (PATCH, danach GET zur Kontrolle):
 *   "A and B"          -> gespeichert
 *   "A & B"            -> gespeichert als LEERER String
 *   "A &amp; B"        -> ebenfalls leer (Escapen allein reicht nicht)
 *   "A < B"            -> leer
 *   "<p>A &amp; B</p>" -> gespeichert
 *
 * Ein einziges kaufmaennisches Und im Text hat also den kompletten Body
 * verschluckt -- die API meldet dabei brav HTTP 200, der Text ist aber weg.
 * Genauso verhaelt sich Text zwischen blossen <br>: der Inhalt faellt raus,
 * nur die Tags bleiben. Der Inhalt muss in Blockelementen stehen.
 *
 * Deshalb wird beim Senden aus dem Klartext des Editors echtes HTML gebaut:
 * Sonderzeichen maskiert, Leerzeilen zu <p>, einfache Umbrueche zu <br />.
 */
export function plainTextToInstantlyHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n[ \t]*\n/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("");
}

/**
 * Gegenrichtung fuer den Editor: aus Instantlys HTML wieder Klartext machen,
 * sonst stuenden im Textfeld ploetzlich <p>- und <br />-Tags.
 *
 * Kampagnen, die vor dieser Umstellung angelegt wurden, enthalten reinen Text
 * -- der bleibt unangetastet.
 */
export function instantlyHtmlToPlainText(body: string): string {
  if (!body) return "";
  if (!/<\/?(p|br|div)\b/i.test(body)) return body;
  return (
    body
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
      .replace(/<\/?(p|div)[^>]*>/gi, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      // &amp; zuletzt, sonst wuerde aus "&amp;lt;" faelschlich "<"
      .replace(/&amp;/g, "&")
      .trim()
  );
}

// Laut Instantly-Doku wird beim Top-Level-Feld "sequences" nur das erste Element
// verwendet (Array existiert nur aus Kompatibilitaetsgruenden). Jeder Schritt hat
// "variants" (fuer A/B-Tests), wir nutzen bewusst nur eine Variante pro Schritt.
export function buildCampaignSequence(steps: SequenceStep[]) {
  return [
    {
      steps: steps.map((s) => ({
        type: "email",
        delay: s.delayDays ?? 0,
        variants: [{ subject: s.subject, body: plainTextToInstantlyHtml(s.body) }],
      })),
    },
  ];
}

/** Instantlys numerischer Kampagnen-Status, siehe Schema-Doku (schemas/def-1). */
export const INSTANTLY_CAMPAIGN_STATUS = {
  DRAFT: 0,
  ACTIVE: 1,
  PAUSED: 2,
  COMPLETED: 3,
  RUNNING_SUBSEQUENCES: 4,
  BOUNCE_PROTECT: -2,
  ACCOUNTS_UNHEALTHY: -1,
  ACCOUNT_SUSPENDED: -99,
} as const;

/** Lokaler Status-String (Check-Constraint auf public.campaigns), aus Instantlys Zahlencode abgeleitet. */
export type LocalCampaignStatus = "draft" | "active" | "paused" | "completed" | "error";

export function toLocalStatus(instantlyStatus: number | null | undefined): LocalCampaignStatus {
  switch (instantlyStatus) {
    case INSTANTLY_CAMPAIGN_STATUS.DRAFT:
      return "draft";
    case INSTANTLY_CAMPAIGN_STATUS.ACTIVE:
    case INSTANTLY_CAMPAIGN_STATUS.RUNNING_SUBSEQUENCES:
      return "active";
    case INSTANTLY_CAMPAIGN_STATUS.PAUSED:
      return "paused";
    case INSTANTLY_CAMPAIGN_STATUS.COMPLETED:
      return "completed";
    default:
      // Alle negativen Fehlerstatus (Account Suspended/Unhealthy, Bounce
      // Protect) landen bewusst in "error", statt still als "paused" zu
      // erscheinen -- das sind Faelle, die der Kunde aktiv sehen soll.
      return instantlyStatus != null && instantlyStatus < 0 ? "error" : "draft";
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";

/** Lokale Zeile aus public.campaigns (Spiegel der Instantly-Kampagne, siehe Migration 0023). */
export type LocalCampaign = {
  id: string;
  workspace_id: string;
  search_id: string | null;
  name: string;
  status: LocalCampaignStatus;
  instantly_campaign_id: string | null;
  mailboxes: string[];
  days: number[];
  send_window_start: string;
  send_window_end: string;
  timezone: string;
  daily_limit: number | null;
  activated_at: string | null;
  created_at: string;
};

/** Laedt eine lokale Kampagne, aber nur wenn sie tatsaechlich diesem Workspace gehoert (RLS greift zusaetzlich, das hier ist die explizite Kontext-Pruefung fuer bessere Fehlermeldungen). */
export async function loadOwnedCampaign(
  supabase: SupabaseClient,
  workspaceId: string,
  campaignId: string
): Promise<LocalCampaign | null> {
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .single();
  return (data as LocalCampaign) ?? null;
}

/** Instantly-Kampagnen-Objekt, nur die Felder, die wir hier tatsaechlich lesen. */
export type InstantlyCampaign = {
  id: string;
  name: string;
  status: number;
  campaign_schedule?: {
    schedules?: Array<{ timing?: { from?: string; to?: string }; days?: Record<string, boolean>; timezone?: string }>;
  };
  sequences?: Array<{ steps?: Array<{ delay?: number; variants?: Array<{ subject?: string; body?: string }> }> }>;
  email_list?: string[];
  daily_limit?: number | null;
};

/** Instantlys Sequenz-Objekt zurueck in unsere editierbare Step-Form uebersetzen. */
export function sequenceFromInstantly(campaign: InstantlyCampaign): SequenceStep[] {
  const steps = campaign.sequences?.[0]?.steps ?? [];
  return steps.map((s) => ({
    subject: s.variants?.[0]?.subject ?? "",
    body: instantlyHtmlToPlainText(s.variants?.[0]?.body ?? ""),
    delayDays: s.delay ?? 0,
  }));
}

/** Instantlys Schedule-Objekt zurueck in unsere editierbare Form uebersetzen. */
export function scheduleFromInstantly(campaign: InstantlyCampaign): CampaignScheduleInput {
  const sched = campaign.campaign_schedule?.schedules?.[0];
  const daysObj = sched?.days ?? {};
  const days = Object.keys(daysObj)
    .filter((k) => daysObj[k])
    .map(Number)
    .sort();
  return {
    days: days.length > 0 ? days : [1, 2, 3, 4, 5],
    from: sched?.timing?.from ?? "09:00",
    to: sched?.timing?.to ?? "17:00",
    timezone: sched?.timezone ?? "Europe/Vienna",
  };
}
