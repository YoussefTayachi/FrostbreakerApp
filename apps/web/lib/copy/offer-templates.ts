/**
 * Die Vorlage "Website-Design": ein vorausgefuelltes Angebot fuer jemanden,
 * der Websites baut oder repariert, plus eine fertige Vier-Stufen-Sequenz
 * dazu.
 *
 * NUR INHALT. Keine UI, keine Datenbanktabelle, keine Migration -- eine
 * Code-Konstante, die eine Oberflaeche (ui-designer) an beliebiger Stelle in
 * ein neues Angebot samt Sequenz kopieren kann, zum Beispiel per
 * `{ ...emptyOffer(name), ...WEBSITE_DESIGN_OFFER_TEMPLATE.de.offer }`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DIE FRICTION: NISCHEN-EBENE, NICHT LEAD-EBENE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * offers.ts (Zeile 32-34) erklaert, warum friction/friction_reason ueberhaupt
 * am ANGEBOT stehen und nicht, wie im Kurs, pro Lead recherchiert werden:
 * Frostbreaker-Nutzer verkaufen Beliebiges an Beliebige, eine Recherche je
 * Lead kostet einen Modellaufruf pro Kontakt. Der Website-Pruefer
 * (apps/worker/worker/website_audit.py) hebt genau diese Recherche fuer die
 * Nische "Website-Design" wieder auf Lead-Ebene an: er misst PRO LEAD einen
 * von acht harten, nachpruefbaren Maengeln.
 *
 * Das bedeutet: `friction` unten schreibt bewusst die ALLGEMEINE Form dessen,
 * was der Pruefer misst ("ein technischer Mangel, den der Inhaber selbst
 * nachpruefen kann"), nicht den Versuch, an dieser Stelle schon konkret zu
 * werden. Konkret wird es in Mail 1, und zwar durch {{websiteFinding}}: dort
 * steht der eine Befund DIESES Leads (z. B. "kein gueltiges
 * Sicherheitszertifikat") als BELEG der Friction, nicht als zweite Friction.
 * Wuerde die Vorlage hier schon einen einzelnen Befund festlegen ("eure
 * Website laedt zu langsam"), widerspraeche sie sich selbst, sobald der
 * Pruefer bei einem Lead einen anderen Code liefert (z. B. no_viewport statt
 * Ladezeit) -- genau der Fehler, den das Playbook mit "EINE Friction ueber
 * alle vier Stufen" ausschliessen soll.
 *
 * ZWEI PLATZHALTER, ZWEI AUFGABEN (seit Migration 0103)
 *
 * {{personalization}} ist der Icebreaker: er beweist, dass man die Welt des
 * Empfaengers versteht. {{websiteFinding}} benennt den Mangel. Bis zum
 * 2026-08-24 steckte der Befund im Icebreaker, und die Vorlage brauchte
 * deshalb eine eigene Zeile ("Sowas uebersieht man an der eigenen Seite
 * leicht"), um ihn einzuordnen. Diese Zeile ist entfallen: der Befundsatz
 * bringt seine Folge selbst mit (CONSEQUENCE_DE in worker/website_audit.py),
 * und sie noch einmal zu erklaeren waere dieselbe Aussage zweimal.
 *
 * PREIS DIESER ENTSCHEIDUNG, den man kennen muss: eine Kampagne mit dieser
 * Vorlage laesst Leads OHNE Befund zurueck (splitByWebsiteFinding in
 * lib/instantly/create-campaign.ts). Das ist gewollt -- ohne Befund gibt es
 * fuer dieses Angebot nichts zu schreiben -- und der Torwart sagt die Zahl
 * vorher an.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIE SEQUENZ FEST GESCHRIEBEN IST UND NICHT VOM MODELL ERZEUGT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Diese vier Mails (mit je zwei Fassungen, wie buildSequencePrompt es auch
 * verlangt) sind von Hand geschrieben, nicht von einem Modell. Sie nutzen
 * denselben Merge-Tag-Mechanismus wie ein KI-Entwurf: {{websiteFinding}}
 * traegt das Lead-Spezifische in Stufe 1, {{firstName}} die Anrede.
 *
 * KEIN {{personalization}} mehr in Stufe 1 (seit 2026-08-31): der Befund IST
 * die Personalisierung (so laufen auch alle Kampagnen seit dem 2026-08-27),
 * und rechnerisch ging es ohnehin nicht mehr -- der Torwart budgetiert
 * {{websiteFinding}} seit der Anhebung von FINDING_MAX_WORDS auf 55 mit 55
 * Woertern, {{personalization}} mit 35, zusammen 90, und
 * FIRST_MAIL_MAX_WORDS ist 90. Beide Variablen in einer Mail liessen fuer
 * den eigentlichen Text null Woerter uebrig; die Vorlage stand mit 118 im
 * Roten, sechs Tests meldeten es, CI prueft das Frontend nicht.
 * Der Nutzer muss beim Uebernehmen der Vorlage NICHTS von Hand ausfuellen --
 * genau das war die Vorgabe ("keine Platzhalter, die der Nutzer fuellen
 * muss, wenn die App das schon weiss").
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ABSICHTLICH LEERE FELDER
 * ═══════════════════════════════════════════════════════════════════════
 *
 * - proof: Diese Vorlage kennt keine echten Referenzen des Nutzers. Migration
 *   0090 verlangt genau dafuer ein leeres Feld -- es erzeugt im Prompt das
 *   ausdrueckliche Verbot, ueberhaupt Referenzen zu erwaehnen. Ein Nutzer mit
 *   echten Referenzen traegt sie selbst ein; erfinden waere hier der Fehler,
 *   den 0090 verhindern soll.
 * - signature: Aus demselben Grund wie calendar_link in Migration 0073 --
 *   kein erfundener Name unter einer fremden Mail. Die vier Mails unten enden
 *   deshalb ohne Unterschriftzeile, genau wie buildSequencePrompt es tut,
 *   wenn signatureFor() leer zurueckgibt ("no sender name is known"). Traegt
 *   der Nutzer spaeter offer.signature oder workspaces.reply_sender_name ein,
 *   soll die einsetzende Stelle signatureFor(offer, senderName) an jede Stufe
 *   anhaengen -- dieselbe Funktion, die der KI-Generator benutzt, damit nicht
 *   zwei Wahrheiten ueber die Unterschrift entstehen.
 * - website, custom_fields: unbekannt bzw. nicht Teil dieser Nische.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * GEPRUEFT GEGEN, NICHT NUR GELESEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Beide Sprachfassungen liefen durch sequenceProblems() aus
 * lib/copy/sequence-prompt.ts (Wegwerf-Skript, nicht Teil dieser Datei). Das
 * Ergebnis steht im Uebergabebericht, nicht hier -- Kommentare in Produktivcode
 * sollen gemessenes Verhalten FREMDER APIs festhalten, nicht den eigenen
 * Testlauf.
 */
