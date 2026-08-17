"use client";
import { useId } from "react";

/**
 * THAW — der Kern, der in der App mitarbeitet.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIE APP EINE FIGUR BEKOMMT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Das Angebot auszufuellen und eine Sequenz schreiben zu lassen ist der
 * einzige Teil der App, in dem der Nutzer nicht verwaltet, sondern etwas
 * entstehen laesst. Genau dort lohnt sich ein Gegenueber: ein
 * Fortschrittsbalken meldet einen Zustand, ein Gegenueber sagt, was es
 * braucht — und man fuellt das dritte Feld aus, weil jemand darauf wartet.
 *
 * Der Name stand schon im Code, bevor es die Figur gab: das Workspace-Cookie
 * heisst thaw_ws. Frostbreaker ist das Werkzeug, THAW ist das, was es tut.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WAS ER IST — UND WAS ER ZWEIMAL NICHT WAR
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ein Energieball: eine Kugel aus leuchtenden Bahnen, durch die Licht
 * laeuft, um einen heissen Kern. Kein Koerper, kein Gesicht, kein Tier --
 * eine Rechenleistung, die man sehen kann.
 *
 * Zwei verworfene Fassungen, beide am Bild entschieden:
 *
 *  1. Ein Eisbaer. Ein Tiergesicht bringt Deutungen mit, die niemand gemeint
 *     hat, und ein Maskottchen verschiebt den Ton einer Flaeche, neben der
 *     eine Kostenaufstellung und ein Versandtor stehen.
 *  2. Eine Optik mit Iris, umlaufen von zwei gekippten Bahnen. Das Auge
 *     schaute zurueck — ungewollt unheimlich — und eine einzelne gekippte
 *     Ellipse liest sich als Saturn, nicht als Technik.
 *
 * Beides faellt hier weg: keine Pupille, kein einzelner Reif. Ein
 * geschlossenes Drahtgitter aus fuenf Breiten- und drei Laengenkreisen liest
 * sich als Kugel, nicht als Planet mit Ring — der Unterschied liegt allein
 * in der Anzahl.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WORAUS DAS RAEUMLICHE KOMMT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Alles SVG, keine Bilddatei (ein PNG braeuchte zwei Fassungen fuer hell und
 * dunkel, waere bei jeder Groesse unscharf und koennte nicht auf die
 * Zustaende reagieren):
 *
 *  1. Breitenkreise als GESTAUCHTE Ellipsen, deren Radius zu den Polen hin
 *     abnimmt. Das ist die ganze Kugelperspektive — eine Formel, keine
 *     3D-Bibliothek.
 *  2. Laengengrade als Ellipsen mit voller Hoehe und abnehmender Breite.
 *     Erst zusammen schliesst sich das Gitter zur Kugel.
 *  3. Eine leichte Achsneigung. Genau senkrecht sieht nach Globus aus.
 *  4. Licht, das DURCH die Bahnen laeuft (wandernde Strichmuster). Das ist
 *     die eigentliche Lebendigkeit: nichts bewegt sich von der Stelle, und
 *     trotzdem steht nichts still.
 *  5. Ein heisser Kern mit Bloom und ein Lichtfleck am Boden, der
 *     gegenlaeufig zum Schweben atmet.
 *
 * prefers-reduced-motion schaltet saemtliche Bewegung ab; die Zeichnung
 * bleibt vollstaendig.
 */

export type ThawState =
  /** Nichts oder fast nichts bekannt — der Kern glimmt nur, das Licht
   *  kriecht. */
  | "cold"
  /** Es fehlt noch etwas Notwendiges — er laeuft. */
  | "listening"
  /** Alles Notwendige da — Mint, Kern hell, ein zweiter Reif. */
  | "ready"
  /** Schreibt gerade — das Licht rast durch die Bahnen. */
  | "working";

const C = 32;
/** Kugelradius. 21 von 32 laesst aussen Platz fuer Bloom und Bodenlicht. */
const R = 21;
/** Perspektivische Stauchung der Breitenkreise. Bei 1 waere es eine
 *  Zielscheibe, bei 0 ein Stapel Striche. */
const STAUCHUNG = 0.34;
/** Achsneigung in Grad. Senkrecht sieht nach Schulglobus aus. */
const NEIGUNG = -14;

/** Breitenkreise in Grad, 0 = Aequator. */
const BREITEN = [62, 31, 0, -31, -62];
/** Laengengrade als Anteil der vollen Kugelbreite. */
const LAENGEN = [1, 0.62, 0.26];

