"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { REQUIRED_FOR_GENERATION, fieldNumber, type OfferStageId, type OfferTextField } from "@/lib/offers";
import type { CoachFinding } from "@/lib/copy/coach-prompt";
import Herkunft from "./herkunft";

/**
 * Die Angebotskarte.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM EINE KARTE UND KEIN FORMULAR
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Zwoelf Felder untereinander sehen aus wie zwoelf gleichrangige Fragen. Sie
 * sind aber ein Gefuege: die Friction ist die konkrete Stelle des Problems,
 * der Grund erklaert die Friction, die Pruefzeit gehoert zum Preview, das
 * Preview zur Frage. Am 2026-08-13 hat genau diese Unsichtbarkeit einen Fehler
 * erzeugt -- derselbe Termin stand in drei Feldern, die drei verschiedene
 * Fragen stellen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM VIER FELDER IM KREIS UND NICHT VIER SPALTEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die erste Fassung waren vier Spalten nebeneinander. Am Live-Bild geprueft
 * und sofort verworfen: neben der 340 Pixel breiten Statusspalte blieben je
 * Spalte rund 250 Pixel, und darin brach "What does the customer struggle
 * with beforehand?" auf vier Zeilen um. Aus einer Erleichterung wurde eine
 * Zumutung -- schmaler als das Formular, das sie ersetzen sollte.
 *
 * Jetzt: vier Felder in den Ecken, THAW in der Mitte, und die Statusspalte
 * ist weg. Damit ist jeder Knoten rund 470 statt 250 Pixel breit -- die Frage
 * steht auf einer Zeile, die Antwort auf zweien.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WOHER DIE BREITE KOMMT -- UND WOHIN SIE GEHT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Am 2026-08-13 gemeldet: "es gibt rechts und links noch genug platz --
 * breite es aus." Am Live-Stand nachgemessen, 1920er Fenster: die Karte war
 * 1024 Pixel breit und lag linksbuendig in einem 1216 Pixel breiten `main`.
 * Links blieben 224 Pixel leer, rechts 416 -- und die Fragen brachen trotzdem
 * um. Zwei Deckel lagen uebereinander: max-w-5xl auf der Seite (weg, siehe
 * page.tsx) und max-w-7xl auf `main` (fuer diese Seite gehoben, siehe
 * .fb-weit in globals.css). Die Karte selbst war nie das Problem.
 *
 * Der gewonnene Platz geht vollstaendig in die KNOTEN, nicht in die Luecke
 * dazwischen: gap-x bleibt bei 19rem, weil dort THAW steht (17rem) und sonst
 * nichts. Das ist auch der Grund, warum die Bezierkurven zwischen den Spalten
 * unveraendert aussehen -- ihr Kontrollpunkt-Abstand (dx in `pfad`) haengt an
 * genau dieser Luecke, nicht an der Knotenbreite. Wer die Luecke doch einmal
 * vergroessert, muss dx deckeln: sehr flache, lange S-Kurven liest man als
 * Zeichenfehler.
 *
 * Nachgemessen nach der Aenderung (1920er Fenster): Karte 1344, Knoten 472
 * statt 336, alle zwoelf Fragen auf einer Zeile, gleicher Rand links wie
 * rechts. Erst unterhalb von rund 1600 Pixeln Fensterbreite ist wieder das
 * FENSTER die Grenze und nicht mehr eine Regel im Stylesheet.
 *
 * Die Reihenfolge laeuft IM UHRZEIGERSINN: oben links, oben rechts, unten
 * rechts, unten links. Das ist kein Geschmack, sondern der Grund, warum es
 * ueberhaupt lesbar ist -- so liegt jede Gruppe neben der, aus der sie folgt,
 * und keine einzige Kante muss quer durch die Mitte.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DER TEST GEGEN ZIERDE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Wenn man alle Kanten entfernt und nichts wird schlechter, waren sie
 * Dekoration. Jede Kante hier traegt eine Regel, und die steht als
 * Beschriftung daran, sobald man einen ihrer Knoten beruehrt.
 *
 * Und der eine Moment: ein Coach-Befund, der zwei Felder betrifft ("dein
 * Beleg steht im Ergebnisfeld"), wird zu einem bernsteinfarbenen Pfeil
 * zwischen beiden Knoten. Das kann ein Formular strukturell nicht.
 */

/** Was ein gemessener Knoten ist -- Koordinaten relativ zur Karte. */
type Box = { x: number; y: number; w: number; h: number };

