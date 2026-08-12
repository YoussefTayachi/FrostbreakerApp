"use client";
import { useId } from "react";

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
 * Der Name stand schon im Code, bevor es die Figur gab: das Workspace-Cookie
 * heisst thaw_ws. Frostbreaker ist das Werkzeug, THAW ist das, was es tut.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM SVG UND NICHT DAS ERZEUGTE BILD
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die Vorlage fuer dieses Aussehen ist ein 3D-Render aus Higgsfield
 * (2026-08-12). Uebernommen wurden Aufbau und Lichtfuehrung, nicht die Datei:
 * ein PNG braeuchte zwei Fassungen fuer hell und dunkel, waere bei jeder
 * Groesse unscharf, koennte nicht blinzeln und wuerde die Zustaende Frost
 * gegen Mint nicht mitmachen. Hier traegt dieselbe Zeichnung alles.
 *
 * Der Koerper ist kein Fell mehr, sondern eine Projektion: durchscheinend,
 * mit einer harten Lichtkante oben, einem Halo drumherum, wandernden
 * Scanlinien und einem Lichtfleck am Boden. Im Hellen liest sich das als
 * mattes Eisglas, im Dunklen als etwas, das von innen leuchtet.
 *
 * Kein Stirnzeichen mehr. Der Kristall sass mittig ueber den Augen und wurde
 * dort als Schmuckpunkt gelesen -- eine Bedeutung, die niemand gemeint hat.
 * Die Verbindung zum Ring drumherum tragen jetzt Farbe und Licht.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WAS ER TUT UND WAS NICHT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Er schwebt (sechs Sekunden je Zug), blinzelt alle sieben Sekunden, und der
 * Lichtfleck unter ihm atmet gegenlaeufig mit. Beim Arbeiten wandert der
 * Blick, beim Fertigsein schlaegt alles von Frost auf Mint um. Mehr nicht --
 * kein Winken, kein Huepfen, keine Sprechblase. Eine Figur, die staendig
 * zappelt, ist beim dritten Oeffnen der Seite nur noch im Weg.
 *
 * prefers-reduced-motion schaltet saemtliche Bewegung ab; die Zeichnung
 * bleibt vollstaendig.
 */

export type ThawState =
  /** Nichts oder fast nichts bekannt -- Augen zu. */
  | "cold"
  /** Es fehlt noch etwas Notwendiges -- er hoert zu. */
  | "listening"
  /** Alles Notwendige da -- Mint, Mundwinkel oben. */
  | "ready"
  /** Schreibt gerade -- der Blick wandert. */
  | "working";

/** Silhouette aus Kopf und Ohren. Einmal beschrieben, dreimal gebraucht:
 *  fuer den Halo, fuer den Koerper und als Maske der Scanlinien. */
function Silhouette({ fill, stroke }: { fill: string; stroke?: string }) {
  return (
    <>
      {/* Ohren klein und HOCH: im ersten Entwurf sassen sie auf halber
          Kopfhoehe und ueberlappten ihn zu drei fast gleich grossen Kreisen --
          am gerenderten Bild geprueft, es sah aus wie eine bekannte Maus.
          Ein Baerenohr guckt oben heraus und ist deutlich kleiner als der
          Kopf. */}
      <ellipse cx="15.5" cy="14.5" rx="7" ry="7" fill={fill} stroke={stroke} strokeWidth={stroke ? 1 : 0} />
      <ellipse cx="48.5" cy="14.5" rx="7" ry="7" fill={fill} stroke={stroke} strokeWidth={stroke ? 1 : 0} />
      {/* Oben schmaler, unten breit -- daran erkennt man einen Baeren und
          keine Katze. */}
      <path
        d="M32 17 c12.4 0 21 8.6 22.2 19.4 c1.2 10.8 -9.3 17.9 -22.2 17.9 c-12.9 0 -23.4 -7.1 -22.2 -17.9 c1.2 -10.8 9.8 -19.4 22.2 -19.4 z"
        fill={fill}
        stroke={stroke}
        strokeWidth={stroke ? 1 : 0}
      />
    </>
  );
}

