/**
 * Die Kontakt-Prueflliste fuer den Personen-Befund: reine Logik, testbar.
 *
 * WARUM ES SIE GIBT
 *
 * Ein Absatz kommt aus zwei Gruenden in die Pruefung: die Quelle ist nicht
 * eindeutig an die Person gebunden (das Modell behauptet die Bindung, ein
 * Mensch bestaetigt sie), oder der Text verstoesst gegen Wortgrenze und
 * Verbotsliste. In beiden Faellen haelt der Upload den Kontakt zurueck
 * (splitByPersonFinding). Eine Rueckhaltung ohne Freigabe-Tuer waere eine
 * Sackgasse; diese Datei und die Route dazu sind die Tuer.
 *
 * Drei Handgriffe, wie bei der Aufhaenger-Prueflliste: freigeben, verwerfen,
 * selbst schreiben. Kein automatisches Kuerzen, aus demselben Grund wie dort.
 */
import { validateIcebreaker } from "@/lib/personalization-defaults";
import { PERSON_FINDING_MAX_WORDS, personBannedWords } from "@/lib/person-finding-defaults";

export type PersonReviewAction = "approve" | "discard" | "save";

/** Die Provenienz, wie der Worker sie schreibt (person_finding.py). */
export type PersonFindingSource = {
  angle?: string | null;
  claim?: string | null;
  source_kind?: string | null;
  source_url?: string | null;
  source_label?: string | null;
  age_months?: number | null;
  verbatim?: string | null;
  identity_anchor?: string | null;
  identity_evidence?: string | null;
  review_reason?: string | null;
  researched_at?: string | null;
};

export type PersonReviewRow = {
  id: string;
  full_name: string | null;
  title: string | null;
  email: string | null;
  person_finding: string | null;
  person_finding_needs_review: boolean | null;
  person_finding_source: PersonFindingSource | null;
  businesses: { name: string | null } | null;
};

/** Warum die Zeile in der Liste steht. */
export function reviewReason(source: PersonFindingSource | null | undefined): "unverified_anchor" | "rules" {
  return source?.review_reason === "unverified_anchor" ? "unverified_anchor" : "rules";
}

/**
 * Ein von Hand geschriebener Absatz gegen dieselben Regeln wie beim
 * Erzeugen: 60 Woerter, Striche aus der Workspace-Liste, die eigene
 * Liste je Sprache. Herkunftsnennung bleibt erlaubt.
 */
export function validatePersonFindingText(
  text: string,
  workspaceBanned: string[],
  lang: "de" | "en"
): string[] {
  return validateIcebreaker(text, PERSON_FINDING_MAX_WORDS, personBannedWords(workspaceBanned, lang), lang);
}

/**
 * Was eine Aktion in der Zeile aendert.
 *
 * approve  Text bleibt, Pruefflag weg. Die Antwort auf "die Bindung stimmt"
 *          oder "die Regel passt hier nicht", und die darf ein Mensch geben.
 * discard  Text weg, Status 'none' (recherchiert, nichts Brauchbares), die
 *          Provenienz bleibt mit dem Grund, damit man spaeter noch sieht,
 *          was verworfen wurde.
 * save     Neuer Text; das Pruefflag folgt den Regeln.
 */
export function personReviewPatch(
  action: PersonReviewAction,
  source: PersonFindingSource | null,
  text: string | undefined,
  problems: string[]
): Record<string, unknown> {
  if (action === "approve") {
    return { person_finding_needs_review: false };
  }
  if (action === "discard") {
    return {
      person_finding: null,
      person_finding_needs_review: false,
      person_finding_status: "none",
      person_finding_source: { ...(source ?? {}), review_reason: "discarded" },
    };
  }
  return {
    person_finding: (text ?? "").trim(),
    person_finding_needs_review: problems.length > 0,
    person_finding_source: {
      ...(source ?? {}),
      review_reason: problems.length > 0 ? "rules" : null,
      edited_by_hand: true,
    },
  };
}
