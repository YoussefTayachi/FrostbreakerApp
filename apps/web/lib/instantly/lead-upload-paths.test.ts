import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Wer Leads zu Instantly hochlaedt, MUSS buildInstantlyLead benutzen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ES DIESEN TEST GIBT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Weil derselbe Fehler zweimal passiert ist, und beide Male still.
 *
 * Am 2026-08-27 legte buildInstantlyLead den Website-Befund als Feld auf
 * oberster Ebene ab. Instantlys Schema hat additionalProperties: false, das
 * Feld fiel weg, und 858 Leads bekamen eine Mail mit einer leeren Stelle.
 *
 * Am 2026-08-28 stellte sich heraus, dass campaigns/[id]/leads/route.ts das
 * Lead-Objekt gar nicht ueber buildInstantlyLead baute, sondern mit fuenf
 * abgeschriebenen Feldern. websiteFinding war keines davon. Das ist der Pfad,
 * der bei einem Lead-Abo regelmaessig laeuft.
 *
 * Beide Male waren alle Tests gruen. Ein Test, der Vorschau und Upload
 * gegeneinander vergleicht, faellt nicht auf, wenn eine DRITTE Stelle
 * ausschert; er kennt sie nicht.
 *
 * Deshalb dieser Test: er liest den Quelltext und prueft eine Regel, die
 * keine einzelne Funktion pruefen kann. Kommt ein neuer Upload-Pfad dazu,
 * faellt er sofort auf, statt erst an einer Kampagne mit tausend Empfaengern.
 *
 * Die Regel selbst ist bewusst simpel gehalten: wer die Adresse des
 * Upload-Endpunkts im Text stehen hat, muss auch den Namen der Bau-Funktion
 * im Text stehen haben. Das faengt Abschriften, nicht jede denkbare
 * Umgehung, und mehr soll es nicht.
 */

const UPLOAD_ENDPUNKT = "/api/v2/leads/add";
const BAU_FUNKTION = "buildInstantlyLead";

/** lib/ und app/ ab dem Wurzelverzeichnis dieses Pakets. */
const WURZELN = ["lib", "app"];

/**
 * Kommentare raus, bevor gesucht wird.
 *
 * Ohne das zaehlt jede Datei mit, die den Endpunkt nur ERWAEHNT. Genau das
 * passierte beim ersten Lauf dieses Tests: backfill-finding/route.ts und
 * campaigns.ts beschreiben den Upload im Kopfkommentar, laden aber selbst
 * nichts hoch. Ein Waechter, der Prosa fuer Code haelt, meldet Fehlalarme und
 * wird dann abgeschaltet.
 */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function alleQuelldateien(verzeichnis: string): string[] {
  const treffer: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    if (eintrag === "node_modules" || eintrag === ".next") continue;
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) {
      treffer.push(...alleQuelldateien(pfad));
    } else if (/\.(ts|tsx)$/.test(eintrag) && !/\.test\.tsx?$/.test(eintrag)) {
      treffer.push(pfad);
    }
  }
  return treffer;
}

describe("Upload-Pfade zu Instantly", () => {
  const dateien = WURZELN.flatMap((w) => alleQuelldateien(w));

  it("findet ueberhaupt Quelldateien", () => {
    // Sonst waere der Test unten gruen, weil er nichts geprueft hat.
    expect(dateien.length).toBeGreaterThan(100);
  });

  it("jede Datei, die Leads hochlaedt, benutzt buildInstantlyLead", () => {
    const ausreisser: string[] = [];
    for (const pfad of dateien) {
      const code = ohneKommentare(readFileSync(pfad, "utf8"));
      if (!code.includes(UPLOAD_ENDPUNKT)) continue;
      if (!code.includes(BAU_FUNKTION)) ausreisser.push(pfad);
    }
    expect(
      ausreisser,
      `Diese Dateien laden Leads hoch, ohne ${BAU_FUNKTION} zu benutzen. ` +
        "Sie bauen das Lead-Objekt vermutlich selbst und verlieren dabei Felder, " +
        "zuletzt websiteFinding (siehe Kopfkommentar)."
    ).toEqual([]);
  });

  it("genau zwei Pfade laden ueberhaupt hoch", () => {
    /**
     * Kein Selbstzweck: je mehr Stellen hochladen, desto mehr Stellen koennen
     * ausscheren. Kommt eine dritte dazu, soll das eine bewusste Entscheidung
     * sein und keine Nebenwirkung. Wer hier die Zahl erhoeht, moege im selben
     * Zug pruefen, ob der neue Pfad auch die Rueckhaltung ohne Befund kennt
     * (splitByWebsiteFinding).
     */
    const hochlader = dateien.filter((p) => {
      const code = ohneKommentare(readFileSync(p, "utf8"));
      return code.includes(UPLOAD_ENDPUNKT);
    });
    expect(hochlader.map((p) => p.replace(/\\/g, "/")).sort()).toEqual([
      "app/api/instantly/campaigns/[id]/leads/route.ts",
      "lib/instantly/create-campaign.ts",
    ]);
  });
});