/** Bis zu welchem senkrechten Abstand zwei Knoten als "direkt untereinander"
 *  gelten. Darueber liegt mindestens ein dritter dazwischen, und dann muss die
 *  Kante aussen herum. */
const NACHBAR_ABSTAND = 44;

/**
 * Wie weit die Umleitung neben der Knotenkante laeuft.
 *
 * In der seitlichen Fahrbahn (px-12 = 48 Pixel) liegen DREI Dinge nebeneinander,
 * und alle drei muessen hineinpassen:
 *   18  die Umleitung selbst (dieser Wert)
 *   44  der Befund-Pfeil, der um VERSATZ_COACH weiter aussen laeuft
 *   48  die Beschriftung, die auf der Umleitung sitzt und nach beiden Seiten
 *       je rund 30 Pixel breit ist (laengster Wert: "fällt weg")
 *
 * Am Live-Bauteil durchgemessen (2026-08-13, ueber jeden Knoten gefahren,
 * damit alle acht Beschriftungen wirklich gezeichnet werden): bei den vorher
 * eingestellten 24 Pixeln ragten "goes away" um 22, "backs it" um 19 und
 * "for that" um 19 Pixel aus der Zeichenflaeche und wurden abgeschnitten --
 * dazu fehlte dem Befund-Pfeil sein aeusseres Stueck. Bei 40 Pixeln blieb es
 * dabei, bei 48 war nichts mehr abgeschnitten. Wird die Fahrbahn wieder
 * schmaler, kommt das Abschneiden zurueck.
 */
const AUSSEN = 18;

/** Wie weit der Befund-Pfeil NEBEN der Umleitung laeuft. Zwischen Ergebnis und
 *  Beleg liegt schon die Struktur-Kante; zwei Linien mit verschiedener
 *  Bedeutung auf derselben Achse sind unlesbar. */
const VERSATZ_COACH = 26;

/**
 * Die vier Ecken, im Uhrzeigersinn ab oben links.
 *
 * Die Reihenfolge im Array IST die Reihenfolge im Raster (zeilenweise), also
 * oben-links, oben-rechts, unten-links, unten-rechts. Damit "unten rechts"
 * die dritte Station wird, steht `value` an dritter Stelle im Uhrzeigersinn,
 * aber an vierter im Raster -- deshalb die getrennte `nummer`.
 */
const ECKEN: { id: OfferStageId; nummer: number; felder: OfferTextField[] }[] = [
  { id: "who", nummer: 1, felder: ["offering", "icp", "tone"] },
  { id: "hook", nummer: 2, felder: ["problem", "friction", "friction_reason"] },
  { id: "ask", nummer: 4, felder: ["preview_asset", "review_time", "cta"] },
  { id: "value", nummer: 3, felder: ["outcome", "mechanism", "proof"] },
];

/**
 * Die Kanten. Jede verbindet nur BENACHBARTE Ecken -- keine laeuft quer durch
 * die Mitte, wo THAW steht.
 *
 * mechanism und tone haben absichtlich keine: der Mechanismus kommt in Mail 1
 * nicht vor, der Ton wirkt auf alles. Die Abwesenheit ist die Aussage.
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

/** Die beiden Knoten, die das Playbook als tragend bezeichnet -- und genau
 *  die beiden, die am 2026-08-13 schiefgingen. */
const TRAGEND: OfferTextField[] = ["friction", "cta"];

