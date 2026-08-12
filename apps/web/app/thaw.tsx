"use client";
import { useId } from "react";

/**
 * THAW -- der Kern, der in der App mitarbeitet.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIE APP EINE FIGUR BEKOMMT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Das Angebot auszufuellen und eine Sequenz schreiben zu lassen ist der
 * einzige Teil der App, in dem der Nutzer nicht verwaltet, sondern etwas
 * entstehen laesst. Genau dort lohnt sich ein Gegenueber: ein
 * Fortschrittsbalken meldet einen Zustand, ein Gegenueber sagt, was es
 * braucht -- und man fuellt das dritte Feld aus, weil jemand darauf wartet.
 *
 * Der Name stand schon im Code, bevor es die Figur gab: das Workspace-Cookie
 * heisst thaw_ws. Frostbreaker ist das Werkzeug, THAW ist das, was es tut.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM KEIN TIER MEHR
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die erste Fassung war ein Eisbaer. Zwei Dinge gegen ihn, beide am Bild
 * geprueft: ein Tiergesicht bringt Deutungen mit, die niemand gemeint hat
 * (das Stirnzeichen wurde als Herkunftszeichen gelesen), und ein Maskottchen
 * verschiebt den Ton der Flaeche ins Verspielte -- daneben steht aber eine
 * Kostenaufstellung und ein Versandtor. Wer damit taeglich arbeitet, will ein
 * Instrument, kein Haustier.
 *
 * Also: ein Sensorkern. Neutral -- keine Art, kein Geschlecht, keine
 * Herkunft -- und trotzdem anwesend. Die Iris weitet sich, wenn er etwas
 * weiss, blinzelt alle sieben Sekunden und wandert beim Arbeiten. Genau diese
 * drei Bewegungen tragen das Lebendige; alles andere ist Geraet.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WORAUS DAS 3D KOMMT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Vier Mittel, alle in SVG, keine Bilddatei (ein PNG braeuchte zwei Fassungen
 * fuer hell und dunkel, waere bei jeder Groesse unscharf und koennte nicht
 * blinzeln):
 *
 *  1. Zwei GEKIPPTE Ellipsen, gegenlaeufig kreisend. Eine Ellipse ist ein
 *     Kreis in Schraeglage -- daher liest das Auge sofort eine dritte Achse.
 *     Das ist der ganze Kreisel-Effekt, ohne eine einzige 3D-Bibliothek.
 *  2. Licht von OBEN LINKS, konsequent in allen Verlaeufen: Koerper, Iris,
 *     Glanzpunkt, Lichtkante. Rundherum gleich hell sieht aus wie ein
 *     Aufkleber.
 *  3. Ein weicher Glanzfleck auf der Kugel, versetzt zur Mitte. Das ist der
 *     Unterschied zwischen einer Scheibe und einer Kugel.
 *  4. Ein Lichtfleck am Boden, der gegenlaeufig zum Schweben atmet. Ohne ihn
 *     steht das Licht still und verraet, dass da nichts schwebt.
 *
 * prefers-reduced-motion schaltet saemtliche Bewegung ab; die Zeichnung
 * bleibt vollstaendig.
 */

export type ThawState =
  /** Nichts oder fast nichts bekannt -- die Blende ist zu. */
  | "cold"
  /** Es fehlt noch etwas Notwendiges -- er hoert zu. */
  | "listening"
  /** Alles Notwendige da -- Mint, Blende weit offen. */
  | "ready"
  /** Schreibt gerade -- der Blick wandert, der Suchring laeuft schnell. */
  | "working";

/** Mittelpunkt und Kugelradius. Einmal benannt, ein Dutzend Mal gebraucht. */
const C = 32;
const KERN = 11.4;

