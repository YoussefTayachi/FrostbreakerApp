/**
 * Die Herkunftszeile eines Vorschlagskastens.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WARUM DIE FARBE NICHT REICHT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vorschlaege kommen aus zwei Quellen: der eigenen Website (Frost) und einer
 * Lead-Liste (--fb-aim, Violett). Bis hierher war das nur am Rahmen zu sehen.
 * Drei Gruende, warum das zu wenig ist:
 *
 *  1. Eine Farbbedeutung muss man sich merken. Wer die Seite am naechsten Tag
 *     wieder aufmacht, hat sechs Kaesten vor sich und keine Legende dazu.
 *  2. "Aus einer Liste" waere ohnehin die halbe Antwort. Die Frage lautet: aus
 *     WELCHER: das Angebot fuer Shopify-Shops soll nicht mit dem fuer
 *     Zahnarztpraxen durcheinandergeraten.
 *  3. Farbe allein ist fuer Screenreader nicht vorhanden und bei
 *     Rot-Gruen-Schwaeche unzuverlaessig (WCAG 1.4.1).
 *
 * Deshalb: der Punkt traegt die Farbe (und wiederholt damit nur, was der
 * Rahmen sagt), der Text traegt die Aussage. Der Text steht bewusst in
 * text-soft und NICHT in der Herkunftsfarbe: --fb-frost auf Weiss sind
 * gerechnet 4,1:1 und damit unter der Grenze fuer Fliesstext.
 *
 * Gleiche Groesse in beiden Ansichten (Abschnittsliste und Karte), obwohl die
 * Karte sonst eine Stufe enger gesetzt ist: das hier ist die eine Zeile, die
 * auf einen Blick stimmen muss.
 */
export default function Herkunft({ farbe, label }: { farbe: string; label: string }) {
  return (
    <p className="mb-1.5 flex items-center gap-2 text-[13px] font-medium leading-snug text-soft">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: farbe }}
      />
      {/* Der Listenname kommt vom Nutzer und kann beliebig lang sein. Er
          bricht nicht um, sondern wird gekuerzt: zwei Zeilen Herkunft ueber
          einem Vorschlag waeren mehr Rahmen als Inhalt. Der volle Name steht
          im title. */}
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
    </p>
  );
}
