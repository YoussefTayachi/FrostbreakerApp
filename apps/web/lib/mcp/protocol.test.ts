import { describe, expect, it } from "vitest";
import {
  decodeHeaderValue,
  detectEra,
  discoverResult,
  initializeResult,
  isNotification,
  isSupportedVersion,
  LATEST_LEGACY_VERSION,
  META_PROTOCOL_VERSION,
  MODERN_VERSION,
  negotiateLegacyVersion,
  parseRpcBody,
  RPC_ERRORS,
  SUPPORTED_VERSIONS,
  validateModernHeaders,
  withEra,
  type JsonRpcRequest,
} from "./protocol";

/** Ein Headers-Ersatz, der nur das kann, was validateModernHeaders braucht. */
function headers(map: Record<string, string>) {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

function modernRequest(method: string, params: Record<string, unknown> = {}): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: { ...params, _meta: { [META_PROTOCOL_VERSION]: MODERN_VERSION } },
  };
}

describe("Versionen", () => {
  it("fuehrt die moderne Version zuerst", () => {
    expect(SUPPORTED_VERSIONS[0]).toBe(MODERN_VERSION);
    expect(MODERN_VERSION).toBe("2026-07-28");
  });

  it("kennt die beiden Legacy-Versionen, die Claude heute spricht", () => {
    expect(isSupportedVersion("2025-11-25")).toBe(true);
    expect(isSupportedVersion("2025-06-18")).toBe(true);
  });

  it("lehnt Unbekanntes ab", () => {
    expect(isSupportedVersion("1900-01-01")).toBe(false);
    expect(isSupportedVersion(42)).toBe(false);
  });

  it("schlaegt einem Legacy-Client mit unbekanntem Wunsch eine Version vor", () => {
    // Kein harter Fehler: die Legacy-Spezifikation sieht vor, dass der Server
    // vorschlaegt und der Client entscheidet.
    expect(negotiateLegacyVersion("1900-01-01")).toBe(LATEST_LEGACY_VERSION);
    expect(negotiateLegacyVersion(undefined)).toBe(LATEST_LEGACY_VERSION);
  });

  it("bestaetigt einem Legacy-Client seine Wunschversion, wenn wir sie koennen", () => {
    expect(negotiateLegacyVersion("2025-06-18")).toBe("2025-06-18");
  });
});

