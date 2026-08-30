/**
 * lead-scan - misst die Website eines Leads, statt sie anzusehen.
 *
 * Der Skill website-finding laesst einen echten Browser hinsehen und verbietet
 * ausdruecklich, den Text allein auszulesen: get_page_text hat am 2026-08-26
 * aus "Welcome to<br>Vert Construction" ein "Welcome toVert Construction"
 * gemacht, also einen Tippfehler erfunden, der nie auf der Seite stand.
 *
 * Playwright rendert genauso echt wie die Chrome-Erweiterung, kostet aber
 * keine Token je Seite und laeuft parallel. Was hier herauskommt, sind
 * Messwerte und Screenshots, keine Formulierungen: welche drei Maengel eine
 * Mail wert sind, entscheidet danach ein Mensch oder ein Modell an einem
 * kleinen JSON, nicht an dreihundert gerenderten Seiten.
 *
 * Aufruf:
 *   node scripts/lead-scan.mjs https://example.com https://zweite.at
 *   node scripts/lead-scan.mjs --datei leads.txt --parallel 6 --out out/scan
 *
 * Ausgabe: eine Zeile JSON je Lead nach <out>/befunde.jsonl, dazu je zwei
 * Screenshots (Desktop und Handy).
 */
import { chromium, devices } from "@playwright/test";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import path from "node:path";

const HANDY = devices["iPhone 13"];
const ZEIT_SEITE = 30000;   // Obergrenze je Seite, danach gilt sie als nicht erreichbar
const ZEIT_RUHE = 2500;     // Wartezeit nach dem Laden, fuer Einblend-Animationen

/** Sonden im Seitenkontext. Bewusst klein gehalten: lange Schleifen haben den
 *  Renderer beim Handbetrieb zweimal eingefroren. */
function sonden() {
  const meta = (n) => (document.querySelector(`meta[name='${n}']`) || {}).content || null;
  const phoneRe = /(\+?\d[\d\s/().-]{7,})/;

  /* Eine blanke Telefonnummer ist ein guter Befund, ein erfundener ein
     teurer Fehler. Der erste Lauf am 2026-08-30 meldete auf drei von drei
     Seiten Treffer wie `{"baseUrl":"https://s.w.org/...` und
     `button#consent-banner-prefs-button {`: Skript- und CSS-Inhalte sind
     Textknoten ohne Kinder und enthalten reichlich Ziffern.

     Zwei Siebe dagegen. Erstens kein script/style/noscript/template.
     Zweitens muss der Text UEBERWIEGEND aus der Nummer bestehen: hoechstens
     2,5 Zeichen je Ziffer, sonst ist es Fliesstext oder Code, in dem
     zufaellig Ziffern stehen. */
  const istCode = (e) => !!e.closest("script, style, noscript, template");
  const nurNummer = (t) => {
    const ziffern = (t.match(/\d/g) || []).length;
    return ziffern >= 7 && ziffern <= 15 && t.length <= ziffern * 2.5;
  };
  const blanke = [...document.querySelectorAll("body *")]
    .filter((e) => e.children.length === 0 && !e.closest("a") && !istCode(e))
    .map((e) => e.textContent.trim())
    .filter((t) => phoneRe.test(t) && nurNummer(t))
    .map((t) => t.slice(0, 40));

  // Baukasten-Themes setzen Abschnitte vor einer Einblend-Animation auf
  // visibility:hidden. Bricht das Skript, bleiben sie fuer immer unsichtbar
  // und stehen trotzdem im HTML. Gezaehlt werden nur die Wurzeln, sonst
  // zaehlt jedes Kind eines verborgenen Blocks mit.
  const verborgen = [...document.querySelectorAll("body *")].filter(
    (e) => getComputedStyle(e).visibility === "hidden" && e.getBoundingClientRect().width > 50
  );

  /* Die Rohzahl taugt nicht als Vorwurf. Gemessen am 2026-08-30 ueber 40
     echte Leads meldeten 19 davon verborgene Bereiche, und die Sichtpruefung
     des staerksten Falls (vetsocial.nl, 15 Bereiche) zeigte eine voellig
     intakte Seite: verborgen waren das Menue-Overlay und Animationsstufen.

     Ein Befund ist es erst, wenn dort ein LOCH waere: ein grosser Block mit
     echtem Text, der nicht zu einem Menue, Dialog oder Cookie-Banner gehoert.
     Ein Fehlalarm ist hier teurer als ein Durchrutscher, weil er in einer
     Kaltmail steht und der Empfaenger seine Seite besser kennt als wir. */
  const istOverlay = (e) => !!e.closest(
    "nav, dialog, [role='dialog'], [aria-modal='true'], [class*='menu'], [class*='modal'], " +
    "[class*='popup'], [class*='overlay'], [class*='cookie'], [class*='consent'], [class*='drawer']"
  );
  const wurzeln = verborgen.filter(
    (e) => e.parentElement && getComputedStyle(e.parentElement).visibility !== "hidden"
  );
  const echteLoecher = wurzeln.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.height > 150 && r.width > window.innerWidth * 0.4 &&
           !istOverlay(e) && (e.innerText || "").trim().length > 40;
  });

  const txt = (document.body.innerText || "").replace(/\s+/g, " ").trim();

  return {
    titel: document.title || null,
    /* Gesucht ist ein Titel, der nur der Domainname ist, also nichts, was zu
       einer Suche passt. Verglichen wird deshalb gegen ein MUSTER und nicht
       gegen die eigene Adresse: vertconstruction.com traegt den Titel
       "vertconstruction.co.uk", also eine fremde Domain, und ein Gleichheits-
       test haette das durchgewinkt. */
    titelIstDomain: /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test((document.title || "").trim()),
    beschreibung: meta("description"),
    viewport: meta("viewport"),
    h1: document.querySelectorAll("h1").length,
    h1Text: (document.querySelector("h1")?.innerText || "").trim().slice(0, 80) || null,
    ogImage: !!document.querySelector("meta[property='og:image']"),
    sprache: document.documentElement.lang || null,
    telLinks: document.querySelectorAll("a[href^='tel:']").length,
    mailLinks: document.querySelectorAll("a[href^='mailto:']").length,
    knoepfe: document.querySelectorAll("a.elementor-button, button, .btn, [role='button']").length,
    formulare: document.querySelectorAll("form").length,
    blankeNummern: blanke.slice(0, 3),
    verborgenGesamt: verborgen.length,
    verborgeneBereiche: wurzeln.length,
    echteLoecher: echteLoecher.length,
    wartetAufAnimation: document.querySelectorAll(".elementor-invisible").length,
    bilderUngeladen: [...document.images].filter((i) => !i.complete).length,
    bilderGesamt: document.images.length,
    textLaenge: txt.length,
    jahreszahlen: [...txt.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => m[0]).slice(0, 6),
  };
}

