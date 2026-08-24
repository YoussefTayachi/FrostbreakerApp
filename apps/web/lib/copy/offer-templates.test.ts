/**
 * Regressionsschutz fuer die ausgelieferte Vorlage.
 *
 * WARUM ES DIESE DATEI GIBT
 *
 * playbook.ts faengt mit "Ein Prompt sagt bitte. Eine Pruefung sagt nein." an.
 * Die Vorlage in offer-templates.ts war bis hierher der einzige Text, den die
 * App SELBST ausliefert, und gleichzeitig der einzige, den keine Pruefung
 * angefasst hat: geprueft wurde er einmal von Hand mit einem Wegwerf-Skript.
 * Damit brach jede Aenderung an STEP_MAX_WORDS, BANNED_PHRASES oder an einer
 * Pruefung in sequenceProblems() die Vorlage lautlos.
 *
 * Diese Datei misst die Vorlage mit genau denselben Funktionen, mit denen der
 * Generator seine eigenen Entwuerfe misst. Keine zweite Wahrheit darueber, was
 * eine gute Mail ist.
 */
import { describe, expect, it } from "vitest";
import {
  OFFER_TEXT_FIELDS,
  REQUIRED_FOR_GENERATION,
  type OfferLanguage,
  type OfferTextField,
} from "@/lib/offers";
import {
  DEFAULT_STEP_COUNT,
  defaultSequenceOptions,
  sequenceProblems,
  signatureFor,
} from "./sequence-prompt";
import { WEBSITE_DESIGN_OFFER_TEMPLATE } from "./offer-templates";

const SPRACHEN: OfferLanguage[] = ["de", "en"];

/** Ein hinterlegter Absendername (workspaces.reply_sender_name), wie ihn der
 *  Vorlagenweg in generate-sequence.tsx nachschlaegt.
 *
 *  DREI Woerter, absichtlich: die angehaengte Unterschrift zaehlt in den
 *  Wortgrenzen der Stufen mit, also ist der laengste realistische Name der
 *  unguenstigste Fall, und nur der haelt etwas. Hier stand bis zum 2026-08-23
 *  ein zweiteiliger Name, und genau daran ist die Erwartung durchgegangen,
 *  obwohl drei der vier Mail-1-Fassungen keine Reserve mehr hatten: ein
 *  dreiteiliger Name haette firstMailTooLong ausgeloest, an einem Text, den
 *  die App selbst ausliefert. Ein Test, der den milden Fall misst, ist ein
 *  Test, der nichts haelt. Wer hier auf einen kuerzeren Namen zurueckgeht,
 *  nimmt genau diese Reserve wieder aus der Pruefung heraus. */
const ABSENDER = "Anna Maria Weber";

/** Dieselbe Zeichenmenge, die sequenceProblems als `kind: "dash"` meldet.
 *  Bewusst dieselbe und keine eigene: sonst haetten Angebotsfelder und Mails
 *  zwei verschiedene Vorstellungen von einem Gedankenstrich. */
const DASH = /—|–|--/;