import type { AddressForm, Offer, OfferLanguage } from "@/lib/offers";
import { DEFAULT_DELAYS, type DraftStep } from "./sequence-prompt";

/** Die zwoelf inhaltlichen Felder plus Anrede/Sprache -- alles, was
 *  `emptyOffer()` nicht schon mit '' vorbelegt. `custom_fields` bleibt leer:
 *  die Vorlage kennt keine eigenen Felder eines Workspaces (Migration 0098). */
export type OfferTemplateFields = Omit<Offer, "id" | "is_default" | "website" | "custom_fields" | "signature"> & {
  website: null;
  custom_fields: Record<string, never>;
  signature: "";
};

export type OfferTemplate = {
  offer: OfferTemplateFields;
  /** Vier Stufen, je zwei Fassungen -- dieselbe Form wie ein KI-Entwurf
   *  (parseSequence() in sequence-prompt.ts), damit eine Oberflaeche die
   *  Vorlage genauso in den Sequenz-Editor laden kann wie einen Entwurf. */
  sequence: DraftStep[];
};

// ── Deutsch ──────────────────────────────────────────────────────────────

// ── Wo die beiden Platzhalter stehen ─────────────────────────────────────
//
// Stufe 1 folgt dem Aufbau aus .claude/skills/cold-email-copy/SKILL.md:
// Anrede, {{personalization}}, dann als ZWEITER Beweispunkt die
// nachpruefbare Beobachtung. Genau dort steht {{websiteFinding}}. Der Skill
// verlangt fuer diese Zeile ausdruecklich einen angewandten Filter statt
// einer Vermutung, und der Website-Check ist genau das: acht deterministische
// Pruefungen am echten HTML.
//
// KEIN SATZ DIESER VORLAGE DARF AUF EINEN DER BEIDEN PLATZHALTER ANGEWIESEN
// SEIN. Auch das steht so im Skill, und es ist der Grund, warum unten "was
// auf deiner Seite kaputt ist" steht und nicht "was SONST NOCH kaputt ist":
// die zweite Fassung zerfaellt, sobald eine der beiden Zeilen leer bleibt,
// und sie liest sich dann wie eine halbe Mail. Ein Test in
// offer-templates.test.ts leert beide Platzhalter und misst nach.

