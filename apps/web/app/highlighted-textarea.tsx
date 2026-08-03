"use client";
import { useRef, type RefObject } from "react";
import { inputCls } from "@/lib/ui";
import { buildHighlightSegments, type Highlights, type Severity } from "@/lib/email-quality";

// Textfeld mit farbiger Markierung von Textstellen, wie im Hemingway-Editor.
//
// Liegt bewusst hier und nicht mehr unter instantly/campaigns: die Komponente
// wird inzwischen von zwei Stellen mit unterschiedlicher Bedeutung genutzt --
// im Kampagnen-Editor markiert sie Qualitaetsbefunde (Passiv, Spam-Trigger),
// im LinkedIn-Vorlagen-Editor die Variablen (blau gueltig, rot vertippt). Sie
// kennt beide Bedeutungen nicht, sie faerbt nur Bereiche ein.
// Da eine <textarea> keine formatierten Bereiche kann, liegt hinter ihr eine
// deckungsgleiche Ebene mit demselben Text: dort stehen die farbigen Flaechen,
// der sichtbare Text kommt weiterhin aus der Textarea selbst. Deshalb bleiben
// Cursor, Auswahl, Undo und das Einfuegen von Variablen exakt das native
// Verhalten -- ein contentEditable-Editor haette all das nachbauen muessen.

// Bewusst zurueckhaltende Flaechen: der Text liegt darueber und muss in
// beiden Themes lesbar bleiben.
const MARK_CLS: Record<Severity, string> = {
  info: "bg-sky-500/15",
  warning: "bg-amber-400/30",
  danger: "bg-red-500/25",
};

export default function HighlightedTextarea({
  value,
  onChange,
  onFocus,
  placeholder,
  rows,
  highlights,
  textareaRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  placeholder?: string;
  rows?: number;
  highlights: Highlights | null;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const backdropRef = useRef<HTMLDivElement | null>(null);

  const active = highlights && highlights.forText === value && highlights.ranges.length > 0;
  // Eine abschliessende Leerzeile hat im <div> keine Hoehe, in der Textarea
  // schon -- ohne dieses Zeichen laufen beide Ebenen am Ende auseinander.
  const segments = active
    ? buildHighlightSegments(value.endsWith("\n") ? value + " " : value, highlights.ranges)
    : null;

  return (
    <div className="relative">
      {segments && (
        <div
          ref={backdropRef}
          aria-hidden
          className={
            // bg-field kommt aus inputCls und bleibt hier bewusst stehen: die
            // Textarea darueber wird durchsichtig geschaltet, sonst verdeckt
            // sie die Farbflaechen.
            inputCls +
            " pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words " +
            "border-transparent text-transparent"
          }
        >
          {segments.map((seg, i) =>
            seg.severity ? (
              <mark key={i} className={"rounded-sm text-transparent " + MARK_CLS[seg.severity]}>
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onScroll={(e) => {
          if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        placeholder={placeholder}
        rows={rows}
        // "block" statt des voreingestellten inline-block: sonst ist der
        // Wrapper wegen der Grundlinie ein paar Pixel hoeher als das Feld und
        // die Hintergrundebene schaut unten heraus.
        className={inputCls + " relative block w-full resize-y"}
        // Als Inline-Style, nicht als Klasse: "bg-transparent" und das
        // "bg-field" aus inputCls sind beides einfache Utilities, da
        // entscheidet die Reihenfolge im Stylesheet und nicht die im String --
        // die Klasse verliert und das Feld bleibt deckend weiss.
        style={segments ? { backgroundColor: "transparent" } : undefined}
      />
    </div>
  );
}
