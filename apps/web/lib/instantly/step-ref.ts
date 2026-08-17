/**
 * Instantlys `step`-Feld: welcher Schritt, welche Variante.
 *
 * WARUM ES DIESE DATEI GIBT
 *
 * Am 2026-08-05 trugen 0 von 753 Nachrichten einen `step_order`. Die App
 * konnte damit zu keiner Antwort sagen, welcher Text sie ausgeloest hat:
 * nicht der Schritt, nicht die Variante, nicht der Aufhaenger. Die
 * Wirkungs-Ansicht konnte nach Lead-Liste und Wochentag aufschluesseln, aber
 * nie nach dem, was tatsaechlich geschrieben wurde.
 *
 * Der Grund war kein fehlendes Feld bei Instantly, sondern ein nie gelesenes:
 * `GET /api/v2/emails` liefert je Mail ein `step` mit, und der Typ in
 * instantly-sync deklarierte schlicht nur fuenf der neunzehn Felder.
 *
 * DAS FORMAT, am 2026-08-05 an 763 echten Mails abgelesen
 *
 *   "0_0_0"  ->  sequenz 0, schritt 0, variante 0
 *    ^ ^ ^
 *    | | +-- Variante, 0-basiert
 *    | +---- Schritt, 0-basiert
 *    +------ Sequenz, 0-basiert
 *
 * Die Belege je Stelle, damit das nicht geraten aussieht:
 *
 *   Dritte Stelle = Variante. Kampagne 60b4b3ac ist die einzige mit zwei
 *   Fassungen in Schritt 0. Genau dort und nur dort kamen "0_0_0" (150) und
 *   "0_0_1" (154) vor, Instantlys haelftige Verteilung auf A und B.
 *
 *   Zweite Stelle = Schritt. Die Kampagnen mit bereits versendetem Follow-up
 *   zeigten "0_0_0" und "0_1_0". Kein einziger Wert hatte eine zweite Stelle
 *   groesser als die Zahl ihrer Schritte.
 *
 *   Erste Stelle = Sequenz, heute ueberall 0. Instantly erlaubt mehrere
 *   Sequenzen je Kampagne; das Feld wird mitgefuehrt, obwohl es aktuell nichts
 *   unterscheidet; sonst wuerde eine zweite Sequenz spaeter still auf die
 *   erste addiert, und die Auswertung waere falsch, ohne dass es auffaellt.
 *
 * ZAEHLUNG: 0-basiert, und das passt ohne Umrechnung
 *
 * `campaign_steps.step_order` ist ebenfalls 0-basiert (Migration 0001), und
 * `campaign_steps.variants` ist ein Array, dessen Index 0 laut Migration 0071
 * die Variante A ist. Instantlys Zaehlung und unsere sind damit dieselbe.
 * Hier NICHT auf 1 umzurechnen ist Absicht: eine Umrechnung an dieser Stelle
 * muesste an jeder Lesestelle rueckgaengig gemacht werden, und die erste
 * vergessene waere ein stiller Versatz um genau einen Schritt.
 */

export type StepRef = {
  /** Instantly erlaubt mehrere Sequenzen je Kampagne. Heute immer 0. */
  sequence: number;
  /** 0-basiert, deckungsgleich mit campaign_steps.step_order. */
  step: number;
  /** 0-basiert, deckungsgleich mit dem Index in campaign_steps.variants. */
  variant: number;
};

/**
 * Zerlegt Instantlys `step`-Zeichenkette.
 *
 * Gibt bei allem Unerwarteten `null` zurueck statt einen Teiltreffer.
 *
 * Der Grund ist derselbe wie beim DNS-Rueckfall im Torwart: ein geratener
 * Schritt ist schlimmer als gar keiner. Ein `null` faellt in der Auswertung
 * als "nicht zuordenbar" auf und laesst sich beheben; eine stillschweigend auf
 * 0 gesetzte Variante verschiebt eine A/B-Auswertung dauerhaft zugunsten von
 * A, und niemand wuerde je nachsehen, warum A immer gewinnt.
 */
export function parseStepRef(raw: unknown): StepRef | null {
  if (typeof raw !== "string") return null;
  const parts = raw.trim().split("_");
  if (parts.length !== 3) return null;

  const nums = parts.map((p) => {
    // Bewusst streng: nur reine Ziffernfolgen. Number("") ist 0 und
    // Number(" 1 ") ist 1; beides wuerde hier eine Zuordnung erfinden, wo
    // das Format nicht stimmt.
    if (!/^\d+$/.test(p)) return null;
    return Number(p);
  });
  if (nums.some((n) => n === null)) return null;

  const [sequence, step, variant] = nums as number[];
  return { sequence, step, variant };
}