type Texte = {
  stages: Record<string, { label: string; hint: string }>;
  fields: Record<OfferTextField, { label: string; hint: string }>;
  edges: Record<string, string>;
  neededForGeneration: string;
  optional: string;
  /**
   * Der Vorschlagskasten. `label` und `farbe` haengen an der HERKUNFT: Website
   * (Frost) oder Lead-Liste (--fb-aim, dann mit dem Namen der Liste). Beides
   * kommt fertig von aussen, damit in der Karte und in der Abschnittsansicht
   * garantiert dasselbe steht -- zweimal derselbe Vorschlag mit zwei
   * verschiedenen Herkuenften waere schlimmer als gar keine Angabe.
   */
  suggestion: { label: string; farbe: string; apply: string; discard: string };
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
  vorschlaege,
  onChange,
  onApply,
  onDismiss,
  onApplySuggestion,
  onDiscardSuggestion,
  texte,
  hub,
}: {
  werte: Record<OfferTextField, string>;
  fehlend: OfferTextField[];
  /** Die messbaren Befunde aus lib/copy/offer-tests.ts, als fertiger Satz. */
  befunde: Partial<Record<OfferTextField, string>>;
  coach: CoachFinding[];
  /**
   * Die Feldvorschlaege aus Website oder Lead-Liste.
   *
   * Derselbe Zustand wie in der Abschnittsansicht -- die Karte zeigt ihn nur
   * an einer anderen Stelle. Ohne diesen Weg waeren Vorschlaege ab 1500 Pixel
   * Fensterbreite unsichtbar: dort steht die Karte statt der Abschnitte, und
   * der Aufruf haette Geld gekostet, ohne dass etwas erscheint.
   */
  vorschlaege: Partial<Record<OfferTextField, string>>;
  onChange: (feld: OfferTextField, wert: string) => void;
  onApply: (feld: OfferTextField, wert: string) => void;
  onDismiss: (feld: OfferTextField) => void;
  onApplySuggestion: (feld: OfferTextField) => void;
  onDiscardSuggestion: (feld: OfferTextField) => void;
  texte: Texte;
  /** Was in der Mitte steht: THAW, der Messwert und die zwei Knoepfe. */
  hub: React.ReactNode;
}) {
  const [offen, setOffen] = useState<OfferTextField | null>(null);
  const [beruehrt, setBeruehrt] = useState<OfferTextField | null>(null);
  const [boxen, setBoxen] = useState<Partial<Record<OfferTextField, Box>>>({});
  const [flaeche, setFlaeche] = useState({ w: 0, h: 0 });
  /** Die Kanten zeichnen sich EINMAL. Bei jedem Tastendruck neu waere ein
   *  Flackern, und ein Moment, der sich wiederholt, ist keiner mehr. */
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
  }, [messen, offen, werte, coach, vorschlaege]);

  useEffect(() => {
    const c = karte.current;
    if (!c) return;
    const ro = new ResizeObserver(messen);
    ro.observe(c);
    for (const el of knoten.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [messen]);

  useEffect(() => {
    const id = setTimeout(() => setGezeichnet(true), 1700);
    return () => clearTimeout(id);
  }, []);

  const coachZu = (f: OfferTextField) => coach.find((c) => c.field === f);

  return (
    // Der seitliche Rand ist kein Abstand, sondern die Fahrbahn: die aussen
    // herum gefuehrten Kanten, ihre Beschriftungen und der Befund-Pfeil laufen
    // darin. Ist sie zu schmal, enden sie ausserhalb der Zeichenflaeche und
    // werden abgeschnitten -- am Standbild gesehen. Warum ausgerechnet 48
    // Pixel, steht bei AUSSEN.
    <div ref={karte} className="relative px-12">
      {/* ── Die Kanten ─────────────────────────────────────────────────
          UEBER den Knoten, nicht darunter: die Beschriftungen sassen sonst in
          der Spaltenluecke und wurden verdeckt. Die Linien selbst laufen von
          Kante zu Kante und kreuzen keinen Knoten. */}
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
          return (
            <g key={`${k.von}-${k.nach}`}>
              <path
                d={pfad(a, b, flaeche.w)}
                fill="none"
                stroke="var(--fb-frost)"
                strokeWidth={aktiv ? 1.8 : 1.1}
                strokeLinecap="round"
                opacity={aktiv ? 0.8 : 0.3}
                pathLength={1}
                className={gezeichnet ? "fb-edge-ruhig" : "fb-edge"}
                style={{ animationDelay: `${460 + i * 70}ms` }}
              />
              {aktiv && (
                <text
                  {...mitte(a, b, flaeche.w)}
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

        {coach
          .filter((c) => c.relatedField)
          .map((c) => {
            const a = boxen[c.field];
            const b = boxen[c.relatedField!];
            if (!a || !b) return null;
            // Versetzt neben der Struktur-Kante -- warum, steht bei
            // VERSATZ_COACH.
            return (
              <path
                key={`coach-${c.field}`}
                d={pfad(a, b, flaeche.w, VERSATZ_COACH)}
                fill="none"
                stroke="var(--fb-warn)"
                strokeWidth="2"
                strokeDasharray="5 4"
                strokeLinecap="round"
                markerEnd={`url(#pfeil-${uid})`}
                className="fb-edge-warn"
              />
            );
          })}
      </svg>

      {/* ── Die vier Ecken ───────────────────────────────────────────
          Die Luecke in der Mitte ist kein Abstand, sondern der Platz, in dem
          THAW steht: 19rem sind seine 17rem plus je 1rem Luft. Sie ist deshalb
          ein FESTER Wert und waechst nicht mit der Karte mit -- jeder
          zusaetzliche Pixel gehoert den Knoten. */}
      <div className="grid grid-cols-2 gap-x-[19rem] gap-y-12">
        {ECKEN.map((ecke, ei) => (
          <div key={ecke.id} className="flex min-w-0 flex-col gap-2.5">
            <div className="fb-fade flex items-baseline gap-2" style={{ animationDelay: `${ei * 80}ms` }}>
              <span
                className="fb-num flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                style={{
                  background: "color-mix(in srgb, var(--fb-frost) 12%, transparent)",
                  color: "var(--fb-frost)",
                }}
              >
                {ecke.nummer}
              </span>
              <p className="fb-label text-mute">{texte.stages[ecke.id].label}</p>
            </div>

            {ecke.felder.map((feld, fi) => {
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
                  style={{ animationDelay: `${200 + ei * 80 + fi * 55}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => setOffen(offenHier ? null : feld)}
                    aria-expanded={offenHier}
                    className="flex w-full items-start gap-2.5 px-4 py-3 text-left"
                  >
                    <span className="fb-num mt-0.5 shrink-0 text-[10px] text-mute">
                      {String(fieldNumber(feld)).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium leading-snug text-ink">
                        {texte.fields[feld].label}
                      </span>
                      {/* KEIN "block" davor: Tailwinds display:block gewinnt je
                          nach Reihenfolge im Stylesheet gegen -webkit-box, und
                          dann greift die Zeilenbegrenzung nicht. Am Live-Bild
                          gesehen -- ein Knoten war zehn Zeilen hoch. */}
                      <span
                        className={
                          "fb-clamp mt-1 text-[12.5px] leading-[1.45] " + (wert ? "text-soft" : "text-mute")
                        }
                      >
                        {wert || (pflicht ? texte.neededForGeneration : texte.optional)}
                      </span>
                    </span>
                    {/* Ein Punkt in der Farbe der Herkunft: der zugeklappte
                        Knoten muss verraten, dass unter ihm ein Vorschlag
                        wartet. Ohne ihn haette der Nutzer sechs Vorschlaege
                        und muesste zwoelf Knoten aufklappen, um sie zu
                        finden.

                        Der Punkt allein sagt einem Screenreader nichts --
                        daneben steht die Herkunft als Text, den nur er liest.
                        Sichtbar waere sie hier zu viel: der Knoten ist 440
                        Pixel breit und traegt schon Beschriftung und
                        Vorschau. */}
                    {vorschlaege[feld] && !offenHier && (
                      <>
                        <span
                          aria-hidden
                          className="mt-2 h-2 w-2 shrink-0 rounded-full"
                          style={{ background: texte.suggestion.farbe }}
                        />
                        <span className="sr-only">{texte.suggestion.label}</span>
                      </>
                    )}
                    {!wert && pflicht && <span className="fb-dot mt-1.5 shrink-0" aria-hidden />}
                    <span
                      aria-hidden
                      className="mt-0.5 shrink-0 text-mute transition-transform duration-200"
                      style={{ transform: offenHier ? "rotate(90deg)" : "none" }}
                    >
                      ›
                    </span>
                  </button>

                  {offenHier && (
                    <div className="fb-open border-t border-edge/60 px-4 pb-4 pt-3">
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

                      {/* Derselbe Kasten wie in der Abschnittsansicht --
                          uebernehmen oder verwerfen, einzeln. Nichts wird
                          automatisch eingetragen: ein falsch gelesenes Feld
                          steht danach unsichtbar in jeder erzeugten Mail.

                          Der Vorschlag steht so gross wie das Textfeld darueber
                          (14 Pixel, eine Stufe unter der Abschnittsansicht wie
                          alles auf der Karte): man waehlt zwischen zwei
                          Fassungen desselben Satzes und muss beide gleich gut
                          lesen koennen. */}
                      {vorschlaege[feld] && (
                        <div
                          className="fb-open mt-2 rounded-lg border-l-2 px-3.5 py-3"
                          style={{
                            borderColor: texte.suggestion.farbe,
                            background: `color-mix(in srgb, ${texte.suggestion.farbe} 7%, transparent)`,
                          }}
                        >
                          <Herkunft farbe={texte.suggestion.farbe} label={texte.suggestion.label} />
                          <p className="text-[14px] leading-relaxed text-ink">
                            {vorschlaege[feld]}
                          </p>
                          <div className="mt-2.5 flex items-center gap-4 text-[13px]">
                            <button
                              type="button"
                              onClick={() => onApplySuggestion(feld)}
                              className="min-h-8 rounded font-medium transition-opacity hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                              style={{ color: texte.suggestion.farbe }}
                            >
                              {texte.suggestion.apply}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDiscardSuggestion(feld)}
                              className="min-h-8 rounded text-faint transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                            >
                              {texte.suggestion.discard}
                            </button>
                          </div>
                        </div>
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

      {/* ── THAW, in der Mitte ────────────────────────────────────────
          Er steht dort, wo alle vier Ecken hinzeigen, und nicht in einer
          Spalte am Rand: er liest das Ganze, nicht eine Seite davon. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-40 w-[17rem] -translate-x-1/2 -translate-y-1/2">
        <div className="pointer-events-auto">{hub}</div>
      </div>
    </div>
  );
}

/**
 * Der Weg von Knoten A zu Knoten B.
 *
 * Innerhalb einer Ecke eine gerade Linie von Kante zu Kante, zwischen zwei
 * Ecken eine Bezierkurve, die waagerecht aus dem einen heraus und in den
 * anderen hineinlaeuft. Eine Kurve, die schraeg an einer Ecke ansetzt, sieht
 * aus wie ein Zeichenfehler.
 */
function pfad(a: Box, b: Box, breite: number, versatz = 0): string {
  const gleicheSpalte = Math.abs(a.x - b.x) < 4;
  if (gleicheSpalte) {
    const luecke = a.y < b.y ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
    // Direkt untereinander: die kurze gerade Linie. Sie kreuzt nichts.
    if (luecke < NACHBAR_ABSTAND && versatz === 0) {
      const x = a.x + a.w / 2;
      const [y1, y2] = a.y < b.y ? [a.y + a.h, b.y] : [a.y, b.y + b.h];
      return `M ${x} ${y1} L ${x} ${y2}`;
    }
    // Sonst AUSSEN HERUM.
    //
    // Am Standbild gefunden: eine gerade Linie durch die Spaltenmitte laeuft
    // mitten durch die Knoten, die dazwischen liegen -- "faellt weg" und
    // "belegt" durchschnitten die Karten 06 und 07, und die Beschriftung lag
    // auf fremdem Text. Aussen ist Platz: die Luecke zur Mitte ist 300 Pixel
    // breit, nach aussen steht der Seitenrand.
    const linkeHaelfte = a.x + a.w / 2 < breite / 2;
    const x = linkeHaelfte ? a.x - AUSSEN - versatz : a.x + a.w + AUSSEN + versatz;
    const xa = linkeHaelfte ? a.x : a.x + a.w;
    const xb = linkeHaelfte ? b.x : b.x + b.w;
    const ya = a.y + a.h / 2;
    const yb = b.y + b.h / 2;
    return `M ${xa} ${ya} L ${x} ${ya} L ${x} ${yb} L ${xb} ${yb}`;
  }
  const linksNachRechts = a.x < b.x;
  const x1 = linksNachRechts ? a.x + a.w : a.x;
  const x2 = linksNachRechts ? b.x : b.x + b.w;
  const y1 = a.y + a.h / 2;
  const y2 = b.y + b.h / 2;
  const dx = Math.max(24, Math.abs(x2 - x1) / 2);
  const s = linksNachRechts ? 1 : -1;
  return `M ${x1} ${y1} C ${x1 + dx * s} ${y1}, ${x2 - dx * s} ${y2}, ${x2} ${y2}`;
}

/** Wo die Beschriftung einer Kante steht. */
function mitte(a: Box, b: Box, breite: number): { x: number; y: number } {
  const gleicheSpalte = Math.abs(a.x - b.x) < 4;
  if (gleicheSpalte) {
    const luecke = a.y < b.y ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
    if (luecke < NACHBAR_ABSTAND) {
      const [y1, y2] = a.y < b.y ? [a.y + a.h, b.y] : [a.y, b.y + b.h];
      return { x: a.x + a.w / 2 + 54, y: (y1 + y2) / 2 + 3 };
    }
    // Auf dem senkrechten Stueck der Umleitung, nicht ueber den Knoten.
    const linkeHaelfte = a.x + a.w / 2 < breite / 2;
    return {
      x: linkeHaelfte ? a.x - AUSSEN : a.x + a.w + AUSSEN,
      y: (a.y + a.h / 2 + b.y + b.h / 2) / 2,
    };
  }
  return { x: (a.x + a.w / 2 + b.x + b.w / 2) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2 - 7 };
}
