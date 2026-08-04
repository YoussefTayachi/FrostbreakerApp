/**
 * Der Waechter: was im laufenden Betrieb die Zustellbarkeit kaputtmacht.
 *
 * Der Torwart (lib/campaign-readiness.ts) prueft EINMAL, beim Anlegen.
 * Danach passiert das Wichtigste: die Kampagne laeuft Wochen, die Liste
 * arbeitet sich ab, und irgendwann kippt etwas. Am 2026-08-04 hatte eine
 * Kampagne 6 Bounces auf 30 Mails -- 20 Prozent, und niemand hat es gesehen,
 * weil niemand hinschaut, solange nichts blinkt.
 *
 * Hier stehen die beiden Entscheidungen, die ein Programm treffen darf:
 * wann eine Absender-Domain als kaputt gilt, und wann eine Kampagne
 * angehalten gehoert. Reine Logik, damit beides pruefbar ist -- es sind
 * Eingriffe in laufende Arbeit, und die will man nicht aus Versehen ausloesen.
 */
import { BOUNCE_BLOCK_RATE, BOUNCE_MIN_SAMPLE } from "./campaign-readiness";

export type DomainCheck = {
  domain: string;
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
};

/**
 * Was von einer Domain zwingend da sein muss.
 *
 * SPF und DKIM: ohne sie landet die Mail im Spam, und der Ruf der Domain
 * traegt es dauerhaft mit. DMARC bleibt bewusst aussen vor -- es ist wichtig,
 * aber eine Mail ohne DMARC wird nicht zwingend abgewiesen, und ein Alarm,
 * der taeglich fuer etwas Nicht-Dringendes schrillt, erzieht dazu, Alarme zu
 * ignorieren. Dieselbe Trennung wie beim Torwart, aus demselben Grund.
 */
export function domainIsBroken(check: DomainCheck): boolean {
  return !check.spf || !check.dkim;
}

/** Was sich seit der letzten Pruefung geaendert hat. */
export type DomainChange = "still_ok" | "broke" | "recovered" | "still_broken";

/**
 * Gemeldet wird nur der UEBERGANG, nicht der Zustand.
 *
 * Eine Domain, die seit drei Wochen kein DKIM hat, jeden Tag erneut zu melden
 * waere die zuverlaessigste Art, dafuer zu sorgen, dass die Meldung
 * weggeklickt wird -- und mit ihr die vom Tag, an dem etwas Neues passiert.
 * Der Alarm bleibt derweil offen sichtbar (provider_alerts), er wird nur
 * nicht noch einmal verschickt.
 */
export function domainChange(previous: DomainCheck | null, current: DomainCheck): DomainChange {
  const brokenNow = domainIsBroken(current);
  // Ohne Vorgeschichte gilt der aktuelle Zustand als Neuigkeit -- beim
  // allerersten Lauf soll eine kaputte Domain gemeldet werden, nicht erst
  // beim naechsten Wechsel.
  const brokenBefore = previous ? domainIsBroken(previous) : false;
  if (brokenNow && !brokenBefore) return "broke";
  if (!brokenNow && brokenBefore) return "recovered";
  return brokenNow ? "still_broken" : "still_ok";
}

export type CampaignBounceState = {
  campaignId: string;
  name: string;
  /** Instantlys Kampagnen-ID -- die braucht das Anhalten. */
  instantlyCampaignId: string;
  sent: number;
  bounced: number;
  /** Laeuft sie ueberhaupt? Eine pausierte nochmal zu pausieren ist sinnlos. */
  active: boolean;
};

export type BounceVerdict = {
  campaignId: string;
  name: string;
  instantlyCampaignId: string;
  rate: number;
  bounced: number;
  sent: number;
  /** Anhalten -- nur bei aktiven Kampagnen ueber der Schwelle mit genug Grundlage. */
  shouldPause: boolean;
};

/**
 * Welche Kampagnen angehalten gehoeren.
 *
 * Dieselbe Schwelle wie beim Torwart (5 Prozent, ab 50 Sendungen) und
 * absichtlich aus derselben Konstante: zwei Zahlen fuer dieselbe Frage
 * driften auseinander, und dann blockiert der Torwart etwas, das der
 * Waechter durchgehen laesst.
 *
 * Angehalten wird je Kampagne, nicht je Workspace. Der Ruf haengt zwar an der
 * Domain und damit am Workspace, aber alles anzuhalten, weil EINE Liste
 * schlecht ist, waere eine Kollektivstrafe fuer ein Problem mit bekanntem
 * Verursacher.
 */
export function assessBounces(campaigns: CampaignBounceState[]): BounceVerdict[] {
  return campaigns.map((c) => {
    const rate = c.sent > 0 ? c.bounced / c.sent : 0;
    return {
      campaignId: c.campaignId,
      name: c.name,
      instantlyCampaignId: c.instantlyCampaignId,
      rate,
      bounced: c.bounced,
      sent: c.sent,
      shouldPause: c.active && c.sent >= BOUNCE_MIN_SAMPLE && rate >= BOUNCE_BLOCK_RATE,
    };
  });
}

/**
 * Wie lange eine DNS-Pruefung gilt.
 *
 * Einmal am Tag. Ein DNS-Eintrag aendert sich nicht im Minutentakt, und der
 * Cron laeuft jede Minute -- ohne diese Bremse waeren es 1440 Abfragen je
 * Domain und Tag fuer eine Antwort, die sich fast nie aendert.
 */
export const DOMAIN_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function domainCheckDue(checkedAt: string | null, now: number): boolean {
  if (!checkedAt) return true;
  return now - new Date(checkedAt).getTime() >= DOMAIN_CHECK_INTERVAL_MS;
}