/**
 * Die Energiefaeden.
 *
 * Fest hinterlegt statt zufaellig erzeugt: Zufall bei jedem Rendern liesse
 * die Figur bei jedem Tastendruck im Formular neu zucken, und ein Muster,
 * das niemand nachlesen kann, laesst sich auch nicht nachbessern.
 * Absichtlich ungleichmaessig verteilt — gleiche Abstaende ergeben einen
 * Stern, und ein Stern sieht aus wie ein Ladesymbol.
 */
const FAEDEN = [
  { a: 6, r0: 5.5, r1: 20.2, o: 0.66 },
  { a: 22, r0: 4.2, r1: 15.4, o: 0.44 },
  { a: 41, r0: 6.8, r1: 20.8, o: 0.6 },
  { a: 58, r0: 4.6, r1: 13.2, o: 0.36 },
  { a: 71, r0: 5.8, r1: 19.6, o: 0.56 },
  { a: 88, r0: 4.4, r1: 16.8, o: 0.4 },
  { a: 103, r0: 6.2, r1: 20.6, o: 0.64 },
  { a: 121, r0: 4.8, r1: 14.6, o: 0.36 },
  { a: 137, r0: 5.4, r1: 19.9, o: 0.58 },
  { a: 154, r0: 4.5, r1: 17.4, o: 0.4 },
  { a: 172, r0: 6.4, r1: 20.4, o: 0.62 },
  { a: 189, r0: 4.9, r1: 13.8, o: 0.34 },
  { a: 204, r0: 5.6, r1: 20.1, o: 0.6 },
  { a: 221, r0: 4.3, r1: 17.2, o: 0.42 },
  { a: 238, r0: 6.6, r1: 20.7, o: 0.64 },
  { a: 256, r0: 4.7, r1: 14.9, o: 0.36 },
  { a: 271, r0: 5.2, r1: 20.3, o: 0.58 },
  { a: 288, r0: 4.4, r1: 16.2, o: 0.4 },
  { a: 306, r0: 6.1, r1: 20.6, o: 0.62 },
  { a: 322, r0: 4.6, r1: 13.6, o: 0.34 },
  { a: 339, r0: 5.7, r1: 19.8, o: 0.56 },
  { a: 354, r0: 4.2, r1: 16.6, o: 0.4 },
];

/**
 * Sehnen: Verbindungen zwischen zwei Punkten auf der Kugel, die NICHT durch
 * die Mitte gehen.
 *
 * Ohne sie waeren die Faeden ein regelmaessiger Strahlenkranz — und der
 * liest sich sofort als Ladesymbol. Erst die Querverbindungen machen aus dem
 * Stern ein Netz.
 */
const SEHNEN = [
  { a1: 18, r1: 18.4, a2: 96, r2: 17.2, o: 0.3 },
  { a1: 63, r1: 19.2, a2: 148, r2: 16.4, o: 0.24 },
  { a1: 112, r1: 17.8, a2: 196, r2: 19.4, o: 0.28 },
  { a1: 168, r1: 18.9, a2: 244, r2: 16.8, o: 0.22 },
  { a1: 214, r1: 19.4, a2: 292, r2: 18.2, o: 0.28 },
  { a1: 268, r1: 17.4, a2: 338, r2: 19.1, o: 0.24 },
  { a1: 314, r1: 18.6, a2: 32, r2: 19.6, o: 0.26 },
  { a1: 84, r1: 16.2, a2: 258, r2: 15.6, o: 0.2 },
];

const punkt = (grad: number, r: number) => {
  const b = (grad * Math.PI) / 180;
  return [C + r * Math.cos(b), C + r * Math.sin(b)] as const;
};

