"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { inputCls } from "@/lib/ui";
import { WEBSITE_DESIGN_OFFER_TEMPLATE } from "@/lib/copy/offer-templates";
import { signatureFor, type SequenceProblem } from "@/lib/copy/sequence-prompt";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";
import Thaw from "../../thaw";
import type { Step } from "./campaign-form";

/**
 * "Mit KI schreiben": die Abkuerzung durch acht leere Textfelder.
 *
 * Steht UEBER dem Kampagnenformular und nicht darin: was es tut, ist das
 * Formular auszufuellen. Ein Knopf mitten zwischen den Stufen saehe aus, als
 * beträfe er nur die Stufe daneben.
 *
 * Was hier NICHT passiert: Absenden. Der Entwurf landet im Formular, der
 * Nutzer liest ihn, aendert ihn, und der Torwart steht davor wie bisher.
 * Ein Sprachmodell, das ungelesen an tausend Adressen schreibt, waere kein
 * Fortschritt, sondern der schnellste Weg, eine Domain zu verbrennen.
 *
 * Die Fläche trägt dieselbe Instrumentensprache wie die Angebotsseite
 * (.fb-hud in globals.css): es ist derselbe Vorgang, nur an seinem zweiten
 * Ende. Während des Schreibens läuft ein Streifen durch die Fläche statt
 * eines Spinners: er sagt "es wird gearbeitet", und die vier Stufenfelder
 * darunter zeigen, woran.
 */

/** language und signature nur fuer die Vorlage: sie entscheiden, in welcher
 *  Sprache die vier Stufen kommen und was unter ihnen steht. */
type OfferOption = {
  id: string;
  name: string;
  is_default: boolean;
  language: string | null;
  signature: string | null;
};

/** Vier Stufen, damit die Fläche während der Arbeit zeigt, was entsteht. */
const STUFEN = [0, 1, 2, 3];

