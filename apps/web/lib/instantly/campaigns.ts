// Alles rund um das Mapping zwischen unserer eigenen Kampagnen-Form und dem,
// was Instantlys /api/v2/campaigns erwartet/liefert (siehe
// https://developer.instantly.ai/api-reference/schemas/campaign). Bewusst
// getrennt von lib/instantly.ts (das bleibt der generische API-Client), damit
// dieser Datei-Kopf als einziger Ort gilt, an dem man nachschauen muss, wenn
// sich Instantlys Kampagnen-Schema aendert.

// Nur der Typ, kein Laufzeit-Import: die Liste der Platzhalter, die Instantly
// beim Versand ersetzt, steht in lib/copy/sequence-prompt.ts, weil sie dort
// auch in die Prompts geht. Sie wird hier gebraucht, damit mergeTagValues
// nachweislich JEDEN dieser Tags mit einem Wert belegt.
import type { EmailMergeTag } from "@/lib/copy/sequence-prompt";

/**
 * Eine Fassung eines Sequenzschritts.
 *
 * Instantly verschickt die Varianten eines Schrittes abwechselnd und zaehlt
 * getrennt mit: das ist der einzige eingebaute Weg, herauszufinden, welcher
 * Text tatsaechlich Antworten bringt. Bis 2026-08-04 hat die App immer genau
 * eine Variante angelegt; damit gab es keinerlei Vergleich, egal wie viele
 * Mails rausgingen.
 *
 * disabled entspricht Instantlys v_disabled: die Variante bleibt stehen (man
 * sieht weiter, was sie geleistet hat), wird aber nicht mehr versendet. Genau
 * das braucht man, wenn ein Gewinner feststeht: eine geloeschte Verliererin
 * nimmt ihre Zahlen mit ins Grab, und die naechste Kampagne wiederholt den
 * Fehler.
 */
export type StepVariant = { subject: string; body: string; disabled?: boolean };

export type SequenceStep = { variants: StepVariant[]; delayDays?: number };

/**
 * Der Name, unter dem der Website-Befund als Instantly-Variable ankommt.
 *
 * Anders als firstName, lastName, companyName und personalization ist das
 * KEINE von Instantlys vordefinierten Lead-Variablen, sondern ein eigenes
 * Feld, das mit dem Lead hochgeladen wird. Der Schluessel im Upload und der
 * Name im Text muessen deshalb zeichengenau gleich sein: ein Tippfehler wird
 * nicht ersetzt und geht als "{{websiteFinding}}" an den Empfaenger raus.
 */
export const WEBSITE_FINDING_FIELD = "websiteFinding";

/**
 * Benutzt diese Sequenz den Website-Befund?
 *
 * Davon haengt ab, ob Leads OHNE Befund mitgehen duerfen. Steht die Variable
 * nirgends im Text, ist ein fehlender Befund voellig belanglos; steht sie
 * drin, wuerde jeder solche Lead eine Mail mit einem Loch bekommen.
 *
 * Geprueft werden ALLE Fassungen und auch die Betreffzeilen, nicht nur
 * Fassung A des ersten Schrittes: eine Variable, die nur in Fassung B steht,
 * wird trotzdem an die Haelfte der Empfaenger versendet.
 */
export function usesWebsiteFinding(
  variants: { subject?: string | null; body?: string | null }[]
): boolean {
  const alles = variants.flatMap((v) => [v.subject ?? "", v.body ?? ""]).join("\n");
  return new RegExp(`\\{\\{\\s*${WEBSITE_FINDING_FIELD}\\s*\\}\\}`).test(alles);
}

/**
 * Ein Lead, soweit er Werte fuer die Merge-Tags liefert.
 *
 * Strukturell genau die Spalten, die create-campaign.ts ohnehin laedt
 * (CampaignContactRow). Bewusst als eigener, kleinerer Typ hier und nicht als
 * Import von dort: create-campaign.ts zieht den Instantly-Client, die
 * Abo-Pruefung und die Sperrlisten mit, und die Vorschau im Browser braucht
 * davon nichts.
 */
