import { describe, expect, it } from "vitest";
import { generateToken, hashToken, parseBearer, TOKEN_PREFIX } from "./token";

describe("generateToken", () => {
  it("erzeugt einen Token mit erkennbarem Praefix", () => {
    expect(generateToken().token.startsWith(TOKEN_PREFIX)).toBe(true);
  });

  it("liefert einen Hash, der zum Klartext passt", () => {
    const { token, hash } = generateToken();
    expect(hash).toBe(hashToken(token));
  });

  it("liefert ein Praefix, das ein Anfang des Klartexts ist", () => {
    const { token, prefix } = generateToken();
    expect(token.startsWith(prefix)).toBe(true);
    // Kurz genug, um beim Raten nicht zu helfen.
    expect(prefix.length).toBeLessThan(token.length);
  });

  it("erzeugt in tausend Laeufen keine Dublette", () => {
    const gesehen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) gesehen.add(generateToken().token);
    expect(gesehen.size).toBe(1000);
  });

  it("bringt genug Zufall mit, um auf einen Langsam-Hash verzichten zu koennen", () => {
    // 32 Byte base64url sind 43 Zeichen. Das ist die Zahl, auf der die
    // Entscheidung gegen bcrypt beruht (siehe Migration 0099) -- faellt sie,
    // faellt die Begruendung mit.
    const zufallsteil = generateToken().token.slice(TOKEN_PREFIX.length);
    expect(zufallsteil.length).toBeGreaterThanOrEqual(43);
    // base64url: kein +, kein /, kein =.
    expect(zufallsteil).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashToken", () => {
  it("liefert 64 Hex-Zeichen", () => {
    expect(hashToken("beliebig")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ist stabil", () => {
    expect(hashToken("gleich")).toBe(hashToken("gleich"));
  });

  it("unterscheidet sich bei einem einzigen geaenderten Zeichen", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("parseBearer", () => {
  it("liest den Token aus einem normalen Header", () => {
    expect(parseBearer("Bearer fbk_mcp_abc")).toBe("fbk_mcp_abc");
  });

  it("akzeptiert kleingeschriebenes bearer", () => {
    // RFC 7235 erklaert das Schema ausdruecklich fuer case-insensitive.
    expect(parseBearer("bearer fbk_mcp_abc")).toBe("fbk_mcp_abc");
  });

  it("vertraegt mehrere Leerzeichen und umschliessenden Leerraum", () => {
    expect(parseBearer("   Bearer    fbk_mcp_abc  ")).toBe("fbk_mcp_abc");
  });

  it("liefert null fuer alles, was kein Bearer-Header ist", () => {
    const dreck = [null, undefined, "", "Bearer", "Bearer ", "Basic abc", "fbk_mcp_abc", 42];
    for (const eingabe of dreck) {
      expect(parseBearer(eingabe as string | null | undefined)).toBeNull();
    }
  });

  it("lehnt einen Header mit zwei Werten ab", () => {
    expect(parseBearer("Bearer abc def")).toBeNull();
  });
});
