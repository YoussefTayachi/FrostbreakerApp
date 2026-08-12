"use client";
import { useEffect, useRef, useState } from "react";
import { OFFER_TEXT_FIELDS, type OfferTextField } from "@/lib/offers";
import Thaw from "../thaw";

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

/**
 * Groesse des Rings.
 *
 * Die rechte Spalte hat den Platz, also nutzt sie ihn: bei 132 Pixeln stand
 * die Anzeige verloren neben einer 700 Pixel breiten Formularspalte, und die
 * Figur in der Mitte war zu klein, um als Geraet gelesen zu werden. Am
 * Live-Stand nachgemessen: bei R=68 stiessen die Orbits des Kerns fast an die
 * Segmente. Jetzt R=80 bei gleichem Kern-Anteil -- die Spalte ist dafuer auf
 * 340 Pixel gewachsen (offers-editor.tsx).
 */
const R = 80;
const STROKE = 11;
/**
 * Luecke zwischen den Segmenten.
 *
 * 10 Grad und nicht weniger: bei 7 Grad (erster Entwurf, am Bild geprueft)
 * verschmilzt der volle Ring zu einem geschlossenen Kreis, und genau dann
 * geht die Aussage verloren -- man soll SIEBEN Felder sehen, nicht eine
 * Fortschrittsanzeige.
 */
const GAP_DEG = 10;
const SIZE = 200;
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
  say,
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
  /** Was THAW gerade sagt. Formuliert wird in dict.ts, entschieden hier
   *  nicht -- der Aufrufer kennt den Zustand ohnehin. */
  say: string;
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
                        ? "var(--fb-ready)"
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

        {/* In der Mitte steht nicht die Zahl, sondern THAW. Die Zahl klein
            darunter: sie beantwortet "wie weit", er beantwortet "und jetzt?".
            Ein Prozentwert allein hat noch nie jemanden dazu gebracht, ein
            drittes Feld auszufuellen. */}
        {/* Die Projektionsfläche.
            Am Live-Stand nachgemessen: das Panel ist bg-panel, also reines
            Weiß, und darauf hatte die Figur keinen Grund, auf dem sie stehen
            konnte. Diese weiche Scheibe gibt ihr einen -- und sie erklärt
            nebenbei, woher das Hologramm kommt. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[64%] w-[64%] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: `radial-gradient(circle, color-mix(in srgb, ${
              ready ? "var(--fb-ready)" : "var(--fb-frost)"
            } 13%, transparent) 0%, transparent 72%)`,
          }}
        />

        {/* Kern und Messwert liegen BEIDE absolut, nicht gestapelt.
            Gestapelt schob die Zahl den Kern um ein Zehntel des Durchmessers
            nach oben -- bei einem Instrument sieht man sofort, wenn die Nadel
            nicht in der Mitte der Skala sitzt. Die Zahl steht jetzt unten im
            Ring, innerhalb der Segmente. */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Thaw state={ready ? "ready" : filled.size === 0 ? "cold" : "listening"} size={112} />
          </div>
          <span
            className="fb-num absolute bottom-[38px] left-1/2 -translate-x-1/2 text-[17px] font-semibold leading-none"
            style={{ color: ready ? "var(--fb-ready)" : "var(--fb-frost)" }}
          >
            {percent}%
          </span>
        </div>
      </div>

      {/* Was THAW gerade braucht. Eine Zeile, kein Gespraech -- sie sagt
          immer genau das, was als Naechstes zu tun ist. */}
      <p className="mt-3.5 min-h-9 px-1 text-center text-[12.5px] leading-[1.45] text-soft">{say}</p>

      {/* Die Legende beantwortet, was der Ring zeigt: welches Segment welches
          Feld ist. Anklickbar, damit der Ring nicht nur meldet, sondern
          hinführt. */}
      <ul className="mt-4 w-full space-y-0.5">
        {OFFER_TEXT_FIELDS.map((field) => {
          const an = filled.has(field);
          const pflicht = required.has(field);
          return (
            <li key={field}>
              <button
                type="button"
                onClick={() => onJump(field)}
                className="group flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full transition-colors"
                  style={{
                    background: an
                      ? ready
                        ? "var(--fb-ready)"
                        : "var(--fb-frost)"
                      : pflicht
                        ? "var(--fb-frost-dim)"
                        : "var(--color-edge2)",
                  }}
                />
                {/* Zwei Zeilen statt Abschneiden.
                    Am Live-Stand gemessen: "What does the customer struggle
                    with beforehand?" lief ins "..." -- und eine Legende, die
                    ihre eigenen Eintraege verschluckt, beantwortet genau die
                    Frage nicht, fuer die es sie gibt. Bei zwei Zeilen passen
                    auch die laengsten Feldnamen beider Sprachen. */}
                <span
                  className={
                    "flex-1 text-[13px] leading-[1.35] transition-colors [display:-webkit-box] [overflow:hidden] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] " +
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