export type MergeTagSource = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  businesses: {
    name: string | null;
    personalization: string | null;
    website_finding: string | null;
  } | null;
};

/**
 * Die sechs Werte eines Leads, benannt wie die Tags IM TEXT.
 *
 * Record<EmailMergeTag, string> ist hier die eigentliche Absicherung: die
 * Liste der Tags steht in lib/copy/sequence-prompt.ts (EMAIL_MERGE_TAGS, von
 * dort kommt auch die Pruefung auf erfundene Platzhalter). Kommt dort ein Tag
 * dazu, kompiliert mergeTagValues nicht mehr, bis er auch hier einen Wert
 * hat. Ein Tag ohne Wert wuerde sonst unbemerkt als leer beim Empfaenger
 * ankommen.
 */
export type MergeTagValues = Record<EmailMergeTag, string>;

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DIE EINE STELLE, AN DER LEAD-SPALTE UND MERGE-TAG ZUSAMMENFINDEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Zwei Aufrufer, die nicht auseinanderlaufen duerfen:
 *
 *   buildInstantlyLead()  -> was beim Kampagnen-Upload tatsaechlich an
 *                            Instantly geht (lib/instantly/create-campaign.ts)
 *   renderVariables()     -> was die Vorschau als Mail des Empfaengers zeigt
 *                            (lib/instantly/preview.ts)
 *
 * Eine Vorschau, die anders zuordnet als der Upload, luegt: sie zeigt einen
 * Firmennamen, wo beim Empfaenger ein Loch steht, oder umgekehrt. Deshalb
 * liest sie nicht selbst aus den Spalten, sondern nimmt genau dieses Objekt.
 *
 * Leer bleibt leer. Kein Rueckfallwert, keine Ersatztexte: dieselbe Haltung
 * wie in splitByWebsiteFinding und in worker/usage.py. Wer den Wert braucht,
 * soll sehen, dass er fehlt.
 */
export function mergeTagValues(lead: MergeTagSource): MergeTagValues {
  return {
    firstName: lead.first_name ?? "",
    lastName: lead.last_name ?? "",
    companyName: lead.businesses?.name ?? "",
    email: lead.email ?? "",
    personalization: lead.businesses?.personalization ?? "",
    [WEBSITE_FINDING_FIELD]: lead.businesses?.website_finding ?? "",
  };
}

/**
 * Das Lead-Objekt fuer POST /api/v2/leads/add.
 *
 * Die Schluessel sind Instantlys eigene (first_name, company_name, ...), die
 * Werte kommen aus mergeTagValues. Leere Werte werden zu undefined und fallen
 * damit aus dem JSON: ein leerer String wuerde bei Instantly als gesetzter
 * Wert liegen, und der Unterschied zwischen "nicht uebergeben" und "leer
 * uebergeben" ist an ihrer API nicht nachgemessen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EIGENE VARIABLEN GEHOEREN IN custom_variables, NICHT NACH OBEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Bis zum 2026-08-27 stand websiteFinding als Schluessel auf oberster Ebene,
 * gleichauf mit email und first_name. Es kam bei Instantly nie an, und in den
 * Mails blieb {{websiteFinding}} leer.
 *
 * Der Grund steht in Instantlys eigenem Schema fuer /api/v2/leads/add
 * (developer.instantly.ai, geprueft 2026-08-27): die Lead-Objekte haben
 * "additionalProperties": false und genau zwoelf erlaubte Felder (email,
 * first_name, last_name, phone, company_name, job_title, website,
 * personalization, lt_interest_status, pl_value_lead, assigned_to,
 * custom_variables). Alles andere faellt weg. personalization funktionierte,
 * weil es eines dieser zwoelf ist; websiteFinding ist keines.
 *
 * Warum es so lange nicht auffiel: die Mail-Vorschau in der App benutzt
 * mergeTagValues direkt und zeigt den Befund deshalb korrekt an. Sie liest
 * nie, was Instantly tatsaechlich gespeichert hat. Der Test in
 * preview.test.ts vergleicht Vorschau und Upload gegeneinander und war
 * ebenfalls gruen, weil beide Seiten denselben falschen Ort benutzten.
 */
