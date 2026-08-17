/**
 * Aus EINER Lead-Liste Vorschlaege fuer die nischen-spezifischen
 * Angebotsfelder machen.
 *
 * WOFUER
 *
 * Das Standardangebot beantwortet, was der Absender verkauft und wie er
 * klingt. Das aendert sich nicht, wenn er statt Zahnarztpraxen jetzt
 * Shopify-Shops anschreibt. Was sich sehr wohl aendert, ist die andere Haelfte:
 * woran diese Empfaenger haengen und warum sie zoegern.
 *
 * Bis dahin gab es dafuer genau zwei Wege, und beide sind schlecht: das
 * Standardangebot fuer jede Liste umschreiben (und danach zurueckschreiben),
 * oder mit einem Problem-Satz an alle schreiben, der auf niemanden passt.
 *
 * WAS HIER NICHT PASSIERT
 *
 * Kein zweiter Website-Abruf, keine neue Tonbestimmung, kein neuer Micro-Yes.
 * offering/proof/preview_asset/review_time/cta/tone werden aus dem Angebot
 * UEBERNOMMEN, nicht neu erzeugt — sie stehen hier nur als Kontext im Prompt,
 * damit die erzeugten Felder in derselben Welt und im selben Ton landen.
 *
 * DIE ENTSCHEIDENDE EINSCHRAENKUNG
 *
 * Dieselbe wie bei offer-from-website.ts: was nicht im Material steht, bleibt
 * leer. Das Material ist hier kein Schaufenster, sondern die Filter der Suche
 * und die recherchierten Firmenbeschreibungen (businesses.company_summary) --
 * also Saetze ueber die EMPFAENGER. Genau deshalb darf hier `friction_reason`
 * mitlaufen, das aus der Website ausdruecklich ausgeschlossen ist: eine
 * Verhaltensbeobachtung ueber den Kaeufer kann in einer Firmenbeschreibung
 * stehen, auf der eigenen Verkaufsseite steht sie nie. Der Prompt sagt trotzdem
 * ausdruecklich, dass ein leerer String die richtige Antwort ist, wenn das
 * Material sie nicht hergibt.
 */
import { type Offer, type OfferTextField } from "@/lib/offers";
import type { FilterLine } from "@/lib/search-filter-lines";
import { parseSuggestionFields, type OfferSuggestion } from "./offer-from-website";
import type { OfferProduct } from "./offer-products";

/**
 * Die Felder, die sich von Liste zu Liste unterscheiden — in zwei Sorten.
 *
 * NEU GESCHRIEBEN werden problem, friction und friction_reason: woran diese
 * Empfaenger haengen, steht in ihren Firmenbeschreibungen und nirgends sonst.
 *
 * UMFORMULIERT werden outcome und mechanism. Das Ergebnis und der Weg dorthin
 * aendern sich nicht, wenn der Absender statt Zahnarztpraxen Shopify-Shops
 * anschreibt — was sich aendert, ist, welcher Teil davon zuerst genannt
 * gehoert und in wessen Worten. Der Prompt sagt deshalb ausdruecklich
 * "reframe", nicht "write": neue Tatsachen sind hier verboten, eine andere
 * Betonung ist der ganze Zweck.
 *
 * `icp` ist der einzige optionale: das Angebot hat schon einen, und die Liste
 * darf ihn nur VERENGEN. Ein leerer String ist hier der Normalfall, nicht der
 * Fehler.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WARUM `proof` HIER NIE STEHEN WIRD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `proof` ist die einzige Tatsachenbehauptung ueber den ABSENDER in diesem
 * Satz Felder: Referenzen, Jahre, Antwortquoten, Kundennamen. Ein Modell, das
 * daran je Liste "die Betonung anpasst", schreibt in der zweiten Fassung eine
 * andere Zahl hin — und die steht danach als Beleg in jeder Mail an diese
 * Liste. Das ist keine Formulierungsfrage mehr, sondern eine erfundene
 * Behauptung ueber das Geschaeft des Absenders.
 *
 * Dieselbe Grenze wie in lib/offers.ts (proof ist bewusst keine Pflicht) und
 * in lib/copy/offer-from-website.ts (dort darf proof nur enthalten, was
 * woertlich auf der Seite steht): was nicht belegt ist, bleibt leer. Der
 * Ausschluss gilt an drei Stellen zugleich — proof fehlt in dieser Liste,
 * der Prompt verbietet es ausdruecklich, und parseSuggestionFields wirft das
 * Feld weg, falls das Modell es trotzdem liefert.
 */
