import { describe, expect, it } from "vitest";
import { personReviewPatch, reviewReason, validatePersonFindingText } from "./review";

describe("reviewReason", () => {
  it("unterscheidet unbestaetigte Bindung von Regelverstoss", () => {
    expect(reviewReason({ review_reason: "unverified_anchor" })).toBe("unverified_anchor");
    expect(reviewReason({ review_reason: "rules" })).toBe("rules");
    expect(reviewReason(null)).toBe("rules");
  });
});

describe("validatePersonFindingText", () => {
  // Der Grund fuer die eigene Liste: die Herkunftsnennung bleibt erlaubt.
  it("erlaubt die Herkunftsnennung trotz Workspace-Verbot", () => {
    const text = "On LinkedIn you wrote that trust is the currency. Email gets opened by 25 percent.";
    expect(validatePersonFindingText(text, ["I saw", "—"], "en")).toEqual([]);
  });

  it("verbietet Abschwaecher und Striche", () => {
    const probleme = validatePersonFindingText("I think this — probably matters.", ["—"], "en");
    expect(probleme.length).toBeGreaterThan(0);
  });

  it("haelt den Deckel von 120 Woertern", () => {
    const lang = Array.from({ length: 121 }, () => "word").join(" ");
    expect(validatePersonFindingText(lang, [], "en").length).toBeGreaterThan(0);
  });
});

describe("personReviewPatch", () => {
  const source = { angle: "statement", review_reason: "unverified_anchor" };

  it("approve laesst den Text stehen und nimmt das Flag", () => {
    expect(personReviewPatch("approve", source, undefined, [])).toEqual({ person_finding_needs_review: false });
  });

  it("discard loescht den Text, behaelt die Provenienz mit Grund", () => {
    const patch = personReviewPatch("discard", source, undefined, []);
    expect(patch.person_finding).toBeNull();
    expect(patch.person_finding_status).toBe("none");
    expect(patch.person_finding_needs_review).toBe(false);
    expect((patch.person_finding_source as { review_reason: string }).review_reason).toBe("discarded");
    expect((patch.person_finding_source as { angle: string }).angle).toBe("statement");
  });

  it("save schreibt den Text, Flag folgt den Regeln", () => {
    const sauber = personReviewPatch("save", source, "  Neuer Absatz.  ", []);
    expect(sauber.person_finding).toBe("Neuer Absatz.");
    expect(sauber.person_finding_needs_review).toBe(false);
    expect((sauber.person_finding_source as { review_reason: string | null }).review_reason).toBeNull();
    const kaputt = personReviewPatch("save", source, "x", ["zu lang"]);
    expect(kaputt.person_finding_needs_review).toBe(true);
    expect((kaputt.person_finding_source as { review_reason: string }).review_reason).toBe("rules");
  });
});