export function buildInstantlyLead(lead: MergeTagSource) {
  const v = mergeTagValues(lead);
  const befund = v[WEBSITE_FINDING_FIELD] || undefined;
  return {
    email: v.email,
    first_name: v.firstName || undefined,
    last_name: v.lastName || undefined,
    company_name: v.companyName || undefined,
    personalization: v.personalization || undefined,
    // Eigenes Feld, nicht in den Icebreaker gemischt: die beiden Saetze haben
    // verschiedene Aufgaben und sollen an verschiedenen Stellen der Mail
    // stehen duerfen (Migration 0103).
    //
    // Der Schluessel INNERHALB von custom_variables ist der Name der
    // Merge-Variable in Instantly. Er muss deshalb zeichengenau zu
    // WEBSITE_FINDING_FIELD passen, so wie er im Sequenztext steht.
    custom_variables: befund ? { [WEBSITE_FINDING_FIELD]: befund } : undefined,
  };
}

/** Alle Fassungen einer Sequenz, ueber alle Stufen. */
export function allVariants(steps: SequenceStep[]): { subject: string; body: string }[] {
  return steps.flatMap((s) => s.variants ?? []);
}

/** Variante A eines Schrittes, der Text, der auf jeden Fall existiert. */
export function primaryVariant(step: SequenceStep): StepVariant {
  return step.variants[0] ?? { subject: "", body: "" };
}

/** Die Buchstaben, unter denen Instantly die Varianten fuehrt: 0 = A, 1 = B, ... */
export function variantLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

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
 * denselben Regelsatz gefuehrt werden, z.B. Europe/Vienna, das seit 1980
 * exakt dieselben Uhrzeiten/DST-Regeln wie Europe/Berlin hat und deshalb nur
 * noch als veralteter Alias existiert. Deshalb: kuratierte Auswahl statt
 * freier Texteingabe im Formular, plus eine Normalisierung hier als
 * Sicherheitsnetz fuer evtl. noch gespeicherte alte Werte.
 */
/**
 * Instantly validiert campaign_schedule.timezone serverseitig gegen eine
 * FESTE, ungewoehnlich kleine Enum-Liste (102 Werte, per api.instantly.ai/
 * openapi/api_v2.json abgerufen und geprueft am 2026-07-21), keine freie
 * IANA-Zeitzone. Die Liste enthaelt pro UTC-Offset+DST-Regelwerk jeweils nur
 * EINEN Vertreter, nicht zwingend die bekannteste Stadt: Mitteleuropa (Berlin,
 * Wien, Zuerich, Paris, Rom, Madrid, Amsterdam, Prag, Warschau, Budapest,
 * Stockholm, Kopenhagen, Oslo: alle identische MEZ/MESZ-Regeln) wird
 * ausschliesslich durch "Europe/Belgrade" repraesentiert, GB/Irland/Portugal
 * durch "Europe/Isle_of_Man", US-Ostkueste durch "America/Detroit". Weder
 * "Europe/Berlin" noch "Europe/Vienna" noch "America/New_York" sind gueltige
 * Werte, obwohl das intuitiv naheliegen wuerde; deshalb bewusst ein
 * Dropdown mit verstaendlichen Labels statt Freitext, und eine Alias-Map als
 * Sicherheitsnetz fuer irgendwo frei eingetippte/importierte Werte.
 */
