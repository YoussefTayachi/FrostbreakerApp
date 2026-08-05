import { describe, expect, it } from "vitest";
import { parseStepRef } from "./step-ref";

describe("parseStepRef", () => {
  it("liest die drei Stellen als Sequenz, Schritt, Variante", () => {
    expect(parseStepRef("0_0_0")).toEqual({ sequence: 0, step: 0, variant: 0 });
  });

  /** Der Beleg aus Kampagne 60b4b3ac: zwei Fassungen in Schritt 0. */
  it("erkennt die zweite Variante desselben Schritts", () => {
    expect(parseStepRef("0_0_1")).toEqual({ sequence: 0, step: 0, variant: 1 });
  });

  /** Der Beleg aus den Kampagnen mit versendetem Follow-up. */
  it("erkennt den zweiten Schritt", () => {
    expect(parseStepRef("0_1_0")).toEqual({ sequence: 0, step: 1, variant: 0 });
  });

  it("erkennt eine zweite Sequenz", () => {
    expect(parseStepRef("1_2_3")).toEqual({ sequence: 1, step: 2, variant: 3 });
  });

  it("kommt mit mehrstelligen Zahlen zurecht", () => {
    expect(parseStepRef("0_10_2")).toEqual({ sequence: 0, step: 10, variant: 2 });
  });

  it("ignoriert umgebende Leerzeichen", () => {
    expect(parseStepRef("  0_1_0  ")).toEqual({ sequence: 0, step: 1, variant: 0 });
  });

  /**
   * Der eigentliche Zweck der Tests: alles Unklare wird null, nicht 0.
   *
   * Eine stillschweigend auf 0 gesetzte Variante wuerde jede A/B-Auswertung
   * dauerhaft zugunsten von A verschieben, ohne dass es irgendwo auffaellt.
   */
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["Zahl statt Zeichenkette", 0],
    ["leer", ""],
    ["zu wenige Stellen", "0_0"],
    ["zu viele Stellen", "0_0_0_0"],
    ["leere Stelle", "0__0"],
    ["keine Ziffer", "0_a_0"],
    ["negativ", "0_-1_0"],
    ["Kommazahl", "0_1.5_0"],
    ["Leerzeichen innen", "0_ 1_0"],
  ])("gibt null bei: %s", (_name, input) => {
    expect(parseStepRef(input)).toBeNull();
  });
});
