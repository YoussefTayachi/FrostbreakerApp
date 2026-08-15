"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { OFFER_TEXT_FIELDS, type Offer, type OfferTextField } from "@/lib/offers";
import { SEARCH_SUGGESTED_FIELDS } from "@/lib/copy/offer-from-search";
import type { OfferSuggestion } from "@/lib/copy/offer-from-website";
import { inputCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";

/**
 * Ein Angebot fuer genau diese Lead-Liste.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ZWEI TEILE UND NICHT EIN NEUES ANGEBOT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Was der Absender verkauft, wie er klingt und worum er bittet, haengt nicht
 * an der Liste. Woran DIESE Empfaenger haengen, sehr wohl. Deshalb wird der
 * erste Teil aus dem Standardangebot uebernommen (kein Modellaufruf, kein
 * Website-Abruf) und nur der zweite geschrieben -- vier Felder, ein Aufruf.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM NICHTS AUTOMATISCH UEBERNOMMEN WIRD
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Der Entwurf steht als aenderbares Feld da und wird erst auf Knopfdruck
 * gespeichert -- und dann als NEUE Zeile in `offers`. Das Standardangebot
 * bleibt unangetastet. Gleiche Begruendung wie beim Website-Vorschlag
 * (lib/copy/offer-from-website.ts): ein falsch gelesenes Feld vergiftet
 * danach unsichtbar jede Mail, die aus dem Angebot entsteht -- der Fehler
 * steht dann in einem Feld, das niemand mehr liest, weil es ja "schon
 * ausgefuellt" ist.
 */
/**
 * Der Kasten drumherum -- gleiche Anmutung wie CampaignLinkCard daneben.
 *
 * Steht ausserhalb der Karte und nicht in ihr: eine im Rumpf definierte
 * Komponente ist bei jedem Bildaufbau ein neuer Typ, React haengt den ganzen
 * Teilbaum darunter ab und neu ein -- und das Textfeld, in dem gerade getippt
 * wird, verliert bei jedem Zeichen den Fokus.
 */
function Karte({
  eyebrow,
  heading,
  children,
}: {
  eyebrow: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-edge2 bg-panel px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-mute">{eyebrow}</p>
      <h2 className="mt-0.5 text-sm font-medium text-ink">{heading}</h2>
      {children}
    </section>
  );
}

/** Ein Satz, warum es hier gerade nichts zu tun gibt -- optional mit dem Weg
 *  dorthin, wo man es beheben kann. */
function Hinweis({
  eyebrow,
  heading,
  text,
  href,
  linkLabel,
}: {
  eyebrow: string;
  heading: string;
  text: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <Karte eyebrow={eyebrow} heading={heading}>
      <p className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-faint">
        {text}
        {href && linkLabel && (
          <>
            {" "}
            <Link href={href} className="text-sky-600 hover:underline dark:text-sky-400">
              {linkLabel} →
            </Link>
          </>
        )}
      </p>
    </Karte>
  );
}

export default function OfferDraftCard({
  searchId,
  searchName,
  running,
  hasOpenAiKey,
  hasSummaries,
  defaultOffer,
}: {
  searchId: string;
  searchName: string;
  /** Suche laeuft noch -- die Firmenbeschreibungen sind unvollstaendig. */
  running: boolean;
  hasOpenAiKey: boolean;
  /** Gibt es zu dieser Liste ueberhaupt recherchierte Firmenbeschreibungen? */
  hasSummaries: boolean;
  /** Das Standardangebot des Workspaces. null = es gibt keins. */
  defaultOffer: Offer | null;
}) {
  const { t } = useT();
  const D = t.searchDetail.offerDraft;
  const O = t.offers;
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [laeuft, setLaeuft] = useState(false);
  const [entwurf, setEntwurf] = useState<Partial<Record<OfferTextField, string>> | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const [gespeichert, setGespeichert] = useState(false);

  async function generieren() {
    if (!defaultOffer || laeuft) return;
    setLaeuft(true);
    setGespeichert(false);
    const res = await fetch("/api/offers/from-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchId }),
    });
    const body = await res.json().catch(() => ({}));
    setLaeuft(false);
    if (!res.ok) return push(t.common.error + (body.error ?? res.status), "error");

    // Was das Modell nicht geliefert hat, kommt aus dem Standardangebot. Ein
    // leeres Feld waere hier ein Rueckschritt: der allgemeine Satz steht schon
    // da und ist immer noch besser als gar keiner. Das Modell laesst vor allem
    // `icp` absichtlich leer, wenn die Liste nicht enger ist als die
    // Zielgruppe des Angebots (siehe lib/copy/offer-from-search.ts).
    const vorschlag = (body.suggestion ?? {}) as OfferSuggestion;
    setEntwurf(
      Object.fromEntries(
        SEARCH_SUGGESTED_FIELDS.map((f) => [f, vorschlag[f] ?? defaultOffer[f]])
      ) as Partial<Record<OfferTextField, string>>
    );
  }

  async function speichern() {
    if (!defaultOffer || !entwurf || speichert) return;
    const name = `${searchName} ${D.nameSuffix}`.trim().slice(0, 80);
    setSpeichert(true);

    // Eine Kopie ueber OFFER_TEXT_FIELDS statt ueber eine Aufzaehlung von
    // Hand: kommt ein dreizehntes Feld dazu, wandert es damit automatisch mit.
    // Ohne diese Schleife entstuende ein Angebot, dem still ein Feld fehlt.
    const kopie: Record<string, unknown> = {
      workspace_id: workspaceId,
      name,
      // Niemals Standard: das eine Standardangebot je Workspace ist die
      // Grundlage, aus der diese Kopie gerade entstanden ist (Teilindex
      // offers_one_default, Migration 0090).
      is_default: false,
      address_form: defaultOffer.address_form,
      language: defaultOffer.language,
      website: defaultOffer.website,
      signature: defaultOffer.signature,
    };
    for (const f of OFFER_TEXT_FIELDS) kopie[f] = entwurf[f] ?? defaultOffer[f];

    const { error } = await createClient().from("offers").insert(kopie);
    setSpeichert(false);
    if (error) return push(t.common.error + error.message, "error");
    setEntwurf(null);
    setGespeichert(true);
    push(D.saved(name), "success");
  }

  const rahmen = { eyebrow: D.eyebrow, heading: D.heading };

  // Reihenfolge nach Dringlichkeit: was noch laeuft, ist kein Bedienfehler und
  // erledigt sich von selbst. Erst danach kommt, was der Nutzer einrichten muss.
  if (running) return <Hinweis {...rahmen} text={D.running} />;
  if (!defaultOffer)
    return <Hinweis {...rahmen} text={D.noOffer} href="/offers" linkLabel={D.noOfferLink} />;
  if (!hasOpenAiKey)
    return <Hinweis {...rahmen} text={D.noKey} href="/settings/keys" linkLabel={D.noKeyLink} />;
  if (!hasSummaries) return <Hinweis {...rahmen} text={D.noSummaries} />;

  return (
    <Karte {...rahmen}>
      <p className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-faint">{D.description}</p>

      {entwurf === null ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void generieren()}
            disabled={laeuft}
            className={secondaryBtnCls}
          >
            {laeuft ? D.generating : D.generate}
          </button>
          {gespeichert && (
            <Link href="/offers" className="text-sm text-sky-600 hover:underline dark:text-sky-400">
              {D.toOffer} →
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {SEARCH_SUGGESTED_FIELDS.map((feld) => (
            <div key={feld}>
              <label
                htmlFor={`entwurf-${feld}`}
                className="mb-1 block text-xs font-medium text-soft"
              >
                {O.fields[feld].label}
              </label>
              <textarea
                id={`entwurf-${feld}`}
                value={entwurf[feld] ?? ""}
                onChange={(e) =>
                  setEntwurf((v) => ({ ...(v ?? {}), [feld]: e.target.value }))
                }
                rows={2}
                className={inputCls + " w-full resize-y"}
              />
            </div>
          ))}
          <p className="max-w-[70ch] text-xs leading-relaxed text-mute">{D.draftHint}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void speichern()}
              disabled={speichert}
              className={primaryBtnCls}
            >
              {speichert ? t.common.saving : D.save}
            </button>
            <button
              onClick={() => setEntwurf(null)}
              className="text-sm text-faint transition-colors hover:text-ink"
            >
              {O.discardSuggestion}
            </button>
          </div>
        </div>
      )}
    </Karte>
  );
}
