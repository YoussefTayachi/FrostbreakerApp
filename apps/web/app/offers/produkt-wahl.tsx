"use client";
import type { OfferProduct } from "@/lib/copy/offer-products";

/**
 * Die Zwischenfrage: welches der gefundenen Produkte ist gemeint?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WARUM EIN BAUTEIL UND NICHT ZWEIMAL DERSELBE BLOCK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Beide Kerne stellen sie: Aim, bevor es das Angebot auf eine Lead-Liste
 * zuschneidet, und Core, bevor es aus der eigenen Website den ersten Entwurf
 * macht. Es ist dieselbe Frage an denselben Nutzer — sie muss sich auch gleich
 * anfuehlen. Zweimal derselbe Block waere die naechste Stelle, an der eine
 * Verbesserung nur in einer der beiden landet.
 *
 * Unterschiedlich ist nur die Farbe des Kerns, der gerade fragt (--fb-aim
 * bzw. --fb-frost), und der Text der Frage.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DIE LETZTE ZEILE IST DER AUSWEG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Erkennung liest Freitext bzw. eine fremde Seite und kann danebenliegen.
 * Ohne eigenes Feld haette der Nutzer dann nur die Wahl zwischen zwei falschen
 * Antworten und dem Abbruch.
 */

/** Der Index, den der Freitext-Ausweg belegt. Nie ein Produkt — die Auswahl
 *  bleibt damit EIN Zustand statt zweier, die sich widersprechen koennen. */
export const FREITEXT = -1;

export type ProduktWahlTexte = {
  heading: string;
  hint: string;
  other: string;
  otherPlaceholder: string;
  confirm: string;
  cancel: string;
};

export default function ProduktWahl({
  produkte,
  index,
  onIndex,
  frei,
  onFrei,
  onConfirm,
  onCancel,
  accent,
  radioName,
  inputCls,
  texte,
}: {
  produkte: OfferProduct[];
  index: number;
  onIndex: (i: number) => void;
  frei: string;
  onFrei: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** Die Farbe des fragenden Kerns. */
  accent: string;
  /** Eigener Gruppenname je Kern: stuenden beide Fragen je einmal im Dokument,
   *  waeren die Radioknoepfe sonst EINE Gruppe und wuerden sich gegenseitig
   *  abwaehlen. */
  radioName: string;
  /** Die Feldklasse kommt vom Aufrufer, damit sie EINE Definition bleibt
   *  (feldBasis in offers-editor.tsx). */
  inputCls: string;
  texte: ProduktWahlTexte;
}) {
  return (
    <div className="mt-3">
      {/* Kein fb-label: das ist eine Frage an den Nutzer und kein
          Instrumentenschild. Gesetzt wie die anderen Fragen dieser Seite. */}
      <p className="text-[13px] text-faint">{texte.heading}</p>
      <p className="mb-2 mt-0.5 max-w-[54ch] text-[13px] leading-relaxed text-mute">{texte.hint}</p>
      <div className="space-y-1.5">
        {produkte.map((p, i) => (
          <label
            key={p.name}
            className={
              "block cursor-pointer rounded-lg border p-3 text-sm transition-colors " +
              (index === i ? "" : "border-edge2 hover:border-edge3")
            }
            style={
              index === i
                ? {
                    borderColor: `color-mix(in srgb, ${accent} 55%, transparent)`,
                    background: `color-mix(in srgb, ${accent} 7%, transparent)`,
                  }
                : undefined
            }
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name={radioName}
                checked={index === i}
                onChange={() => onIndex(i)}
                className="h-3.5 w-3.5"
                style={{ accentColor: accent }}
              />
              <span className="font-medium text-ink">{p.name}</span>
            </span>
            {p.description && (
              <span className="mt-1 block pl-[22px] text-[13px] leading-relaxed text-faint">
                {p.description}
              </span>
            )}
          </label>
        ))}
        <label
          className={
            "block cursor-pointer rounded-lg border p-3 text-sm transition-colors " +
            (index === FREITEXT ? "" : "border-edge2 hover:border-edge3")
          }
          style={
            index === FREITEXT
              ? {
                  borderColor: `color-mix(in srgb, ${accent} 55%, transparent)`,
                  background: `color-mix(in srgb, ${accent} 7%, transparent)`,
                }
              : undefined
          }
        >
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name={radioName}
              checked={index === FREITEXT}
              onChange={() => onIndex(FREITEXT)}
              className="h-3.5 w-3.5"
              style={{ accentColor: accent }}
            />
            <span className="font-medium text-ink">{texte.other}</span>
          </span>
        </label>
        {/* Das Textfeld steht AUSSERHALB der Beschriftung: ein zweites
            Bedienelement in einem <label> laesst den Klick ins Textfeld je
            nach Browser den Radioknopf treffen. */}
        {index === FREITEXT && (
          <input
            autoFocus
            value={frei}
            onChange={(e) => onFrei(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onConfirm()}
            placeholder={texte.otherPlaceholder}
            className={inputCls + " w-full"}
          />
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-4">
        <button
          type="button"
          onClick={onConfirm}
          disabled={index === FREITEXT && !frei.trim()}
          className="min-h-9 rounded-lg border px-4 text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          style={{
            borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`,
            color: accent,
            background: `color-mix(in srgb, ${accent} 8%, transparent)`,
          }}
        >
          {texte.confirm}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-8 rounded text-[13px] text-faint transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          {texte.cancel}
        </button>
      </div>
    </div>
  );
}
