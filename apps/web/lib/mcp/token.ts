import crypto from "crypto";

/**
 * Erzeugen, Hashen und Auslesen der MCP-Zugriffstoken.
 *
 * Reine Funktionen ohne Datenbank, damit die eine Stelle, an der ueber ein
 * Geheimnis entschieden wird, testbar bleibt. Wer diese Datei aendert, aendert
 * gleichzeitig, was in mcp_tokens.token_hash steht -- bestehende Token wuerden
 * dabei unbrauchbar.
 */

/** Erkennungszeichen im Klartext. Ein Token, den jemand versehentlich in ein
 *  Issue kopiert, ist damit als solcher erkennbar (gleiches Muster wie bei
 *  Stripe oder GitHub). */
export const TOKEN_PREFIX = "fbk_mcp_";

/** 32 Byte = 256 Bit aus dem CSPRNG. Das ist die Zahl, die den Verzicht auf
 *  bcrypt begruendet (siehe Migration 0099): gegen 256 Zufallsbits hilft kein
 *  Woerterbuch, also muss der Hash nicht langsam sein. */
const TOKEN_BYTES = 32;

/** So viel vom Klartext wird zur Wiedererkennung gespeichert: das Praefix und
 *  sechs Zeichen. Genug, um zwei Token in einer Liste auseinanderzuhalten, zu
 *  wenig, um beim Raten zu helfen. */
const VISIBLE_CHARS = 6;

export type GeneratedToken = {
  /** Der Klartext. Existiert genau einmal -- direkt nach dem Anlegen. */
  token: string;
  /** Was in mcp_tokens.token_hash kommt. */
  hash: string;
  /** Was in mcp_tokens.token_prefix kommt. */
  prefix: string;
};

export function generateToken(): GeneratedToken {
  // base64url, damit der Token ohne Kodierung in einen Authorization-Header
  // passt: kein +, kein /, kein =.
  const random = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const token = `${TOKEN_PREFIX}${random}`;
  return {
    token,
    hash: hashToken(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + VISIBLE_CHARS),
  };
}

/** SHA-256 als Hex, 64 Zeichen. Ungesalzen und mit Absicht -- die Begruendung
 *  steht im Kopf von Migration 0099. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Den Token aus einem Authorization-Header ziehen.
 *
 * Robust gegen das, was Clients tatsaechlich schicken: "bearer" klein
 * geschrieben (RFC 7235 erklaert das Schema ausdruecklich fuer
 * case-insensitive), mehrere Leerzeichen dazwischen, umschliessender
 * Leerraum. Alles andere -- fehlender Header, ein anderes Schema, ein leerer
 * Wert -- ergibt null, und die Route macht daraus dieselbe 401 wie bei einem
 * falschen Token.
 */
export function parseBearer(headerValue: string | null | undefined): string | null {
  if (typeof headerValue !== "string") return null;
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(headerValue);
  if (!match) return null;
  return match[1];
}
