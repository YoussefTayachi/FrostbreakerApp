/**
 * Aus einer HTML-Seite lesbaren Text machen.
 *
 * WOFUER
 *
 * Damit niemand sein eigenes Angebot in sieben leere Felder tippen muss, liest
 * api/offers/from-website die Website und laesst das Modell daraus Vorschlaege
 * machen. Dafuer muss das HTML vorher auf das reduziert werden, was Aussage
 * traegt.
 *
 * WARUM KEIN HTML-PARSER
 *
 * Der Worker macht dasselbe mit `trafilatura` (personalize.py,
 * _safe_website_text). In TypeScript gibt es dafuer kein Gegenstueck, das
 * ohne DOM auskommt -- und ein DOM-Parser waere hier ein
 * Abhaengigkeits-Zuwachs fuer eine Aufgabe, die kein Parsen im engeren Sinn
 * ist: es wird nichts navigiert, nichts selektiert, es wird weggeworfen.
 *
 * Regulaere Ausdruecke sind fuer *korrektes* HTML-Parsen die falsche Wahl.
 * Fuer "alles zwischen spitzen Klammern faellt raus" sind sie genau richtig,
 * und der schlimmste denkbare Fehler ist ein Textschnipsel zu viel oder zu
 * wenig im Prompt -- nicht eine falsch gerenderte Seite.
 *
 * WAS BEWUSST DRIN BLEIBT
 *
 * `<header>` wird NICHT entfernt, obwohl das nach Navigation klingt. Bei den
 * meisten Firmenseiten steht genau dort die Kernaussage ("Wir bauen X fuer
 * Y") -- also das wertvollste Stueck der ganzen Seite. Entfernt werden nur
 * `<nav>` und `<footer>`, die zuverlaessig aus Linklisten bestehen.
 */

/** Deckel fuer den Text, der ins Modell geht. Der Worker nimmt 6000 fuer einen
 *  einzelnen Satz; hier sollen sieben Felder entstehen, deshalb mehr -- aber
 *  weit unterhalb dessen, wo Kosten und Aufmerksamkeit des Modells kippen. */
export const MAX_SITE_CHARS = 12_000;

/** Unterhalb davon ist die Seite keine Grundlage fuer Vorschlaege (JS-Seite
 *  ohne serverseitigen Inhalt, Weiterleitung, Fehlerseite). Gleiche Schwelle
 *  wie _safe_website_text im Worker. */
export const MIN_USEFUL_CHARS = 100;

export type WebsiteContent = {
  /** Aus <title>. Oft die knappste Fassung dessen, was die Firma tut. */
  title: string | null;
  /** Aus <meta name="description"> oder og:description. */
  description: string | null;
  /** Der Fliesstext, entkernt und gedeckelt. */
  text: string;
};

const BLOCK_ELEMENTS = /<\/?(p|div|br|li|tr|h[1-6]|section|article|header|main|td)\b[^>]*>/gi;

/** Elemente, deren INHALT komplett weg soll -- nicht nur die Tags. */
const DROPPED_WITH_CONTENT =
  /<(script|style|noscript|svg|iframe|template|nav|footer|form|select)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Die paar Entities, die in echtem Fliesstext vorkommen.
 *
 * Bewusst eine kurze Liste statt einer vollstaendigen Tabelle: alles darueber
 * hinaus ist Sonderzeichen-Kosmetik in einem Text, den ausschliesslich ein
 * Sprachmodell liest. Ein uebrig gebliebenes `&hellip;` kostet nichts.
 */
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&ndash;": "-",
  "&mdash;": "-",
  "&auml;": "ä",
  "&ouml;": "ö",
  "&uuml;": "ü",
  "&Auml;": "Ä",
  "&Ouml;": "Ö",
  "&Uuml;": "Ü",
  "&szlig;": "ß",
  "&euro;": "€",
};

function decodeEntities(s: string): string {
  let out = s;
  for (const [entity, replacement] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(replacement);
  }
  // Numerische Entities (&#8217; und &#x27;) -- die streuen echte Seiten
  // reichlich, vor allem Apostrophe aus Textverarbeitungen.
  out = out.replace(/&#(\d{1,6});/g, (_, code) => String.fromCodePoint(Number(code)));
  out = out.replace(/&#x([0-9a-fA-F]{1,6});/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));
  return out;
}

function firstMatch(html: string, re: RegExp): string | null {
  return html.match(re)?.[1] ?? null;
}

/** Reiner Text aus HTML: Skripte und Linklisten raus, Tags raus, Umbrueche
 *  aus Blockelementen erhalten, Leerraum eingedampft, am Ende gedeckelt. */
export function htmlToText(html: string, maxChars: number = MAX_SITE_CHARS): string {
  let s = html.replace(DROPPED_WITH_CONTENT, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Blockgrenzen zu Zeilenumbruechen, BEVOR die uebrigen Tags fallen: sonst
  // klebt die Ueberschrift am ersten Absatz und das Modell liest einen Satz,
  // wo zwei stehen.
  s = s.replace(BLOCK_ELEMENTS, "\n");
  s = s.replace(/<[^>]*>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+/g, " ");
  // Jede Folge von Umbruechen wird EIN Umbruch. Verschachtelte Blockelemente
  // erzeugen sonst Kaskaden von Leerzeilen (<div><p>Text</p></div> waeren
  // schon drei), und eine Leerzeile sagt dem Modell nichts, was der einfache
  // Umbruch nicht auch sagt -- sie kostet nur Zeichen im Deckel.
  s = s.replace(/[ \t]*\n\s*/g, "\n");
  return s.trim().slice(0, maxChars);
}

/**
 * Titel, Beschreibung und Fliesstext einer Seite.
 *
 * Titel und Meta-Beschreibung stehen getrennt, weil sie eine andere Qualitaet
 * haben als der Rest: sie sind die vom Betreiber SELBST gewaehlte Kurzfassung
 * dessen, was er tut. Im Fliesstext gingen sie zwischen Cookie-Hinweisen und
 * Referenzlogos unter.
 */
export function extractWebsiteContent(html: string, maxChars: number = MAX_SITE_CHARS): WebsiteContent {
  const rawTitle = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawDescription =
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ??
    firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) ??
    firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);

  const clean = (v: string | null) => {
    const text = v ? decodeEntities(v).replace(/\s+/g, " ").trim() : "";
    return text.length > 0 ? text : null;
  };

  return {
    title: clean(rawTitle),
    description: clean(rawDescription),
    text: htmlToText(html, maxChars),
  };
}

/** Reicht das fuer eine Auswertung? Verhindert, dass eine leere JS-Seite als
 *  "Website gelesen" durchgeht und das Modell sich den Rest ausdenkt. */
export function hasEnoughContent(content: WebsiteContent): boolean {
  return content.text.length >= MIN_USEFUL_CHARS;
}

/**
 * Eine getippte Eingabe zu einer aufrufbaren URL machen.
 *
 * Niemand tippt "https://" mit. Ohne diese Ergaenzung scheitert der Abruf an
 * einer Eingabe, die fuer den Nutzer voellig richtig aussieht ("firma.de").
 * Nur http/https: alles andere (javascript:, file:, data:) hat in einem
 * serverseitigen Abruf nichts verloren.
 */
export function normalizeWebsiteUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}