export const SEARCH_SUGGESTED_FIELDS: OfferTextField[] = [
  "problem",
  "friction",
  "friction_reason",
  "icp",
  "outcome",
  "mechanism",
];

/**
 * Wie viele Firmenbeschreibungen in den Prompt wandern.
 *
 * Eine Stichprobe, keine Liste: 25 Beschreibungen zu je ~400 Zeichen sind rund
 * 2.500 Tokens Eingabe und damit ein Bruchteil eines Cents. Alle 500 Firmen
 * einer Liste mitzuschicken wuerde daran nichts verbessern — was die Nische
 * ausmacht, steht in den ersten zwanzig genauso.
 */
export const SUMMARY_SAMPLE_SIZE = 25;
/** Laenge je Beschreibung. company_summary ist meist kuerzer; der Schnitt
 *  greift nur bei den Ausreissern, die sonst allein den halben Prompt fuellen. */
export const SUMMARY_MAX_CHARS = 400;

export type LeadListContext = {
  /** Der Name, unter dem der Nutzer die Liste sieht. */
  name: string;
  /** Bei Maps die Eingabe des Nutzers, sonst die beim Anlegen erzeugte
   *  Ueberschrift (siehe lib/search-presets.ts). Beides sagt etwas ueber die
   *  Nische, deshalb geht es mit. */
  query: string;
  location: string;
  /** maps | corporate | apollo | prospeo | csv */
  source: string | null;
  /** Die gesetzten Filter, wie sie auch die Suchdetailseite zeigt. */
  filters: FilterLine[];
  /** Die Stichprobe. Leer heisst: es gibt nichts zu lesen, und dann wird gar
   *  nicht erst gefragt (siehe api/offers/from-search). */
  summaries: { name: string; summary: string }[];
  /** Wie viele Firmen der Liste ueberhaupt eine Beschreibung haben — damit im
   *  Prompt steht, dass es eine Stichprobe ist und keine Vollzaehlung. */
  totalWithSummary: number;
};

const LANGUAGE_NAMES: Record<string, string> = { de: "German", en: "English" };

/**
 * Ein Angebotsfeld als Kontextzeile, oder null.
 *
 * Leere Felder fallen ganz weg statt als "(nicht angegeben)" dazustehen — im
 * Unterschied zu sequence-prompt.ts, wo ein leeres Feld ein ausdrueckliches
 * Verbot ausloest. Hier wird zu diesen Feldern gar nichts erzeugt, sie sind
 * nur Hintergrund; ein Verbot waere eine Anweisung ohne Gegenstand.
 *
 * null und nicht "": die leeren Zeilen zwischen den Abschnitten sind gewollt
 * und sollen den Filter ueberleben.
 */
function kontext(label: string, value: string): string | null {
  const v = value.trim();
  return v ? `${label}: ${v}` : null;
}

/**
 * Der Auftrag ans Modell.
 *
 * Englisch wie alle anderen Prompts dieser App (gleiche Begruendung wie in
 * sequence-prompt.ts: Formvorgaben befolgt das Modell in Englisch
 * verlaesslicher). Die Sprache der WERTE kommt aus dem Angebot.
 *
 * Die Filter stehen mit ihrem Schluessel davor ("headcount: 11-50") und nicht
 * mit der uebersetzten Beschriftung aus dem Woerterbuch: die Schluessel sind
 * bereits englische, sprechende Woerter, und eine zweite Beschriftungstabelle
 * neben searchDetail.filterLabels waere eine, die auseinanderlaeuft.
 *
 * `produkt` ist gesetzt, wenn das Angebot mehr als eine Sache beschreibt und
 * der Nutzer gesagt hat, um welche es bei DIESER Liste geht (siehe
 * offer-products.ts). Ohne den Wert bleibt der Prompt Wort fuer Wort der von
 * vorher — der eindeutige Fall ist der Normalfall und darf sich nicht
 * aendern.
 */