/** Der Micro-Yes, wortgleich in jeder Stufe und in offer.cta. */
const MICRO_YES_DE = "Willst du sehen, was an deiner Website kaputt ist?";
/** Zwei Betreffs, je Fassung derselbe ueber alle vier Stufen (subjectDrift). */
const SUBJECT_A_DE = "kaputte Stelle deiner Website";
const SUBJECT_B_DE = "Fehler auf deiner Seite";

const OFFER_DE: OfferTemplateFields = {
  name: "Website-Design",
  offering: "Ich baue und repariere Websites für kleine Unternehmen.",
  icp: "Inhaberinnen und Inhaber kleiner Unternehmen mit eigener Website, die niemand regelmäßig technisch prüft.",
  problem:
    "Die eigene Website läuft oft jahrelang unverändert weiter, technische Mängel bleiben liegen, weil niemand von außen draufschaut.",
  // Allgemeine Form, siehe Erklaerung oben im Dateikopf. Der Lead-Befund aus
  // website_audit.py belegt diesen Satz, er ersetzt ihn nicht.
  friction:
    "Die eigene Website hat fast immer mindestens einen technischen Mangel, den der Inhaber selbst in wenigen Sekunden nachprüfen kann, zum Beispiel ein kaputtes Sicherheitszertifikat, kein Mobil-Format oder eine veraltete Jahreszahl im Footer.",
  friction_reason:
    "Inhaber sehen ihre eigene Seite selten mit den Augen eines Erstbesuchers, deshalb bleiben solche Stellen oft jahrelang unbemerkt.",
  outcome:
    "Eine Website ohne diese Stolpersteine wirkt von der ersten Sekunde an vertrauenswürdiger und lässt sich auf jedem Gerät nutzen.",
  // Ohne Tool-Sprache, wie Migration 0093 verlangt, und gehört nicht in Mail 1
  // (die Mails unten erwaehnen sie nicht).
  mechanism:
    "Jede Seite wird einzeln durchgesehen, jeder gefundene Fehler wird benannt und danach Schritt für Schritt behoben, von der Verschlüsselung bis zur Darstellung auf dem Handy.",
  proof: "", // absichtlich leer, siehe Dateikopf
  preview_asset:
    "Eine kurze schriftliche Liste der gefundenen Probleme mit einer kurzen Erklärung, wie sich jedes einzelne beheben lässt.",
  review_time: "unter einer Minute",
  cta: MICRO_YES_DE,
  tone: "direkt, sachlich, ohne Fachjargon, keine Übertreibung",
  address_form: "du" as AddressForm,
  language: "de" as OfferLanguage,
  website: null,
  signature: "", // absichtlich leer, siehe Dateikopf
  custom_fields: {},
};

