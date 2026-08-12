"use client";

/**
 * THAW -- der Eisbär, der in der App mitarbeitet.
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
 * Ein Maskottchen ist dafuer das richtige Mittel, nicht das falsche. Duolingos
 * Eule, Mailchimps Freddie und der Octocat tragen ganze Produkte. Was
 * scheitert, ist ein BELIEBIGES Maskottchen -- eines, das genauso gut zu einer
 * Buchhaltungssoftware gehoeren koennte.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM EIN EISBAER UND WARUM DIESER
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Der Name stand schon im Code, bevor es die Figur gab: das Workspace-Cookie
 * heisst thaw_ws. Frostbreaker ist das Werkzeug, THAW ist das, was es tut --
 * einen kalten Kontakt auftauen. Ein Eisbaer ist genau die Figur, die im Eis
 * zu Hause ist und trotzdem hindurchbricht.
 *
 * Eigene Zeichnung, kein nachgebautes Vorbild: die Vorlage aus dem Gespraech
 * (Volibear) gehoert Riot Games und haette in einer verkauften Anwendung
 * nichts zu suchen. Uebernommen ist nur das, was frei ist -- die Idee vom
 * Eisbaeren. Die Ausfuehrung ist bewusst geometrisch und nah an der uebrigen
 * Instrumentenflaeche: Haarlinien, zwei Fell-Toene, die Frost/Mint-Skala aus
 * globals.css. Das Frostzeichen auf der Stirn ist derselbe Kristall, der
 * vorher allein in der Mitte des Rings stand.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WAS ER TUT UND WAS NICHT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Er blinzelt alle sieben Sekunden, und im Ruhezustand ist das alles. Beim
 * Arbeiten wandert sein Blick, beim Fertigsein hebt sich der Mundwinkel und
 * die Augen schlagen von Frost auf Mint um. Mehr nicht -- keine Winkanimation,
 * kein Huepfen, keine Sprechblase. Eine Figur, die staendig zappelt, ist beim
 * dritten Oeffnen der Seite nur noch im Weg, und genau daran scheitern
 * Maskottchen in Geschaeftssoftware.
 */

export type ThawState =
  /** Nichts oder fast nichts bekannt -- Augen halb zu. */
  | "cold"
  /** Es fehlt noch etwas Notwendiges -- er hoert zu. */
  | "listening"
  /** Alles Notwendige da -- Augen in Mint, Mundwinkel oben. */
  | "ready"
  /** Schreibt gerade -- der Blick wandert. */
  | "working";

export default function Thaw({
  state,
  size = 64,
  className = "",
}: {
  state: ThawState;
  size?: number;
  className?: string;
}) {
  const warm = state === "ready";
  const linie = warm ? "var(--fb-ready)" : "var(--fb-frost)";
  const kalt = state === "cold";

  // Die Augen tragen den Ausdruck. Halb geschlossen, wenn er nichts weiss,
  // weit offen, sobald es reicht -- dieselbe Aussage wie die Iris des
  // frueheren Kristalls, nur lesbarer.
  const augeR = kalt ? 2.6 : warm ? 4.2 : 3.6;

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
      {/* Ohren. Zuerst gezeichnet, damit der Kopf sie ueberlappt. */}
      {[
        { cx: 17, cy: 17 },
        { cx: 47, cy: 17 },
      ].map((ohr) => (
        <g key={ohr.cx}>
          <circle cx={ohr.cx} cy={ohr.cy} r="9" fill="var(--fb-fur)" stroke={linie} strokeWidth="1.6" />
          <circle cx={ohr.cx} cy={ohr.cy} r="4" fill="var(--fb-fur-lit)" />
        </g>
      ))}

      {/* Kopf. Breiter als hoch -- das ist der Unterschied zwischen einem
          Baeren und einer Katze. */}
      <ellipse cx="32" cy="36" rx="23" ry="20.5" fill="var(--fb-fur)" stroke={linie} strokeWidth="1.8" />

      {/* Das Frostzeichen auf der Stirn: derselbe Kristall, der vorher allein
          in der Mitte des Rings stand. Er verbindet die Figur mit dem
          Instrument drumherum. */}
      <g opacity={kalt ? 0.4 : 0.9} className={state === "working" ? "fb-rotate-fast" : ""} style={{ transformOrigin: "32px 22px" }}>
        {[0, 60, 120].map((deg) => (
          <line
            key={deg}
            x1="32"
            y1="19"
            x2="32"
            y2="25"
            stroke={linie}
            strokeWidth="1.4"
            strokeLinecap="round"
            transform={`rotate(${deg} 32 22)`}
          />
        ))}
      </g>

      {/* Schnauze. Heller abgesetzt, damit Nase und Mund darauf sitzen. */}
      <ellipse cx="32" cy="43" rx="11.5" ry="8.5" fill="var(--fb-fur-lit)" />

      {/* Augen. Blinzeln im Ruhezustand, Blick wandert beim Arbeiten. */}
      <g className={state === "working" ? "fb-look" : kalt ? "" : "fb-blink"}>
        {[24, 40].map((cx) =>
          kalt ? (
            /* Geschlossen, solange er nichts weiss. Kleinere Augen allein
               liessen sich nicht von "hoert zu" unterscheiden -- gemessen am
               gerenderten Bild; zwei geschlossene Lider sagen es sofort. */
            <path
              key={cx}
              d={`M${cx - 4} 32 q4 3.4 8 0`}
              fill="none"
              stroke={linie}
              strokeWidth="1.6"
              strokeLinecap="round"
              opacity="0.6"
            />
          ) : (
            <g key={cx}>
              <circle cx={cx} cy={32} r={augeR} fill={linie} />
              {/* Der helle Punkt -- der Unterschied zwischen einem Auge und
                  einem Loch. */}
              <circle cx={cx - 1.1} cy={30.9} r={augeR * 0.34} fill="#fff" opacity="0.9" />
            </g>
          )
        )}
      </g>

      {/* Nase und Mund. Der Mundwinkel hebt sich, sobald es reicht -- die
          einzige Stelle, an der die Figur eine Miene macht. */}
      <ellipse cx="32" cy="40.5" rx="3.2" ry="2.4" fill={linie} />
      <path
        d={
          warm
            ? "M32 43 v2.4 M32 45.4 q-4.5 4 -8.4 0.4 M32 45.4 q4.5 4 8.4 0.4"
            : "M32 43 v2.4 M32 45.4 q-4 2.6 -7.6 0.5 M32 45.4 q4 2.6 7.6 0.5"
        }
        fill="none"
        stroke={linie}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity={kalt ? 0.5 : 0.85}
      />
    </svg>
  );
}
