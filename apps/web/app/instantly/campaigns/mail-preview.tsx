"use client";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../language-provider";
import { plainTextToInstantlyHtml, variantLabel, type MergeTagSource } from "@/lib/instantly/campaigns";
import { renderVariablesForLead, hasWebsiteFinding } from "@/lib/instantly/preview";
import {
  clampPreviewSelection,
  hasSequenceText,
  isHeldBack,
  selectedVariant,
  sequenceGaps,
  PREVIEW_BROWSE_LIMIT,
  type PreviewSelection,
} from "@/lib/instantly/preview-selection";
import { mergeTagOptions } from "./campaign-step-card";
import type { Step } from "./campaign-form";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DIE MAIL, WIE SIE BEIM EMPFAENGER ANKOMMT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Im Editor steht {{websiteFinding}}, und was daraus wird, sah bisher niemand.
 * Die App warnte mit einer ZAHL ("X Leads ohne Befund", lib/campaign-readiness.ts),
 * und eine Zahl sagt nichts darueber, wie die Mail mit leerer Variable
 * aussieht. Wer einmal den leeren Absatz mitten im Text sieht, versteht das
 * Problem sofort, statt einer Warnung glauben zu muessen.
 *
 * Deshalb ist der Reihe nach wichtig:
 *
 *   1. ECHTE Leads. Nicht "Max Mustermann", sondern Empfaenger aus den
 *      angehakten Listen, und zwar nur solche, die tatsaechlich mitgingen
 *      (api/campaigns/preview-leads laeuft durch dieselbe Filterkette wie der
 *      Versand).
 *   2. Das echte Loch. renderVariables setzt fuer einen leeren Wert NICHTS
 *      ein, und der Text unten wird durch genau denselben Aufruf gejagt, der
 *      auch an Instantly geht (plainTextToInstantlyHtml). Was hier
 *      auseinanderfaellt, faellt beim Empfaenger auseinander.
 *   3. Der Name dazu. Das Loch allein sagt nicht, WELCHE Variable fehlt;
 *      empty[] aus RenderedEmail sagt es, ohne dass der Text ein zweites Mal
 *      zerlegt werden muss.
 *
 * DER OPT-OUT-LINK, gemessen am 2026-08-24 im Formular:
 * optOutLink() (campaign-step-card.tsx) schreibt die Workspace-ID direkt in
 * die URL und laesst {{email}} als echtes Instantly-Merge-Tag stehen. In der
 * Vorschau wird es deshalb wie jeder andere Tag ersetzt, und dort steht die
 * vollstaendige Abmelde-URL mit der Adresse des angezeigten Leads -- also
 * genau der Link, den dieser Empfaenger anklickt. Das ist gewollt: eine
 * falsche Workspace-ID faellt nur hier auf. Weil so eine URL laenger ist als
 * die Karte breit, bricht der Textkasten unten notfalls mitten im Wort um
 * ([overflow-wrap:anywhere]); ohne das schob der Link die ganze Vorschau in
 * die Breite.
 */

type PreviewLead = MergeTagSource;

/** Die Wanne, in der die Vorschau in JEDEM Zustand sitzt (leer, laedt, Fehler,
 *  voll). Eine Flaeche, die mal da ist und mal nicht, liest sich als Fehler --
 *  deshalb an einer Stelle und nicht je Zweig abgeschrieben. Der Rahmen kommt
 *  von aussen dazu, weil er den Befund traegt (siehe `rahmen` unten). */
const wanneCls = "rounded-lg border bg-field p-3 transition-colors";

/**
 * Die kleinen Schaltflaechen der Vorschau: blaettern, Stufe, Fassung, Sprung
 * zur anderen Luecke. Vier Stellen, eine Klasse -- sonst haette die naechste
 * Aenderung am Fokusring drei Stellen vergessen.
 *
 * focus-visible statt focus: der Ring gehoert der Tastatur. Ohne ihn haengt die
 * ganze Bedienung dieser Flaeche am Standardumriss des Browsers, und der ist
 * auf der dunklen Flaeche kaum zu sehen.
 *
 * Groesse und Innenabstand stehen bewusst NICHT in der Grundklasse: Tailwind
 * entscheidet bei zwei Utilities derselben Eigenschaft nach der Reihenfolge im
 * erzeugten Stylesheet, nicht nach der im class-Attribut. Ein "px-0" hinter
 * einem "px-2" gewinnt also nicht zuverlaessig.
 */