const SEQUENCE_DE: DraftStep[] = [
  {
    delayDays: DEFAULT_DELAYS[0],
    variants: [
      {
        subject: SUBJECT_A_DE,
        body: [
          "Hi {{firstName}},",
          "",
          "{{websiteFinding}}",
          "",
          "Ich zeige dir kostenlos, was auf deiner Seite kaputt ist: eine kurze Liste, Lesezeit unter einer Minute.",
          "",
          MICRO_YES_DE,
        ].join("\n"),
      },
      {
        subject: SUBJECT_B_DE,
        body: [
          "Hi {{firstName}},",
          "",
          "{{websiteFinding}}",
          "",
          "Sag mir Bescheid, dann bekommst du kostenlos eine Liste der Fehler auf deiner Seite.",
          "",
          MICRO_YES_DE,
        ].join("\n"),
      },
    ],
  },
  // Stufen 2 und 3 am 2026-09-01 nach Mentor-Feedback neu geschrieben: die
  // alten Fassungen erfanden Besucher-Verhalten ("jeder neue Besucher sieht
  // ihn zuerst", "kostet dich stillschweigend Anfragen"). Neue Regel: die
  // Folgemails wiederholen das Angebot und seine Bedingungen, sie erfinden
  // keine Szene, die niemand beobachtet hat.
  {
    delayDays: DEFAULT_DELAYS[1],
    variants: [
      {
        subject: SUBJECT_A_DE,
        body: [
          "Hi {{firstName}}, kurz zurück zu meiner letzten Mail.",
          "",
          "Das Angebot steht noch: eine kurze Liste der Fehler auf deiner Seite, kostenlos, Lesezeit unter einer Minute.",
          "",
          MICRO_YES_DE,
        ].join("\n"),
      },
      {
        subject: SUBJECT_B_DE,
        body: [
          "Hi {{firstName}}, noch mal kurz zu meiner Mail von eben.",
          "",
          "Die Liste gehört dir, wenn du sie willst: jeder gefundene Fehler, in einfachen Worten erklärt.",
          "",
          MICRO_YES_DE,
        ].join("\n"),
      },
    ],
  },
  {
    delayDays: DEFAULT_DELAYS[2],
    variants: [
      {
        subject: SUBJECT_A_DE,
        body: [
          "Hi {{firstName}}, kurz zusammengefasst.",
          "",
          "Du bekommst die Liste, liest sie in einer Minute und entscheidest selbst, was du damit machst. Mehr passiert nicht.",
          "",
          MICRO_YES_DE,
        ].join("\n"),
      },
      {
        subject: SUBJECT_B_DE,
        body: [
          "Hi {{firstName}}, in einem Satz.",
          "",
          "Ein Ja startet nichts. Es sagt mir nur, dass ich dir die Liste schicken soll.",
          "",
          MICRO_YES_DE,
        ].join("\n"),
      },
    ],
  },
  {
    delayDays: DEFAULT_DELAYS[3],
    variants: [
      {
        subject: SUBJECT_A_DE,
        body: ["Hi {{firstName}}, letzte Mail von mir, danach höre ich auf.", "", MICRO_YES_DE].join("\n"),
      },
      {
        subject: SUBJECT_B_DE,
        body: ["Hi {{firstName}}, ich frage nur noch dieses eine Mal nach.", "", MICRO_YES_DE].join("\n"),
      },
    ],
  },
];

// ── Englisch ─────────────────────────────────────────────────────────────
// Geschrieben, nicht uebersetzt: eigener Satzbau, gleicher Inhalt.

const MICRO_YES_EN = "Want to see what's broken on your site?";
const SUBJECT_A_EN = "your site's broken spot";
const SUBJECT_B_EN = "problem with your site";

