/**
 * JSON-RPC- und MCP-Protokollschicht.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIESER SERVER ZWEI ZEITALTER SPRICHT ("dual-era")
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die aktuelle Protokollversion 2026-07-28 hat den initialize-Handshake
 * ABGESCHAFFT. Die Spezifikation nennt alles davor "legacy" und die neue
 * Fassung "modern"; ein Server, der beides kann, heisst dort "dual-era".
 *
 * Die Kompatibilitaetsmatrix (/specification/2026-07-28/basic/versioning,
 * geprueft 2026-08-22) sagt: "Legacy client + Dual-era server" = Works,
 * "Legacy client + Modern server" = Fails. Die heute ausgelieferten
 * Claude-Clients sind mit hoher Wahrscheinlichkeit legacy. Ein rein moderner
 * Server waere also formal korrekt und praktisch unbenutzbar. Deshalb dual-era
 * -- nicht aus Bequemlichkeit, sondern weil die andere Wahl heute nicht
 * funktioniert.
 *
 * Alles hier ist rein und testbar; die Route (app/api/mcp/route.ts) haelt nur
 * die Reihenfolge und das IO.
 */

// ─────────────────────────────────────────────────────────────────────────
// Versionen
// ─────────────────────────────────────────────────────────────────────────

/** Die Version ohne initialize. */
export const MODERN_VERSION = "2026-07-28";

/**
 * Reihenfolge = Vorliebe, neueste zuerst. Steht so auch in
 * server/discover.supportedVersions.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM 2025-03-26 UND 2024-11-05 HIER STEHEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Bis zum 2026-08-26 endete die Liste bei 2025-06-18. Am Live-Endpunkt
 * gemessen: ein initialize mit protocolVersion "2024-11-05" bekam
 * "2025-11-25" zurueck. Die Legacy-Spezifikation laesst das formal zu (der
 * Server schlaegt vor), sagt im naechsten Satz aber auch, was der Client dann
 * tut: "If the client does not support the version returned by the server, it
 * SHOULD disconnect." Genau das ist der Abbruch, der in Claude Desktop und
 * unter mcp-remote als "MCP error" ankommt -- beide handeln in ihren
 * ausgelieferten Fassungen 2024-11-05 aus.
 *
 * Beide alten Versionen sind hier kostenlos zu koennen: der Unterschied zu
 * 2025-06-18 ist auf der Serverseite additiv (structuredContent, der
 * MCP-Protocol-Version-Header). Ein Client, der sie nicht kennt, ueberliest
 * unbekannte Felder -- das ist bei JSON-RPC der Normalfall und keine Annahme.
 */
