import { describe, expect, it } from "vitest";
import {
  allowedWorkspaceIds,
  assertWorkspaceAllowed,
  isTokenUsable,
  requireScope,
  SCOPE_DENIED_MESSAGE,
  WORKSPACE_DENIED_MESSAGE,
  type McpTokenRow,
} from "./authorize";

/**
 * Der wichtigste Test dieses Features.
 *
 * Der MCP-Server laeuft mit Service-Role und umgeht RLS -- die Datenbank sagt
 * hier nicht mehr nein. Was diese Funktionen durchlassen, geht raus. Ein
 * Fehler waere kein Absturz, sondern das stille Ausliefern der Daten eines
 * fremden Kunden an ein fremdes Modell.
 */

const WS_A = "11111111-1111-1111-1111-111111111111";
const WS_B = "22222222-2222-2222-2222-222222222222";
const WS_FREMD = "33333333-3333-3333-3333-333333333333";

function token(overrides: Partial<McpTokenRow> = {}): McpTokenRow {
  return {
    id: "tok-1",
    user_id: "user-1",
    workspace_id: null,
    scope: "read",
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe("isTokenUsable", () => {
  const now = new Date("2026-08-22T12:00:00Z");

  it("nimmt einen Token ohne Ablauf und ohne Widerruf", () => {
    expect(isTokenUsable(token(), now)).toBe(true);
  });

  it("lehnt einen widerrufenen Token ab", () => {
    expect(isTokenUsable(token({ revoked_at: "2026-08-01T00:00:00Z" }), now)).toBe(false);
  });

  it("lehnt einen abgelaufenen Token ab", () => {
    expect(isTokenUsable(token({ expires_at: "2026-08-21T23:59:59Z" }), now)).toBe(false);
  });

  it("nimmt einen Token, dessen Ablauf in der Zukunft liegt", () => {
    expect(isTokenUsable(token({ expires_at: "2026-08-23T00:00:00Z" }), now)).toBe(true);
  });

  it("behandelt ein unlesbares Ablaufdatum als abgelaufen", () => {
    // Fail closed: bei einem kaputten Wert ist "gilt nicht mehr" die einzige
    // Antwort, die nicht zu viel erlaubt.
    expect(isTokenUsable(token({ expires_at: "keine Zeitangabe" }), now)).toBe(false);
  });

  it("laesst den Widerruf vor dem Ablauf gewinnen", () => {
    const row = token({ revoked_at: "2026-08-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z" });
    expect(isTokenUsable(row, now)).toBe(false);
  });
});

describe("allowedWorkspaceIds", () => {
  it("gibt ohne Token-Einschraenkung alle Mitgliedschaften zurueck", () => {
    expect(allowedWorkspaceIds([WS_A, WS_B], null)).toEqual([WS_A, WS_B]);
  });

  it("schraenkt auf den einen Workspace ein, wenn der Token das sagt", () => {
    expect(allowedWorkspaceIds([WS_A, WS_B], WS_B)).toEqual([WS_B]);
  });

  it("ergibt LEER, wenn der Mensch im Workspace des Tokens kein Mitglied (mehr) ist", () => {
    // Der Kern der ganzen Konstruktion: die Einschraenkung addiert nichts.
    expect(allowedWorkspaceIds([WS_A], WS_FREMD)).toEqual([]);
  });

  it("ergibt LEER ohne jede Mitgliedschaft, auch ohne Token-Einschraenkung", () => {
    expect(allowedWorkspaceIds([], null)).toEqual([]);
  });

  it("ergibt LEER ohne jede Mitgliedschaft, auch mit Token-Einschraenkung", () => {
    expect(allowedWorkspaceIds([], WS_A)).toEqual([]);
  });

  it("behandelt einen leeren String wie keine Einschraenkung", () => {
    expect(allowedWorkspaceIds([WS_A], "")).toEqual([WS_A]);
  });

  it("entfernt Dubletten", () => {
    expect(allowedWorkspaceIds([WS_A, WS_A, WS_B], null)).toEqual([WS_A, WS_B]);
  });

  it("wirft nicht-string-Eintraege weg", () => {
    const dreck = [WS_A, null, undefined, 42] as unknown as string[];
    expect(allowedWorkspaceIds(dreck, null)).toEqual([WS_A]);
  });
});

describe("assertWorkspaceAllowed", () => {
  it("laesst einen erlaubten Workspace durch", () => {
    const result = assertWorkspaceAllowed([WS_A, WS_B], WS_A);
    expect(result).toEqual({ ok: true, workspaceId: WS_A });
  });

  it("lehnt einen nicht erlaubten Workspace ab", () => {
    const result = assertWorkspaceAllowed([WS_A], WS_B);
    expect(result.ok).toBe(false);
  });

  it("gibt fuer 'existiert nicht' und 'keine Berechtigung' DENSELBEN Text", () => {
    // Sonst waere die Antwort ein Orakel: wer fremde UUIDs durchprobiert,
    // koennte daraus ablesen, welche Workspaces es gibt.
    const nichtErlaubt = assertWorkspaceAllowed([WS_A], WS_B);
    const gibtEsNicht = assertWorkspaceAllowed([WS_A], "00000000-0000-0000-0000-000000000000");
    expect(nichtErlaubt.ok).toBe(false);
    expect(gibtEsNicht.ok).toBe(false);
    if (!nichtErlaubt.ok && !gibtEsNicht.ok) {
      expect(nichtErlaubt.message).toBe(gibtEsNicht.message);
      expect(nichtErlaubt.message).toBe(WORKSPACE_DENIED_MESSAGE);
    }
  });

  it("lehnt fehlende und falsch getypte Angaben mit demselben Text ab", () => {
    for (const eingabe of [undefined, null, 42, {}, [], ""]) {
      const result = assertWorkspaceAllowed([WS_A], eingabe);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toBe(WORKSPACE_DENIED_MESSAGE);
    }
  });

  it("lehnt bei leerer Erlaubnisliste jeden Workspace ab", () => {
    expect(assertWorkspaceAllowed([], WS_A).ok).toBe(false);
  });

  it("erlaubt Leerraum um die ID herum", () => {
    const result = assertWorkspaceAllowed([WS_A], `  ${WS_A}  `);
    expect(result).toEqual({ ok: true, workspaceId: WS_A });
  });
});

describe("requireScope", () => {
  it("laesst read mit einem read-Token zu", () => {
    expect(requireScope("read", "read")).toBe(true);
  });

  it("laesst read mit einem read_write-Token zu", () => {
    expect(requireScope("read_write", "read")).toBe(true);
  });

  it("verweigert read_write mit einem read-Token", () => {
    expect(requireScope("read", "read_write")).toBe(false);
  });

  it("laesst read_write mit einem read_write-Token zu", () => {
    expect(requireScope("read_write", "read_write")).toBe(true);
  });

  it("behandelt einen unbekannten Wert als 'reicht nicht'", () => {
    expect(requireScope("admin", "read")).toBe(false);
    expect(requireScope("admin", "read_write")).toBe(false);
  });

  it("hat eine Fehlermeldung, die den Weg aus der App heraus nennt", () => {
    expect(SCOPE_DENIED_MESSAGE).toContain("read_write");
  });
});
