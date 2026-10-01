import { describe, expect, it } from "vitest";
import { bouncedEmails, needsBounceSync } from "./bounce-sync";

describe("needsBounceSync", () => {
  it("fragt nur bei neuen Bounces nach", () => {
    expect(needsBounceSync(2, 0)).toBe(true);
    expect(needsBounceSync(2, 2)).toBe(false);
    expect(needsBounceSync(0, null)).toBe(false);
    expect(needsBounceSync(null, null)).toBe(false);
  });
});

describe("bouncedEmails", () => {
  it("nimmt nur status -1, auch wenn Instantly den Filter ignoriert hat", () => {
    expect(
      bouncedEmails([
        { email: "a@shop.com", status: -1 },
        { email: "b@shop.com", status: 1 },
        { email: "c@shop.com", status: 3 },
      ])
    ).toEqual(["a@shop.com"]);
  });

  it("schreibt klein und entfernt Doppelte", () => {
    expect(bouncedEmails([{ email: " Anna@Shop.com ", status: -1 }, { email: "anna@shop.com", status: -1 }])).toEqual([
      "anna@shop.com",
    ]);
  });

  it("ignoriert Leads ohne Adresse", () => {
    expect(bouncedEmails([{ email: null, status: -1 }])).toEqual([]);
  });
});