export const SUPPORTED_VERSIONS = [
  MODERN_VERSION,
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

/** Womit ein Legacy-Client abgespeist wird, dessen Wunschversion wir nicht
 *  kennen. Bewusst NICHT die neueste: wer etwas Unbekanntes verlangt, ist
 *  eher ein alter als ein neuer Client. */
export const LATEST_LEGACY_VERSION = "2025-11-25";

export function isSupportedVersion(version: unknown): boolean {
  return typeof version === "string" && (SUPPORTED_VERSIONS as readonly string[]).includes(version);
}

/**
 * Legacy-initialize: die gewuenschte Version, wenn wir sie koennen, sonst
 * unsere neueste Legacy-Version.
 *
 * Bewusst kein Fehler bei Unbekanntem: die Legacy-Spezifikation sieht vor,
 * dass der Server eine Version VORSCHLAEGT und der Client dann entscheidet, ob
 * er damit weitermacht. Erst der moderne Pfad lehnt hart ab (-32022).
 */
export function negotiateLegacyVersion(requested: unknown): string {
  return isSupportedVersion(requested) ? (requested as string) : LATEST_LEGACY_VERSION;
}

// ─────────────────────────────────────────────────────────────────────────
// Fehlercodes
// ─────────────────────────────────────────────────────────────────────────

/** Die Standard-JSON-RPC-Codes plus die beiden, die 2026-07-28 ergaenzt. */
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** HeaderMismatch: Pflicht-Header fehlt oder widerspricht dem Body. */
  HEADER_MISMATCH: -32020,
  /** Die verlangte Protokollversion kennen wir nicht. */
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// _meta-Schluessel und Header
// ─────────────────────────────────────────────────────────────────────────

export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
export const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

export const HEADER_PROTOCOL_VERSION = "MCP-Protocol-Version";
export const HEADER_METHOD = "Mcp-Method";
export const HEADER_NAME = "Mcp-Name";

// ─────────────────────────────────────────────────────────────────────────
// Request-Formen
// ─────────────────────────────────────────────────────────────────────────

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  /** Fehlt bei einer Notification. */
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type RpcErrorShape = {
  code: number;
  message: string;
  data?: unknown;
  /** Welchen HTTP-Status die Route dazu setzen soll. */
  httpStatus: number;
};

export type ParsedBody =
  | { ok: true; request: JsonRpcRequest }
  | { ok: false; error: RpcErrorShape };

/**
 * Rohtext zu einem geprueften JSON-RPC-Request.
 *
 * Batches (ein Array) werden abgelehnt: MCP hat das JSON-RPC-Batching mit
 * 2025-06-18 gestrichen, und ein halb unterstuetztes Batch waere schlimmer als
 * gar keins -- der Client bekaeme eine Antwort, die er nicht zuordnen kann.
 */
export function parseRpcBody(raw: string): ParsedBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: { code: RPC_ERRORS.PARSE_ERROR, message: "Request body is not valid JSON.", httpStatus: 400 },
    };
  }
  if (Array.isArray(parsed)) {
    return {
      ok: false,
      error: {
        code: RPC_ERRORS.INVALID_REQUEST,
        message: "JSON-RPC batching is not supported (removed from MCP in 2025-06-18). Send one request per call.",
        httpStatus: 400,
      },
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {
      ok: false,
      error: { code: RPC_ERRORS.INVALID_REQUEST, message: "Request body must be a JSON-RPC object.", httpStatus: 400 },
    };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.jsonrpc !== "2.0") {
    return {
      ok: false,
      error: { code: RPC_ERRORS.INVALID_REQUEST, message: 'Field "jsonrpc" must be "2.0".', httpStatus: 400 },
    };
  }
  if (typeof obj.method !== "string" || obj.method === "") {
    return {
      ok: false,
      error: { code: RPC_ERRORS.INVALID_REQUEST, message: 'Field "method" is required and must be a string.', httpStatus: 400 },
    };
  }
  if (obj.params !== undefined && (typeof obj.params !== "object" || obj.params === null || Array.isArray(obj.params))) {
    return {
      ok: false,
      error: { code: RPC_ERRORS.INVALID_PARAMS, message: 'Field "params" must be an object.', httpStatus: 400 },
    };
  }
  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    method: obj.method,
    params: (obj.params as Record<string, unknown> | undefined) ?? {},
  };
  // "id" nur uebernehmen, wenn es wirklich dasteht: das Fehlen des Feldes ist
  // der einzige Unterschied zwischen Request und Notification.
  if ("id" in obj) request.id = obj.id as JsonRpcId;
  return { ok: true, request };
}

/** Eine Notification hat kein id-Feld. Antwort darauf: 202 ohne Body. */
export function isNotification(request: JsonRpcRequest): boolean {
  return !("id" in request);
}

// ─────────────────────────────────────────────────────────────────────────
// Modern oder legacy
// ─────────────────────────────────────────────────────────────────────────

export type Era = "modern" | "legacy";

/** params._meta, falls vorhanden. */
export function metaOf(request: JsonRpcRequest): Record<string, unknown> {
  const meta = request.params?._meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return {};
  return meta as Record<string, unknown>;
}

/**
 * Woran ein moderner Request erkannt wird: an
 * params._meta["io.modelcontextprotocol/protocolVersion"].
 *
 * NICHT am MCP-Protocol-Version-HEADER. Der ist seit 2025-06-18 auch fuer
 * Legacy-Clients nach dem Handshake Pflicht, taugt also nicht zur
 * Unterscheidung -- eine Verwechslung, die einen Legacy-Client mit korrektem
 * Header sofort mit -32020 abweisen wuerde.
 */
export function detectEra(request: JsonRpcRequest): Era {
  return typeof metaOf(request)[META_PROTOCOL_VERSION] === "string" ? "modern" : "legacy";
}

/**
 * Mcp-Name darf als "=?base64?<wert>?=" kodiert sein (die Spezifikation nennt
 * das den Base64-Sentinel; HTTP-Header vertragen keine beliebigen Zeichen).
 * Vor dem Vergleich also dekodieren.
 *
 * Bei kaputtem Base64 wird der Rohwert zurueckgegeben: der Vergleich schlaegt
 * dann fehl und die Route antwortet mit -32020, was genau richtig ist.
 */
export function decodeHeaderValue(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const match = /^=\?base64\?(.*)\?=$/.exec(trimmed);
  if (!match) return trimmed;
  try {
    return Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return trimmed;
  }
}

/** Nur das, was hier gebraucht wird -- so laesst sich in Tests ein Headers-
 *  Objekt oder ein simples Literal uebergeben. */
export type HeaderLike = { get(name: string): string | null };