export default function Thaw({
  state,
  size = 64,
  className = "",
  accent,
  label = "Frostbreaker AI",
}: {
  state: ThawState;
  size?: number;
  className?: string;
  /**
   * Eine andere Leuchtfarbe als die aus dem Zustand.
   *
   * Ein CSS-Farbwert oder eine Eigenschaft (`var(--fb-aim)`). Gedacht fuer den
   * Fall, dass ZWEI Kerne auf derselben Seite stehen und Verschiedenes tun:
   * im Angebotsformular liest der eine das Angebot, der andere eine Lead-Liste.
   * Zwei gleich aussehende Kerne waeren dort zweimal derselbe Knopf.
   *
   * Ohne diesen Wert bleibt alles wie bisher — der Kern faerbt sich nach
   * seinem Zustand (Frost bzw. Mint).
   */
  accent?: string;
  /**
   * Wie die Figur an DIESER Stelle heisst — fuer Screenreader.
   *
   * Im Angebotsformular stehen zwei Kerne nebeneinander, die Verschiedenes
   * tun: "Core" liest das Angebot selbst, "Aim" eine Lead-Liste. Zwei Bilder
   * mit derselben Ansage waeren dort zweimal derselbe Knopf — fuer einen
   * Screenreader waere die Farbe, die sie unterscheidet, ohnehin nicht da.
   *
   * Nicht uebersetzt: Produktnamen, die in beiden Sprachen gleich lauten.
   */
  label?: string;
}) {
  // Eigene IDs je Instanz: der Kern steht auf der Angebotsseite und im
  // Kampagnengenerator, und zwei gleiche Verlaufs-IDs im selben Dokument
  // lassen die zweite Figur die Fuellung der ersten erben.
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${name}-${uid}`;

  const warm = state === "ready";
  const kalt = state === "cold";
  const arbeitet = state === "working";
  // Der Akzent uebersteuert nur die FARBE. Kerngroesse, Staerke und Tempo
  // haengen weiter am Zustand — ein Kern, der die Farbe wechselt UND anders
  // atmet, waere eine zweite Figur.
  const licht = accent ?? (warm ? "var(--fb-ready)" : "var(--fb-frost)");

  /** Der Kern waechst mit dem Wissen — der einzige Zustandswert, den die
   *  Figur wirklich anzeigt. Alles andere ist Farbe und Tempo. */
  const kernR = kalt ? 5.6 : warm ? 9.8 : 8.2;
  /** Solange nichts bekannt ist, liegt das Gitter im Halbdunkel. */
  const staerke = kalt ? 0.5 : 1;
  /** Grunddauer eines Lichtumlaufs in Sekunden. */
  const fluss = arbeitet ? 2.4 : kalt ? 24 : 9;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      // Der Bauteilname bleibt THAW (Datei, Komponente, Cookie thaw_ws) — nach
      // aussen traegt jede Stelle ihren eigenen Namen (siehe `label`).
      aria-label={label}
      style={{ overflow: "visible" }}
    >
      <defs>
        {/* Der heisse Kern: weisser Brennpunkt, dann die Zustandsfarbe, dann
            Nichts. Der weisse Punkt muss klein bleiben — auf hellem Grund
            ist Weiss der Hintergrund, und ein grosser weisser Kern waere
            dort ein Loch. */}
        <radialGradient id={id("hot")}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="18%" stopColor={licht} stopOpacity="1" />
          <stop offset="46%" stopColor={licht} stopOpacity="0.5" />
          <stop offset="100%" stopColor={licht} stopOpacity="0" />
        </radialGradient>

        <radialGradient id={id("glow")}>
          <stop offset="0%" stopColor={licht} stopOpacity="0.5" />
          <stop offset="100%" stopColor={licht} stopOpacity="0" />
        </radialGradient>

        {/* Ein Hauch Fuellung, damit die Bahnen nicht im Nichts haengen.
            Am Bild geprueft: bei 0,5 / 0,28 / 0,22 war es eine massive Kugel
            mit Muster darauf — gemeint ist ein Netz, durch das man
            hindurchsieht. */}
        <radialGradient id={id("body")} cx="36%" cy="28%" r="76%">
          <stop offset="0%" stopColor="var(--fb-holo-hi)" stopOpacity="0.18" />
          <stop offset="60%" stopColor="var(--fb-holo-mid)" stopOpacity="0.1" />
          <stop offset="100%" stopColor="var(--fb-holo-lo)" stopOpacity="0.08" />
        </radialGradient>

        {/* Die Lichtkante. Oben hart, nach unten auslaufend — rundherum
            gleich hell sieht aus wie ein Aufkleber. */}
        <linearGradient id={id("rim")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={licht} stopOpacity="0.8" />
          <stop offset="50%" stopColor={licht} stopOpacity="0.28" />
          <stop offset="100%" stopColor={licht} stopOpacity="0.06" />
        </linearGradient>

        <filter id={id("blur")} x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id={id("blurSoft")} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>

      </defs>

      {/* Lichtfleck am Boden. Er macht aus "steht" ein "schwebt". */}
      <ellipse
        className="fb-shadow"
        cx={C}
        cy="60"
        rx="16"
        ry="2.6"
        fill={`url(#${id("glow")})`}
        filter={`url(#${id("blurSoft")})`}
      />

      <g className="fb-float">
        {/* Bloom um die ganze Kugel. */}
        <circle
          cx={C}
          cy={C}
          r={R * 0.92}
          fill={licht}
          filter={`url(#${id("blur")})`}
          opacity="var(--fb-holo-halo-a)"
        />

        <g transform={`rotate(${NEIGUNG} ${C} ${C})`}>
          <circle cx={C} cy={C} r={R} fill={`url(#${id("body")})`} />

          {/* Keine Scanlinien mehr. Innerhalb der geneigten Gruppe standen
              sie schraeg und lasen sich als Schraffur — eine Zeichentechnik,
              die zu allem anderen hier quersteht. Das wandernde Licht in den
              Breitenkreisen tut ohnehin dasselbe, nur begruendet. */}
          <g opacity={staerke}>
            {/* Laengengrade: volle Hoehe, abnehmende Breite. Ruhig — wanderte
                auch hier Licht, waere die Kugel ein Flimmern. */}
            {LAENGEN.map((f) => (
              <ellipse
                key={f}
                cx={C}
                cy={C}
                rx={R * f}
                ry={R}
                fill="none"
                stroke={licht}
                strokeWidth="0.55"
                opacity="0.3"
              />
            ))}

            {/* Breitenkreise. Durch sie laeuft das Licht — benachbarte Bahnen
                gegenlaeufig und verschieden schnell, sonst pulsiert die ganze
                Kugel im Gleichtakt und der Raumeindruck bricht zusammen. */}
            {BREITEN.map((phi, i) => {
              const b = (phi * Math.PI) / 180;
              const rx = R * Math.cos(b);
              return (
                <ellipse
                  key={phi}
                  cx={C}
                  cy={C - R * Math.sin(b) * 0.94}
                  rx={rx}
                  ry={Math.max(rx * STAUCHUNG, 1.2)}
                  fill="none"
                  stroke={licht}
                  strokeWidth="0.9"
                  strokeLinecap="round"
                  strokeDasharray="1.2 3.4"
                  className={i % 2 ? "fb-flow-rev" : "fb-flow"}
                  style={{ animationDuration: `${fluss * (1 + i * 0.22)}s` }}
                  opacity={0.36 + (i === 2 ? 0.22 : 0.08)}
                />
              );
            })}

            {/* Die Sehnen liegen UNTER den Faeden und flackern nicht: sie
                halten das Netz zusammen, waehrend darueber gerechnet wird. */}
            {SEHNEN.map((s) => {
              const [x1, y1] = punkt(s.a1, s.r1);
              const [x2, y2] = punkt(s.a2, s.r2);
              return (
                <line
                  key={`${s.a1}-${s.a2}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={licht}
                  strokeWidth="0.35"
                  strokeLinecap="round"
                  opacity={s.o}
                />
              );
            })}

            {/* Die Faeden, in zwei versetzt flackernden Gruppen. Ein einzelnes
                Flackern ueber alles waere ein Wackelkontakt; zwei versetzte
                lesen sich als Rechnen. */}
            {[0, 1].map((gruppe) => (
              <g
                key={gruppe}
                className="fb-spark"
                style={{ animationDelay: `${gruppe * 1.7}s` }}
              >
                {FAEDEN.filter((_, i) => i % 2 === gruppe).map((f) => {
                  const [x1, y1] = punkt(f.a, f.r0);
                  const [x2, y2] = punkt(f.a, f.r1);
                  return (
                    <g key={f.a}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={licht}
                        strokeWidth="0.45"
                        strokeLinecap="round"
                        opacity={f.o}
                      />
                      {/* Nur die langen Faeden bekommen einen Endpunkt --
                          sonst saesse aussen ein gleichmaessiger Perlenkranz,
                          und der laese sich wieder als Zifferblatt. */}
                      {f.r1 > 19 && (
                        <circle cx={x2} cy={y2} r="0.62" fill={licht} opacity={f.o + 0.3} />
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
          </g>

          <circle
            cx={C}
            cy={C}
            r={R}
            fill="none"
            stroke={`url(#${id("rim")})`}
            strokeWidth="0.9"
          />
        </g>

        {/* Der Kern. Bloom zuerst, damit er in die Bahnen hineinleuchtet. */}
        <circle
          className="fb-breathe"
          cx={C}
          cy={C}
          r={kernR * 1.7}
          fill={`url(#${id("glow")})`}
        />
        <circle className="fb-breathe" cx={C} cy={C} r={kernR} fill={`url(#${id("hot")})`} />

        {/* Nur im Zielzustand: ein zweiter, atmender Reif dicht an der Kugel.
            Der eine Moment, den die Figur sich leistet. */}
        {warm && (
          <circle
            className="fb-breathe"
            cx={C}
            cy={C}
            r={R + 3.4}
            fill="none"
            stroke={licht}
            strokeWidth="0.7"
            opacity="0.45"
          />
        )}
      </g>
    </svg>
  );
}