/** In Schritten bis zum Fuss scrollen und zurueck.
 *
 *  Ohne das meldet jedes Bild unterhalb des sichtbaren Bereichs complete=false,
 *  weil es noch gar nicht geladen werden SOLL. Das ist Lazy Loading und kein
 *  Mangel; wer es als einen meldet, schreibt einen Vorwurf in eine Kaltmail,
 *  der nicht stimmt.
 */
async function durchscrollen(seite) {
  await seite.evaluate(async () => {
    const schritt = Math.max(400, window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += schritt) {
      window.scrollTo(0, y);
      await new Promise((w) => setTimeout(w, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((w) => setTimeout(w, 200));
  });
}

/** Einen Lead messen. Wirft nie: ein Fehler ist selbst ein Befund. */
async function messeLead(browser, url, ordner) {
  const start = Date.now();
  const name = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]/gi, "_").slice(0, 60);
  const ergebnis = { url, ok: false, fehler: null, dauerMs: 0 };

  let kontext;
  try {
    kontext = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 1440, height: 900 } });
    const seite = await kontext.newPage();

    const konsole = [];
    seite.on("console", (m) => { if (m.type() === "error") konsole.push(m.text().slice(0, 160)); });
    seite.on("pageerror", (e) => konsole.push("pageerror: " + String(e).slice(0, 160)));

    const antwort = await seite.goto(url, { waitUntil: "domcontentloaded", timeout: ZEIT_SEITE });
    ergebnis.status = antwort ? antwort.status() : null;
    ergebnis.endUrl = seite.url();
    await seite.waitForTimeout(ZEIT_RUHE);
    await durchscrollen(seite);

    ergebnis.desktop = await seite.evaluate(sonden);
    ergebnis.konsolenfehler = konsole.slice(0, 5);
    ergebnis.konsolenfehlerAnzahl = konsole.length;
    await seite.screenshot({ path: path.join(ordner, `${name}-desktop.png`), fullPage: false });

    // Handy als eigener Kontext, nicht als Groessenaenderung: ein Layout, das
    // bei 390 Pixeln bricht, bricht oft erst mit dem mobilen User-Agent, weil
    // Baukaesten daran ihre Weiche haengen.
    const mKontext = await browser.newContext({ ...HANDY });
    const mSeite = await mKontext.newPage();
    await mSeite.goto(url, { waitUntil: "domcontentloaded", timeout: ZEIT_SEITE });
    await mSeite.waitForTimeout(ZEIT_RUHE);
    ergebnis.handy = await mSeite.evaluate(() => ({
      // Waagrechtes Scrollen auf dem Handy heisst: der Inhalt passt nicht.
      // 4 Pixel Toleranz, weil Rundungen sonst jede zweite Seite anschwaerzen.
      ueberbreite: Math.max(0, document.documentElement.scrollWidth - window.innerWidth - 4),
      /* Nicht das Minimum, sondern die Menge. Ein einzelnes 10px-Element ist
         fast immer das Kleingedruckte im Cookie-Banner und taugt nicht als
         Vorwurf; dreissig davon heissen, dass der Fliesstext zu klein ist.
         Gezaehlt wird nur, was auch Text traegt. */
      textUnter12px: [...document.querySelectorAll("p, li, a, span")]
        .slice(0, 400)
        .filter((e) => (e.innerText || "").trim().length > 15 &&
                       (parseFloat(getComputedStyle(e).fontSize) || 99) < 12).length,
      zielZuKlein: [...document.querySelectorAll("a, button")]
        .slice(0, 200)
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
        }).length,
    }));
    await mSeite.screenshot({ path: path.join(ordner, `${name}-handy.png`), fullPage: false });
    await mKontext.close();

    ergebnis.ok = true;
  } catch (e) {
    // Zertifikatsfehler, Zeitueberschreitung, kein DNS: alles drei sind Maengel,
    // die ein Inhaber sofort versteht. Sie gehoeren in die Ausgabe und nicht
    // in einen Abbruch.
    ergebnis.fehler = String(e.message || e).split("\n")[0].slice(0, 200);
  } finally {
    if (kontext) await kontext.close().catch(() => {});
    ergebnis.dauerMs = Date.now() - start;
  }
  return ergebnis;
}

