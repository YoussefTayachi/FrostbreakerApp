import { describe, expect, it } from "vitest";
import { needsNeverBounce } from "./email-verification";

const base = { email: "anna@shop.com", email_verification_status: null, sources: ["apollo"] };

describe("needsNeverBounce", () => {
  it("prueft Apollo-Adressen trotz Apollos eigenem 'verified'", () => {
    expect(needsNeverBounce({ ...base, email_verification_status: "verified" })).toBe(true);
  });

  it("prueft nichts zweimal, was NeverBounce schon geprueft hat", () => {
    expect(
      needsNeverBounce({ ...base, email_verification_status: "catchall", email_verified_by: "neverbounce" })
    ).toBe(false);
  });

  it("prueft keine Adresse, die bei Instantly schon gebounct ist", () => {
    expect(
      needsNeverBounce({ ...base, email_verification_status: "invalid", email_verified_by: "instantly_bounce" })
    ).toBe(false);
  });

  it("laesst Hunter-Status stehen, damit nichts doppelt bezahlt wird", () => {
    expect(needsNeverBounce({ ...base, email_verification_status: "valid", sources: ["hunter"] })).toBe(false);
  });

  it("prueft jede Adresse ohne Status, egal woher", () => {
    expect(needsNeverBounce({ ...base, sources: ["manual"] })).toBe(true);
  });

  it("ohne Adresse gibt es nichts zu pruefen", () => {
    expect(needsNeverBounce({ ...base, email: null })).toBe(false);
  });
});
