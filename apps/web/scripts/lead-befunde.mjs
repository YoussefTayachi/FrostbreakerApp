/**
 * lead-befunde - macht aus den Messwerten von lead-scan gewichtete Maengel.
 *
 * Getrennt vom Messen, und das ist kein Ordnungssinn: die Gewichtung aendert
 * sich, sobald ein Lead zurueckschreibt, das Messen nicht. Wer beides in
 * einem Skript hat, laedt fuer jede Regelaenderung dreihundert Seiten neu.
 *
 * Die Reihenfolge stammt aus dem Skill website-finding und ist nach dem
 * sortiert, was ein Inhaber sofort versteht und was ihn Geld kostet:
 *
 *   1. Der Besucher sieht es sofort  (Seite kaputt, leer, unbenutzbar)
 *   2. Er wird nicht gefunden        (kein Titel, keine Beschreibung, kein h1)
 *   3. Nichts fuehrt zum Abschluss   (kein Formular, keine antippbare Nummer)
 *
 * Jeder Mangel traegt seinen Messwert mit. Ein Befund ohne Beleg ist eine
 * Behauptung, und Behauptungen ueber die eigene Website glaubt niemand.
 *
 * Aufruf: node scripts/lead-befunde.mjs out/lead-scan/befunde.jsonl
 */
import { readFile } from "node:fs/promises";

/** Alle Kandidaten eines Leads, jeder mit Stufe und Beleg. */
function maengel(r) {
  const d = r.desktop || {}, h = r.handy || {}, aus = [];
  const nimm = (stufe, was, beleg) => aus.push({ stufe, was, beleg });

  // --- Stufe 1: sieht man sofort
  if (!r.ok) nimm(1, "Seite laedt nicht", r.fehler);
  if (r.status && r.status >= 400) nimm(1, `Server antwortet mit ${r.status}`, `HTTP ${r.status}`);
  // Nur echte Loecher, nicht jede verborgene Schublade: die Rohzahl
  // verborgeneBereiche traf 19 von 40 Leads und war bei der Sichtpruefung
  // fast immer ein Menue-Overlay.
  if (d.echteLoecher > 0)
    nimm(1, "Ein Abschnitt bleibt leer", `${d.echteLoecher} grosse Textbloecke stehen im HTML, sind aber unsichtbar`);
  if (h.ueberbreite > 0)
    nimm(1, "Auf dem Handy laesst sich seitwaerts schieben", `${h.ueberbreite}px breiter als der Bildschirm`);
  if (h.zielZuKlein >= 15)
    nimm(1, "Knoepfe auf dem Handy zu klein zum Treffen", `${h.zielZuKlein} Ziele unter 44px`);
  if (h.textUnter12px >= 5)
    nimm(1, "Text auf dem Handy zu klein zum Lesen", `${h.textUnter12px} Textstellen unter 12px`);
  if (r.konsolenfehlerAnzahl >= 3)
    nimm(1, "Skriptfehler im Browser", `${r.konsolenfehlerAnzahl} Fehler, u.a. ${(r.konsolenfehler || [])[0] || ""}`.slice(0, 120));

  // --- Stufe 2: wird nicht gefunden
  if (d.titelIstDomain) nimm(2, "Der Seitentitel ist nur der Domainname", `<title> lautet ${d.titel}`);
  if (!d.beschreibung) nimm(2, "Keine Beschreibung fuer die Suche", "meta description fehlt");
  else if (d.beschreibung.length < 50) nimm(2, "Beschreibung zu kurz", `${d.beschreibung.length} Zeichen`);
  if (d.h1 === 0) nimm(2, "Keine Ueberschrift auf der Startseite", "kein <h1> im Dokument");
  else if (d.h1 > 3) nimm(2, "Mehrere konkurrierende Ueberschriften", `${d.h1} h1-Elemente`);
  if (!d.ogImage) nimm(2, "Beim Teilen erscheint kein Bild", "og:image fehlt");
  if (!d.sprache) nimm(2, "Keine Sprache hinterlegt", "html lang fehlt");

  // --- Stufe 3: nichts fuehrt zum Abschluss
  if (d.telLinks === 0 && (d.blankeNummern || []).length)
    nimm(3, "Telefonnummer laesst sich nicht antippen", `steht als Text da: ${d.blankeNummern[0]}`);
  if (d.formulare === 0 && d.mailLinks === 0 && d.telLinks === 0)
    nimm(3, "Kein Weg zur Anfrage", "kein Formular, keine Mailadresse, keine Nummer");
  else if (d.formulare === 0) nimm(3, "Kein Kontaktformular", "kein <form> auf der Seite");
  if (d.knoepfe <= 1) nimm(3, "Kein Aufruf zum Handeln", `${d.knoepfe} Knopf auf der ganzen Seite`);

  return aus;
}

const datei = process.argv[2] || "out/lead-scan/befunde.jsonl";
const zeilen = (await readFile(datei, "utf8")).split(/\r?\n/).filter(Boolean);

let mitDrei = 0, mitZwei = 0, mitEinem = 0, ohne = 0;
const nachStufe = { 1: 0, 2: 0, 3: 0 };
const haeufig = new Map();

for (const z of zeilen) {
  const r = JSON.parse(z);
  const m = maengel(r).sort((a, b) => a.stufe - b.stufe);
  m.forEach((x) => {
    nachStufe[x.stufe]++;
    haeufig.set(x.was, (haeufig.get(x.was) || 0) + 1);
  });
  // Nur die drei staerksten. Eine Liste aufzufuellen heisst, den schwaechsten
  // Punkt neben den staerksten zu stellen und beide zu verwaessern.
  const drei = m.slice(0, 3);
  if (drei.length >= 3) mitDrei++; else if (drei.length === 2) mitZwei++;
  else if (drei.length === 1) mitEinem++; else ohne++;

  console.log(`\n== ${r.url}${r.ok ? "" : "   (nicht erreichbar)"}`);
  drei.forEach((x) => console.log(`   [${x.stufe}] ${x.was}\n       Beleg: ${x.beleg}`));
  if (!drei.length) console.log("   nichts gefunden, was eine Mail traegt");
}

console.log(`\n\n--- ${zeilen.length} Leads ---`);
console.log(`  drei Maengel: ${mitDrei}   zwei: ${mitZwei}   einer: ${mitEinem}   keiner: ${ohne}`);
console.log(`  nach Stufe: sofort sichtbar ${nachStufe[1]}, nicht auffindbar ${nachStufe[2]}, kein Abschluss ${nachStufe[3]}`);
console.log("\n  Haeufigste Maengel:");
[...haeufig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([was, n]) => console.log(`    ${String(n).padStart(3)}x  ${was}`));
