import { describe, expect, it } from "vitest";
import { isMissingFunction, missingFunctionMessage, requeueFailure } from "./requeue";

/**
 * Diese Tests sind der Grund, warum "nochmal erzeugen" beim Website-Befund
 * schon jetzt eine brauchbare Meldung liefert, obwohl Migration 0104 in der
 * Produktionsdatenbank noch nicht angewendet ist: der Fall laesst sich hier
 * nachstellen, ohne ihn dort auszuloesen.
 *
 * Die nachgestellte Fehlermeldung ist der Wortlaut von PostgREST; der Code
 * PGRST202 steht in dessen Dokumentation. Beides wird geprueft, weil an
 * dieser Datenbank noch nicht nachgemessen werden konnte, welcher der beiden
 * Wege wirklich ankommt (siehe Kopf von requeue.ts).
 */
const NOT_FOUND = {
  code: "PGRST202",
  message:
    "Could not find the function public.requeue_website_finding(p_business_ids) in the schema cache",
};

describe("fehlende Datenbankfunktion erkennen", () => {
  it("erkennt sie am Fehlercode", () => {
    expect(isMissingFunction({ code: "PGRST202", message: "irgendwas" })).toBe(true);
  });

  it("erkennt sie auch ohne Code am Wortlaut", () => {
    expect(isMissingFunction({ message: NOT_FOUND.message })).toBe(true);
  });

  it("haelt andere Datenbankfehler auseinander", () => {
    expect(isMissingFunction({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
    expect(isMissingFunction(undefined)).toBe(false);
  });
});

describe("Meldung an den Betreiber", () => {
  it("nennt die Migration beim Namen, denn nur sie hilft", () => {
    const text = missingFunctionMessage("requeue_website_finding");
    expect(text).toContain("0104_requeue_website_finding.sql");
    expect(text).toContain("requeue_website_finding");
  });

  it("bleibt verstaendlich, wenn eine unbekannte Funktion fehlt", () => {
    const text = missingFunctionMessage("requeue_irgendwas");
    expect(text).toContain("requeue_irgendwas");
    expect(text).toContain("noch nicht angewendet");
  });
});

describe("Antwort der Route", () => {
  // 503 und nicht 500: der Aufruf war richtig, es fehlt ein Stueck
  // Einrichtung. Ein spaeterer Versuch kann klappen.
  it("macht aus der fehlenden Funktion eine 503 mit eigenem Grund", () => {
    const failure = requeueFailure("requeue_website_finding", NOT_FOUND);
    expect(failure.status).toBe(503);
    expect(failure.reason).toBe("missing_migration");
    expect(failure.error).toContain("0104");
  });

  it("laesst echte Datenbankfehler unveraendert durch", () => {
    const failure = requeueFailure("requeue_personalization", {
      code: "42501",
      message: "permission denied for table jobs",
    });
    expect(failure.status).toBe(500);
    expect(failure.reason).toBe("rpc_failed");
    expect(failure.error).toBe("permission denied for table jobs");
  });

  it("erfindet keine Meldung, wenn der Fehler keine hat", () => {
    const failure = requeueFailure("requeue_personalization", { code: null, message: null });
    expect(failure.status).toBe(500);
    expect(failure.error).toBe("Unbekannter Datenbankfehler");
  });
});
