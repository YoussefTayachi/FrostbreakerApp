/**
 * Die Mail, wie der Empfaenger sie bekommt.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WOZU
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Im Kampagnen-Editor steht {{websiteFinding}}, und was daraus wird, sieht
 * bisher niemand. Die App warnt nur mit einer Zahl ("X Leads ohne Befund",
 * lib/campaign-readiness.ts und splitByWebsiteFinding), und diese Zahl sagt
 * nichts darueber, wie der Satz im fertigen Text sitzt oder ob ohne ihn ein
 * Absatz auseinanderfaellt.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIE WERTE NICHT HIER GELESEN WERDEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die Zuordnung "welche Spalte steckt hinter welchem Tag" steht in
 * mergeTagValues (lib/instantly/campaigns.ts), und derselbe Aufruf baut das
 * Lead-Objekt, das beim Kampagnenstart tatsaechlich zu Instantly hochgeht.
 * Eine Vorschau mit eigener Zuordnung waere genau so lange richtig, bis eine
 * Spalte umbenannt wird -- und sie wuerde danach weiter etwas anzeigen, nur
 * eben nicht mehr das, was rausgeht.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WAS MIT EINEM LEEREN WERT PASSIERT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Der Tag wird durch nichts ersetzt, also bleibt genau das Loch stehen, das
 * beim Empfaenger auch stuende. Ihn stehenzulassen ("{{websiteFinding}}")
 * waere gefaelliger und falsch: Instantly setzt an dieser Stelle nichts ein,
 * und wer die Vorschau anschaut, soll den leeren Absatz sehen und nicht einen
 * Platzhalter, den es in der Mail nie gibt.
 *
 * Damit die Oberflaeche das trotzdem benennen kann, ohne den Text noch einmal
 * zu zerlegen, meldet das Ergebnis jeden Tag getrennt: eingesetzt, leer oder
 * unbekannt.
 */
import {
  mergeTagValues,
  WEBSITE_FINDING_FIELD,
  type MergeTagSource,
  type MergeTagValues,
} from "./campaigns";

/**
 * Dieselbe Schreibweise wie in usesWebsiteFinding und unknownTags: Leerzeichen
 * innerhalb der Klammern sind erlaubt ("{{ firstName }}"), weil handgetippte
 * und aus Instantly zurueckgelesene Texte sie enthalten koennen. Ohne
 * geschachtelte Klammern, sonst frisst der Ausdruck ueber ein "{{" hinweg.
 */
const TAG_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Ein Tag in der Schreibweise, in der er angezeigt werden soll: ohne Leerzeichen. */
export function mergeTagToken(name: string): string {
  return `{{${name}}}`;
}

export type RenderedEmail = {
  subject: string;
  body: string;
  /**
   * Alle drei Listen enthalten TOKEN ("{{firstName}}"), nicht blosse Namen:
   * so kann die Oberflaeche sie unveraendert anzeigen, wie es die Meldung
   * ueber erfundene Platzhalter (unknownTags) seit jeher tut. Je Tag ein
   * Eintrag, in der Reihenfolge des ersten Vorkommens, Betreff vor Text.
   */
  filled: string[];
  /** Bekannter Tag, aber dieser Lead hat keinen Wert dafuer. Der Zweck der Uebung. */
  empty: string[];
  /** Kein Tag, den Instantly ersetzt. Er geht woertlich an den Empfaenger raus. */
  unknown: string[];
};

/**
 * Betreff und Text einer Fassung mit den Werten eines Leads fuellen.
 *
 * Der Opt-out-Link braucht KEINEN Sonderfall. Er enthaelt absichtlich ein
 * stehenbleibendes {{email}} (optOutLink in campaign-step-card.tsx), und
 * genau das ersetzt Instantly beim Versand pro Empfaenger -- ein Merge-Tag
 * wie jedes andere, nur eben in einer URL. Die Vorschau macht dasselbe und
 * zeigt damit den Link, den der Empfaenger anklickt. Ihn auszunehmen hiesse,
 * die einzige Stelle zu verstecken, an der eine falsche Workspace-ID oder
 * eine kaputte Adresse auffallen wuerde.
 */
