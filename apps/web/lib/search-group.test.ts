import { describe, expect, it } from "vitest";
import {
  groupPickerOptions,
  groupScopeFilter,
  parentByChild,
  withChildIds,
} from "./search-group";

// Eine Gruppe (g1) mit zwei Teilsuchen, daneben eine gewoehnliche Einzelsuche.
const gruppe = { id: "g1", parent_search_id: null, is_search_group: true };
const kind1 = { id: "k1", parent_search_id: "g1", is_search_group: false };
const kind2 = { id: "k2", parent_search_id: "g1", is_search_group: false };
const einzeln = { id: "e1", parent_search_id: null, is_search_group: false };
const alle = [gruppe, kind1, kind2, einzeln];

describe("withChildIds", () => {
  it("haengt die Teilsuchen einer Gruppe an", () => {
    expect(withChildIds(["g1"], alle)).toEqual(["g1", "k1", "k2"]);
  });

  it("laesst eine Einzelsuche unveraendert", () => {
    expect(withChildIds(["e1"], alle)).toEqual(["e1"]);
  });

  it("nimmt jede ID nur einmal", () => {
    // Wer Gruppe UND Kind auswaehlt, darf das Kind nicht doppelt loeschen.
    expect(withChildIds(["g1", "k1"], alle)).toEqual(["g1", "k1", "k2"]);
  });

  it("kommt mit leerer Eingabe aus", () => {
    expect(withChildIds([], alle)).toEqual([]);
  });
});

describe("groupScopeFilter", () => {
  it("fasst Zeile und Kinder in einer or-Gruppe zusammen", () => {
    expect(groupScopeFilter(["g1", "e1"])).toBe(
      "id.in.(g1,e1),parent_search_id.in.(g1,e1)"
    );
  });
});

describe("parentByChild", () => {
  it("bildet nur Kinder ab", () => {
    expect(parentByChild(alle)).toEqual({ k1: "g1", k2: "g1" });
  });
});

describe("groupPickerOptions", () => {
  it("blendet Teilsuchen aus und laesst die Gruppe fuer sie stehen", () => {
    const optionen = groupPickerOptions(alle);
    expect(optionen.map((o) => o.row.id)).toEqual(["g1", "e1"]);
    // Der Kern: die Gruppe waehlt ihre Kinder aus, nicht sich selbst — an der
    // Huelle haengt keine einzige Firma.
    expect(optionen[0].searchIds).toEqual(["k1", "k2"]);
    expect(optionen[1].searchIds).toEqual(["e1"]);
  });

  it("laesst eine Gruppe ohne Teilsuchen weg", () => {
    // Kann entstehen, wenn die Kinder einzeln im Papierkorb gelandet sind.
    // Sie anzubieten hiesse, eine leere Auswahl als Liste auszugeben.
    expect(groupPickerOptions([gruppe, einzeln]).map((o) => o.row.id)).toEqual(["e1"]);
  });
});