export const INSTANTLY_TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "Europe/Belgrade", label: "Mitteleuropa: Berlin, Wien, Zürich, Paris, Rom, Madrid (MEZ/MESZ)" },
  { value: "Europe/Isle_of_Man", label: "Großbritannien, Irland, Portugal (GMT/BST)" },
  { value: "Europe/Helsinki", label: "Osteuropa: Helsinki, Athen, Kiew, Riga (OEZ/OESZ)" },
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
  { value: "America/Detroit", label: "US-Ostküste: New York, Miami, Boston (Eastern)" },
  { value: "America/Chicago", label: "US Zentral: Chicago, Dallas (Central)" },
  { value: "America/Boise", label: "US Mountain: Denver-nah (Mountain)" },
  { value: "America/Creston", label: "US/Kanada Westküste-nah: ganzjährig UTC-7, keine Sommerzeit" },
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
 * verschluckt; die API meldet dabei brav HTTP 200, der Text ist aber weg.
 * Genauso verhaelt sich Text zwischen blossen <br>: der Inhalt faellt raus,
 * nur die Tags bleiben. Der Inhalt muss in Blockelementen stehen.
 *
 * Deshalb wird beim Senden aus dem Klartext des Editors echtes HTML gebaut.
 *
 * Erzeugt wird dabei bewusst GENAU das Format, das Instantlys eigener Editor
 * speichert: eine Zeile pro <div>, eine Leerzeile als <div><br /></div>.
 *
 * Der Grund ist ein Fehler, der erst nach dem Versand auffiel: frueher wurden
 * hier <p>-Absaetze gebaut. Instantlys Editor schreibt die beim ersten Oeffnen
 * in <div> um, und beim Wechsel zwischen zwei Schritten sah der Text auf
 * einmal ohne Absaetze aus. Wer die Kampagne dann bei uns oeffnete und
 * speicherte, schrieb die zusammengefallene Fassung zurueck.
 *
 * Schicken wir von vornherein ihr eigenes Format, hat ihr Editor nichts
 * umzuschreiben und der Text bleibt ueber beliebig viele Runden stabil.
 * Die Bedingung von oben ist dabei weiterhin erfuellt: jede Zeile steht in
 * einem Blockelement, auch die leeren.
 */
export function plainTextToInstantlyHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split("\n")
    .map((line) => (line.trim() === "" ? "<div><br /></div>" : `<div>${line}</div>`))
    .join("");
}

/**
 * Gegenrichtung fuer den Editor: aus Instantlys HTML wieder Klartext machen,
 * sonst stuenden im Textfeld ploetzlich <p>- und <br />-Tags.
 *
 * Kampagnen, die vor dieser Umstellung angelegt wurden, enthalten reinen Text;
 * der bleibt unangetastet.
 *
 * ACHTUNG: Instantly gibt NICHT zurueck, was wir geschickt haben. Wir senden
 * <p>-Absaetze, ihr Editor speichert sie beim ersten Oeffnen als <div> um
 * (gemessen an einer echten Kampagne, 2026-08-02):
 *
 *   gesendet:    <p>Hi</p><p>Welt</p>
 *   gespeichert: <div>Hi</div><div><br /></div><div>Welt</div>
 *
 * Eine Leerzeile steht dort also als <div><br /></div>. Ohne eine Regel fuer
 * die <div>-Grenze fielen die Tags ersatzlos weg und zwei Zeilen klebten ohne
 * jedes Leerzeichen aneinander ("...the more you sell.On the platform..." /
 * "Hi {{firstName}},Last one from me"). Das war nicht nur ein Anzeigefehler:
 * wer die Kampagne bei uns oeffnete und speicherte, schrieb den zerstoerten
 * Text zurueck nach Instantly und verschickte ihn so.
 */
