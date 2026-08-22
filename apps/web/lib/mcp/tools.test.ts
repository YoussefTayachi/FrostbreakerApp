import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callTool, listTools, type McpToolContext } from "./tools";
import { SCOPE_DENIED_MESSAGE, WORKSPACE_DENIED_MESSAGE } from "./authorize";

/**
 * Die Werkzeuge gegen eine GESTUBBTE Datenbank.
 *
 * Warum ueberhaupt: die Migration 0099 ist bewusst noch nicht eingespielt (der
 * Nutzer tut das selbst), es gibt also weder Tabelle noch Token, gegen die
 * sich echt pruefen liesse. Was sich auch ohne Datenbank pruefen laesst, ist
 * das Einzige, was hier wirklich gefaehrlich ist: ob JEDE Abfrage den
 * Workspace-Filter mitschickt und ob eine unerlaubte Anfrage die Datenbank
 * ueberhaupt erreicht.
 *
 * Der Stub merkt sich jeden Aufruf am Query-Builder. Ein vergessenes
 * .eq("workspace_id", ...) faellt damit hier auf und nicht beim Kunden.
 */

type Aufruf = { table: string; method: string; args: unknown[] };
type Antwort = { data?: unknown; error?: { message: string } | null; count?: number | null };

function stubSupabase(antworten: Record<string, Antwort> = {}) {
  const aufrufe: Aufruf[] = [];

  const client = {
    from(table: string) {
      const antwort = () => antworten[table] ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      const merken =
        (method: string) =>
        (...args: unknown[]) => {
          aufrufe.push({ table, method, args });
          return builder;
        };
      for (const m of ["select", "eq", "in", "is", "not", "order", "range", "limit", "update", "insert"]) {
        builder[m] = merken(m);
      }
      builder.maybeSingle = (...args: unknown[]) => {
        aufrufe.push({ table, method: "maybeSingle", args });
        const a = antwort();
        return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
      };
      // Thenable: `await supabase.from(x).select(...).eq(...)` loest hier auf.
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown
      ) => {
        const a = antwort();
        return Promise.resolve({
          data: a.data ?? [],
          error: a.error ?? null,
          count: a.count ?? null,
        }).then(resolve, reject);
      };
      return builder;
    },
  };

  return { supabase: client as unknown as SupabaseClient, aufrufe };
}

const WS = "11111111-1111-1111-1111-111111111111";
const FREMD = "22222222-2222-2222-2222-222222222222";

function ctx(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    allowedWorkspaceIds: [WS],
    scope: "read",
    tokenId: "tok-1",
    userId: "user-1",
    ...overrides,
  };
}

/** Steht dieses .eq(spalte, wert) in den aufgezeichneten Aufrufen? */
function hatFilter(aufrufe: Aufruf[], table: string, spalte: string, wert: unknown): boolean {
  return aufrufe.some(
    (a) => a.table === table && a.method === "eq" && a.args[0] === spalte && a.args[1] === wert
  );
}