describe("WEBSITE_DESIGN_OFFER_TEMPLATE", () => {
  for (const lang of SPRACHEN) {
    const vorlage = WEBSITE_DESIGN_OFFER_TEMPLATE[lang];

    describe(lang, () => {
      // ── Der Kern ──────────────────────────────────────────────────────
      // Die ausgelieferten Stufen laufen durch dieselbe Pruefung wie ein
      // KI-Entwurf, mit dem Vorlagen-Angebot als Bezug (sonst fallen
      // Betreff-Spiegel, Abschrift und Unterschrift stillschweigend aus).
      it("laeuft ohne Befund durch sequenceProblems()", () => {
        expect(sequenceProblems(vorlage.sequence, defaultSequenceOptions(), vorlage.offer)).toEqual([]);
      });

      // ── Mit Absendername, so wie die Oberflaeche einsetzt ─────────────
      // Der Test daneben prueft die rohe Vorlage OHNE Absendername. Sobald
      // einer hinterlegt ist, faellt signatureFor() auf
      // workspaces.reply_sender_name zurueck, und dieselbe rohe Vorlage
      // ergaebe vier mal missingSignature je Sprache: an einem Text, den die
      // App selbst geliefert hat.
      //
      // Das ist kein Fehler der Vorlage. Sie endet absichtlich ohne
      // Unterschrift, weil sie den Namen des Nutzers nicht kennen kann (siehe
      // oben, "laesst proof und signature leer"). Das Anhaengen ist deshalb
      // PFLICHT der einsetzenden Stelle und kein Feinschliff: heute
      // app/instantly/campaigns/generate-sequence.tsx, vorlageEinsetzen().
      // Nimmt jemand diesen Schritt spaeter dort heraus, sieht der Nutzer vier
      // Beanstandungen an einem Text, den er nicht geschrieben hat. Dieser
      // Test haelt fest, dass das Anhaengen genuegt, damit niemand statt
      // dessen an der Vorlage oder an sequenceProblems() zu drehen anfaengt.
      //
      // Angehaengt wird hier zeichengleich wie dort: zwei Zeilenumbrueche
      // zwischen Text und Unterschrift, ohne Ruecksicht auf vorhandene
      // Leerzeilen. Ein Test, der anders anhaengt, prueft eine Fassung, die es
      // nicht gibt.
      //
      // WAS DIESER TEST BEI SEINER EINFUEHRUNG GEFUNDEN HAT (2026-08-23)
      //
      // Am Tag seiner Einfuehrung war er ROT, in beiden Sprachen aus je einem
      // eigenen Grund. Der Text ist noch am selben Tag zweimal ueberarbeitet
      // worden (copywriter), der Test ist seitdem gruen. Die HISTORISCHEN
      // Zahlen stehen trotzdem hier, weil beide Gruende zurueckkommen, sobald
      // jemand die Vorlagentexte wieder verlaengert. Sie beschreiben den
      // damaligen Text und den damaligen, zweiteiligen ABSENDER; die heutigen
      // Werte stehen weiter unten.
      //
      //   de  HISTORISCH: Mail 1, Fassung A hatte 88 Woerter roh (inklusive
      //       der 35 fuer {{personalization}}); die damals vierwortige
      //       Unterschrift machte 92 daraus, FIRST_MAIL_MAX_WORDS ist 90,
      //       also firstMailTooLong.
      //       Der Punkt, der bleibt: DIE UNTERSCHRIFT ZAEHLT MIT. Sie trifft
      //       jeden Namen, denn schon "Beste Grüße" plus ein einziges Wort
      //       landet bei 91. Wer die Vorlage verlaengert, hat nicht 90
      //       Woerter, sondern 90 minus Unterschrift -- und wie viel das ist,
      //       bestimmt der Nutzer mit der Laenge seines Namens, nicht wir.
      //   en  HISTORISCH: Stufe 4: die beiden Fassungen teilten roh 7 von 9
      //       Woertern (0.78), die drei gemeinsamen Woerter der Unterschrift
      //       hoben das auf 10 von 12 (0.83) und damit ueber
      //       AEHNLICHKEIT_GRENZE (0.8), also variantsTooSimilar. Auch das
      //       trifft jeden Namen. Der Punkt, der bleibt: der Nenner ist
      //       min(|A|,|B|), also wiegt jedes gemeinsame Wort umso schwerer,
      //       je KUERZER die Stufe ist -- und Stufe 4 ist die kuerzeste.
      //
      // Beides war kein Fehler dieses Tests, sondern der gemessene Zustand des
      // ausgelieferten Textes: die Vorlage hielt ihre eigenen Grenzen nur so
      // lange ein, wie niemand unterschrieb. Im Betrieb sichtbar wurde es
      // nicht, weil der Vorlagenweg in generate-sequence.tsx die Befundliste
      // auf [] setzt statt zu pruefen. Repariert wurde deshalb der TEXT, nicht
      // diese Erwartung.
      //
      // HEUTE, gemessen am 2026-08-23 mit ABSENDER unten (dreiteilig, also
      // Unterschrift de 5 Woerter / en 4):
      //   Mail 1, roh / mit Unterschrift, Grenze 90:
      //     de A 79 / 84    de B 75 / 80
      //     en A 79 / 83    en B 82 / 86  <- engste Stelle, 4 Woerter Reserve
      //   Aehnlichkeit, Grenze 0.8: en Stufe 4 roh 6 von 11 (0.55), mit
      //   Unterschrift 10 von 15 (0.67); den hoechsten Wert hat inzwischen
      //   nicht mehr die kuerzeste Stufe, sondern en Stufe 1 mit 21 von 31
      //   (0.68).
      // Alle vier Mail-1-Fassungen haben damit echte Reserve. Wer sie
      // aufbraucht, sieht es hier zuerst.
      it("laeuft mit angehaengter Unterschrift auch mit senderName ohne Befund durch", () => {
        const opts = { ...defaultSequenceOptions(), senderName: ABSENDER };
        const unterschrift = signatureFor(vorlage.offer, opts.senderName);
        // Vorbedingung: ohne eigene Signatur im Angebot MUSS der Rueckfall
        // greifen. Waere sie leer, prueften die Zeilen darunter nichts.
        expect(unterschrift).toContain(ABSENDER);

        const eingesetzt = vorlage.sequence.map((stufe) => ({
          ...stufe,
          variants: stufe.variants.map((v) => ({
            subject: v.subject,
            body: unterschrift ? `${v.body}\n\n${unterschrift}` : v.body,
          })),
        }));

        expect(sequenceProblems(eingesetzt, opts, vorlage.offer)).toEqual([]);
      });

      // Die Gegenprobe zum Test darueber: ohne das Anhaengen ist es genau der
      // Befund missingSignature, und zwar an allen vier Stufen. Sie steht hier,
      // damit der Test darueber nicht eines Tages gruen bleibt, weil
      // sequenceProblems() die Unterschrift gar nicht mehr prueft.
      it("meldet ohne das Anhaengen an jeder Stufe eine fehlende Unterschrift", () => {
        const opts = { ...defaultSequenceOptions(), senderName: ABSENDER };
        const problems = sequenceProblems(vorlage.sequence, opts, vorlage.offer);
        expect(problems).toEqual(
          Array.from({ length: DEFAULT_STEP_COUNT }, (_, i) => ({
            kind: "missingSignature",
            step: i + 1,
          }))
        );
      });

      it("hat vier Stufen mit je zwei Fassungen", () => {
        expect(vorlage.sequence).toHaveLength(DEFAULT_STEP_COUNT);
        for (const step of vorlage.sequence) {
          expect(step.variants).toHaveLength(2);
        }
      });

      // ── Vollstaendigkeit des Angebots ─────────────────────────────────
      // Eine Vorlage, die ein Pflichtfeld leer laesst, erzeugt beim Nutzer
      // eine Angebotsseite, die ab der ersten Sekunde unvollstaendig ist --
      // und der Knopf "Sequenz erzeugen" bleibt gesperrt.
      it("fuellt alle Felder aus REQUIRED_FOR_GENERATION", () => {
        const leer = REQUIRED_FOR_GENERATION.filter((f) => !vorlage.offer[f].trim());
        expect(leer).toEqual([]);
      });

      // ── Absichtlich leer ──────────────────────────────────────────────
      // proof und signature sind KEINE Luecke, sie sind eine Aussage.
      //
      // Ein leeres proof erzeugt laut Migration 0090 im Prompt das
      // ausdrueckliche Verbot, ueberhaupt Referenzen zu erwaehnen. Die Vorlage
      // kennt die echten Referenzen des Nutzers nicht; wer dieses Feld spaeter
      // "hilfsbereit" mit einem erfundenen Referenzsatz fuellt, dreht das
      // Verbot in genau die erfundene Behauptung um, gegen die der ganze
      // uebrige Code geschrieben ist. Deshalb scheitert dieser Test dann.
      //
      // signature bleibt leer, weil eine Vorlage den Namen des Nutzers nicht
      // kennt (dieselbe Begruendung wie calendar_link in Migration 0073). Die
      // einsetzende Stelle haengt sie ueber signatureFor(offer, senderName)
      // an, damit es nicht zwei Wahrheiten ueber die Unterschrift gibt.
      it("laesst proof und signature leer", () => {
        expect(vorlage.offer.proof).toBe("");
        expect(vorlage.offer.signature).toBe("");
      });

      // ── Keine Gedankenstriche ─────────────────────────────────────────
      // Feste Vorgabe des Nutzers. Die Mails deckt sequenceProblems mit
      // kind: "dash" ab; die Angebotsfelder deckt gar nichts ab, obwohl sie
      // ueber den Prompt in jede erzeugte Mail weiterwandern.
      it("hat keine Gedankenstriche in den Angebotsfeldern", () => {
        const mitStrich = [...OFFER_TEXT_FIELDS, "name" as const].filter((f) =>
          DASH.test(vorlage.offer[f as OfferTextField | "name"])
        );
        expect(mitStrich).toEqual([]);
      });

      // ── Die beiden Platzhalter ────────────────────────────────────────
      //
      // Beide Pruefungen kommen aus .claude/skills/cold-email-copy/SKILL.md
      // und nicht aus dem Playbook: der Skill legt den AUFBAU von Mail 1
      // fest (Anrede, {{personalization}}, dann als zweiter Beweispunkt die
      // nachpruefbare Beobachtung) und verbietet Saetze, die auf einen
      // Platzhalter angewiesen sind.
      it("stellt den Website-Befund direkt hinter den Aufhaenger", () => {
        for (const v of vorlage.sequence[0].variants) {
          const zeilen = v.body
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          const iAufhaenger = zeilen.indexOf("{{personalization}}");
          const iBefund = zeilen.indexOf("{{websiteFinding}}");
          expect(iAufhaenger).toBeGreaterThanOrEqual(0);
          expect(iBefund).toBe(iAufhaenger + 1);
        }
      });

      // Der teuerste Fehler waere ein Satz, der ohne einen Platzhalter
      // zerfaellt ("was SONST NOCH kaputt ist"): {{personalization}} kann
      // leer bleiben, und dann liest der Empfaenger eine halbe Mail.
      // Gemessen wird, was uebrig bleibt, wenn beide Zeilen wegfallen.
      it("traegt Mail 1 auch mit leeren Platzhaltern", () => {
        const rueckverweise = /sonst noch|die ganze Liste|what else|the full list/i;
        for (const v of vorlage.sequence[0].variants) {
          const ohne = v.body
            .replace(/\{\{personalization\}\}/g, "")
            .replace(/\{\{websiteFinding\}\}/g, "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          // Anrede, mindestens ein eigener Satz, Micro-Yes.
          expect(ohne.length).toBeGreaterThanOrEqual(3);
          expect(ohne[ohne.length - 1]).toBe(vorlage.offer.cta);
          expect(ohne.some((l) => rueckverweise.test(l))).toBe(false);
        }
      });

      it("hat keine Gedankenstriche in den Mails", () => {
        const mitStrich = vorlage.sequence.flatMap((step, i) =>
          step.variants.filter((v) => DASH.test(v.subject + v.body)).map(() => i + 1)
        );
        expect(mitStrich).toEqual([]);
      });
    });
  }

  // ── de und en decken dasselbe ab ────────────────────────────────────
  // Eine englische Fassung mit einer Stufe weniger oder einem fehlenden Feld
  // faellt sonst niemandem auf: sie wird nur von englischsprachigen Nutzern
  // gesehen und von niemandem geprueft.
  it("deckt in de und en dieselben Felder ab", () => {
    const de = Object.keys(WEBSITE_DESIGN_OFFER_TEMPLATE.de.offer).sort();
    const en = Object.keys(WEBSITE_DESIGN_OFFER_TEMPLATE.en.offer).sort();
    expect(en).toEqual(de);
  });

  it("hat in de und en dieselbe Stufenzahl und dieselben Abstaende", () => {
    const de = WEBSITE_DESIGN_OFFER_TEMPLATE.de.sequence;
    const en = WEBSITE_DESIGN_OFFER_TEMPLATE.en.sequence;
    expect(en).toHaveLength(de.length);
    expect(en.map((s) => s.variants.length)).toEqual(de.map((s) => s.variants.length));
    expect(en.map((s) => s.delayDays)).toEqual(de.map((s) => s.delayDays));
  });

  // Die Sprache steht nicht nur im Schluessel, sondern auch im Angebot
  // selbst: buildSequencePrompt liest offer.language, nicht den Schluessel.
  it("traegt die Sprache auch im Angebot", () => {
    for (const lang of SPRACHEN) {
      expect(WEBSITE_DESIGN_OFFER_TEMPLATE[lang].offer.language).toBe(lang);
    }
  });
});

