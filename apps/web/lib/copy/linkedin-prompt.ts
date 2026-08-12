/**
 * Eine LinkedIn-Vorlage aus demselben Angebot.
 *
 * WARUM DAS HIER UEBERHAUPT AUFTAUCHT
 *
 * Dieselben Leads ueber LinkedIn anzuschreiben kostet keinen einzigen
 * zusaetzlichen Credit -- die Kontakte sind schon gekauft. Die Verkettung
 * dahin gibt es seit Migration 0074/0082. Was fehlte, war auch hier der Text:
 * die LinkedIn-Arbeitsliste startet mit einer leeren Vorlage, genau wie die
 * Mail-Kampagne.
 *
 * WAS ANDERS IST ALS BEI DER MAIL
 *
 * Kein Betreff, kein Link, und vor allem: viel kuerzer. Eine Kontaktanfrage
 * bei LinkedIn hat 300 Zeichen -- nicht 300 Woerter. Eine Mail-Eroeffnung
 * dort hineinzukopieren ergibt einen abgeschnittenen Satz.
 */
import { LINKEDIN_PLACEHOLDERS } from "@/lib/crm/linkedin-message";
import type { Offer } from "@/lib/offers";

/** LinkedIns Grenze fuer die Nachricht an einer Kontaktanfrage. Gemessen am
 *  Feld selbst, nicht geschaetzt: laengere Texte nimmt das Formular nicht an. */
export const LINKEDIN_MAX_CHARS = 300;

const LANGUAGE_NAMES: Record<string, string> = { de: "German", en: "English" };

export function buildLinkedInPrompt(offer: Offer): string {
  const sprache = LANGUAGE_NAMES[offer.language] ?? "German";
  const lines: string[] = [
    "You write ONE short LinkedIn connection message for cold outreach.",
    "",
    "THE OFFER:",
    `What they sell: ${offer.offering.trim() || "(not specified)"}`,
    `Who they sell to: ${offer.icp.trim() || "(not specified)"}`,
    `Problem before: ${offer.problem.trim() || "(not specified, do not assert one)"}`,
    `Outcome after: ${offer.outcome.trim() || "(not specified, do not promise one)"}`,
    offer.proof.trim()
      ? `Proof they may cite: ${offer.proof.trim()}`
      : "They have NO proof. Never mention clients, numbers, results or years of experience.",
    offer.tone.trim() ? `Tone notes: ${offer.tone.trim()}` : "Tone: direct, plain, business-like.",
    "",
    "HARD RULES:",
    `- Write in ${sprache}.`,
  ];

  if (offer.language === "de") {
    lines.push(
      offer.address_form === "sie"
        ? '- Address the reader formally ("Sie").'
        : '- Address the reader informally ("du").'
    );
  }

  lines.push(
    // Die Zeichengrenze ist der ganze Unterschied zur Mail. Wird sie
    // ueberschritten, schneidet LinkedIn ab -- mitten im Satz.
    `- HARD LIMIT: ${LINKEDIN_MAX_CHARS} characters INCLUDING the placeholders. Count them. This is a connection request, not an email.`,
    "- No subject line. No greeting formula longer than two words. No signature.",
    "- No link, no URL, no phone number.",
    `- Placeholders: only ${LINKEDIN_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}. Any other {{...}} reaches the recipient unfilled.`,
    "- {{personalization}} is a researched opening line of about 20 words. If you use it, budget for that length.",
    "- Never use the characters — – or --.",
    "- End with a small question that is easy to answer. Do not ask for a call.",
    "",
    "Answer with the message text only. No JSON, no quotes, no explanation."
  );

  return lines.join("\n");
}

/**
 * Die Antwort auf eine benutzbare Vorlage zurechtstutzen.
 *
 * Anfuehrungszeichen und ein vorangestelltes "Nachricht:" liefert das Modell
 * regelmaessig mit -- beides wuerde woertlich in der Vorlage landen. Gekuerzt
 * wird NICHT: eine mitten im Satz abgeschnittene Nachricht sieht aus wie ein
 * Fehler der App. Zu lange Antworten meldet stattdessen die Route.
 */
export function cleanLinkedInMessage(raw: string): string {
  return raw
    .trim()
    .replace(/^(nachricht|message|text)\s*:\s*/i, "")
    .replace(/^["'„“](.*)["'“”]$/s, "$1")
    .trim();
}

/** Laenge, wie LinkedIn sie zaehlt: der Aufhaenger wird beim Versand ersetzt
 *  und ist dann rund zwanzig Woerter lang -- deshalb zaehlt er hier mit
 *  seiner geschaetzten Endlaenge, nicht mit den 19 Zeichen des Platzhalters. */
export function estimateLinkedInLength(text: string, personalizationWords: number): number {
  const AVG_WORT_ZEICHEN = 6;
  return text.replace(/\{\{personalization\}\}/g, "x".repeat(personalizationWords * AVG_WORT_ZEICHEN))
    .replace(/\{\{\s*[^}]+\s*\}\}/g, "xxxxxxxx")
    .length;
}