/**
 * Die Header-Pflichten des modernen Zeitalters.
 *
 * Die Spezifikation verlangt, dass der Server prueft, ob Header und Body
 * uebereinstimmen. Der Grund ist keine Formsache: Zwischenstationen (Proxies,
 * Gateways, Ratenbegrenzer) sollen an den Headern entscheiden koennen, ohne
 * den Body zu lesen. Wenn Header und Body auseinanderlaufen duerften, waere
 * jede solche Entscheidung angreifbar -- ein Aufruf koennte sich als
 * tools/list ausgeben und tools/call sein.
 *
 * Reihenfolge der Pruefung: erst Vorhandensein und Uebereinstimmung (-32020),
 * dann ob wir die Version ueberhaupt koennen (-32022). Andersherum bekaeme ein
 * Client mit fehlendem Header eine Versionsmeldung, die ihm nichts sagt.
 */
export function validateModernHeaders(
  headers: HeaderLike,
  request: JsonRpcRequest
): RpcErrorShape | null {
  const bodyVersion = metaOf(request)[META_PROTOCOL_VERSION];
  const headerVersion = decodeHeaderValue(headers.get(HEADER_PROTOCOL_VERSION));
  if (!headerVersion) {
    return headerMismatch(`Missing required header ${HEADER_PROTOCOL_VERSION}.`);
  }
  if (headerVersion !== bodyVersion) {
    return headerMismatch(
      `Header ${HEADER_PROTOCOL_VERSION} (${headerVersion}) does not match params._meta["${META_PROTOCOL_VERSION}"] (${String(bodyVersion)}).`
    );
  }

  const headerMethod = decodeHeaderValue(headers.get(HEADER_METHOD));
  if (!headerMethod) {
    return headerMismatch(`Missing required header ${HEADER_METHOD}.`);
  }
  if (headerMethod !== request.method) {
    return headerMismatch(
      `Header ${HEADER_METHOD} (${headerMethod}) does not match the method in the body (${request.method}).`
    );
  }

  if (request.method === "tools/call") {
    const headerName = decodeHeaderValue(headers.get(HEADER_NAME));
    const bodyName = request.params?.name;
    if (!headerName) {
      return headerMismatch(`Missing required header ${HEADER_NAME} for tools/call.`);
    }
    if (headerName !== bodyName) {
      return headerMismatch(
        `Header ${HEADER_NAME} (${headerName}) does not match params.name (${String(bodyName)}).`
      );
    }
  }

  if (!isSupportedVersion(headerVersion)) {
    return {
      code: RPC_ERRORS.UNSUPPORTED_PROTOCOL_VERSION,
      message: `Unsupported MCP protocol version: ${headerVersion}.`,
      data: { supported: [...SUPPORTED_VERSIONS], requested: headerVersion },
      httpStatus: 400,
    };
  }
  return null;
}

function headerMismatch(message: string): RpcErrorShape {
  return { code: RPC_ERRORS.HEADER_MISMATCH, message, httpStatus: 400 };
}

// ─────────────────────────────────────────────────────────────────────────
// Antwortformen
// ─────────────────────────────────────────────────────────────────────────

export type ServerInfo = { name: string; version: string };

export function rpcResult(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

export function rpcError(id: JsonRpcId | undefined, error: RpcErrorShape) {
  const { httpStatus: _ignored, ...rest } = error;
  return { jsonrpc: "2.0" as const, id: id ?? null, error: rest };
}

/**
 * Die Antwort auf server/discover.
 *
 * resultType: "complete" traegt im modernen Zeitalter JEDES Ergebnis; die
 * Spezifikation laesst damit Raum fuer Teilantworten, die dieser Server nicht
 * gibt.
 */
export function discoverResult(info: ServerInfo, instructions: string) {
  return {
    resultType: "complete" as const,
    supportedVersions: [...SUPPORTED_VERSIONS],
    capabilities: { tools: {} },
    _meta: { [META_SERVER_INFO]: info },
    instructions,
  };
}

/** Die Antwort auf legacy initialize. Kein resultType -- den kennt das alte
 *  Zeitalter nicht. */
export function initializeResult(
  requestedVersion: unknown,
  info: ServerInfo,
  instructions: string
) {
  return {
    protocolVersion: negotiateLegacyVersion(requestedVersion),
    capabilities: { tools: {} },
    serverInfo: info,
    instructions,
  };
}

/** Ergebnisse tragen im modernen Zeitalter resultType, im alten nicht. Eine
 *  Stelle statt einer Fallunterscheidung in jeder Methode. */
export function withEra<T extends object>(era: Era, result: T): T | (T & { resultType: "complete" }) {
  return era === "modern" ? { ...result, resultType: "complete" as const } : result;
}