const pillBaseCls =
  "rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";
const pillCls = pillBaseCls + " px-2 py-0.5 text-[11px]";
/** Die Blaetterpfeile. 24 Pixel im Quadrat, weil man sie zehnmal hintereinander
 *  trifft (WCAG 2.2, 2.5.8); bei px-2 py-0.5 waren es 20. */
const arrowCls = pillBaseCls + " flex h-6 w-6 items-center justify-center text-sm";
const pillAnCls = "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-300";
const pillAusCls = "border-edge2 text-faint hover:border-sky-500/50 hover:text-ink";

type Ladezustand =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; leads: PreviewLead[]; sendable: number };

export default function MailPreview({
  searchIds,
  steps,
  selection,
  onSelectionChange,
}: {
  /** Die angehakten Lead-Listen. Leer = noch keine gewaehlt. */
  searchIds: string[];
  steps: Step[];
  /** Folgt der gerade bearbeiteten Stufe/Fassung, laesst sich hier aber auch
   *  selbst umstellen: derselbe Zustand, zwei Bedienstellen. */
  selection: PreviewSelection;
  onSelectionChange: (s: PreviewSelection) => void;
}) {
  const { t } = useT();
  const F = t.instantly.campaigns.form;
  const P = F.mailPreview;

  const [daten, setDaten] = useState<Ladezustand>({ state: "idle" });
  const [leadIndex, setLeadIndex] = useState(0);
  /** Nur zum erneuten Ausloesen des Effekts nach einem Fehler. */
  const [versuch, setVersuch] = useState(0);

  // Haengt bewusst NUR an den Lead-Listen und nicht am Sequenztext: sonst
  // liefe diese Abfrage bei jedem Tastendruck im Editor erneut.
  const listenKey = searchIds.join(",");
  useEffect(() => {
    if (searchIds.length === 0) {
      setDaten({ state: "idle" });
      return;
    }
    let abgebrochen = false;
    setDaten({ state: "loading" });
    fetch("/api/campaigns/preview-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchIds, limit: PREVIEW_BROWSE_LIMIT }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((body) => {
        if (abgebrochen) return;
        setLeadIndex(0);
        setDaten({ state: "ready", leads: body.leads ?? [], sendable: body.sendable ?? 0 });
      })
      .catch(() => {
        if (!abgebrochen) setDaten({ state: "error" });
      });
    return () => {
      abgebrochen = true;
    };
    // listenKey statt searchIds: das Array ist bei jedem Rendern ein neues.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenKey, versuch]);

  const tagLabels = useMemo(
    () => new Map(mergeTagOptions(F).map((v) => [v.token, v.label])),
    [F]
  );

  const sel = clampPreviewSelection(steps, selection);
  const variant = selectedVariant(steps, sel);
  const leads = daten.state === "ready" ? daten.leads : [];
  // Nicht der rohe Index: die Liste kann sich unter der Auswahl geaendert haben.
  const li = Math.min(leadIndex, Math.max(0, leads.length - 1));
  const lead = leads[li] ?? null;

  const rendered = lead ? renderVariablesForLead(variant, lead) : null;
  const gaps = lead ? sequenceGaps(steps, lead) : [];
  const andereLuecken = gaps.filter((g) => !(g.step === sel.step && g.variant === sel.variant));
  const zurueckgehalten = lead ? isHeldBack(steps, lead) : false;

  /** Token in der Sprache des Nutzers: "{{websiteFinding}} (Website-Mangel)".
   *  Der Token bleibt sichtbar, weil er im Editor genau so dasteht. */
  function tagText(token: string): string {
    const label = tagLabels.get(token);
    return label ? `${token} (${label})` : token;
  }

  const kopf = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p className="text-xs font-medium text-faint">{P.heading}</p>
      {/* Nur wenn tatsaechlich mehr Leads dahinterstehen, als hier blaetterbar
          sind. Bei drei Empfaengern und drei gezeigten Mails waere das Wort
          "Stichprobe" eine Uebertreibung, und die Zaehlung daneben sagt es
          ohnehin genauer. */}
      {daten.state === "ready" && daten.sendable > daten.leads.length && (
        <p className="text-[11px] text-faint">{P.sample(daten.sendable)}</p>
      )}
    </div>
  );

  /** Alle Zustaende sehen gleich aus: ein Kasten mit einem Satz darin. Ein
   *  Bereich, der mal da ist und mal nicht, liest sich als Fehler.
   *
   *  text-faint und nicht text-mute: in diesen Zustaenden ist der eine Satz
   *  der GANZE Inhalt der Flaeche. text-mute kommt auf Weiss auf 2,4:1 und ist
   *  damit fuer Platzhalter gedacht, nicht fuer den einzigen Text im Bild. */
  function hinweis(text: string, extra?: React.ReactNode) {
    return (
      <div className={wanneCls + " border-edge2"}>
        {kopf}
        <p className="mt-1.5 text-xs text-faint">{text}</p>
        {extra}
      </div>
    );
  }

  if (searchIds.length === 0) return hinweis(P.noSearch);
  // "idle" zaehlt hier als "laedt gleich": der Effekt laeuft erst nach dem
  // ersten Rendern, und ohne diese Zeile blitzt eine Zehntelsekunde lang
  // "aus dieser Auswahl geht niemand raus" auf, obwohl noch nichts geladen ist.
  if (daten.state === "idle" || daten.state === "loading") return hinweis(P.loading);
  if (daten.state === "error")
    return hinweis(
      P.error,
      <button
        type="button"
        onClick={() => setVersuch((v) => v + 1)}
        className="mt-1.5 rounded-md text-[11px] font-medium text-sky-600 hover:text-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-400"
      >
        {P.retry}
      </button>
    );
  if (!lead) return hinweis(P.noLeads);
  if (!hasSequenceText(steps)) return hinweis(P.emptySequence);

  /**
   * Der Befund steckt im Rahmen der ganzen Flaeche, nicht nur im Kasten unten.
   *
   * Das ist der Unterschied, um den es beim Blaettern geht: wer mit ‹ / › durch
   * zehn Empfaenger geht, liest nicht jedes Mal den Text zu Ende. Wechselt die
   * ganze Wanne die Kante, sieht man am Rand des Blickfelds, dass DIESE Mail
   * anders ist als die davor.
   *
   * Dieselbe Sprache wie ueberall sonst in der App: Bernstein heisst "haelt
   * noch nicht", Rot heisst "kaputt". Der Rahmen ist kein zweiter Kanal neben
   * den Kaesten unten, sondern ihr Vorzeichen -- benannt wird der Grund
   * weiterhin nur dort.
   */
  const rahmen =
    rendered!.unknown.length > 0
      ? "border-red-500/50"
      : rendered!.empty.length > 0 || zurueckgehalten
        ? "border-amber-500/50"
        : "border-edge2";

  return (
    <div className={wanneCls + " " + rahmen}>
      {kopf}

      {/* Wer gerade zu sehen ist, und welcher Fall das ist. Der Fall steht
          NEBEN dem Namen und nicht in einer Fussnote: der erste Klick auf
          "weiter" ist der Sprung von der vollstaendigen Mail zu der mit dem
          Loch (pickPreviewLeads sortiert das Paar nach vorn), und ohne
          Beschriftung sieht man nur, dass sich der Text geaendert hat. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {/* aria-live: beim Blaettern wandert der Fokus nicht mit, er bleibt auf
            dem Pfeil. Ohne diese Ansage hoert man nur "weiter, Schaltflaeche"
            und erfaehrt nie, wer jetzt dasteht. */}
        <div className="min-w-0" aria-live="polite">
          <p className="truncate text-sm font-medium text-ink">
            {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email}
            {lead.businesses?.name && <span className="text-faint"> · {lead.businesses.name}</span>}
          </p>
          {/* Der Fall, nicht eine Fussnote: er sagt, WARUM die Mail unten so
              aussieht, wie sie aussieht. Auf text-mute (2,4:1) war genau die
              Zeile unlesbar, die den Sprung von "vollstaendig" zu "hier fehlt
              etwas" benennt. */}
          <p className="text-[11px] text-faint">
            {hasWebsiteFinding(lead) ? P.caseWithFinding : P.caseWithoutFinding}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* pointer-events-none am abgeschalteten Pfeil: ohne das faerbt sich
              auch der tote Pfeil beim Ueberfahren blau und verspricht etwas. */}
          <button
            type="button"
            onClick={() => setLeadIndex(li - 1)}
            disabled={li === 0}
            aria-label={P.prev}
            className={arrowCls + " " + pillAusCls + " disabled:pointer-events-none disabled:opacity-30"}
          >
            ‹
          </button>
          {/* tabular-nums: ohne sie wechselt die Zeichenbreite bei jedem
              Blaettern und die beiden Pfeile rutschen unter dem Finger weg. */}
          <span className="text-[11px] tabular-nums text-faint">{P.counter(li + 1, leads.length)}</span>
          <button
            type="button"
            onClick={() => setLeadIndex(li + 1)}
            disabled={li >= leads.length - 1}
            aria-label={P.next}
            className={arrowCls + " " + pillAusCls + " disabled:pointer-events-none disabled:opacity-30"}
          >
            ›
          </button>
        </div>
      </div>

      {/* Stufe und Fassung in EINER Reihe, nicht in zwei uebereinander: die
          Fassungen erscheinen nur, wenn die gewaehlte Stufe mehr als eine hat.
          Bei vier Stufen mit je einer Fassung bleibt es damit bei einer Reihe
          mit vier Knoepfen. */}
      {/* role=group mit vorhandener Beschriftung: die Reihe ist eine Auswahl,
          und aria-pressed sagt je Knopf, welche gerade gilt. Bewusst KEIN
          role=tablist -- dafuer muessten die Pfeiltasten den Fokus wandern
          lassen, und ein Versprechen, das die Tastatur nicht einloest, ist
          schlechter als gar keins. */}
      <div
        role="group"
        aria-label={F.sequenceLabel}
        className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-edge2/60 pt-2"
      >
        {steps.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={i === sel.step}
            onClick={() => onSelectionChange({ step: i, variant: 0 })}
            className={pillCls + " " + (i === sel.step ? pillAnCls : pillAusCls)}
          >
            {F.stepLabel(i + 1)}
          </button>
        ))}
        {(steps[sel.step]?.variants.length ?? 0) > 1 && (
          <>
            <span className="mx-0.5 h-3.5 w-px bg-edge2" aria-hidden />
            {steps[sel.step].variants.map((v, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={i === sel.variant}
                onClick={() => onSelectionChange({ step: sel.step, variant: i })}
                className={
                  pillCls +
                  " " +
                  (i === sel.variant ? pillAnCls : pillAusCls) +
                  (v.disabled ? " line-through opacity-60" : "")
                }
              >
                {variantLabel(i)}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Die Mail selbst. Der Text geht durch denselben Aufruf wie beim
          Versand (plainTextToInstantlyHtml), damit die Absaetze hier so
          sitzen wie dort; [&_div]:min-h-[1em] haelt die leere Zeile offen,
          sonst faellt genau der leere Absatz zusammen, um den es geht.
          dangerouslySetInnerHTML ist unkritisch: plainTextToInstantlyHtml
          maskiert &, < und > und setzt danach nur eigene Tags. Das gilt
          ausdruecklich auch fuer die eingesetzten Lead-Werte -- Icebreaker und
          Website-Befund stammen aus fremden Webseiten und werden erst
          eingesetzt und danach maskiert. */}
      {/* KEIN Rahmen und eine eigene Flaeche: mit border-edge2 auf bg-panel war
          dieser Kasten Zeichen fuer Zeichen ein Eingabefeld (inputCls ist genau
          das), und der Blick las ihn als "hier tippt man rein" statt als "so
          kommt das an". Die Trennung traegt jetzt die Flaeche.

          bg-panel2 sitzt in beiden Themes einen Schritt neben der Wanne: im
          Hellen etwas dunkler (das eingebettete Zitat), im Dunklen etwas heller
          (das Blatt im Licht). Andersherum haette eines von beiden gefehlt.

          Der Fliesstext ist text-ink, nicht text-soft: das ist der Inhalt
          dieser Flaeche und nicht ihr Beiwerk.

          break-words ist raus -- es setzt dieselbe Eigenschaft wie
          [overflow-wrap:anywhere] und welche der beiden gewinnt, entschied
          allein die Reihenfolge im erzeugten Stylesheet. Fuer die sehr lange
          Abmelde-URL ist "anywhere" die richtige der beiden: sie bricht auch
          dann, wenn im ganzen Wort keine Trennstelle vorkommt. */}
      <div className="mt-2 rounded-md bg-panel2 px-4 py-3.5">
        {/* text-soft statt text-faint: dieses Schild sitzt als einziges nicht
            auf Weiss, und text-faint kommt auf bg-panel2 nur auf 4,2:1. */}
        <p className="text-[11px] text-soft">{F.subjectPlaceholder}</p>
        <p className="mt-0.5 text-sm font-medium text-ink [overflow-wrap:anywhere]">
          {rendered!.subject.trim() ? rendered!.subject : <span className="text-soft">{P.noSubject}</span>}
        </p>
        <div
          className="mt-3 border-t border-edge2/70 pt-3 text-sm leading-relaxed text-ink [&_div]:min-h-[1em] [overflow-wrap:anywhere]"
          dangerouslySetInnerHTML={{ __html: plainTextToInstantlyHtml(rendered!.body) }}
        />
      </div>

      {/* Der Befund zum Text darueber. Er benennt, was das Loch war: im Text
          selbst steht dazu bewusst nichts, denn dort steht, was der Empfaenger
          sieht, und der sieht keinen Hinweis. */}
      <div className="mt-2 space-y-1.5">
        {zurueckgehalten && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            {P.heldBack}
          </p>
        )}
        {rendered!.empty.length > 0 && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            {P.empty(rendered!.empty.map(tagText).join(", "))}
          </p>
        )}
        {rendered!.unknown.length > 0 && (
          <p className="rounded-md border border-red-500/40 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-600 dark:text-red-400">
            {P.unknown(rendered!.unknown.join(", "))}
          </p>
        )}
        {rendered!.empty.length === 0 && rendered!.unknown.length === 0 && !zurueckgehalten && (
          /* Der gute Fall bleibt still: kein Gruen, kein Kasten, nur ein Satz.
             Laut ist hier nur, was Arbeit macht -- sonst waere beim Blaettern
             jede zweite Mail ein Ausrufezeichen. */
          <p className="text-[11px] text-faint">{P.allFilled}</p>
        )}
        {/* Die Vorschau zeigt immer nur eine Fassung. Ohne diese Zeile
            muesste man acht Karten durchklicken, um zu merken, dass das Loch
            nicht hier sitzt, sondern in Schritt 3 Variante B. */}
        {andereLuecken.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
            {P.gapsElsewhere}
            {andereLuecken.map((g) => (
              <button
                key={`${g.step}-${g.variant}`}
                type="button"
                onClick={() => onSelectionChange({ step: g.step, variant: g.variant })}
                className={pillBaseCls + " px-1.5 py-0.5 text-[11px] " + pillAusCls}
              >
                {F.stepLabel(g.step + 1)}
                {(steps[g.step]?.variants.length ?? 0) > 1 && ` ${variantLabel(g.variant)}`}
              </button>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