export function renderVariables(
  text: { subject: string; body: string },
  values: MergeTagValues
): RenderedEmail {
  const filled = new Set<string>();
  const empty = new Set<string>();
  const unknown = new Set<string>();

  function fill(input: string): string {
    return input.replace(TAG_RE, (raw, inner: string) => {
      const name = inner.trim();
      // hasOwnProperty statt "name in values": sonst gaelte {{constructor}}
      // als bekannter Tag und wuerde durch Unsinn aus der Prototypenkette
      // ersetzt.
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        unknown.add(mergeTagToken(name));
        return raw;
      }
      const value = values[name as keyof MergeTagValues] ?? "";
      if (value.trim() === "") {
        empty.add(mergeTagToken(name));
        return "";
      }
      filled.add(mergeTagToken(name));
      return value;
    });
  }

  return {
    subject: fill(text.subject ?? ""),
    body: fill(text.body ?? ""),
    filled: [...filled],
    empty: [...empty],
    unknown: [...unknown],
  };
}

/** Bequemlichkeit fuer den haeufigen Fall: Fassung plus Lead-Zeile. */
export function renderVariablesForLead(
  text: { subject: string; body: string },
  lead: MergeTagSource
): RenderedEmail {
  return renderVariables(text, mergeTagValues(lead));
}

/**
 * Wie viele Leads die Vorschau zeigt, wenn niemand etwas anderes sagt.
 *
 * Zwei, weil zwei die kleinste Menge ist, in der beide Faelle nebeneinander
 * stehen koennen: einer mit Website-Befund und einer ohne. Eine dritte Mail
 * waere geraten.
 */
export const PREVIEW_LEAD_COUNT = 2;

/**
 * Die Leads, an denen die Vorschau gezeigt wird.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM NICHT EINFACH DIE ERSTEN ZWEI
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Weil die Reihenfolge einer Lead-Liste nichts damit zu tun hat, welche Faelle
 * darin vorkommen. Stehen zufaellig zwei Leads mit Befund vorn, sieht die
 * Vorschau tadellos aus, und die Mails ohne Befund -- die Haelfte der Liste --
 * sieht niemand. Genau der Fall, den es zu zeigen gilt, waere der einzige,
 * der fehlt.
 *
 * Deshalb: erst je ein Vertreter der beiden Faelle, dann auffuellen. Kommt
 * einer der Faelle gar nicht vor, wird nichts erfunden.
 *
 * DETERMINISTISCH, kein Zufall und kein Mischen. Die Vorschau haengt an einem
 * Textfeld, das bei jedem Tastendruck neu rendert; eine Auswahl, die dabei
 * springt, macht das Vergleichen unmoeglich. Aus derselben Menge Leads kommt
 * immer dieselbe Auswahl, und sie behaelt die Reihenfolge der Eingabe.
 */
export function pickPreviewLeads<T extends MergeTagSource>(
  leads: T[],
  limit: number = PREVIEW_LEAD_COUNT
): T[] {
  if (limit <= 0) return [];
  const hasFinding = (l: T) => (l.businesses?.website_finding ?? "").trim().length > 0;

  const mitIndex = leads.findIndex(hasFinding);
  const ohneIndex = leads.findIndex((l) => !hasFinding(l));

  const gewaehlt = new Set<number>();
  // Der Normalfall zuerst: so bleibt bei limit = 1 die Mail stehen, die
  // vollstaendig ist. Zwei sind der Standard, dort spielt die Reihenfolge
  // dieser beiden Zeilen keine Rolle.
  for (const i of [mitIndex, ohneIndex]) {
    if (i >= 0 && gewaehlt.size < limit) gewaehlt.add(i);
  }
  for (let i = 0; i < leads.length && gewaehlt.size < limit; i++) gewaehlt.add(i);

  return [...gewaehlt].sort((a, b) => a - b).map((i) => leads[i]);
}

/**
 * Hat dieser Lead einen Website-Befund?
 *
 * Steht hier und nicht in der Oberflaeche, weil "leer" dieselbe Bedeutung
 * haben muss wie in splitByWebsiteFinding: nur Leerzeichen zaehlen als kein
 * Befund, sonst haelt der Kampagnenstart einen Lead zurueck, den die Vorschau
 * als vollstaendig gezeigt hat.
 */
export function hasWebsiteFinding(lead: MergeTagSource): boolean {
  return mergeTagValues(lead)[WEBSITE_FINDING_FIELD].trim().length > 0;
}