export default function Thaw({
  state,
  size = 64,
  className = "",
}: {
  state: ThawState;
  size?: number;
  className?: string;
}) {
  // Eigene IDs je Instanz: der Kern steht auf der Angebotsseite und im
  // Kampagnengenerator, und zwei gleiche Verlaufs-IDs im selben Dokument
  // lassen die zweite Figur die Fuellung der ersten erben.
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${name}-${uid}`;

  const warm = state === "ready";
  const kalt = state === "cold";
  const arbeitet = state === "working";
  const licht = warm ? "var(--fb-ready)" : "var(--fb-frost)";

  /** Die Iris weitet sich mit dem Wissen. Der einzige Zustandswert, den die
   *  Figur wirklich anzeigt -- alles andere ist Farbe. */
  const iris = warm ? 4.6 : 3.6;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="THAW"
      style={{ overflow: "visible" }}
    >
      <defs>
        {/* Der Koerper. Licht oben links, Schattenseite unten rechts. */}
        <radialGradient id={id("core")} cx="34%" cy="27%" r="76%">
          {/* Drei eigene Deckkraft-Variablen statt calc(): calc() in
              stop-opacity ist nicht in jedem Browser verlaesslich, und ein
              Ausfall waere hier ein unsichtbarer Kern. */}
          <stop offset="0%" stopColor="var(--fb-holo-hi)" stopOpacity="var(--fb-holo-a1)" />
          <stop offset="55%" stopColor="var(--fb-holo-mid)" stopOpacity="var(--fb-holo-a2)" />
          <stop offset="100%" stopColor="var(--fb-holo-lo)" stopOpacity="var(--fb-holo-a3)" />
        </radialGradient>

        {/* Die Iris leuchtet von innen: weisser Punkt, dann die Zustandsfarbe.
            Derselbe Lichteinfall wie beim Koerper, sonst kippt die Kugel. */}
        <radialGradient id={id("iris")} cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="42%" stopColor={licht} stopOpacity="1" />
          <stop offset="100%" stopColor={licht} stopOpacity="0.72" />
        </radialGradient>

        {/* Die Lichtkante. Oben hart, nach unten auslaufend. */}
        <linearGradient id={id("rim")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={licht} stopOpacity="0.95" />
          <stop offset="45%" stopColor={licht} stopOpacity="0.4" />
          <stop offset="100%" stopColor={licht} stopOpacity="0.1" />
        </linearGradient>

        <radialGradient id={id("glow")}>
          <stop offset="0%" stopColor={licht} stopOpacity="0.55" />
          <stop offset="100%" stopColor={licht} stopOpacity="0" />
        </radialGradient>

        <filter id={id("blur")} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <filter id={id("blurSoft")} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>

        <pattern id={id("scan")} width="4" height="3" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill={licht} opacity="var(--fb-scan-a)" />
        </pattern>

        <clipPath id={id("clip")}>
          <circle cx={C} cy={C} r={KERN} />
        </clipPath>
      </defs>

      {/* Lichtfleck am Boden. Er macht aus "steht" ein "schwebt". */}
      <ellipse
        className="fb-shadow"
        cx={C}
        cy="59"
        rx="15"
        ry="2.8"
        fill={`url(#${id("glow")})`}
        filter={`url(#${id("blurSoft")})`}
      />

      <g className="fb-float">
        {/* Halo. Eine unscharfe Kopie der Kugel -- billiger und
            gleichmaessiger als ein Schlagschatten je Form. */}
        <circle
          cx={C}
          cy={C}
          r={KERN + 1.4}
          fill={licht}
          filter={`url(#${id("blur")})`}
          opacity="var(--fb-holo-halo-a)"
        />

        {/* ── Die beiden Orbits ────────────────────────────────────────
            Zwei Ringebenen, deutlich verschieden gekippt und gegenlaeufig.
            Am gerenderten Bild geprueft: flache Ellipsen (ry 8) mit feiner
            Strichelung lesen sich nicht als Ring in Schraeglage, sondern als
            verstreute Striche -- der ganze Raumeindruck ging verloren. Jetzt
            ist der aeussere durchgezogen (eine Bahn), nur der innere
            gestrichelt, und beide sind bauchig genug, um als Kreis in
            Perspektive gelesen zu werden.

            Der Knoten auf der aeusseren Bahn ist der einzige Punkt, an dem
            die Drehung wirklich ablesbar ist. */}
        <g className="fb-orbit">
          <g transform={`rotate(-20 ${C} ${C})`}>
            <ellipse
              cx={C}
              cy={C}
              rx="28"
              ry="11.5"
              fill="none"
              stroke={licht}
              strokeWidth="0.8"
              opacity="0.4"
            />
            <circle cx={C + 28} cy={C} r="1.6" fill={licht} opacity="0.9" />
          </g>
        </g>
        {/* Die Neigung MUSS in einer inneren Gruppe stehen.
            Am Bild geprueft: liegt das transform-Attribut auf demselben
            Element wie die Animationsklasse, gewinnt der animierte CSS-Wert
            und die Neigung faellt ersatzlos weg -- die Bahn stand dann quer
            und ausserhalb der Mitte. */}
        <g className="fb-orbit-rev">
          <g transform={`rotate(64 ${C} ${C})`}>
            <ellipse
              cx={C}
              cy={C}
              rx="23"
              ry="13.5"
              fill="none"
              stroke={licht}
              strokeWidth="0.8"
              strokeLinecap="round"
              strokeDasharray="3 5"
              opacity="0.3"
            />
          </g>
        </g>

        {/* ── Die Blende ───────────────────────────────────────────────
            Sechs Segmente um den Kern. Beim Arbeiten dreht der Kranz schnell
            -- das ersetzt den Spinner und sagt "er liest", nicht nur "es
            passiert etwas". */}
        <circle
          className={arbeitet ? "fb-rotate-fast" : "fb-rotate"}
          cx={C}
          cy={C}
          r="15"
          fill="none"
          stroke={licht}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeDasharray="10.2 5.5"
          opacity={kalt ? 0.28 : 0.5}
        />

        {/* ── Die Kugel ────────────────────────────────────────────────── */}
        <circle cx={C} cy={C} r={KERN} fill={`url(#${id("core")})`} />
        {/* Im Zielzustand faerbt sich auch das Glas, nicht nur der Ring.
            Ohne diese Lasur blieb der Koerper frostblau, waehrend alles um
            ihn herum auf Mint umschlug -- am Bild geprueft, es sah nach zwei
            verschiedenen Zustaenden gleichzeitig aus. */}
        {warm && <circle cx={C} cy={C} r={KERN} fill={licht} opacity="0.2" />}

        {/* Scanlinien, auf die Kugel beschnitten und langsam wandernd. */}
        <g clipPath={`url(#${id("clip")})`}>
          <rect
            className="fb-scanlines"
            x="0"
            y="-6"
            width="64"
            height="76"
            fill={`url(#${id("scan")})`}
          />
        </g>

        <circle
          cx={C}
          cy={C}
          r={KERN}
          fill="none"
          stroke={`url(#${id("rim")})`}
          strokeWidth="1.1"
        />

        {/* ── Die Iris ─────────────────────────────────────────────────
            Geschlossen als Spalt, solange er nichts weiss. Eine kleinere
            Iris allein liess sich nicht von "hoert zu" unterscheiden -- am
            gerenderten Bild geprueft. */}
        <g className={arbeitet ? "fb-look" : kalt ? "" : "fb-blink"}>
          {kalt ? (
            <ellipse cx={C} cy={C} rx="6.4" ry="0.9" fill={licht} opacity="0.7" />
          ) : (
            <>
              <circle cx={C} cy={C} r={iris + 2.4} fill={licht} opacity="0.16" />
              <circle cx={C} cy={C} r={iris} fill={`url(#${id("iris")})`} />
              {/* Die Blendenlamellen sitzen VOR der Iris: erst dadurch wird
                  aus dem leuchtenden Punkt eine Optik. */}
              <circle
                className="fb-rotate"
                cx={C}
                cy={C}
                r={iris + 1.5}
                fill="none"
                stroke={licht}
                strokeWidth="0.7"
                strokeLinecap="round"
                strokeDasharray="2.6 2.6"
                opacity="0.6"
              />
            </>
          )}
        </g>

        {/* Der Glanzfleck. Versetzt nach oben links, weich -- das ist der
            Unterschied zwischen einer Scheibe und einer Kugel. Er liegt
            zuoberst, weil Glas das Licht vor allem spiegelt, was dahinter
            liegt. */}
        <ellipse
          cx={C - 4.4}
          cy={C - 5.6}
          rx="4"
          ry="2.4"
          transform={`rotate(-32 ${C - 4.4} ${C - 5.6})`}
          fill="#ffffff"
          opacity="0.6"
          filter={`url(#${id("blurSoft")})`}
        />

        {/* Nur im Zielzustand: ein zweiter, atmender Ring. Der eine Moment,
            den die Figur sich leistet. */}
        {warm && (
          <circle
            className="fb-breathe"
            cx={C}
            cy={C}
            r={KERN + 2.6}
            fill="none"
            stroke={licht}
            strokeWidth="0.8"
            opacity="0.5"
          />
        )}
      </g>
    </svg>
  );
}
