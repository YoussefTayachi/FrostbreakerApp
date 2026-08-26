import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  authorizationServerMetadata,
  errorRedirect,
  isUsableRedirectUri,
  isValidCodeChallenge,
  mcpScopeFromOAuthScope,
  protectedResourceMetadata,
  publicOrigin,
  redirectUriAllowed,
  successRedirect,
  verifyPkce,
} from "./oauth";

/**
 * Die Tests zum OAuth-Teil des MCP-Zugangs.
 *
 * Schwerpunkt liegt bewusst auf den drei Funktionen, an denen ein Fehler einen
 * fremden Zugang bedeutet: verifyPkce, redirectUriAllowed und
 * isUsableRedirectUri. Die Metadatendokumente werden nur darauf geprueft, dass
 * sie zueinander passen -- ein falscher issuer ist der Fehler, den ein Client
 * am lautesten meldet und ein Mensch am schwersten findet.
 */

/** Ein echter PKCE-Verifier, wie ihn ein Client erzeugt: 32 Zufallsbytes als
 *  base64url, also 43 Zeichen. */
function verifierUndChallenge() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

describe("verifyPkce", () => {
  it("nimmt das Paar an, das ein Client tatsaechlich bildet", () => {
    const { verifier, challenge } = verifierUndChallenge();
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("weist einen fremden Verifier ab", () => {
    const { challenge } = verifierUndChallenge();
    const anderer = crypto.randomBytes(32).toString("base64url");
    expect(verifyPkce(anderer, challenge)).toBe(false);
  });

  it("weist ab, wenn nur ein Zeichen abweicht", () => {
    const { verifier, challenge } = verifierUndChallenge();
    const verbogen = verifier.slice(0, -1) + (verifier.endsWith("A") ? "B" : "A");
    expect(verifyPkce(verbogen, challenge)).toBe(false);
  });

  // "plain" wuerde die eine Schutzwirkung von PKCE abwaehlbar machen: die
  // Challenge WAERE dann der Verifier, und wer den Code abfaengt, hat beides.
  it("kennt nur S256, kein plain", () => {
    const verifier = crypto.randomBytes(32).toString("base64url");
    expect(verifyPkce(verifier, verifier, "plain")).toBe(false);
  });

  it("weist zu kurze und leere Verifier ab, bevor gerechnet wird", () => {
    expect(verifyPkce("", "x".repeat(43))).toBe(false);
    expect(verifyPkce("zu-kurz", "x".repeat(43))).toBe(false);
    expect(verifyPkce(null, "x".repeat(43))).toBe(false);
    expect(verifyPkce(42, "x".repeat(43))).toBe(false);
  });

  it("weist Verifier mit Zeichen ausserhalb von RFC 7636 ab", () => {
    // Gleiche Laenge, aber ein Zeichen, das der Standard nicht zulaesst.
    const unerlaubt = "a".repeat(42) + "+";
    expect(verifyPkce(unerlaubt, "x".repeat(43))).toBe(false);
  });
});

describe("isValidCodeChallenge", () => {
  it("nimmt eine echte S256-Challenge an", () => {
    const { challenge } = verifierUndChallenge();
    expect(isValidCodeChallenge(challenge)).toBe(true);
  });

  it("weist falsche Laengen und Zeichen ab", () => {
    expect(isValidCodeChallenge("")).toBe(false);
    expect(isValidCodeChallenge("a".repeat(42))).toBe(false);
    expect(isValidCodeChallenge("a".repeat(44))).toBe(false);
    // "=" ist die base64-Polsterung; base64url ohne Polsterung hat sie nicht.
    expect(isValidCodeChallenge("a".repeat(42) + "=")).toBe(false);
    expect(isValidCodeChallenge(null)).toBe(false);
  });
});

describe("redirectUriAllowed", () => {
  const registriert = ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:33418/callback"];

  it("nimmt exakt die registrierte Adresse an", () => {
    expect(redirectUriAllowed(registriert, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
  });

  // Das ist der Kern: ein Praefixvergleich haette hier true gesagt, und der
  // Autorisierungscode waere bei einem fremden Pfad gelandet.
  it("laesst keinen angehaengten Pfad durch", () => {
    expect(redirectUriAllowed(registriert, "https://claude.ai/api/mcp/auth_callback/boese")).toBe(false);
    expect(redirectUriAllowed(registriert, "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
  });

  it("laesst keine fremde Domain durch, auch nicht als Unterdomain", () => {
    expect(redirectUriAllowed(registriert, "https://claude.ai.boese.example/api/mcp/auth_callback")).toBe(false);
    expect(redirectUriAllowed(registriert, "https://boese.example/")).toBe(false);
  });

  it("behandelt Leeres und Nicht-Strings als nicht erlaubt", () => {
    expect(redirectUriAllowed(registriert, "")).toBe(false);
    expect(redirectUriAllowed(registriert, null)).toBe(false);
    expect(redirectUriAllowed([], "https://claude.ai/api/mcp/auth_callback")).toBe(false);
  });
});

describe("isUsableRedirectUri", () => {
  it("nimmt https an", () => {
    expect(isUsableRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
  });

  // Der Grund fuer die Ausnahme: Desktop-Clients fangen den Rueckweg auf einem
  // lokalen Port ab.
  it("nimmt http nur auf dem eigenen Rechner an", () => {
    expect(isUsableRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(isUsableRedirectUri("http://127.0.0.1:33418/callback")).toBe(true);
    expect(isUsableRedirectUri("http://boese.example/callback")).toBe(false);
  });

  it("weist alles ab, was kein http(s) ist", () => {
    expect(isUsableRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isUsableRedirectUri("data:text/html,<script>")).toBe(false);
    expect(isUsableRedirectUri("ftp://example.com/")).toBe(false);
    expect(isUsableRedirectUri("nicht mal eine adresse")).toBe(false);
    expect(isUsableRedirectUri("")).toBe(false);
  });

  // RFC 6749 verbietet Fragmente: der Server haengt beim Rueckweg selbst eines
  // an und wuerde ein vorhandenes zerstoeren.
  it("weist Adressen mit Fragment ab", () => {
    expect(isUsableRedirectUri("https://claude.ai/cb#teil")).toBe(false);
  });
});

describe("mcpScopeFromOAuthScope", () => {
  it("gibt read_write nur bei ausdruecklicher Anfrage", () => {
    expect(mcpScopeFromOAuthScope("mcp:read_write")).toBe("read_write");
    expect(mcpScopeFromOAuthScope("mcp:read mcp:read_write")).toBe("read_write");
  });

  // Die sichere Voreinstellung ist die kleinere: RFC 6749 laesst den Parameter
  // weg-lassbar und ueberlaesst dem Server die Wahl.
  it("faellt auf read zurueck", () => {
    expect(mcpScopeFromOAuthScope("mcp:read")).toBe("read");
    expect(mcpScopeFromOAuthScope("")).toBe("read");
    expect(mcpScopeFromOAuthScope(undefined)).toBe("read");
    expect(mcpScopeFromOAuthScope("etwas:erfundenes")).toBe("read");
  });
});

describe("publicOrigin", () => {
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

  it("nimmt x-forwarded-host vor host", () => {
    expect(
      publicOrigin(
        headers({ "x-forwarded-host": "app.frostbreaker.app", "x-forwarded-proto": "https", host: "intern.vercel" }),
        "https://intern.vercel/api/mcp"
      )
    ).toBe("https://app.frostbreaker.app");
  });

  it("nimmt bei einer Proxy-Kette den ersten Eintrag", () => {
    expect(
      publicOrigin(
        headers({ "x-forwarded-host": "app.frostbreaker.app, intern.vercel", "x-forwarded-proto": "https, http" }),
        "https://intern.vercel/api/mcp"
      )
    ).toBe("https://app.frostbreaker.app");
  });

  it("bleibt lokal bei http", () => {
    expect(publicOrigin(headers({ host: "localhost:3000" }), "http://localhost:3000/api/mcp")).toBe(
      "http://localhost:3000"
    );
  });

  it("faellt ohne Header auf die Adresse der Anfrage zurueck", () => {
    expect(publicOrigin(headers({}), "https://app.frostbreaker.app/api/mcp")).toBe(
      "https://app.frostbreaker.app"
    );
  });
});

describe("Die Metadatendokumente", () => {
  const origin = "https://app.frostbreaker.app";

  // Ein Client vergleicht den issuer mit der Adresse, ueber die er das
  // Dokument geholt hat, und bricht bei Abweichung ab.
  it("nennen denselben Aussteller wie die Adresse, unter der sie stehen", () => {
    expect(authorizationServerMetadata(origin).issuer).toBe(origin);
    expect(protectedResourceMetadata(origin).authorization_servers).toEqual([origin]);
  });

  // resource MUSS exakt der geschuetzte Endpunkt sein, sonst lehnt ein
  // sorgfaeltiger Client den Token als "fuer etwas anderes ausgestellt" ab.
  it("nennen als Ressource genau den MCP-Endpunkt", () => {
    expect(protectedResourceMetadata(origin).resource).toBe(`${origin}/api/mcp`);
  });

  it("bieten plain gar nicht erst an", () => {
    expect(authorizationServerMetadata(origin).code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("nennen sich als oeffentlichen Client ohne Geheimnis", () => {
    expect(authorizationServerMetadata(origin).token_endpoint_auth_methods_supported).toEqual(["none"]);
  });
});

describe("Die Rueckwege", () => {
  it("reichen state unveraendert durch", () => {
    const url = new URL(successRedirect("https://claude.ai/cb", "fbk_code_abc", "s tate&=x"));
    expect(url.searchParams.get("code")).toBe("fbk_code_abc");
    expect(url.searchParams.get("state")).toBe("s tate&=x");
  });

  it("lassen state weg, wenn keiner da war", () => {
    const url = new URL(successRedirect("https://claude.ai/cb", "fbk_code_abc", null));
    expect(url.searchParams.has("state")).toBe(false);
  });

  it("erhalten vorhandene Parameter des Ruecksprungziels", () => {
    const url = new URL(errorRedirect("https://claude.ai/cb?vorher=1", "access_denied", "Nein.", "s"));
    expect(url.searchParams.get("vorher")).toBe("1");
    expect(url.searchParams.get("error")).toBe("access_denied");
  });
});