describe("parseRpcBody", () => {
  it("nimmt einen gueltigen Request", () => {
    const result = parseRpcBody('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    expect(result.ok).toBe(true);
  });

  it("lehnt kaputtes JSON ab", () => {
    const result = parseRpcBody("{nicht json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(RPC_ERRORS.PARSE_ERROR);
  });

  it("lehnt Batches ab", () => {
    // MCP hat JSON-RPC-Batching mit 2025-06-18 gestrichen.
    const result = parseRpcBody('[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(RPC_ERRORS.INVALID_REQUEST);
  });

  it("besteht auf jsonrpc 2.0", () => {
    const result = parseRpcBody('{"jsonrpc":"1.0","id":1,"method":"tools/list"}');
    expect(result.ok).toBe(false);
  });

  it("besteht auf einer Methode", () => {
    expect(parseRpcBody('{"jsonrpc":"2.0","id":1}').ok).toBe(false);
  });

  it("unterscheidet Notification von Request am fehlenden id-Feld", () => {
    const mitId = parseRpcBody('{"jsonrpc":"2.0","id":1,"method":"x"}');
    const ohneId = parseRpcBody('{"jsonrpc":"2.0","method":"x"}');
    expect(mitId.ok && isNotification(mitId.request)).toBe(false);
    expect(ohneId.ok && isNotification(ohneId.request)).toBe(true);
  });

  it("behandelt id: null als Request und nicht als Notification", () => {
    const result = parseRpcBody('{"jsonrpc":"2.0","id":null,"method":"x"}');
    expect(result.ok && isNotification(result.request)).toBe(false);
  });
});

describe("detectEra", () => {
  it("erkennt modern an params._meta", () => {
    expect(detectEra(modernRequest("tools/list"))).toBe("modern");
  });

  it("erkennt legacy ohne params._meta", () => {
    expect(detectEra({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).toBe("legacy");
  });

  it("erkennt NICHT am MCP-Protocol-Version-Header", () => {
    // Der Header ist seit 2025-06-18 auch fuer Legacy-Clients nach dem
    // Handshake Pflicht. Wer daran unterscheidet, weist einen korrekten
    // Legacy-Client sofort mit -32020 ab.
    const legacyMitHeader: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    expect(detectEra(legacyMitHeader)).toBe("legacy");
  });
});

describe("decodeHeaderValue", () => {
  it("gibt einen einfachen Wert unveraendert zurueck", () => {
    expect(decodeHeaderValue("get_leads")).toBe("get_leads");
  });

  it("dekodiert den Base64-Sentinel", () => {
    const kodiert = `=?base64?${Buffer.from("Hallo Welt", "utf8").toString("base64")}?=`;
    expect(decodeHeaderValue(kodiert)).toBe("Hallo Welt");
  });

  it("liefert null ohne Header", () => {
    expect(decodeHeaderValue(null)).toBeNull();
    expect(decodeHeaderValue(undefined)).toBeNull();
  });
});

describe("validateModernHeaders", () => {
  const request = modernRequest("tools/call", { name: "get_leads" });

  it("laesst einen vollstaendigen, stimmigen Satz Header durch", () => {
    const result = validateModernHeaders(
      headers({
        "MCP-Protocol-Version": MODERN_VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "get_leads",
      }),
      request
    );
    expect(result).toBeNull();
  });

  it("meldet einen fehlenden Versions-Header als HeaderMismatch", () => {
    const result = validateModernHeaders(
      headers({ "Mcp-Method": "tools/call", "Mcp-Name": "get_leads" }),
      request
    );
    expect(result?.code).toBe(RPC_ERRORS.HEADER_MISMATCH);
    expect(result?.httpStatus).toBe(400);
  });

  it("meldet einen Header, der dem Body widerspricht", () => {
    // Der Sinn der Pruefung: eine Zwischenstation soll am Header entscheiden
    // duerfen, ohne den Body zu lesen. Ein Aufruf, der sich als tools/list
    // ausgibt und tools/call ist, waere sonst moeglich.
    const result = validateModernHeaders(
      headers({
        "MCP-Protocol-Version": MODERN_VERSION,
        "Mcp-Method": "tools/list",
        "Mcp-Name": "get_leads",
      }),
      request
    );
    expect(result?.code).toBe(RPC_ERRORS.HEADER_MISMATCH);
  });

  it("verlangt Mcp-Name bei tools/call", () => {
    const result = validateModernHeaders(
      headers({ "MCP-Protocol-Version": MODERN_VERSION, "Mcp-Method": "tools/call" }),
      request
    );
    expect(result?.code).toBe(RPC_ERRORS.HEADER_MISMATCH);
  });

  it("akzeptiert einen Base64-kodierten Mcp-Name", () => {
    const kodiert = `=?base64?${Buffer.from("get_leads", "utf8").toString("base64")}?=`;
    const result = validateModernHeaders(
      headers({
        "MCP-Protocol-Version": MODERN_VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": kodiert,
      }),
      request
    );
    expect(result).toBeNull();
  });

  it("meldet eine unbekannte Version mit -32022 und nennt die eigenen", () => {
    const fremd: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { [META_PROTOCOL_VERSION]: "1900-01-01" } },
    };
    const result = validateModernHeaders(
      headers({ "MCP-Protocol-Version": "1900-01-01", "Mcp-Method": "tools/list" }),
      fremd
    );
    expect(result?.code).toBe(RPC_ERRORS.UNSUPPORTED_PROTOCOL_VERSION);
    expect(result?.data).toEqual({ supported: [...SUPPORTED_VERSIONS], requested: "1900-01-01" });
  });

  it("prueft erst die Uebereinstimmung und dann die Version", () => {
    // Andersherum bekaeme ein Client mit fehlendem Header eine
    // Versionsmeldung, die ihm nichts sagt.
    const result = validateModernHeaders(headers({ "Mcp-Method": "tools/list" }), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { [META_PROTOCOL_VERSION]: "1900-01-01" } },
    });
    expect(result?.code).toBe(RPC_ERRORS.HEADER_MISMATCH);
  });
});

describe("Antwortformen", () => {
  it("gibt server/discover die unterstuetzten Versionen und serverInfo mit", () => {
    const result = discoverResult({ name: "frostbreaker", version: "1.0.0" }, "Anleitung");
    expect(result.resultType).toBe("complete");
    expect(result.supportedVersions).toEqual([...SUPPORTED_VERSIONS]);
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.instructions).toBe("Anleitung");
  });

  it("gibt initialize KEIN resultType, aber eine ausgehandelte Version", () => {
    const result = initializeResult("2025-06-18", { name: "f", version: "1" }, "Anleitung");
    expect("resultType" in result).toBe(false);
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.serverInfo).toEqual({ name: "f", version: "1" });
  });

  it("haengt resultType nur im modernen Zeitalter an", () => {
    expect(withEra("modern", { tools: [] })).toEqual({ tools: [], resultType: "complete" });
    expect(withEra("legacy", { tools: [] })).toEqual({ tools: [] });
  });
});
