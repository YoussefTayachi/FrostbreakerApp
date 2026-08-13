"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  OFFER_STAGES,
  REQUIRED_FOR_GENERATION,
  fieldNumber,
  type OfferTextField,
} from "@/lib/offers";
import type { CoachFinding } from "@/lib/copy/coach-prompt";

/**
 * Die Angebotskarte.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM EINE KARTE UND KEIN FORMULAR
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Zwoelf Felder untereinander sehen aus wie zwoelf gleichrangige Fragen. Sie
 * sind aber keine Liste, sondern ein Gefuege: die Friction ist die konkrete
 * Stelle des Problems, der Grund erklaert die Friction, die Pruefzeit gehoert
 * zum Preview, das Preview gehoert zur Frage.
 *
 * Am 2026-08-13 hat genau diese Unsichtbarkeit einen Fehler erzeugt: derselbe
 * Termin stand in drei Feldern, die drei verschiedene Fragen stellen. In einer
 * Liste faellt das nicht auf. In einer Kette schon.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM FEST UND NICHT FREI
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Das Vorbild waere ein Board, auf dem man Knoten anlegt und anordnet. Das
 * waere hier falsch: die Struktur eines Angebots gehoert nicht dem Nutzer,
 * sie steht fest. Deshalb kein Anlegen, kein Verschieben, kein Zoomen -- die
 * Position TRAEGT hier Bedeutung, und wer sie verschieben darf, zerstoert sie.
 *
 * Der Test gegen Zierde: wenn man alle Kanten entfernt und nichts wird
 * schlechter, waren sie Dekoration. Jede Kante hier traegt eine Regel, und die
 * steht als Beschriftung daran, sobald man einen ihrer Knoten beruehrt.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DER EINE MOMENT, DEN SICH DIE FLAECHE LEISTET
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die Kanten zeichnen sich beim Aufbau selbst -- einmal, nicht bei jedem
 * Tastendruck. Und ein Coach-Befund, der zwei Felder betrifft ("dein Beleg
 * steht im Ergebnisfeld"), wird zu einem BERNSTEINFARBENEN PFEIL zwischen
 * beiden Knoten. Das ist die eine Sache, die ein Formular strukturell nicht
 * kann: dort waere es ein Satz, den man erst zuordnen muss.
 */

/** Was ein gemessener Knoten ist -- Koordinaten relativ zur Karte. */
type Box = { x: number; y: number; w: number; h: number };

/**
 * Die Kanten. `regel` ist der Schluessel des Satzes, der an ihr steht.
 *
 * mechanism und tone haben ABSICHTLICH keine Kante: der Mechanismus kommt in
 * Mail 1 nicht vor, und der Ton wirkt auf alles. Die Abwesenheit ist hier die
 * Aussage -- im Formular stand der Mechanismus als Feld 07 mittendrin, als
 * waere er gleichrangig.
 */
export const KANTEN: { von: OfferTextField; nach: OfferTextField; regel: string }[] = [
  { von: "offering", nach: "problem", regel: "world" },
  { von: "icp", nach: "problem", regel: "world" },
  { von: "problem", nach: "friction", regel: "concrete" },
  { von: "friction", nach: "friction_reason", regel: "why" },
  { von: "friction", nach: "outcome", regel: "removed" },
  { von: "proof", nach: "outcome", regel: "backs" },
  { von: "outcome", nach: "cta", regel: "easy" },
  { von: "review_time", nach: "preview_asset", regel: "takes" },
  { von: "preview_asset", nach: "cta", regel: "forThat" },
];

/** Die beiden Knoten, die das Playbook als tragend bezeichnet. Sie stehen
 *  kraeftiger da als die anderen -- und es sind genau die beiden, die am
 *  2026-08-13 schiefgingen. */
const TRAGEND: OfferTextField[] = ["friction", "cta"];

type Texte = {
  stages: Record<string, { label: string; hint: string }>;
  fields: Record<OfferTextField, { label: string; hint: string }>;
  edges: Record<string, string>;
  neededForGeneration: string;
  optional: string;
  coach: {
    verdictLabel: string;
    apply: string;
    dismiss: string;
    related: (feld: string) => string;
  };
};