const OFFER_EN: OfferTemplateFields = {
  name: "Website Design",
  offering: "I build and fix websites for small businesses.",
  icp: "Small business owners with their own site that nobody checks technically on a regular basis.",
  problem:
    "A business's own site often runs unchanged for years, technical flaws sit there because nobody from the outside ever looks.",
  friction:
    "A business site almost always has at least one technical flaw the owner can verify themselves in seconds, for example a broken security certificate, no mobile layout, or an outdated year in the footer.",
  friction_reason:
    "Owners rarely look at their own site the way a first time visitor would, so these spots often go unnoticed for years.",
  outcome: "A site without these issues reads as more trustworthy from the first second and works on every device.",
  mechanism:
    "Every page gets reviewed one by one, every issue found gets named, then fixed step by step, from encryption to how it looks on a phone.",
  proof: "", // intentionally empty, see file header
  preview_asset: "A short written list of the issues found, with a short note on how to fix each one.",
  review_time: "under a minute",
  cta: MICRO_YES_EN,
  tone: "direct, plain, no jargon, no overstatement",
  address_form: "du" as AddressForm, // ohne Bedeutung bei language="en", siehe offers.ts
  language: "en" as OfferLanguage,
  website: null,
  signature: "", // intentionally empty, see file header
  custom_fields: {},
};

const SEQUENCE_EN: DraftStep[] = [
  {
    delayDays: DEFAULT_DELAYS[0],
    variants: [
      {
        subject: SUBJECT_A_EN,
        body: [
          "Hi {{firstName}},",
          "",
          "{{websiteFinding}}",
          "",
          "I'll show you what is broken on your site for free, a short list, under a minute.",
          "",
          MICRO_YES_EN,
        ].join("\n"),
      },
      {
        subject: SUBJECT_B_EN,
        body: [
          "Hi {{firstName}},",
          "",
          "{{websiteFinding}}",
          "",
          "Let me know and I'll send a free list of what is broken on your site.",
          "",
          MICRO_YES_EN,
        ].join("\n"),
      },
    ],
  },
  // Stufen 2 und 3 am 2026-09-01 nach Mentor-Feedback neu geschrieben, gleiche
  // Begruendung wie in der deutschen Fassung oben.
  {
    delayDays: DEFAULT_DELAYS[1],
    variants: [
      {
        subject: SUBJECT_A_EN,
        body: [
          "Hi {{firstName}}, quick follow up on my last note.",
          "",
          "The offer still stands: a short list of what is broken on your site, free, under a minute to read.",
          "",
          MICRO_YES_EN,
        ].join("\n"),
      },
      {
        subject: SUBJECT_B_EN,
        body: [
          "Hi {{firstName}}, back to what I sent over last time.",
          "",
          "The list is yours if you want it: every issue I found on your site, explained in plain words.",
          "",
          MICRO_YES_EN,
        ].join("\n"),
      },
    ],
  },
  {
    delayDays: DEFAULT_DELAYS[2],
    variants: [
      {
        subject: SUBJECT_A_EN,
        body: [
          "Hi {{firstName}}, short version.",
          "",
          "You get the list, read it in a minute, and decide for yourself what to do with it. Nothing else happens.",
          "",
          MICRO_YES_EN,
        ].join("\n"),
      },
      {
        subject: SUBJECT_B_EN,
        body: [
          "Hi {{firstName}}, one line version.",
          "",
          "A yes does not start anything. It just tells me to send the list.",
          "",
          MICRO_YES_EN,
        ].join("\n"),
      },
    ],
  },
  {
    delayDays: DEFAULT_DELAYS[3],
    variants: [
      {
        subject: SUBJECT_A_EN,
        body: ["Hi {{firstName}}, last email from me, then I'll stop.", "", MICRO_YES_EN].join("\n"),
      },
      {
        subject: SUBJECT_B_EN,
        body: ["Hi {{firstName}}, I won't write again after this one.", "", MICRO_YES_EN].join("\n"),
      },
    ],
  },
];

export const WEBSITE_DESIGN_OFFER_TEMPLATE: Record<OfferLanguage, OfferTemplate> = {
  de: { offer: OFFER_DE, sequence: SEQUENCE_DE },
  en: { offer: OFFER_EN, sequence: SEQUENCE_EN },
};
