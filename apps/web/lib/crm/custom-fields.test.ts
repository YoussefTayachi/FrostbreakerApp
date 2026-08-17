import { describe, expect, it } from "vitest";
import {
  coerceValue,
  keyFromLabel,
  orphanedKeys,
  uniqueKey,
  visibleValues,
  type CustomFieldDef,
} from "./custom-fields";

function def(patch: Partial<CustomFieldDef> = {}): CustomFieldDef {
  return {
    id: "f1",
    entity: "contact",
    key: "branche",
    label: "Branche",
    field_type: "text",
    options: [],
    position: 0,
    ...patch,
  };
}

/** Muss zum CHECK in Migration 0067 passen. */
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

describe("keyFromLabel", () => {
  it("macht aus einer Beschriftung einen Schluessel", () => {
    expect(keyFromLabel("Branche")).toBe("branche");
    expect(keyFromLabel("Erwarteter Umsatz")).toBe("erwarteter_umsatz");
  });

  it("loest Umlaute auf", () => {
    expect(keyFromLabel("Größe")).toBe("groesse");
    expect(keyFromLabel("Zuständigkeit")).toBe("zustaendigkeit");
  });

  it("wirft Sonderzeichen raus, ohne Unterstriche zu haeufen", () => {
    expect(keyFromLabel("Umsatz (in €) / Jahr")).toBe("umsatz_in_jahr");
  });

  // Der Constraint verlangt einen Buchstaben am Anfang; ein Feld "2024"
  // waere sonst schlicht nicht anlegbar.
  it("stellt einen Buchstaben voran, wenn es mit einer Ziffer beginnt", () => {
    expect(keyFromLabel("2024 Ziel")).toBe("f_2024_ziel");
  });

  it("liefert nie einen leeren Schluessel", () => {
    expect(keyFromLabel("!!!")).toBe("feld");
    expect(keyFromLabel("")).toBe("feld");
  });

  it("haelt sich immer an den Constraint der Datenbank", () => {
    const labels = ["Branche", "Größe", "2024 Ziel", "!!!", "a".repeat(80), "Umsatz (in €)"];
    for (const l of labels) expect(keyFromLabel(l)).toMatch(KEY_RE);
  });
});

describe("uniqueKey", () => {
  it("nimmt den naheliegenden Schluessel, wenn er frei ist", () => {
    expect(uniqueKey("Branche", [])).toBe("branche");
  });

  it("haengt einen Zaehler an, wenn er vergeben ist", () => {
    expect(uniqueKey("Branche", ["branche"])).toBe("branche_2");
    expect(uniqueKey("Branche", ["branche", "branche_2"])).toBe("branche_3");
  });

  // Wuerde erst gekuerzt und dann gezaehlt, fiele der Zaehler weg und die
  // Kollision bliebe bestehen.
  it("bleibt auch bei langen Beschriftungen eindeutig und gueltig", () => {
    const long = "Sehr lange Beschriftung fuer ein eigenes Feld mit vielen Woertern";
    const first = uniqueKey(long, []);
    const second = uniqueKey(long, [first]);
    expect(second).not.toBe(first);
    expect(second).toMatch(KEY_RE);
  });
});

describe("coerceValue", () => {
  it("nimmt Text unveraendert, getrimmt", () => {
    expect(coerceValue(def(), "  Handel  ")).toEqual({ value: "Handel" });
  });

  it("wertet Leereingabe als nicht gesetzt, nicht als Fehler", () => {
    expect(coerceValue(def(), "")).toEqual({ value: null });
    expect(coerceValue(def({ field_type: "number" }), "   ")).toEqual({ value: null });
  });

  it("wandelt Zahlen um", () => {
    expect(coerceValue(def({ field_type: "number" }), "42")).toEqual({ value: 42 });
  });

  // In einer deutschsprachigen Oberflaeche tippt niemand einen Dezimalpunkt.
  it("akzeptiert das Komma als Dezimaltrennzeichen", () => {
    expect(coerceValue(def({ field_type: "number" }), "1234,50")).toEqual({ value: 1234.5 });
  });

  it("meldet eine unbrauchbare Zahl", () => {
    expect(coerceValue(def({ field_type: "number" }), "abc")).toEqual({ error: "not_a_number" });
  });

  it("nimmt ein ISO-Datum", () => {
    expect(coerceValue(def({ field_type: "date" }), "2026-08-03")).toEqual({ value: "2026-08-03" });
  });

  it("weist alles ab, was kein ISO-Datum ist", () => {
    expect(coerceValue(def({ field_type: "date" }), "03.08.2026")).toEqual({ error: "not_a_date" });
    expect(coerceValue(def({ field_type: "date" }), "2026-13-45")).toEqual({ error: "not_a_date" });
  });

  it("laesst bei Auswahlfeldern nur vorgesehene Werte zu", () => {
    const d = def({ field_type: "select", options: ["A", "B"] });
    expect(coerceValue(d, "A")).toEqual({ value: "A" });
    expect(coerceValue(d, "C")).toEqual({ error: "not_an_option" });
  });
});

describe("visibleValues", () => {
  it("sortiert nach Position", () => {
    const defs = [def({ key: "b", position: 2 }), def({ key: "a", position: 1 })];
    expect(visibleValues(defs, {}).map((v) => v.def.key)).toEqual(["a", "b"]);
  });

  it("zeigt ein Feld ohne Wert als leer statt es wegzulassen", () => {
    expect(visibleValues([def()], {})).toEqual([{ def: def(), value: null }]);
  });

  // Ein Wert ohne Feldnamen ist keine Information; deshalb wird er nicht
  // angezeigt, bleibt aber in der Datenbank stehen.
  it("zeigt Werte ohne Definition nicht an", () => {
    const shown = visibleValues([def({ key: "branche" })], { branche: "Handel", alt: "x" });
    expect(shown).toHaveLength(1);
    expect(shown[0].value).toBe("Handel");
  });
});

describe("orphanedKeys", () => {
  it("findet Werte ohne Definition", () => {
    expect(orphanedKeys([def({ key: "branche" })], { branche: "Handel", alt: "x" })).toEqual(["alt"]);
  });

  it("meldet nichts, wenn alles zugeordnet ist", () => {
    expect(orphanedKeys([def({ key: "branche" })], { branche: "Handel" })).toEqual([]);
  });

  it("kommt mit leeren Werten klar", () => {
    expect(orphanedKeys([def()], {})).toEqual([]);
  });
});
