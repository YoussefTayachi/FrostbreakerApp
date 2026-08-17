import { describe, expect, it } from "vitest";
import {
  FILTER_ALL,
  FILTER_NO_FOLDER,
  matchesSearchFilter,
  type SearchListRow,
} from "./search-list";

const basis: SearchListRow = {
  id: "1", name: "Netherlands E-Com WhatsApp", query: "ecommerce", location: "Netherlands",
  source: "apollo", status: "completed", error: null, note: null, schedule: "none",
  max_results: 50, target_email_count: 50, created_at: "2026-08-09T12:09:00Z",
  archived_at: null, folder_id: null,
  businesses: 39, businesses_done: 39, contacts: 47, with_email: 47,
  is_search_group: false, child_count: 0, children_done: 0, children_failed: 0,
};
const offen = { q: "", quelle: "", status: "", ordner: FILTER_ALL };

describe("matchesSearchFilter", () => {
  it("laesst ohne Filter alles durch", () => {
    expect(matchesSearchFilter(basis, offen)).toBe(true);
  });

  it("findet ueber den Namen, unabhaengig von Gross-/Kleinschreibung", () => {
    expect(matchesSearchFilter(basis, { ...offen, q: "whatsapp" })).toBe(true);
    expect(matchesSearchFilter(basis, { ...offen, q: "WhatsApp" })).toBe(true);
  });

  it("findet auch ueber den Ort", () => {
    // Wer "Netherlands" tippt, meint die niederlaendische Liste — auch wenn
    // das Wort zufaellig nicht im Namen steht.
    const ohneOrtImNamen = { ...basis, name: "E-Com WhatsApp" };
    expect(matchesSearchFilter(ohneOrtImNamen, { ...offen, q: "netherlands" })).toBe(true);
  });

  it("findet ueber den Suchbegriff", () => {
    expect(matchesSearchFilter(basis, { ...offen, q: "ecommerce" })).toBe(true);
  });

  it("filtert nach Quelle", () => {
    expect(matchesSearchFilter(basis, { ...offen, quelle: "apollo" })).toBe(true);
    expect(matchesSearchFilter(basis, { ...offen, quelle: "maps" })).toBe(false);
  });

  it("fasst pending und running zu 'laeuft' zusammen", () => {
    // Der Unterschied interessiert nur den Worker.
    expect(matchesSearchFilter({ ...basis, status: "pending" }, { ...offen, status: "running" })).toBe(true);
    expect(matchesSearchFilter({ ...basis, status: "running" }, { ...offen, status: "running" })).toBe(true);
    expect(matchesSearchFilter(basis, { ...offen, status: "running" })).toBe(false);
  });

  it("unterscheidet 'Alle' von 'Ohne Ordner'", () => {
    const imOrdner = { ...basis, folder_id: "f1" };
    expect(matchesSearchFilter(imOrdner, { ...offen, ordner: FILTER_ALL })).toBe(true);
    expect(matchesSearchFilter(imOrdner, { ...offen, ordner: FILTER_NO_FOLDER })).toBe(false);
    expect(matchesSearchFilter(basis, { ...offen, ordner: FILTER_NO_FOLDER })).toBe(true);
    expect(matchesSearchFilter(imOrdner, { ...offen, ordner: "f1" })).toBe(true);
    expect(matchesSearchFilter(imOrdner, { ...offen, ordner: "f2" })).toBe(false);
  });

  it("verbindet mehrere Filter mit UND", () => {
    const treffer = { ...offen, q: "whatsapp", quelle: "apollo", status: "completed" };
    expect(matchesSearchFilter(basis, treffer)).toBe(true);
    expect(matchesSearchFilter(basis, { ...treffer, quelle: "prospeo" })).toBe(false);
  });

  it("beachtet das Archiv NICHT -- das trennt die Liste selbst", () => {
    // Sonst waere ein archivierter Treffer bei aktiver Textsuche unsichtbar,
    // und genau danach sucht man ("wo ist die Liste hin?").
    const archiviert = { ...basis, archived_at: "2026-08-10T09:00:00Z" };
    expect(matchesSearchFilter(archiviert, { ...offen, q: "whatsapp" })).toBe(true);
  });
});
