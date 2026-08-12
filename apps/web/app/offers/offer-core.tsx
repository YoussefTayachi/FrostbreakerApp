"use client";
import { useEffect, useRef, useState } from "react";
import { OFFER_TEXT_FIELDS, type OfferTextField } from "@/lib/offers";

/**
 * Der Ring -- das eine auffällige Element dieser Fläche.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM EIN RING UND KEINE PROZENTZAHL
 * ═══════════════════════════════════════════════════════════════════════
 *
 * "57 % ausgefüllt" beantwortet die Frage nicht, die man vor dem Erzeugen
 * wirklich hat: WELCHES Feld fehlt noch. Sieben Segmente, eines je Feld,
 * beantworten beides auf einen Blick -- und ein Klick springt zum fehlenden
 * Feld.
 *
 * Die Farbe ist keine Zierde, sie ist derselbe Zustand, den der Knopf
 * "Sequenz erzeugen" abfragt: Frostblau, solange Pflichtfelder fehlen, Glut,
 * sobald das Angebot tragfähig ist. Der Name der App steht für genau diesen
 * Übergang -- ein kalter Kontakt wird aufgetaut.
 *
 * Die Pflichtsegmente sind kräftiger gezeichnet als die freiwilligen. Damit
 * trägt der Ring die Unterscheidung, die sonst nur als kleiner Zusatz am
 * Feldnamen steht.
 */

const R = 52;
const STROKE = 8;
/**
 * Luecke zwischen den Segmenten.
 *
 * 10 Grad und nicht weniger: bei 7 Grad (erster Entwurf, am Bild geprueft)
 * verschmilzt der volle Ring zu einem geschlossenen Kreis, und genau dann
 * geht die Aussage verloren -- man soll SIEBEN Felder sehen, nicht eine
 * Fortschrittsanzeige.
 */
const GAP_DEG = 10;
const SIZE = 132;
const CIRC = 2 * Math.PI * R;
const SEG = CIRC / OFFER_TEXT_FIELDS.length;
const GAP = (GAP_DEG / 360) * CIRC;
const DRAW = SEG - GAP;

export default function OfferCore({
  filled,
  required,
  ready,
  percent,
  labels,
  onJump,
  readyLabel,
  missingLabel,
}: {
  /** Welche Felder Text enthalten. */
  filled: Set<OfferTextField>;
  /** Welche Felder fürs Erzeugen nötig sind. */
  required: Set<OfferTextField>;
  /** Alle Pflichtfelder gefüllt -- der Ring schlägt in Glut um. */
  ready: boolean;
  percent: number;
  labels: Record<OfferTextField, string>;
  onJump: (field: OfferTextField) => void;
  readyLabel: string;
  missingLabel: (n: number) => string;
}) {
  /**
   * Der Zündmoment wird nur beim ÜBERGANG gespielt, nicht bei jedem Rendern.
   * Sonst pulsiert der Ring bei jedem Tastendruck in einem fertigen Angebot --
   * aus einem Moment würde ein Zucken.
   */
  const [ignite, setIgnite] = useState(false);
  const warReady = useRef(ready);
  useEffect(() => {
    if (ready && !warReady.current) {
      setIgnite(true);
      const id = setTimeout(() => setIgnite(false), 700);
      return () => clearTimeout(id);
    }
    warReady.current = ready;
  }, [ready]);

  const fehlend = [...required].filter((f) => !filled.has(f));

  return (
    <div className="flex flex-col items-center">
      <div className={"relative " + (ignite ? "fb-ignite" : "")}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={ready ? readyLabel : missingLabel(fehlend.length)}
        >
          {/* -90°, damit das erste Segment oben beginnt und nicht rechts. */}
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {OFFER_TEXT_FIELDS.map((field, i) => {
              const an = filled.has(field);
              const pflicht = required.has(field);
              return (
                <circle
                  key={field}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  stroke={
                    an
                      ? ready
                        ? "var(--fb-ember)"
                        : "var(--fb-frost)"
                      : pflicht
                        ? "var(--fb-frost-dim)"
                        : "var(--color-edge2)"
                  }
                  // Pflichtfelder kräftiger: die Unterscheidung, die sonst nur
                  // als Wort am Feld steht, trägt hier die Zeichnung.
                  strokeWidth={pflicht ? STROKE : STROKE - 3}
                  strokeLinecap="round"
                  strokeDasharray={`${DRAW} ${CIRC - DRAW}`}
                  strokeDashoffset={-i * SEG}
                  className="fb-seg"
                  style={
                    {
                      "--fb-seg-len": `${CIRC}`,
                      animationDelay: `${i * 55}ms`,
                      opacity: an ? 1 : 0.55,
                    } as React.CSSProperties
                  }
                />
              );
            })}
          </g>
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="fb-num text-[26px] font-semibold leading-none"
            style={{ color: ready ? "var(--fb-ember)" : "var(--fb-frost)" }}
          >
            {percent}
          </span>
          <span className="fb-label mt-1 text-mute">%</span>
        </div>
      </div>

      {/* Die Legende beantwortet, was der Ring zeigt: welches Segment welches
          Feld ist. Anklickbar, damit der Ring nicht nur meldet, sondern
          hinführt. */}
      <ul className="mt-4 w-full space-y-1">
        {OFFER_TEXT_FIELDS.map((field) => {
          const an = filled.has(field);
          const pflicht = required.has(field);
          return (
            <li key={field}>
              <button
                type="button"
                onClick={() => onJump(field)}
                className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full transition-colors"
                  style={{
                    background: an
                      ? ready
                        ? "var(--fb-ember)"
                        : "var(--fb-frost)"
                      : pflicht
                        ? "var(--fb-frost-dim)"
                        : "var(--color-edge2)",
                  }}
                />
                <span
                  className={
                    "flex-1 truncate text-[12px] leading-4 transition-colors " +
                    (an ? "text-soft" : "text-mute group-hover:text-faint")
                  }
                >
                  {labels[field]}
                </span>
                {!an && pflicht && (
                  <span className="fb-label shrink-0" style={{ color: "var(--fb-frost)" }}>
                    !
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
