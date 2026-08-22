/**
 * Kampagnen-ENTWUERFE: Zeilen in public.campaigns, die es nur bei uns gibt.
 *
 * Bis zum MCP-Werkzeug create_campaign (2026-08-22) hatte jede Kampagne immer
 * beide Haelften: eine bei Instantly und einen Spiegel bei uns. Der Entwurf
 * hat nur die zweite. Er entsteht, wenn jemand in Claude sagt "leg fuer diese
 * Liste eine Kampagne mit diesen vier Mails an" -- der Gang zu Instantly
 * bleibt bewusst in der App, weil erst er echte Mails moeglich macht.
 *
 * Diese Datei haelt die drei Fragen, die dadurch an drei Stellen auftauchen,
 * an einer:
 *   1. Ist diese Zeile ein Entwurf?            -> isCampaignDraft
 *   2. Was haengt schon an diesen Listen?      -> classifyLinkedCampaigns
 *   3. Was passiert mit dem Entwurf, wenn die
 *      Kampagne jetzt wirklich angelegt wird?  -> planDraftTakeover
 *   4. Wie sieht er im Kampagnenformular aus?  -> campaignFormValueFromDraft
 *
 * Aufgerufen wird das aus lib/mcp/tools.ts (create_campaign),
 * app/api/instantly/campaigns/route.ts (POST) und
 * app/instantly/campaigns/new/page.tsx.
 */
import { normalizeInstantlyTimezone, toHhMm, type StepVariant } from "./campaigns";

/**
 * Eine Kampagnenzeile, soweit sie fuer die Entwurfs-Frage zaehlt.
 *
 * Absichtlich schmaler als LocalCampaign: der MCP-Server liest hier nur diese
 * fuenf Spalten, und ein Typ, der mehr verlangt, zwaenge ihn zu einer
 * groesseren Abfrage, als er braucht.
 */
export type CampaignDraftFlags = {
  status: string;
  instantly_campaign_id: string | null;
  activated_at: string | null;
};
export type CampaignDraftRow = CampaignDraftFlags & { id: string; name: string };

/**
 * Ein Entwurf ist eine Kampagne, die nichts versenden kann.
 *
 * Alle drei Bedingungen, nicht nur die Instantly-ID: status und activated_at
 * sind die beiden anderen Stellen, an denen "diese Kampagne laeuft schon"
 * steht (ladeEntwurf in lib/mcp/tools.ts prueft dieselben drei). Eine Zeile,
 * die auch nur eine davon verletzt, darf weder ueberschrieben noch
 * weggeraeumt werden.
 *
 * `=== null` und nicht `!row.instantly_campaign_id`: wer die Spalte gar nicht
 * mitselektiert, bekommt undefined und damit "kein Entwurf". Das ist die
 * ungefaehrliche Richtung des Irrtums.
 */
export function isCampaignDraft(row: CampaignDraftFlags): boolean {
  return row.instantly_campaign_id === null && row.status === "draft" && !row.activated_at;
}

/**
 * Was haengt an diesen Lead-Listen schon?
 *
 * `live` ist eine Kampagne, die es bei Instantly gibt: dann darf fuer dieselbe
 * Liste keine zweite entstehen, sonst bekaemen dieselben Empfaenger alles
 * doppelt. `draft` ist ein Entwurf: der ist kein Grund abzubrechen, sondern
 * der, den man weiterverwendet.
 *
 * Die Reihenfolge der Zeilen entscheidet, welche genannt wird -- der Aufrufer
 * sortiert (aeltester zuerst), damit die Antwort bei zwei Treffern nicht bei
 * jedem Aufruf eine andere ist.
 */
export function classifyLinkedCampaigns(rows: CampaignDraftRow[]): {
  draft: CampaignDraftRow | null;
  live: CampaignDraftRow | null;
} {
  return {
    draft: rows.find((r) => isCampaignDraft(r)) ?? null,
    live: rows.find((r) => !isCampaignDraft(r)) ?? null,
  };
}

export type DraftTakeover = {
  /**
   * Eine Kampagne, die es bei Instantly schon gibt. Ist sie gesetzt, wird
   * nichts angelegt und nichts geloescht: der Aufrufer bricht ab.
   */
  blocked: CampaignDraftRow | null;
  /**
   * Der Entwurf, dessen ZEILE weiterverwendet wird, statt eine zweite
   * anzulegen. Null heisst: neu einfuegen wie bisher.
   */
  reuse: CampaignDraftRow | null;
  /**
   * Weitere Entwuerfe derselben Listen. Sobald die Kampagne steht, traegt
   * jede beteiligte Suche eine instantly_campaign_id; ein zurueckgebliebener
   * Entwurf koennte damit nie mehr angelegt werden (die App antwortet mit
   * HTTP 409) und waere eine Karteileiche mit einer Sequenz darin.
   */
  obsolete: CampaignDraftRow[];
};