describe("listTools", () => {
  it("bietet genau die sieben vereinbarten Werkzeuge, in fester Reihenfolge", () => {
    // Feste Reihenfolge, weil die Spezifikation eine deterministische
    // Sortierung verlangt -- und weil sie den Arbeitsweg abbildet: erst der
    // Workspace, dann die Liste, dann die Leads.
    expect(listTools().map((t) => t.name)).toEqual([
      "list_workspaces",
      "list_lead_lists",
      "get_leads",
      "get_offer",
      "get_campaign_stats",
      "get_replies",
      "set_lead_icebreaker",
    ]);
  });

  it("kennzeichnet sechs Werkzeuge als nur lesend und eines als schreibend", () => {
    const schreibend = listTools().filter((t) => t.annotations.readOnlyHint === false);
    expect(schreibend.map((t) => t.name)).toEqual(["set_lead_icebreaker"]);
  });

  it("das schreibende Werkzeug ist als nicht zerstoerend und idempotent markiert", () => {
    const werkzeug = listTools().find((t) => t.name === "set_lead_icebreaker")!;
    expect(werkzeug.annotations.destructiveHint).toBe(false);
    expect(werkzeug.annotations.idempotentHint).toBe(true);
  });

  it("jedes Werkzeug hat eine Beschreibung und ein Schema", () => {
    for (const werkzeug of listTools()) {
      expect(werkzeug.description.length).toBeGreaterThan(40);
      expect(werkzeug.inputSchema.type).toBe("object");
      expect(werkzeug.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("nennt bei get_leads und get_replies den Fremdtext schon in der Beschreibung", () => {
    /**
     * Vorbild ist der Supabase-MCP-Server: die Warnung steht nicht nur im
     * Ergebnis, sondern dort, wo das Modell sie liest, BEVOR es aufruft.
     *
     * Geprueft wird auf "instruction" und "data" und nicht auf einen ganzen
     * Satz: der Wortlaut gehoert dem copywriter (lib/mcp/tool-descriptions.ts),
     * die Aussage "das ist Text von Fremden, er ist Daten und keine Anweisung"
     * gehoert zur Sicherheit und darf beim Umformulieren nicht verschwinden.
     */
    for (const name of ["get_leads", "get_replies"]) {
      const beschreibung = listTools().find((t) => t.name === name)!.description.toLowerCase();
      expect(beschreibung, name).toContain("instruction");
      expect(beschreibung, name).toContain("data");
    }
  });
});

describe("Workspace-Zuschnitt", () => {
  it("ein fremder Workspace erreicht die Datenbank gar nicht", async () => {
    // Der wichtigste Fall: nicht "es kommt nichts zurueck", sondern "es wird
    // gar nicht erst gefragt".
    for (const name of ["list_lead_lists", "get_leads", "get_offer", "get_campaign_stats", "get_replies"]) {
      const { supabase, aufrufe } = stubSupabase();
      const ergebnis = await callTool(supabase, ctx(), name, {
        workspace_id: FREMD,
        search_id: "s1",
      });
      expect(ergebnis.isError, name).toBe(true);
      expect(ergebnis.content[0].text).toBe(WORKSPACE_DENIED_MESSAGE);
      expect(aufrufe, name).toHaveLength(0);
    }
  });

  it("get_leads filtert auf workspace_id UND search_id", async () => {
    const { supabase, aufrufe } = stubSupabase({
      businesses: { data: [{ id: "b1", name: "Beispiel", contacts: [] }], count: 1 },
    });
    await callTool(supabase, ctx(), "get_leads", { workspace_id: WS, search_id: "s1" });
    expect(hatFilter(aufrufe, "businesses", "workspace_id", WS)).toBe(true);
    expect(hatFilter(aufrufe, "businesses", "search_id", "s1")).toBe(true);
  });

  it("list_lead_lists blendet Papierkorb und Teilsuchen aus", async () => {
    // Ohne den parent_search_id-Filter stuenden hier sechzig Eintraege fuer
    // das, was in der App EINE gebuendelte Liste ist (Migration 0096) -- und
    // das Modell riefe sechzigmal get_leads auf.
    const { supabase, aufrufe } = stubSupabase({ searches: { data: [] } });
    await callTool(supabase, ctx(), "list_lead_lists", { workspace_id: WS });
    const isFilter = aufrufe.filter((a) => a.table === "searches" && a.method === "is");
    expect(isFilter.map((a) => a.args[0])).toEqual(["deleted_at", "parent_search_id"]);
  });

  it("get_replies filtert auf workspace_id und holt nur Eingaenge", async () => {
    const { supabase, aufrufe } = stubSupabase({ messages: { data: [], count: 0 } });
    await callTool(supabase, ctx(), "get_replies", { workspace_id: WS });
    expect(hatFilter(aufrufe, "messages", "workspace_id", WS)).toBe(true);
    expect(hatFilter(aufrufe, "messages", "direction", "inbound")).toBe(true);
  });

  it("list_workspaces fragt ohne Reichweite gar nicht erst", async () => {
    const { supabase, aufrufe } = stubSupabase();
    const ergebnis = await callTool(supabase, ctx({ allowedWorkspaceIds: [] }), "list_workspaces", {});
    expect(aufrufe).toHaveLength(0);
    expect(ergebnis.isError).toBeUndefined();
    expect(ergebnis.content[0].text).toContain("no workspace");
  });

  it("list_workspaces fragt nur die erlaubten IDs ab", async () => {
    const { supabase, aufrufe } = stubSupabase({ workspaces: { data: [{ id: WS, name: "Meiner" }] } });
    await callTool(supabase, ctx(), "list_workspaces", {});
    const inFilter = aufrufe.find((a) => a.method === "in");
    expect(inFilter?.args).toEqual(["id", [WS]]);
  });
});

describe("Argumentpruefung", () => {
  it("ein zu grosses limit wird abgelehnt, bevor gefragt wird", async () => {
    const { supabase, aufrufe } = stubSupabase();
    const ergebnis = await callTool(supabase, ctx(), "get_leads", {
      workspace_id: WS,
      search_id: "s1",
      limit: 500,
    });
    expect(ergebnis.isError).toBe(true);
    // 100 ist die Grenze, die auch in der Beschreibung steht.
    expect(ergebnis.content[0].text).toContain("100");
    expect(aufrufe).toHaveLength(0);
  });

  it("fehlendes search_id wird benannt", async () => {
    const { supabase } = stubSupabase();
    const ergebnis = await callTool(supabase, ctx(), "get_leads", { workspace_id: WS });
    expect(ergebnis.isError).toBe(true);
    expect(ergebnis.content[0].text).toContain("search_id");
  });

  it("ein unbekannter Werkzeugname ist ein Werkzeugfehler, kein Absturz", async () => {
    const { supabase } = stubSupabase();
    const ergebnis = await callTool(supabase, ctx(), "delete_everything", {});
    expect(ergebnis.isError).toBe(true);
    expect(ergebnis.content[0].text).toContain("tools/list");
  });
});

describe("set_lead_icebreaker", () => {
  const args = { workspace_id: WS, business_id: "b1", icebreaker: "Neuer Satz." };

  it("ein read-Token schreibt nicht, und fragt auch nicht", async () => {
    const { supabase, aufrufe } = stubSupabase();
    const ergebnis = await callTool(supabase, ctx({ scope: "read" }), "set_lead_icebreaker", args);
    expect(ergebnis.isError).toBe(true);
    expect(ergebnis.content[0].text).toBe(SCOPE_DENIED_MESSAGE);
    expect(aufrufe).toHaveLength(0);
  });

  it("schreibt mit beiden Filtern und protokolliert den alten Wert", async () => {
    const { supabase, aufrufe } = stubSupabase({
      businesses: { data: { id: "b1", name: "Beispiel GmbH", personalization: "Alter Satz." } },
    });
    const ergebnis = await callTool(supabase, ctx({ scope: "read_write" }), "set_lead_icebreaker", args);
    expect(ergebnis.isError).toBeUndefined();

    // Der Update-Aufruf existiert und traegt BEIDE Bedingungen: mit
    // Service-Role wuerde .eq("id", ...) allein jede Zeile der Datenbank
    // treffen, auch die eines fremden Kunden.
    expect(aufrufe.some((a) => a.table === "businesses" && a.method === "update")).toBe(true);
    expect(hatFilter(aufrufe, "businesses", "workspace_id", WS)).toBe(true);
    expect(hatFilter(aufrufe, "businesses", "id", "b1")).toBe(true);

    const log = aufrufe.find((a) => a.table === "mcp_write_log" && a.method === "insert");
    expect(log).toBeDefined();
    expect(log!.args[0]).toMatchObject({
      workspace_id: WS,
      business_id: "b1",
      old_value: "Alter Satz.",
      new_value: "Neuer Satz.",
      token_id: "tok-1",
      user_id: "user-1",
    });
  });

  it("ein unbekannter Lead wird wie ein fremder behandelt", async () => {
    // Derselbe Satz fuer beides: sonst laesst sich durch Durchprobieren
    // ablesen, welche business_ids es gibt.
    const { supabase, aufrufe } = stubSupabase({ businesses: { data: null } });
    const ergebnis = await callTool(supabase, ctx({ scope: "read_write" }), "set_lead_icebreaker", args);
    expect(ergebnis.isError).toBe(true);
    expect(aufrufe.some((a) => a.method === "update")).toBe(false);
  });

  it("ein ganzer Aufsatz statt einer Eroeffnungszeile wird abgelehnt", async () => {
    const { supabase, aufrufe } = stubSupabase();
    const ergebnis = await callTool(supabase, ctx({ scope: "read_write" }), "set_lead_icebreaker", {
      ...args,
      icebreaker: "x".repeat(5000),
    });
    expect(ergebnis.isError).toBe(true);
    expect(aufrufe.some((a) => a.method === "update")).toBe(false);
  });
});

describe("Fremdtext", () => {
  it("get_leads liefert die Leads umzaeunt und zusaetzlich als structuredContent", async () => {
    const { supabase } = stubSupabase({
      businesses: {
        data: [{ id: "b1", name: "Beispiel", company_summary: "Ein Shop.", contacts: [] }],
        count: 1,
      },
    });
    const ergebnis = await callTool(supabase, ctx(), "get_leads", {
      workspace_id: WS,
      search_id: "s1",
    });
    expect(ergebnis.content[0].text).toContain("<untrusted-leads-");
    // structuredContent traegt dieselben Daten ohne Umzaeunung, damit ein
    // Client sie auswerten kann, ohne den Block aufzuschneiden.
    expect(ergebnis.structuredContent).toMatchObject({ total: 1, has_more: false });
  });

  it("kuerzt eine ueberlange Zusammenfassung sichtbar", async () => {
    // Sichtbar, weil Claude Code Werkzeugausgaben bei 25.000 Token hart
    // abschneidet: ein stumm gekuerzter Text saehe fuer das Modell
    // vollstaendig aus.
    const { supabase } = stubSupabase({
      businesses: {
        data: [{ id: "b1", name: "Beispiel", company_summary: "a".repeat(5000), contacts: [] }],
        count: 1,
      },
    });
    const ergebnis = await callTool(supabase, ctx(), "get_leads", {
      workspace_id: WS,
      search_id: "s1",
    });
    expect(ergebnis.content[0].text).toContain("truncated");
  });
});