export default function GenerateSequence({
  onGenerated,
  onOfferChange,
}: {
  onGenerated: (steps: Step[]) => void;
  /** Das gewaehlte Angebot wandert nach oben, damit das Nachschaerfen je
   *  Stufe denselben Zusammenhang mitschicken kann. */
  onOfferChange: (offerId: string | null) => void;
}) {
  const { t } = useT();
  const G = t.copyGen;
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [offers, setOffers] = useState<OfferOption[] | null>(null);
  const [offerId, setOfferId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  /** Der Vorlagenweg hat einen eigenen Zustand: er ist nach einer kurzen
   *  Abfrage fertig und darf nicht den Streifen und das "Schreibt..." des
   *  Modellaufrufs auslösen, der Minuten dauern kann. */
  const [setzt, setSetzt] = useState(false);
  const [fertig, setFertig] = useState(0);
  const [problems, setProblems] = useState<SequenceProblem[]>([]);

  useEffect(() => {
    createClient()
      .from("offers")
      .select("id, name, is_default, language, signature")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const rows = (data ?? []) as OfferOption[];
        setOffers(rows);
        const start = rows.find((o) => o.is_default)?.id ?? rows[0]?.id ?? "";
        setOfferId(start);
        onOfferChange(start || null);
      });
    // onOfferChange ist beim Aufrufer stabil (useCallback); als Abhaengigkeit
    // gefuehrt liefe der Effekt sonst bei jedem Tastendruck im Formular neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function erzeugen() {
    if (!offerId) return;
    setBusy(true);
    setProblems([]);
    setFertig(0);
    const res = await fetch("/api/copy/sequence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return push(t.common.error + (body.error ?? res.status), "error");
    const steps = (body.steps ?? []) as Step[];
    onGenerated(steps);
    setFertig(steps.length);
    setProblems((body.problems ?? []) as SequenceProblem[]);
    push(G.done, "success");
  }

  /**
   * Die fertige Vorlage statt eines Modellaufrufs.
   *
   * Der ruhigere Weg fuer jemanden, der noch kein ausgefuelltes Angebot hat
   * oder erst einmal sehen will, wie so eine Sequenz aussieht: dieselben vier
   * Stufen, sofort und ohne Kosten.
   *
   * Die Unterschrift MUSS hier drangehaengt werden. Die Vorlage endet ohne
   * sie, weil sie den Namen des Nutzers nicht kennt (siehe den Dateikopf von
   * lib/copy/offer-templates.ts); ohne diesen Schritt meldete
   * sequenceProblems() an allen vier Stufen "endet ohne deine Unterschrift",
   * an einem Text, den die App selbst geliefert hat. signatureFor() ist
   * dieselbe Funktion, die der Generator benutzt, damit nicht zwei Wahrheiten
   * ueber die Unterschrift entstehen.
   */
  async function vorlageEinsetzen() {
    const offer = offers?.find((o) => o.id === offerId);
    if (!offer) return;
    setSetzt(true);
    const { data } = await createClient()
      .from("workspaces")
      .select("reply_sender_name")
      .eq("id", workspaceId)
      .maybeSingle();
    setSetzt(false);
    const sprache = offer.language === "en" ? "en" : "de";
    const unterschrift = signatureFor(
      { signature: offer.signature ?? "", language: sprache },
      data?.reply_sender_name ?? null
    );
    const steps: Step[] = WEBSITE_DESIGN_OFFER_TEMPLATE[sprache].sequence.map((stufe) => ({
      delayDays: stufe.delayDays,
      variants: stufe.variants.map((v) => ({
        subject: v.subject,
        body: unterschrift ? `${v.body}\n\n${unterschrift}` : v.body,
      })),
    }));
    onGenerated(steps);
    setFertig(steps.length);
    setProblems([]);
    push(G.templateDone, "success");
  }

  if (offers === null) return null;

  // Ohne Angebot gibt es nichts zu erzeugen. Statt eines abgeschalteten
  // Knopfes der Weg dorthin; ein grauer Knopf beantwortet die Frage nicht,
  // was jetzt zu tun waere.
  if (offers.length === 0) {
    return (
      <div className="fb-hud fb-ticks relative rounded-xl border border-dashed border-edge2 px-5 py-4">
        <p className="fb-label mb-2 text-mute">{G.heading}</p>
        <p className="text-sm leading-relaxed text-soft">{G.noOffer}</p>
        <Link
          href="/offers"
          className="mt-2 inline-block text-xs font-medium transition-opacity hover:opacity-75"
          style={{ color: "var(--fb-frost)" }}
        >
          {G.createOffer} →
        </Link>
      </div>
    );
  }

  return (
    <div className="fb-hud fb-ticks relative overflow-hidden rounded-xl border border-edge/60 bg-panel p-5">
      <div className="fb-grid-bg absolute inset-0" aria-hidden />
      {busy && <span className="fb-scan" aria-hidden />}

      <div className="relative">
        <div className="flex flex-wrap items-end justify-between gap-3">
          {/* Derselbe Kern wie auf der Angebotsseite. Er ist der Grund, warum
              sich die beiden Flaechen wie ein Vorgang anfuehlen und nicht wie
              zwei Werkzeuge: dort sammelt er, hier schreibt er. */}
          <div className="flex items-start gap-3.5">
            <Thaw state={busy ? "working" : fertig > 0 ? "ready" : "listening"} size={64} className="shrink-0" />
            <div>
              <p className="fb-label mb-1.5" style={{ color: "var(--fb-frost)" }}>
                {G.eyebrow}
              </p>
              <h2 className="text-base font-semibold text-ink">{G.heading}</h2>
              <p className="mt-0.5 max-w-md text-xs leading-relaxed text-faint">
                {busy ? G.sayWorking : fertig > 0 ? G.sayDone : G.hint}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {offers.length > 1 && (
              <select
                value={offerId}
                onChange={(e) => {
                  setOfferId(e.target.value);
                  onOfferChange(e.target.value || null);
                }}
                aria-label={G.offerLabel}
                className={inputCls + " min-h-10 py-1.5"}
              >
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={erzeugen}
              disabled={busy || !offerId}
              className="min-h-10 rounded-lg px-5 text-sm font-medium text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              style={{ background: "var(--fb-frost)" }}
            >
              {busy ? G.working : G.generate}
            </button>
          </div>
        </div>

        {/* Die vier Stufen als Anzeige. Vor dem Lauf leer, waehrend des Laufs
            in Bewegung, danach gefuellt — damit sichtbar ist, was "Sequenz"
            ueberhaupt heisst, bevor man den Knopf zum ersten Mal drueckt. */}
        <div className="mt-4 grid grid-cols-4 gap-1.5">
          {STUFEN.map((i) => {
            const an = fertig > i;
            return (
              <div
                key={i}
                className="relative overflow-hidden rounded-md border px-2 py-1.5 transition-colors duration-300"
                style={{
                  borderColor: an
                    ? "color-mix(in srgb, var(--fb-ready) 45%, transparent)"
                    : "var(--color-edge)",
                  background: an
                    ? "color-mix(in srgb, var(--fb-ready) 9%, transparent)"
                    : "transparent",
                }}
              >
                <span
                  className="fb-num block text-[10px] leading-none"
                  style={{ color: an ? "var(--fb-ready)" : "var(--color-mute)" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="mt-1 block truncate text-[11px] leading-4 text-faint">
                  {G.stepNames[i]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Der zweite Weg, und sichtbar der zweite: eine Zeile unter den
            Stufen statt eines zweiten Knopfes neben dem ersten. Sobald ein
            Angebot ausgefuellt ist, ist der erzeugte Text besser, und die
            Gestaltung soll das sagen, nicht verschweigen. Waehrend des
            Modellaufrufs verschwindet die Zeile: dann ist die Frage
            beantwortet. */}
        {!busy && (
          <p className="mt-3 text-xs leading-5 text-faint">
            {G.templateHint}{" "}
            <button
              type="button"
              onClick={vorlageEinsetzen}
              disabled={setzt}
              title={G.templateTitle}
              className="rounded font-medium text-soft underline decoration-dotted underline-offset-2 transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50"
            >
              {G.templateUse}
            </button>
          </p>
        )}

        {/* Was nach der Korrekturrunde uebrig blieb. Sichtbar, aber nicht
            blockierend: ein Text, an dem noch zwei Woerter zu viel haengen, ist
            mehr wert als eine Fehlermeldung — und der Torwart prueft ohnehin
            noch einmal, bevor etwas rausgeht. */}
        {problems.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-edge/60 pt-3">
            {problems.map((p, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-4 text-amber-700 dark:text-amber-500">
                <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                {problemText(p, G.problems)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type ProblemTexte = {
  stepCount: (got: number) => string;
  variantCount: (step: number) => string;
  missingPersonalization: string;
  firstMailTooLong: (words: number, max: number) => string;
  firstMailHasLink: string;
  unknownTags: (tags: string) => string;
  dash: (step: number) => string;
  variantsTooSimilar: (step: number) => string;
  noGreeting: (step: number) => string;
  missingSignature: (step: number) => string;
  noParagraphs: (step: number) => string;
  personalizationLeadIn: (text: string) => string;
  stepTooLong: (step: number, words: number, max: number) => string;
  notShorter: (step: number) => string;
  subjectTooLong: (step: number, words: number, max: number) => string;
  subjectDrift: (step: number) => string;
  subjectNoMirror: (step: number) => string;
  subjectIsMicroYes: (step: number) => string;
  subjectAsks: (step: number) => string;
  bannedPhrase: (step: number, phrase: string) => string;
  meetingAsk: (step: number) => string;
  copiedNote: (step: number, text: string) => string;
};

function problemText(p: SequenceProblem, T: ProblemTexte): string {
  switch (p.kind) {
    case "stepCount":
      return T.stepCount(p.got);
    case "variantCount":
      return T.variantCount(p.step);
    case "missingPersonalization":
      return T.missingPersonalization;
    case "firstMailTooLong":
      return T.firstMailTooLong(p.words, p.max);
    case "firstMailHasLink":
      return T.firstMailHasLink;
    case "unknownTags":
      return T.unknownTags(p.tags.join(", "));
    case "dash":
      return T.dash(p.step);
    case "variantsTooSimilar":
      return T.variantsTooSimilar(p.step);
    case "noGreeting":
      return T.noGreeting(p.step);
    case "missingSignature":
      return T.missingSignature(p.step);
    case "noParagraphs":
      return T.noParagraphs(p.step);
    case "personalizationLeadIn":
      return T.personalizationLeadIn(p.text);
    case "stepTooLong":
      return T.stepTooLong(p.step, p.words, p.max);
    case "notShorter":
      return T.notShorter(p.step);
    case "subjectTooLong":
      return T.subjectTooLong(p.step, p.words, p.max);
    case "subjectDrift":
      return T.subjectDrift(p.step);
    case "subjectNoMirror":
      return T.subjectNoMirror(p.step);
    case "subjectIsMicroYes":
      return T.subjectIsMicroYes(p.step);
    case "subjectAsks":
      return T.subjectAsks(p.step);
    case "bannedPhrase":
      return T.bannedPhrase(p.step, p.phrase);
    case "meetingAsk":
      return T.meetingAsk(p.step);
    case "copiedNote":
      return T.copiedNote(p.step, p.text);
  }
}
