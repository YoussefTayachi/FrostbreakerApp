/**
 * Den lesbaren Text einer Instantly-Mail bestimmen.
 *
 * DER ANLASS: von 184 gespeicherten ausgehenden Nachrichten hatten am
 * 2026-08-04 alle 184 einen leeren Body: der Posteingang zeigte im
 * Gespraechsverlauf zu jeder verschickten Mail eine leere Zeile. Der Sync
 * las ausschliesslich body.text, und bei aus einer Kampagne versendeten
 * Mails liefert Instantly dort nichts; der Inhalt steht in body.html.
 *
 * Deshalb hier ein Ruecksfall statt einer Notiz im Sync: die Umwandlung
 * hat genug Faelle (Zeilenumbrueche, Entitaeten, Signaturbloecke), dass sie
 * eigene Tests verdient.
 */

export type InstantlyBody = { text?: string | null; html?: string | null } | null | undefined;

/** Entitaeten ohne Regel: Zeichensetzung, Symbole, Sonderbuchstaben. */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  laquo: "«",
  raquo: "»",
  middot: "·",
  deg: "°",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  szlig: "ß",
  aelig: "æ",
  oslash: "ø",
  eth: "ð",
  thorn: "þ",
};

/**
 * Die Akzent-Entitaeten nach Regel statt nach Tabelle.
 *
 * &ouml; ist "o" plus Trema, &eacute; ist "e" plus Akut; die ganze
 * Latin-1-Familie folgt diesem Muster. Aus Buchstabe und kombinierendem
 * Zeichen zusammengesetzt und mit normalize("NFC") verschmolzen deckt das
 * rund 60 Entitaeten mit acht Zeilen ab, in beiden Schreibweisen (&Ouml;
 * ebenso wie &ouml;). Die Alternative waere eine Tabelle, in der genau der
 * eine Buchstabe fehlt, den der naechste Kunde braucht; so ist es hier
 * begonnen und mit fehlenden Umlauten aufgefallen.
 */
const ACCENTS: Record<string, string> = {
  grave: "̀",
  acute: "́",
  circ: "̂",
  tilde: "̃",
  uml: "̈",
  ring: "̊",
  cedil: "̧",
};

function decodeNamed(name: string): string | null {
  const direct = ENTITIES[name] ?? ENTITIES[name.toLowerCase()];
  if (direct) return direct;
  const accent = /^([a-zA-Z])(grave|acute|circ|tilde|uml|ring|cedil)$/.exec(name);
  if (!accent) return null;
  const composed = (accent[1] + ACCENTS[accent[2]]).normalize("NFC");
  // Nur wenn die Verschmelzung wirklich ein Zeichen ergeben hat; sonst
  // bliebe ein nacktes kombinierendes Zeichen im Text stehen.
  return composed.length === 1 ? composed : null;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-zA-Z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const num = code[1] === "x" || code[1] === "X"
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      // Unbrauchbare Codepunkte unveraendert stehen lassen: ein sichtbares
      // "&#0;" ist ehrlicher als ein stiller Steuerzeichen-Einschub.
      return Number.isFinite(num) && num > 0 && num <= 0x10ffff ? String.fromCodePoint(num) : whole;
    }
    return decodeNamed(code) ?? whole;
  });
}

/**
 * HTML zu Text.
 *
 * Kein Parser, und das ist Absicht: hier kommt der eigene, von uns selbst
 * verschickte Kampagnentext zurueck, kein fremdes Dokument. Gebraucht wird
 * genau eine Sache: dass die Zeilenumbrueche dort bleiben, wo der Autor
 * sie gesetzt hat.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      // Inhalt, der nie sichtbar war, vollstaendig entfernen; sonst landet
      // CSS als Absatz im Gespraechsverlauf.
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      // Blockenden werden zu Umbruechen, bevor die Tags fallen.
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)\s*>/gi, "\n")
      .replace(/<(hr)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    // Nach dem Entfernen bleiben oft Zeilen aus reinem Leerraum stehen.
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    // Drei und mehr Leerzeilen sagen nichts, was zwei nicht auch sagen.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Der Text, der gespeichert wird.
 *
 * Reihenfolge: text vor html. Wo Instantly beides liefert, ist text bereits
 * die Fassung, die der Empfaenger im Nur-Text-Teil bekommen hat; die
 * Umwandlung unten kann sie hoechstens verschlechtern.
 *
 * Ein Body, der nur aus Leerraum besteht, gilt als leer: sonst gewinnt ein
 * text-Feld mit einem einzelnen Zeilenumbruch gegen ein vollstaendiges html.
 */
export function emailBodyText(body: InstantlyBody): string {
  const text = (body?.text ?? "").trim();
  if (text) return text;
  const html = (body?.html ?? "").trim();
  return html ? htmlToText(html) : "";
}