export default function Thaw({
  state,
  size = 64,
  className = "",
}: {
  state: ThawState;
  size?: number;
  className?: string;
}) {
  // Eigene IDs je Instanz: der Baer steht auf der Angebotsseite und im
  // Kampagnengenerator, und zwei gleiche Verlaufs-IDs im selben Dokument
  // lassen die zweite Figur die Fuellung der ersten erben.
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${name}-${uid}`;

  const warm = state === "ready";
  const kalt = state === "cold";
  const licht = warm ? "var(--fb-ready)" : "var(--fb-frost)";
  const augeR = kalt ? 0 : warm ? 4.4 : 3.9;

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
        {/* Volumen: Licht von oben links, Schattenseite unten rechts. */}
        <radialGradient id={id("body")} cx="36%" cy="24%" r="78%">
          {/* Drei eigene Deckkraft-Variablen statt calc(): calc() in
              stop-opacity ist nicht in jedem Browser verlaesslich, und ein
              Ausfall waere hier ein unsichtbarer Baer. */}
          <stop offset="0%" stopColor="var(--fb-holo-hi)" stopOpacity="var(--fb-holo-a1)" />
          <stop offset="52%" stopColor="var(--fb-holo-mid)" stopOpacity="var(--fb-holo-a2)" />
          <stop offset="100%" stopColor="var(--fb-holo-lo)" stopOpacity="var(--fb-holo-a3)" />
        </radialGradient>

        {/* Die Schnauze sitzt vor dem Kopf, also faengt sie mehr Licht. */}
        <radialGradient id={id("muzzle")} cx="40%" cy="26%" r="80%">
          <stop offset="0%" stopColor="var(--fb-holo-hi)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--fb-holo-mid)" stopOpacity="0.5" />
        </radialGradient>

        {/* Die Lichtkante. Oben hart, nach unten auslaufend -- eine Kante, die
            rundherum gleich hell ist, sieht aus wie ein Aufkleber. */}
        <linearGradient id={id("rim")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={licht} stopOpacity="0.95" />
          <stop offset="45%" stopColor={licht} stopOpacity="0.4" />
          <stop offset="100%" stopColor={licht} stopOpacity="0.08" />
        </linearGradient>

        <radialGradient id={id("glow")}>
          <stop offset="0%" stopColor={licht} stopOpacity="0.55" />
          <stop offset="100%" stopColor={licht} stopOpacity="0" />
        </radialGradient>

        <filter id={id("blur")} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
        <filter id={id("blurSoft")} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>

        <pattern id={id("scan")} width="4" height="3" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill={licht} opacity="var(--fb-scan-a)" />
        </pattern>

        <clipPath id={id("clip")}>
          <Silhouette fill="#000" />
        </clipPath>
      </defs>

      {/* Lichtfleck am Boden. Er macht aus "steht" ein "schwebt". */}
      <ellipse
        className="fb-shadow"
        cx="32"
        cy="60"
        rx="17"
        ry="3.2"
        fill={`url(#${id("glow")})`}
        filter={`url(#${id("blurSoft")})`}
      />

      <g className="fb-float">
        {/* Halo. Eine unscharfe Kopie der Silhouette -- billiger und
            gleichmaessiger als ein Schlagschatten je Form. */}
        <g filter={`url(#${id("blur")})`} opacity="var(--fb-holo-halo-a)">
          <Silhouette fill={licht} />
        </g>

        {/* Der Koerper. */}
        <Silhouette fill={`url(#${id("body")})`} />

        {/* Scanlinien, auf die Silhouette beschnitten und langsam wandernd. */}
        <g clipPath={`url(#${id("clip")})`}>
          <rect className="fb-scanlines" x="0" y="-6" width="64" height="76" fill={`url(#${id("scan")})`} />
        </g>

        {/* Lichtkante, in derselben Silhouette nur als Kontur. */}
        <g opacity="0.9">
          <Silhouette fill="none" stroke={`url(#${id("rim")})`} />
        </g>

        {/* Ohrinneres: ein Ring, kein gefuellter Kreis -- so bleibt es
            durchscheinend wie der Rest. */}
        {[15.5, 48.5].map((cx) => (
          <ellipse
            key={cx}
            cx={cx}
            cy={14.8}
            rx="3.3"
            ry="3.3"
            fill="none"
            stroke={licht}
            strokeWidth="1.1"
            opacity="0.5"
          />
        ))}

        <ellipse cx="32" cy="44" rx="10.2" ry="7.6" fill={`url(#${id("muzzle")})`} />

        {/* Augen. Geschlossen, solange er nichts weiss -- kleinere Augen allein
            liessen sich nicht von "hoert zu" unterscheiden (am gerenderten
            Bild geprueft). */}
        <g className={state === "working" ? "fb-look" : kalt ? "" : "fb-blink"}>
          {[24, 40].map((cx) =>
            kalt ? (
              <path
                key={cx}
                d={`M${cx - 4.2} 32.4 q4.2 3.6 8.4 0`}
                fill="none"
                stroke={licht}
                strokeWidth="1.7"
                strokeLinecap="round"
                opacity="0.75"
              />
            ) : (
              <g key={cx}>
                <circle cx={cx} cy={32.4} r={augeR + 1.6} fill={licht} opacity="0.22" />
                <circle cx={cx} cy={32.4} r={augeR} fill={licht} />
                {/* Zwei Glanzpunkte: einer gross oben links, einer klein unten
                    rechts. Das ist der Unterschied zwischen einer Scheibe und
                    einer Kugel. */}
                <circle cx={cx - 1.3} cy={31.1} r={augeR * 0.36} fill="#fff" opacity="0.95" />
                <circle cx={cx + 1.4} cy={33.8} r={augeR * 0.17} fill="#fff" opacity="0.5" />
              </g>
            )
          )}
        </g>

        <ellipse cx="32" cy="41" rx="3.4" ry="2.5" fill={licht} opacity="0.9" />
        <path
          d={
            warm
              ? "M32 43.5 v2.2 M32 45.7 q-4.6 4.1 -8.6 0.4 M32 45.7 q4.6 4.1 8.6 0.4"
              : "M32 43.5 v2.2 M32 45.7 q-4.1 2.7 -7.8 0.5 M32 45.7 q4.1 2.7 7.8 0.5"
          }
          fill="none"
          stroke={licht}
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity={kalt ? 0.55 : 0.85}
        />
      </g>
    </svg>
  );
}
