"use client";

/**
 * THAW -- der Kern, der in der App mitarbeitet.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIE APP EINE FIGUR BEKOMMT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Das Angebot auszufuellen und eine Sequenz schreiben zu lassen ist der
 * einzige Teil der App, in dem der Nutzer nicht verwaltet, sondern etwas
 * entstehen laesst. Genau dort lohnt sich ein Gegenueber: ein Fortschritts-
 * balken meldet einen Zustand, ein Gegenueber sagt, was es braucht -- und man
 * fuellt das dritte Feld aus, weil jemand darauf wartet.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM AUSGERECHNET DIESE FORM UND DIESER NAME
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Kein Gesicht, kein Maskottchen, keine Sprechblase mit Zwinkersmiley -- das
 * waere in einem Werkzeug, mit dem jemand seinen Umsatz macht, in der zweiten
 * Woche peinlich. Stattdessen ein Eiskristall mit einer Iris: sechs Arme, die
 * sich langsam drehen, und ein Kern, der sich oeffnet, wenn er genug weiss.
 *
 * Der Name stand schon im Code, bevor es die Figur gab: das Workspace-Cookie
 * heisst thaw_ws. Frostbreaker ist das Werkzeug, THAW ist das, was es tut --
 * einen kalten Kontakt auftauen. Die Farbe folgt derselben Linie: Frost,
 * solange etwas fehlt, Mint, sobald es reicht.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DIE ZURUECKHALTUNG IST TEIL DES ENTWURFS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Im Ruhezustand atmet er, sonst nichts. Vier Sekunden je Zug, kaum sichtbar.
 * Ein Maskottchen, das dauernd zappelt, ist beim dritten Oeffnen der Seite nur
 * noch im Weg -- und es ist genau der Grund, warum Figuren in
 * Geschaeftssoftware meistens ein Fehler sind. Bewegung gibt es nur an den
 * drei Stellen, an denen wirklich etwas passiert: aufwachen, arbeiten,
 * fertig.
 */

export type ThawState =
  /** Nichts oder fast nichts bekannt. */
  | "cold"
  /** Es fehlt noch etwas Notwendiges. */
  | "listening"
  /** Alles Notwendige da. */
  | "ready"
  /** Schreibt gerade. */
  | "working";

const ARMS = [0, 60, 120, 180, 240, 300];

export default function Thaw({
  state,
  size = 40,
  className = "",
}: {
  state: ThawState;
  size?: number;
  className?: string;
}) {
  const warm = state === "ready";
  const farbe = warm ? "var(--fb-ready)" : "var(--fb-frost)";
  // Der Kern oeffnet sich mit dem Wissensstand: geschlossen, wenn nichts da
  // ist, weit offen, wenn es reicht. Die Iris ist die Aussage, nicht ein
  // Gesichtsausdruck.
  const iris = state === "cold" ? 2.6 : state === "listening" ? 4.2 : state === "working" ? 5 : 5.8;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label="THAW"
    >
      {/* Die Arme. Im Arbeitszustand schneller, sonst kaum wahrnehmbar. */}
      <g className={state === "working" ? "fb-rotate-fast" : "fb-rotate"} style={{ transformBox: "fill-box" }}>
        {ARMS.map((deg) => (
          <g key={deg} transform={`rotate(${deg} 20 20)`}>
            <line
              x1="20"
              y1="20"
              x2="20"
              y2="5.5"
              stroke={farbe}
              strokeWidth="1.4"
              strokeLinecap="round"
              opacity={state === "cold" ? 0.4 : 0.75}
            />
            {/* Die Verzweigung, an der ein Eiskristall als Eiskristall
                erkennbar wird. Ohne sie waere es ein Stern. */}
            <path
              d="M20 9.5 L16.8 6.6 M20 9.5 L23.2 6.6"
              stroke={farbe}
              strokeWidth="1.2"
              strokeLinecap="round"
              fill="none"
              opacity={state === "cold" ? 0.3 : 0.6}
            />
          </g>
        ))}
      </g>

      {/* Das Sechseck haelt die Arme zusammen und gibt dem Kern einen Rand. */}
      <polygon
        points="20,11 27.8,15.5 27.8,24.5 20,29 12.2,24.5 12.2,15.5"
        fill="none"
        stroke={farbe}
        strokeWidth="1.1"
        opacity={state === "cold" ? 0.35 : 0.55}
      />

      {/* Der Kern. Er atmet -- und das ist im Ruhezustand alles. */}
      <g className={state === "working" ? "" : "fb-breathe"} style={{ transformBox: "fill-box" }}>
        <circle cx="20" cy="20" r={iris + 2.6} fill={farbe} opacity="0.14" />
        <circle
          cx="20"
          cy="20"
          r={iris}
          fill={farbe}
          className="fb-wake"
          style={{ transition: "r 0.45s cubic-bezier(0.2,0.7,0.3,1)" }}
        />
        {/* Ein heller Punkt aussermittig: der Unterschied zwischen einem
            Kreis und etwas, das schaut. */}
        <circle cx="18.4" cy="18.4" r={Math.max(0.8, iris * 0.28)} fill="#fff" opacity={warm ? 0.85 : 0.7} />
      </g>
    </svg>
  );
}