export default function OfferMap({
  werte,
  fehlend,
  befunde,
  coach,
  onChange,
  onApply,
  onDismiss,
  texte,
}: {
  werte: Record<OfferTextField, string>;
  fehlend: OfferTextField[];
  /** Die messbaren Befunde aus lib/copy/offer-tests.ts, als fertiger Satz. */
  befunde: Partial<Record<OfferTextField, string>>;
  /** Was THAW gefunden hat. */
  coach: CoachFinding[];
  onChange: (feld: OfferTextField, wert: string) => void;
  onApply: (feld: OfferTextField, wert: string) => void;
  onDismiss: (feld: OfferTextField) => void;
  texte: Texte;
}) {
  const [offen, setOffen] = useState<OfferTextField | null>(null);
  const [beruehrt, setBeruehrt] = useState<OfferTextField | null>(null);
  const [boxen, setBoxen] = useState<Partial<Record<OfferTextField, Box>>>({});
  const [flaeche, setFlaeche] = useState({ w: 0, h: 0 });
  /** Die Kanten zeichnen sich EINMAL. Bei jedem Tastendruck neu waere ein
   *  Flackern, und der Moment verliert seine Bedeutung, wenn er sich
   *  wiederholt. */
  const [gezeichnet, setGezeichnet] = useState(false);

  const uid = useId().replace(/:/g, "");
  const karte = useRef<HTMLDivElement>(null);
  const knoten = useRef(new Map<OfferTextField, HTMLElement>());

  /**
   * Alle Knoten nachmessen.
   *
   * Die Kanten kommen aus den TATSAECHLICHEN Rechtecken, nicht aus geratenen
   * Koordinaten: ein Knoten waechst beim Aufklappen, und eine Kante, die dann
   * ins Leere zeigt, ist schlimmer als keine.
   */
  const messen = useCallback(() => {
    const c = karte.current;
    if (!c) return;
    const cr = c.getBoundingClientRect();
    const next: Partial<Record<OfferTextField, Box>> = {};
    for (const [feld, el] of knoten.current) {
      const r = el.getBoundingClientRect();
      next[feld] = { x: r.x - cr.x, y: r.y - cr.y, w: r.width, h: r.height };
    }
    setBoxen(next);
    setFlaeche({ w: cr.width, h: c.scrollHeight });
  }, []);

  useLayoutEffect(() => {
    messen();
  }, [messen, offen, werte, coach]);

  useEffect(() => {
    const c = karte.current;
    if (!c) return;
    const ro = new ResizeObserver(messen);
    ro.observe(c);
    for (const el of knoten.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [messen]);

  useEffect(() => {
    const id = setTimeout(() => setGezeichnet(true), 1600);
    return () => clearTimeout(id);
  }, []);

  const coachZu = (f: OfferTextField) => coach.find((c) => c.field === f);

  return (
    <div ref={karte} className="fb-map relative">
      {/* ── Die Kanten ─────────────────────────────────────────────────
          Ueber den Knoten, aber ohne Mauszeiger: sie sollen die Karte
          zusammenhalten, nicht anklickbar sein. */}
      {/* UEBER den Knoten, nicht darunter.
          Am Standbild geprueft: die Beschriftungen sassen in der 36 Pixel
          breiten Spaltenluecke und wurden von den Knoten verdeckt -- lesbar
          blieb "ILT FUE" und "AELLT WE". Die Linien selbst laufen von Kante zu
          Kante und kreuzen keinen Knoten, oben liegen schadet ihnen also
          nicht. Die Schrift bekommt zusaetzlich einen Rand in Flaechenfarbe
          (paint-order), damit sie auch ueber einem Knotenrahmen lesbar ist. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 z-30"
        width={flaeche.w}
        height={flaeche.h}
      >
        <defs>
          <marker
            id={`pfeil-${uid}`}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L8 4 L0 8 z" fill="var(--fb-warn)" />
          </marker>
        </defs>

        {KANTEN.map((k, i) => {
          const a = boxen[k.von];
          const b = boxen[k.nach];
          if (!a || !b) return null;
          const aktiv = beruehrt === k.von || beruehrt === k.nach || offen === k.von || offen === k.nach;
          const d = pfad(a, b);
          return (
            <g key={`${k.von}-${k.nach}`}>
              <path
                d={d}
                fill="none"
                stroke="var(--fb-frost)"
                strokeWidth={aktiv ? 1.6 : 1}
                strokeLinecap="round"
                opacity={aktiv ? 0.75 : 0.28}
                pathLength={1}
                className={gezeichnet ? "fb-edge-ruhig" : "fb-edge"}
                style={{ animationDelay: `${420 + i * 70}ms` }}
              />
              {/* Die Regel steht erst da, wenn man einen ihrer Knoten
                  beruehrt. Neun Beschriftungen gleichzeitig waeren Rauschen;
                  eine auf Anfrage ist eine Erklaerung. */}
              {aktiv && (
                <text
                  {...mitte(a, b)}
                  textAnchor="middle"
                  className="fb-edge-label"
                  fill="var(--fb-frost)"
                >
                  {texte.edges[k.regel]}
                </text>
              )}
            </g>
          );
        })}

        {/* Der Befund, der zwei Knoten betrifft. Das ist der Grund, warum
            diese Flaeche eine Karte ist und kein Formular. */}
        {coach
          .filter((c) => c.relatedField)
          .map((c) => {
            const a = boxen[c.field];
            const b = boxen[c.relatedField!];
            if (!a || !b) return null;
            return (
              <path
                key={`coach-${c.field}`}
                // Um 22 Pixel versetzt: zwischen Ergebnis und Beleg laeuft
                // schon die Struktur-Kante "belegt". Zwei Linien auf derselben
                // Achse mit verschiedener Bedeutung sind unlesbar.
                d={pfad(a, b, 22)}
                fill="none"
                stroke="var(--fb-warn)"
                strokeWidth="1.8"
                strokeDasharray="5 4"
                strokeLinecap="round"
                markerEnd={`url(#pfeil-${uid})`}
                className="fb-edge-warn"
              />
            );
          })}
      </svg>

      {/* ── Die Knoten ──────────────────────────────────────────────── */}
      <div className="relative grid grid-cols-4 gap-x-9 gap-y-4">
        {OFFER_STAGES.map((stufe, si) => (
          <div key={stufe.id} className="flex min-w-0 flex-col gap-3">
            <div className="fb-fade" style={{ animationDelay: `${si * 90}ms` }}>
              <p className="fb-label text-mute">{texte.stages[stufe.id].label}</p>
              <p className="mt-1 text-[11.5px] leading-snug text-faint">{texte.stages[stufe.id].hint}</p>
            </div>

            {(stufe.fields as readonly OfferTextField[]).map((feld, fi) => {
              const wert = werte[feld].trim();
              const pflicht = REQUIRED_FOR_GENERATION.includes(feld);
              const offenHier = offen === feld;
              const c = coachZu(feld);
              const messbar = befunde[feld];
              const zustand = c
                ? c.severity === "blocker"
                  ? "blocker"
                  : "warn"
                : messbar
                  ? "warn"
                  : wert
                    ? "voll"
                    : pflicht
                      ? "offen"
                      : "leer";
              return (
                <div
                  key={feld}
                  ref={(el) => {
                    if (el) knoten.current.set(feld, el);
                    else knoten.current.delete(feld);
                  }}
                  onMouseEnter={() => setBeruehrt(feld)}
                  onMouseLeave={() => setBeruehrt(null)}
                  className={
                    "fb-node fb-fade relative z-20 rounded-xl border bg-panel transition-shadow " +
                    (offenHier ? "shadow-lg" : "") +
                    (TRAGEND.includes(feld) ? " fb-node-tragend" : "")
                  }
                  data-zustand={zustand}
                  style={{ animationDelay: `${180 + si * 90 + fi * 60}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => setOffen(offenHier ? null : feld)}
                    aria-expanded={offenHier}
                    className="w-full px-3.5 py-3 text-left"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="fb-num shrink-0 text-[10px] text-mute">
                        {String(fieldNumber(feld)).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-ink">
                        {texte.fields[feld].label}
                      </span>
                      {!wert && pflicht && (
                        <span className="fb-dot shrink-0" aria-label={texte.neededForGeneration} />
                      )}
                    </span>
                    <span
                      className={
                        "mt-1.5 block text-[12.5px] leading-[1.45] " +
                        (wert
                          ? "text-soft [display:-webkit-box] [overflow:hidden] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
                          : "text-mute")
                      }
                    >
                      {wert || (pflicht ? texte.neededForGeneration : texte.optional)}
                    </span>
                  </button>

                  {offenHier && (
                    <div className="fb-open border-t border-edge/60 px-3.5 pb-3.5 pt-3">
                      <p className="mb-2 text-[12.5px] leading-relaxed text-faint">
                        {texte.fields[feld].hint}
                      </p>
                      <textarea
                        id={`feld-${feld}`}
                        autoFocus
                        value={werte[feld]}
                        onChange={(e) => onChange(feld, e.target.value)}
                        rows={4}
                        className="w-full resize-y rounded-lg border border-edge2 bg-field px-3 py-2.5 text-[14px] leading-[1.6] text-ink outline-none transition-colors focus:border-sky-500"
                      />

                      {messbar && (
                        <p className="fb-open mt-2 rounded-lg border-l-2 border-amber-500/50 bg-amber-500/5 px-3 py-1.5 text-[12.5px] leading-relaxed text-soft">
                          {messbar}
                        </p>
                      )}

                      {c && (
                        <div
                          className="fb-open mt-2 rounded-lg border-l-2 px-3 py-2.5"
                          style={{
                            borderColor: "var(--fb-warn)",
                            background: "color-mix(in srgb, var(--fb-warn) 7%, transparent)",
                          }}
                        >
                          <p className="fb-label mb-1" style={{ color: "var(--fb-warn)" }}>
                            {texte.coach.verdictLabel}
                          </p>
                          <p className="text-[12.5px] leading-relaxed text-soft">{c.verdict}</p>
                          {c.relatedField && (
                            <p className="mt-1 text-[12px] text-faint">
                              {texte.coach.related(texte.fields[c.relatedField].label)}
                            </p>
                          )}
                          <p className="mt-2 rounded-md bg-panel px-2.5 py-2 text-[13px] leading-relaxed text-ink">
                            {c.proposal}
                          </p>
                          <div className="mt-2 flex gap-3 text-xs">
                            <button
                              onClick={() => onApply(feld, c.proposal)}
                              className="font-medium transition-opacity hover:opacity-75"
                              style={{ color: "var(--fb-warn)" }}
                            >
                              {texte.coach.apply}
                            </button>
                            <button onClick={() => onDismiss(feld)} className="text-faint hover:text-ink">
                              {texte.coach.dismiss}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Der Weg von Knoten A zu Knoten B.
 *
 * Zwei Faelle, und die Unterscheidung ist die Spalte, nicht die Richtung:
 * innerhalb einer Spalte eine gerade Linie von Kante zu Kante, ueber Spalten
 * hinweg eine Bezierkurve, die waagerecht aus dem einen heraus und in den
 * anderen hineinlaeuft. Eine Kurve, die schraeg an einer Ecke ansetzt, sieht
 * aus wie ein Zeichenfehler.
 */
function pfad(a: Box, b: Box, versatz = 0): string {
  const gleicheSpalte = Math.abs(a.x - b.x) < 4;
  if (gleicheSpalte) {
    const x = a.x + a.w / 2 + versatz;
    const [y1, y2] = a.y < b.y ? [a.y + a.h, b.y] : [a.y, b.y + b.h];
    return `M ${x} ${y1} L ${x} ${y2}`;
  }
  const linksNachRechts = a.x < b.x;
  const x1 = linksNachRechts ? a.x + a.w : a.x;
  const x2 = linksNachRechts ? b.x : b.x + b.w;
  const y1 = a.y + a.h / 2;
  const y2 = b.y + b.h / 2;
  const dx = Math.max(20, Math.abs(x2 - x1) / 2);
  const s = linksNachRechts ? 1 : -1;
  return `M ${x1} ${y1} C ${x1 + dx * s} ${y1}, ${x2 - dx * s} ${y2}, ${x2} ${y2}`;
}

/** Wo die Beschriftung einer Kante steht. */
function mitte(a: Box, b: Box): { x: number; y: number } {
  const gleicheSpalte = Math.abs(a.x - b.x) < 4;
  if (gleicheSpalte) {
    const [y1, y2] = a.y < b.y ? [a.y + a.h, b.y] : [a.y, b.y + b.h];
    return { x: a.x + a.w / 2 + 46, y: (y1 + y2) / 2 + 3 };
  }
  return { x: (a.x + a.w + b.x) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 - 6 };
}