export function buildOfferFromSearchPrompt(
  ctx: LeadListContext,
  offer: Offer,
  produkt?: OfferProduct | null
): string {
  const sprache = LANGUAGE_NAMES[offer.language] ?? "German";

  const zeilen: (string | null)[] = [
    "You are looking at ONE lead list a sender is about to write to.",
    "Your job is to sharpen the parts of their offer that depend on WHO is on this list.",
    "",
    "RULES:",
    // Der wichtigste Satz, wortgleich in der Sache zu offer-from-website.ts:
    // ein erfundenes Problem steht danach in jeder Mail an diese Liste und
    // faellt erst dem Empfaenger auf.
    "- Only use the filters and the company descriptions below. Never add industry knowledge of your own.",
    "  The one exception is the sender's own outcome and mechanism: those are given below and you may",
    "  only rephrase them, never extend them.",
    // Nur wenn das Angebot mehr als eine Sache beschreibt UND der Nutzer
    // entschieden hat, welche gemeint ist. Der Satz steht doppelt — hier als
    // Regel und unten am Produkt selbst: was hier als Aufzaehlungspunkt
    // zwischen zehn anderen steht, wird sonst mit ueberlesen.
    produkt
      ? "- The sender sells more than one thing. THIS list is about exactly ONE of them, named below." +
        " Write about that one only and ignore the rest of what they sell."
      : null,
    "- If the material does not support a field, return an empty string for it. Never guess.",
    "- Never invent numbers, percentages, revenue figures or client counts.",
    // Gilt ausdruecklich nur fuer die drei neu geschriebenen Felder: outcome
    // und mechanism handeln naturgemaess davon, was der Absender tut.
    "- For problem, friction and friction_reason: these describe the RECIPIENTS. Write about what THEY",
    "  struggle with, never about what the sender does.",
    // proof steht bewusst NICHT in der Feldliste weiter unten — diese Zeile
    // sagt es zusaetzlich, weil ein Modell sonst gelegentlich "hilfsbereit"
    // einen Beleg mitliefert. Warum das hier dauerhaft verboten ist, steht bei
    // SEARCH_SUGGESTED_FIELDS.
    "- Never write about the sender's own track record. References, client counts, years in business and",
    "  reply rates are not part of your answer. Do not return a 'proof' field.",
    "- One or two plain sentences per field. No marketing language, no bullet points.",
    "- Match the sender's voice below. Do not copy their sentences.",
    `- Write the values in ${sprache}.`,
    "",
    "FIELDS:",
    "- problem: what the companies on THIS list struggle with before they buy anything.",
    "  It has to be recognisably about this list, not about business in general. If the only thing you can say",
    "  would fit any company anywhere, return an empty string.",
    // Wortgleiche Strenge wie in offer-from-website.ts: die Friction ist der
    // Satz, mit dem die erste Mail anfaengt. Ein allgemeiner Satz an dieser
    // Stelle ist schlimmer als ein leeres Feld, weil er sich ausgefuellt
    // anfuehlt.
    "- friction: ONE concrete, checkable moment where these companies get stuck, right before someone would spend money.",
    "  It must be something a person could go and look at at one of these companies. If the descriptions only",
    "  talk in general terms, return an empty string.",
    "- friction_reason: why buyers hesitate at exactly that moment. Observed behaviour, never an accusation,",
    "  and only if the material actually shows it. This is the field a model invents most easily. Prefer an empty string.",
    "- icp: ONLY if this list is narrower than the sender's own audience below. If it is the same audience,",
    "  return an empty string. Never widen it.",
    // Die beiden einzigen Felder, die NICHT aus dem Material entstehen, sondern
    // aus dem Angebot selbst. Deshalb steht hier "reframe" und nirgends
    // "write": das Ergebnis und der Weg dorthin sind Tatsachen des Absenders,
    // die Betonung ist es nicht.
    "- outcome: REFRAME the sender's outcome below for this audience. Same result, same numbers, same",
    "  timeframe -- only the emphasis and the wording change to what these companies would care about.",
    "  Never add a fact the sender did not state and never change, add or drop a number.",
    "  If their outcome is empty, or you would only hand it back unchanged, return an empty string.",
    "- mechanism: REFRAME the sender's mechanism below for this audience. The mechanism itself does not",
    "  change -- only which part of it comes first and in whose words. No new steps, no tool words,",
    "  no product names. If their mechanism is empty, return an empty string.",
    "",
    "Answer with JSON only, no prose around it:",
    '{"problem":"...","friction":"...","friction_reason":"...","icp":"...","outcome":"...","mechanism":"..."}',
    "",
    "THE SENDER (context for voice and scope; their sentences are never material to quote):",
    kontext("What they sell", offer.offering),
    kontext("Who they normally sell to", offer.icp),
    kontext("Their outcome -- what is different afterwards", offer.outcome),
    kontext("Their mechanism -- how the result comes about", offer.mechanism),
    kontext("Tone notes", offer.tone),
  ];

  // Das gewaehlte Produkt steht NACH dem Absender und nicht davor: es ist eine
  // Einschraenkung dessen, was gerade darueber steht ("What they sell" nennt
  // alle), und eine Einschraenkung muss hinter dem stehen, was sie
  // einschraenkt.
  if (produkt) {
    zeilen.push(
      "",
      "THE ONE PRODUCT OR SERVICE THIS LIST IS ABOUT:",
      kontext("Name", produkt.name),
      kontext("What it is", produkt.description),
      "Everything you write -- problem, friction, friction_reason, icp, outcome, mechanism -- is about THIS",
      "one. The parts of 'What they sell' that belong to their other products or services are off limits.",
      "Do not mention the others and do not blend them in."
    );
  }

  // Was heute in den drei NEU geschriebenen Feldern steht, kommt ausdruecklich
  // als "das ist die allgemeine Fassung" mit. Ohne diesen Block schreibt das
  // Modell sie gelegentlich einfach ab — und der ganze Aufruf haette nichts
  // gebracht. outcome und mechanism fehlen hier mit Absicht: sie stehen schon
  // oben beim Absender, und dort sind sie die Vorlage und nicht das, was
  // ersetzt wird.
  const bisher = [
    kontext("problem", offer.problem),
    kontext("friction", offer.friction),
    kontext("friction_reason", offer.friction_reason),
  ].filter((z): z is string => z !== null);
  if (bisher.length > 0) {
    zeilen.push(
      "",
      "Their CURRENT, generic wording of the three fields you are about to write from scratch.",
      "You are replacing these for this one list. Do not hand them back unchanged:",
      ...bisher.map((z) => `  ${z}`)
    );
  }

  zeilen.push(
    "",
    "THE LEAD LIST:",
    kontext("Name", ctx.name),
    kontext("Search term", ctx.query),
    kontext("Location", ctx.location),
    kontext("Source", ctx.source ?? "")
  );

  if (ctx.filters.length > 0) {
    zeilen.push(
      "Filters that were actually set:",
      ...ctx.filters.map((f) => `  ${f.key}: ${f.items.join(", ")}`)
    );
  }

  zeilen.push(
    "",
    ctx.totalWithSummary > ctx.summaries.length
      ? `Researched descriptions of ${ctx.summaries.length} of the ${ctx.totalWithSummary} companies on this list:`
      : `Researched descriptions of the ${ctx.summaries.length} companies on this list:`,
    ...ctx.summaries.map((s) => `- ${s.name}: ${s.summary}`)
  );

  return zeilen.filter((l): l is string => l !== null).join("\n");
}

/** Die Antwort des Modells — mit derselben Strenge wie bei der Website:
 *  unbekannte Schluessel raus, Ausreden ("nicht angegeben") gelten als leer. */
export function parseOfferFromSearch(raw: string): OfferSuggestion {
  return parseSuggestionFields(raw, SEARCH_SUGGESTED_FIELDS);
}

/** Die Stichprobe zurechtschneiden. Steht hier und nicht in der Route, damit
 *  der Test die Grenze pruefen kann, ohne eine Datenbank zu brauchen. */
export function sampleSummaries(
  rows: { name: string | null; company_summary: string | null }[]
): { name: string; summary: string }[] {
  return rows
    .map((r) => ({
      name: (r.name ?? "").trim(),
      summary: (r.company_summary ?? "").trim().slice(0, SUMMARY_MAX_CHARS),
    }))
    .filter((r) => r.summary.length > 0)
    .slice(0, SUMMARY_SAMPLE_SIZE);
}