export function instantlyHtmlToPlainText(body: string): string {
  if (!body) return "";
  if (!/<\/?(p|br|div)\b/i.test(body)) return body;
  return (
    body
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
      // Jede <div>-Grenze ist ein Zeilenumbruch. Zusammen mit dem <br /> aus
      // einem leeren Absatz-<div> ergibt das drei Umbrueche, die weiter
      // unten wieder auf eine Leerzeile zusammengefasst werden.
      .replace(/<\/div>\s*<div[^>]*>/gi, "\n")
      .replace(/<\/?(p|div)[^>]*>/gi, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      // &amp; zuletzt, sonst wuerde aus "&amp;lt;" faelschlich "<"
      .replace(/&amp;/g, "&")
      // Aus <div>A</div><div><br /></div><div>B</div> werden sonst drei
      // Umbrueche und damit beim naechsten Speichern eine zusaetzliche
      // Leerzeile, die mit jedem Durchgang weiter waechst.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// Laut Instantly-Doku wird beim Top-Level-Feld "sequences" nur das erste Element
// verwendet (Array existiert nur aus Kompatibilitaetsgruenden).
//
// ACHTUNG, unterschiedliche Bedeutung von "delay":
//   unser Modell:  step[i].delayDays = warte so lange VOR diesem Schritt
//                  (im Formular steht das Feld deshalb erst ab Schritt 2)
//   Instantly:     step[i].delay     = warte so lange NACH diesem Schritt,
//                  bevor der naechste rausgeht ("Send next message in X days",
//                  in ihrer Oberflaeche unter Schritt 1 zu sehen)
//
// Ungefiltert durchgereicht landet die Wartezeit also einen Schritt zu spaet:
// Schritt 1 bekaeme 0 und das Follow-up ginge sofort nach der ersten Mail
// raus; die Verzoegerung, die der Nutzer eingestellt hat, verpufft
// stillschweigend. Deshalb wird beim Senden um eine Position verschoben.
export function buildCampaignSequence(steps: SequenceStep[]) {
  return [
    {
      steps: steps.map((s, i) => ({
        type: "email",
        delay: steps[i + 1]?.delayDays ?? 0,
        // Alle Fassungen mitgeben. Instantly verteilt den Versand darauf und
        // zaehlt getrennt mit; ohne mehrere Varianten gibt es keinen
        // Vergleich, egal wie viele Mails rausgehen.
        variants: s.variants.map((v) => ({
          subject: v.subject,
          body: plainTextToInstantlyHtml(v.body),
          // Nur setzen, wenn abgeschaltet: ein v_disabled:false an einer
          // Kampagne, die das Feld nie kannte, waere eine Aenderung ohne Anlass.
          ...(v.disabled ? { v_disabled: true } : {}),
        })),
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

/** Kuerzt Postgres' "HH:MM:SS"-Zeitformat auf "HH:MM" fuer <input type="time">.
 *  Steht hier und nicht mehr nur in api/instantly/campaigns/[id]: die
 *  Entwurfs-Vorbelegung braucht dieselbe Umrechnung. */
export function toHhMm(t: string): string {
  return t.slice(0, 5);
}

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
      // erscheinen: das sind Faelle, die der Kunde aktiv sehen soll.
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
  /** Migration 0071. Null = vor der Migration angelegt, echter Zustand nur bei
   *  Instantly bekannt, deshalb bewusst nicht als false gefuehrt. */
  open_tracking: boolean | null;
  link_tracking: boolean | null;
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
  sequences?: Array<{
    steps?: Array<{
      delay?: number;
      variants?: Array<{ subject?: string; body?: string; v_disabled?: boolean }>;
    }>;
  }>;
  email_list?: string[];
  daily_limit?: number | null;
  open_tracking?: boolean | null;
  link_tracking?: boolean | null;
};

/** Instantlys Sequenz-Objekt zurueck in unsere editierbare Step-Form uebersetzen. */
export function sequenceFromInstantly(campaign: InstantlyCampaign): SequenceStep[] {
  const steps = campaign.sequences?.[0]?.steps ?? [];
  return steps.map((s, i) => ({
    // Mindestens eine Fassung, auch wenn Instantly gar keine liefert; sonst
    // stuende im Formular ein Schritt ohne jedes Textfeld.
    variants: (s.variants?.length ? s.variants : [{}]).map((v) => ({
      subject: v.subject ?? "",
      body: instantlyHtmlToPlainText(v.body ?? ""),
      ...(v.v_disabled ? { disabled: true } : {}),
    })),
    // Gegenstueck zur Verschiebung in buildCampaignSequence: die Wartezeit
    // steht bei Instantly am vorherigen Schritt. Schritt 1 hat per Definition
    // keine Vorlaufzeit.
    delayDays: i === 0 ? 0 : steps[i - 1]?.delay ?? 0,
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
