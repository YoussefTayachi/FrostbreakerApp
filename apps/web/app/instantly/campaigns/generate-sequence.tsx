"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { inputCls, secondaryBtnCls } from "@/lib/ui";
import type { SequenceProblem } from "@/lib/copy/sequence-prompt";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";
import type { Step } from "./campaign-form";

/**
 * "Mit KI schreiben" -- die Abkuerzung durch acht leere Textfelder.
 *
 * Steht UEBER dem Kampagnenformular und nicht darin: was es tut, ist das
 * Formular auszufuellen. Ein Knopf mitten zwischen den Stufen saehe aus, als
 * beträfe er nur die Stufe daneben.
 *
 * Was hier NICHT passiert: Absenden. Der Entwurf landet im Formular, der
 * Nutzer liest ihn, aendert ihn, und der Torwart steht davor wie bisher.
 * Ein Sprachmodell, das ungelesen an tausend Adressen schreibt, waere kein
 * Fortschritt, sondern der schnellste Weg, eine Domain zu verbrennen.
 */

type OfferOption = { id: string; name: string; is_default: boolean };

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
  const [problems, setProblems] = useState<SequenceProblem[]>([]);

  useEffect(() => {
    createClient()
      .from("offers")
      .select("id, name, is_default")
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
    const res = await fetch("/api/copy/sequence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return push(t.common.error + (body.error ?? res.status), "error");
    onGenerated(body.steps as Step[]);
    setProblems((body.problems ?? []) as SequenceProblem[]);
    push(G.done, "success");
  }

  if (offers === null) return null;

  // Ohne Angebot gibt es nichts zu erzeugen. Statt eines abgeschalteten
  // Knopfes der Weg dorthin -- ein grauer Knopf beantwortet die Frage nicht,
  // was jetzt zu tun waere.
  if (offers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-edge2 px-4 py-3">
        <p className="text-sm text-soft">{G.noOffer}</p>
        <Link href="/offers" className="mt-1 inline-block text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400">
          {G.createOffer}
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{G.heading}</span>
        {offers.length > 1 && (
          <select
            value={offerId}
            onChange={(e) => {
              setOfferId(e.target.value);
              onOfferChange(e.target.value || null);
            }}
            className={inputCls + " py-1.5"}
          >
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <button onClick={erzeugen} disabled={busy || !offerId} className={secondaryBtnCls}>
          {busy ? G.working : G.generate}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-faint">{G.hint}</p>

      {/* Was nach der Korrekturrunde uebrig blieb. Sichtbar, aber nicht
          blockierend: ein Text, an dem noch zwei Woerter zu viel haengen, ist
          mehr wert als eine Fehlermeldung -- und der Torwart prueft ohnehin
          noch einmal, bevor etwas rausgeht. */}
      {problems.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {problems.map((p, i) => (
            <li key={i} className="text-xs text-amber-700 dark:text-amber-500">
              · {problemText(p, G.problems)}
            </li>
          ))}
        </ul>
      )}
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
  }
}