/**
 * Wie das Anlegen mit dem vorhandenen Entwurf umgeht.
 *
 * Weiterverwenden statt loeschen-und-neu-anlegen, aus drei Gruenden: die
 * campaign_id, die das Modell dem Nutzer genannt hat, bleibt gueltig; die
 * Zeilen in mcp_write_log (Migration 0101) zeigen weiter auf eine existierende
 * Kampagne; und es gibt keinen Moment, in dem die Kampagne doppelt oder gar
 * nicht da ist.
 *
 * `requestedId` ist der Entwurf aus ?draft= im Formular. Er gewinnt gegen
 * einen zufaellig ebenfalls passenden zweiten: der Nutzer hat GENAU DEN
 * geoeffnet und geprueft.
 */
export function planDraftTakeover(
  candidates: CampaignDraftRow[],
  requestedId: string | null
): DraftTakeover {
  const { live } = classifyLinkedCampaigns(candidates);
  if (live) return { blocked: live, reuse: null, obsolete: [] };

  const drafts = candidates.filter((r) => isCampaignDraft(r));
  const reuse = (requestedId ? drafts.find((d) => d.id === requestedId) : undefined) ?? drafts[0] ?? null;
  return {
    blocked: null,
    reuse,
    obsolete: drafts.filter((d) => d.id !== reuse?.id),
  };
}

/** Die Spalten aus public.campaigns, die das Formular vorbelegen. */
export type CampaignDraftSettings = {
  name: string;
  mailboxes: string[] | null;
  days: number[] | null;
  send_window_start: string | null;
  send_window_end: string | null;
  timezone: string | null;
  daily_limit: number | null;
  open_tracking: boolean | null;
  link_tracking: boolean | null;
};

/** Eine Zeile aus public.campaign_steps, in der Reihenfolge von step_order. */
export type CampaignDraftStep = {
  wait_days: number | null;
  subject: string | null;
  body: string | null;
  variants: StepVariant[] | null;
};

/**
 * Genau die Felder von CampaignFormValue (app/instantly/campaigns/
 * campaign-form.tsx).
 *
 * Strukturell wiederholt statt importiert: campaign-form.tsx ist eine
 * "use client"-Komponente, und lib/** wird ohne DOM getestet. Dass beide
 * Formen zusammenpassen, prueft tsc an der Zuweisung im Formular -- weicht
 * eine ab, schlaegt npx tsc --noEmit dort fehl und nicht erst im Browser.
 */
export type CampaignDraftFormValue = {
  name: string;
  mailboxes: string[];
  steps: { variants: StepVariant[]; delayDays: number }[];
  days: number[];
  from: string;
  to: string;
  timezone: string;
  dailyLimit: string;
  openTracking: boolean;
  linkTracking: boolean;
};

/**
 * Der Entwurf, wie ihn das Kampagnenformular braucht.
 *
 * `leerwert` ist emptyCampaignFormValue() des Formulars und liefert alles,
 * was der Entwurf nicht beantwortet -- vor allem die Zeitzone des Browsers,
 * falls in der Zeile keine steht.
 */
export function campaignFormValueFromDraft(
  campaign: CampaignDraftSettings,
  steps: CampaignDraftStep[],
  leerwert: CampaignDraftFormValue
): CampaignDraftFormValue {
  return {
    name: campaign.name,
    // Leer, und das bleibt es: welche Postfaecher senden, entscheidet der
    // Mensch in der App (create_campaign legt bewusst keine an).
    mailboxes: campaign.mailboxes?.length ? campaign.mailboxes : [],
    steps: steps.length > 0 ? steps.map(schrittZuStufe) : leerwert.steps,
    days: campaign.days?.length ? campaign.days : leerwert.days,
    // Postgres liefert "09:00:00", <input type="time"> will "09:00".
    from: campaign.send_window_start ? toHhMm(campaign.send_window_start) : leerwert.from,
    to: campaign.send_window_end ? toHhMm(campaign.send_window_end) : leerwert.to,
    /**
     * Durch normalizeInstantlyTimezone, nicht roh uebernommen.
     *
     * Der Entwurf traegt die Vorgabe der Spalte, "Europe/Berlin" (Migration
     * 0001). Das Auswahlfeld im Formular kennt nur Instantlys kuratierte
     * Liste, und in der gibt es Berlin nicht (siehe
     * INSTANTLY_TIMEZONE_OPTIONS): ohne die Abbildung stuende dort eine leere
     * Auswahl, und der Nutzer muesste eine Einstellung nachziehen, die er nie
     * geaendert hat.
     */
    timezone: normalizeInstantlyTimezone(campaign.timezone || leerwert.timezone),
    dailyLimit: campaign.daily_limit != null ? String(campaign.daily_limit) : leerwert.dailyLimit,
    // Null (vor Migration 0071 angelegt) heisst hier "aus": beide Messungen
    // kosten Zustellbarkeit und werden nur eingeschaltet, wenn es jemand tut.
    openTracking: campaign.open_tracking === true,
    linkTracking: campaign.link_tracking === true,
  };
}

/** Eine gespeicherte Stufe als Formularstufe, mit demselben Rueckfall auf
 *  subject/body wie die Kampagnen-Detailseite: Zeilen von vor Migration 0071
 *  haben noch kein variants. */
function schrittZuStufe(s: CampaignDraftStep): { variants: StepVariant[]; delayDays: number } {
  return {
    variants: s.variants?.length ? s.variants : [{ subject: s.subject ?? "", body: s.body ?? "" }],
    delayDays: s.wait_days ?? 0,
  };
}
