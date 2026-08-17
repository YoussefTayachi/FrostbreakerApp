import type { EmailContent, EmailQualityReport, Lang } from "./types";
import { checkReadability } from "./readability";
import { checkSpamTriggers } from "./spam-triggers";
import { checkAiSounding } from "./ai-sounding";

export * from "./types";
export * from "./highlights";
export { checkReadability } from "./readability";
export { checkSpamTriggers } from "./spam-triggers";
export { checkAiSounding } from "./ai-sounding";

/**
 * Alle drei Pruefungen in einem Durchlauf. Reine Funktion ohne Netzwerk oder
 * Secrets — laeuft deshalb direkt im Browser waehrend des Tippens, statt wie
 * der Deliverability-Check (lib/deliverability.ts) einen Serverweg zu
 * brauchen.
 */
export function runEmailQualityCheck(content: EmailContent, lang: Lang): EmailQualityReport {
  return {
    lang,
    readability: checkReadability(content.body, lang),
    spam: checkSpamTriggers(content, lang),
    aiSounding: checkAiSounding(content, lang),
  };
}

/** Ob ueberhaupt genug Text fuer eine Aussage da ist (steuert das Rendern des Panels). */
export function hasAnalyzableContent(content: EmailContent): boolean {
  return content.subject.trim().length > 0 || content.body.trim().length > 0;
}