/** Eine Warteschlange mit fester Breite. Mehr Kontexte als Kerne bringen
 *  nichts, weil jeder eine eigene Renderer-Instanz ist. */
async function schwarm(browser, urls, breite, ordner, ziel) {
  let naechster = 0, fertig = 0;
  const alle = [];
  const arbeiter = Array.from({ length: Math.min(breite, urls.length) }, async () => {
    while (naechster < urls.length) {
      const i = naechster++;
      const r = await messeLead(browser, urls[i], ordner);
      alle.push(r);
      await appendFile(ziel, JSON.stringify(r) + "\n", "utf8");
      fertig++;
      process.stderr.write(`  ${String(fertig).padStart(3)}/${urls.length}  ${r.ok ? "ok " : "FEHL"}  ${String(r.dauerMs).padStart(5)}ms  ${r.url}\n`);
    }
  });
  await Promise.all(arbeiter);
  return alle;
}

const argv = process.argv.slice(2);
const wert = (flagge, standard) => {
  const i = argv.indexOf(flagge);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : standard;
};

const ordner = path.resolve(wert("--out", "out/lead-scan"));
const breite = parseInt(wert("--parallel", "4"), 10);
const datei = wert("--datei", null);

let urls = argv.filter((a) => a.startsWith("http"));
if (datei) {
  const roh = await readFile(datei, "utf8");
  urls = urls.concat(roh.split(/\r?\n/).map((z) => z.trim()).filter((z) => z && !z.startsWith("#")));
}
urls = [...new Set(urls.map((u) => (u.startsWith("http") ? u : "https://" + u)))];

if (!urls.length) {
  console.error("Keine Adressen. Aufruf: node scripts/lead-scan.mjs <url> ... [--datei leads.txt] [--parallel 6]");
  process.exit(1);
}

await mkdir(ordner, { recursive: true });
const ziel = path.join(ordner, "befunde.jsonl");
const t0 = Date.now();
process.stderr.write(`\n  ${urls.length} Adressen, ${breite} parallel, nach ${ordner}\n\n`);

const browser = await chromium.launch();
const alle = await schwarm(browser, urls, breite, ordner, ziel);
await browser.close();

const dauer = (Date.now() - t0) / 1000;
const ok = alle.filter((r) => r.ok).length;
process.stderr.write(
  `\n  ${ok}/${alle.length} gemessen in ${dauer.toFixed(1)}s` +
  `  (${(dauer / alle.length).toFixed(1)}s je Seite, hochgerechnet auf 300: ${((dauer / alle.length) * 300 / 60).toFixed(0)} min)\n\n`
);
