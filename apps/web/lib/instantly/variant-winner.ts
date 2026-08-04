/**
 * Welche Variante gewinnt -- und wann man das ueberhaupt sagen darf.
 *
 * DIE SCHWIERIGE STELLE IST NICHT DAS RECHNEN, SONDERN DAS SCHWEIGEN
 *
 * Der klassische Fehler beim A/B-Test ist, den Gewinner zu frueh
 * auszurufen. Bei 40 versendeten Mails je Variante und einer Antwortquote um
 * die 3 Prozent ist der Unterschied zwischen "1 Antwort" und "3 Antworten"
 * reines Rauschen -- er sieht aber aus wie eine Verdreifachung. Wer danach
 * die andere Variante abschaltet, hat mit einiger Wahrscheinlichkeit die
 * bessere geloescht und ist trotzdem ueberzeugt, etwas gelernt zu haben.
 *
 * Deshalb gibt es hier drei Zustaende und nicht nur eine Rangliste:
 *
 *   collecting -- zu wenig Daten. Es wird KEINE Empfehlung ausgesprochen.
 *   leading    -- eine Variante liegt vorn, der Abstand ist aber noch im
 *                 Bereich des Zufalls. Anschauen ja, abschalten nein.
 *   winner     -- der Abstand haelt einem Zweistichprobentest auf 95 Prozent
 *                 stand. Jetzt darf man die anderen abschalten.
 *
 * Gemessen wird an EINDEUTIGEN Antworten je versendeter Mail. Nicht an
 * Oeffnungen: die haengen an einem Zaehlpixel, der bei einem Teil der
 * Empfaenger gar nicht laedt und bei einem anderen Teil vom Sicherheitsscanner
 * automatisch geladen wird -- eine Zahl, die in beide Richtungen luegt. Die
 * Antwort ist das, was zaehlt, und sie ist eindeutig.
 */

/** Eine Zeile aus Instantlys /campaigns/analytics/steps, auf das Noetige reduziert. */
export type VariantStats = {
  /** Instantlys Schrittnummer, ab 0. */
  step: number;
  /** Instantlys Variantennummer, ab 0. 0 = A, 1 = B, ... */
  variant: number;
  sent: number;
  opened: number;
  unique_replies: number;
};

export type VariantVerdict = "collecting" | "leading" | "winner" | "behind";

export type RatedVariant = VariantStats & {
  /** Eindeutige Antworten je versendeter Mail, 0 bis 1. */
  replyRate: number;
  verdict: VariantVerdict;
};

export type StepAssessment = {
  step: number;
  variants: RatedVariant[];
  /** Variantennummer des Gewinners, oder null solange keiner feststeht. */
  winner: number | null;
  /** Wie viele Sendungen der schwaechsten Variante noch zur Mindestmenge fehlen. */
  missingSends: number;
};

/**
 * Mindestmenge je Variante, bevor ueberhaupt verglichen wird.
 *
 * 50 ist kein statistisch hergeleiteter Wert, sondern eine Anstandsgrenze:
 * darunter ist bei den ueblichen Antwortquoten im einstelligen Prozentbereich
 * jede Aussage geraten. Der Test unten entscheidet danach, ob es trotzdem
 * reicht -- meist braucht es deutlich mehr.
 */
export const MIN_SENDS_PER_VARIANT = 50;

/** Zweiseitig, 95 Prozent. */
const Z_95 = 1.96;

/**
 * Zweistichproben-Test auf Anteilswerte.
 *
 * Beantwortet: koennte der beobachtete Unterschied zwischen zwei Quoten auch
 * durch Zufall entstanden sein? Bewusst der einfachste Test, den es fuer
 * diese Frage gibt -- er ist nachvollziehbar, und alles Feinere waere hier
 * Genauigkeit vorgetaeuscht, wo die Datenmenge sie nicht hergibt.
 */
export function proportionsDiffer(
  successesA: number,
  totalA: number,
  successesB: number,
  totalB: number
): boolean {
  if (totalA <= 0 || totalB <= 0) return false;
  const pA = successesA / totalA;
  const pB = successesB / totalB;
  const pooled = (successesA + successesB) / (totalA + totalB);
  // Ohne einen einzigen Erfolg (oder bei ausschliesslich Erfolgen) ist die
  // Streuung null und die Division waere nicht definiert. Beide Varianten
  // haben dann dasselbe Ergebnis -- es gibt nichts zu unterscheiden.
  if (pooled <= 0 || pooled >= 1) return false;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  if (se === 0) return false;
  return Math.abs(pA - pB) / se >= Z_95;
}

/**
 * Ein Schritt mit seinen Varianten.
 *
 * Der Gewinner muss gegen JEDE andere Variante bestehen, nicht nur gegen die
 * zweitbeste. Bei drei Fassungen waere sonst der Fall moeglich, dass A gegen
 * C gewinnt, gegen B aber nicht -- und man B abschaltet, obwohl sie
 * moeglicherweise die bessere ist.
 */
export function assessStep(stats: VariantStats[]): StepAssessment {
  const step = stats[0]?.step ?? 0;
  const rated: RatedVariant[] = stats
    .map((s) => ({
      ...s,
      replyRate: s.sent > 0 ? s.unique_replies / s.sent : 0,
      verdict: "collecting" as VariantVerdict,
    }))
    .sort((a, b) => a.variant - b.variant);

  const missingSends = Math.max(0, MIN_SENDS_PER_VARIANT - Math.min(...rated.map((r) => r.sent), Infinity));

  // Eine einzelne Variante ist kein Test. Sie bleibt bei "collecting" --
  // "Gewinner" waere hier eine Aussage ueber ein Feld ohne Gegner.
  if (rated.length < 2) return { step, variants: rated, winner: null, missingSends };

  const enoughData = rated.every((r) => r.sent >= MIN_SENDS_PER_VARIANT);
  if (!enoughData) return { step, variants: rated, winner: null, missingSends };

  const best = rated.reduce((a, b) => (b.replyRate > a.replyRate ? b : a));
  const others = rated.filter((r) => r.variant !== best.variant);
  const beatsAll = others.every(
    (o) =>
      best.replyRate > o.replyRate &&
      proportionsDiffer(best.unique_replies, best.sent, o.unique_replies, o.sent)
  );

  for (const r of rated) {
    if (r.variant === best.variant) r.verdict = beatsAll ? "winner" : "leading";
    else r.verdict = beatsAll ? "behind" : "collecting";
  }

  return { step, variants: rated, winner: beatsAll ? best.variant : null, missingSends };
}

/** Alle Zeilen nach Schritt gruppieren und je Schritt bewerten. */
export function assessSteps(stats: VariantStats[]): StepAssessment[] {
  const byStep = new Map<number, VariantStats[]>();
  for (const s of stats) {
    const list = byStep.get(s.step);
    if (list) list.push(s);
    else byStep.set(s.step, [s]);
  }
  return [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([, rows]) => assessStep(rows));
}
