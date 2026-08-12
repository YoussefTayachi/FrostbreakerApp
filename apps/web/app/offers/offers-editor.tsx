"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cardCls, inputCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import {
  OFFER_COLUMNS,
  OFFER_TEXT_FIELDS,
  completeness,
  emptyOffer,
  missingForGeneration,
  type Offer,
  type OfferTextField,
} from "@/lib/offers";
import type { OfferSuggestion } from "@/lib/copy/offer-from-website";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

/**
 * Das Angebotsformular.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM SIEBEN FELDER UND KEIN GROSSES TEXTFELD
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ein einziges "beschreibe dein Angebot" waere wieder ein leeres Blatt --
 * also genau das Problem, das dieser ganze Bereich loesen soll. Sieben
 * beantwortbare Fragen sind fuer den Nutzer leichter UND fuer den Generator
 * brauchbarer: er kann gezielt formulieren, statt einen Absatz zu deuten.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM VORSCHLAEGE UND KEIN AUTOMATISCHES AUSFUELLEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Der Knopf "Aus Website übernehmen" speichert nichts. Jeder Vorschlag steht
 * unter seinem Feld und wird einzeln uebernommen oder verworfen. Grund: eine
 * falsch gelesene Website vergiftet danach unsichtbar jede erzeugte Mail --
 * der Fehler steht dann in einem Feld, das niemand mehr liest, weil es ja
 * "schon ausgefuellt" ist.
 */

type Entwurf = Omit<Offer, "id" | "is_default">;

const MAX_OFFERS = 10;

export default function OffersEditor({ initial }: { initial: Offer[] }) {
  const { t } = useT();
  const O = t.offers;
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [offers, setOffers] = useState<Offer[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.find((o) => o.is_default)?.id ?? initial[0]?.id ?? null
  );
  const aktuell = offers.find((o) => o.id === selectedId) ?? null;

  const [entwurf, setEntwurf] = useState<Entwurf>(() =>
    aktuell ? { ...aktuell } : emptyOffer("")
  );
  const [gespeichert, setGespeichert] = useState<string>(() => JSON.stringify(entwurf));
  const [busy, setBusy] = useState(false);
  const [lese, setLese] = useState(false);
  const [vorschlaege, setVorschlaege] = useState<OfferSuggestion>({});
  const [neuerName, setNeuerName] = useState("");
  const [legeAn, setLegeAn] = useState(initial.length === 0);

  const geaendert = JSON.stringify(entwurf) !== gespeichert;
  const fehlend = missingForGeneration(entwurf);
  const prozent = completeness(entwurf);

  function setzeFeld<K extends keyof Entwurf>(key: K, value: Entwurf[K]) {
    setEntwurf((v) => ({ ...v, [key]: value }));
  }

  async function neuLaden(selectId: string | null) {
    const { data } = await createClient()
      .from("offers")
      .select(OFFER_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as unknown as Offer[];
    setOffers(rows);
    const ziel = rows.find((r) => r.id === selectId) ?? rows.find((r) => r.is_default) ?? rows[0] ?? null;
    setSelectedId(ziel?.id ?? null);
    const next = ziel ? { ...ziel } : emptyOffer("");
    setEntwurf(next);
    setGespeichert(JSON.stringify(next));
    setVorschlaege({});
  }

  /** Wechseln mit ungesicherten Aenderungen wuerde sie stillschweigend
   *  wegwerfen -- dieselbe Ruecksicht wie im LinkedIn-Vorlageneditor. */
  function wechsle(id: string) {
    if (geaendert && !window.confirm(O.switchUnsaved)) return;
    const ziel = offers.find((o) => o.id === id);
    if (!ziel) return;
    setSelectedId(id);
    const next = { ...ziel };
    setEntwurf(next);
    setGespeichert(JSON.stringify(next));
    setVorschlaege({});
    setLegeAn(false);
  }

  async function anlegen() {
    const name = neuerName.trim();
    if (!name) return;
    setBusy(true);
    const { data, error } = await createClient()
      .from("offers")
      .insert({
        workspace_id: workspaceId,
        name: name.slice(0, 80),
        // Das erste Angebot ist automatisch das Standardangebot: sonst muesste
        // der Nutzer eine Auswahl treffen, bei der es nichts zu waehlen gibt.
        is_default: offers.length === 0,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) return push(t.common.error + error.message, "error");
    setNeuerName("");
    setLegeAn(false);
    await neuLaden(data.id);
    push(O.created, "success");
  }

  async function speichern() {
    if (!aktuell) return;
    setBusy(true);
    const { error } = await createClient()
      .from("offers")
      .update({ ...entwurf, updated_at: new Date().toISOString() })
      .eq("id", aktuell.id)
      .eq("workspace_id", workspaceId);
    setBusy(false);
    if (error) return push(t.common.error + error.message, "error");
    setGespeichert(JSON.stringify(entwurf));
    setOffers((list) => list.map((o) => (o.id === aktuell.id ? { ...o, ...entwurf } : o)));
    push(t.common.savedOk, "success");
  }

  /**
   * Standard umschalten -- erst die alte loeschen, dann die neue setzen.
   *
   * Der Teilindex aus Migration 0090 laesst hoechstens ein Standardangebot je
   * Workspace zu. Die umgekehrte Reihenfolge liefe in eine
   * Eindeutigkeitsverletzung (gleiche Stelle wie bei linkedin_templates).
   */
  async function alsStandard() {
    if (!aktuell || aktuell.is_default) return;
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("offers")
      .update({ is_default: false })
      .eq("workspace_id", workspaceId)
      .eq("is_default", true);
    const { error } = await supabase
      .from("offers")
      .update({ is_default: true })
      .eq("id", aktuell.id)
      .eq("workspace_id", workspaceId);
    setBusy(false);
    if (error) return push(t.common.error + error.message, "error");
    await neuLaden(aktuell.id);
  }

  async function loeschen() {
    if (!aktuell) return;
    if (!window.confirm(O.deleteConfirm(aktuell.name))) return;
    setBusy(true);
    const { error } = await createClient()
      .from("offers")
      .delete()
      .eq("id", aktuell.id)
      .eq("workspace_id", workspaceId);
    setBusy(false);
    if (error) return push(t.common.error + error.message, "error");
    await neuLaden(null);
    push(O.deleted, "success");
  }

  async function ausWebsite() {
    if (!entwurf.website?.trim()) return;
    setLese(true);
    setVorschlaege({});
    const res = await fetch("/api/offers/from-website", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ website: entwurf.website, language: entwurf.language }),
    });
    const body = await res.json().catch(() => ({}));
    setLese(false);
    if (!res.ok) return push(t.common.error + (body.error ?? res.status), "error");
    setVorschlaege(body.suggestion ?? {});
    push(O.suggestionsReady(Object.keys(body.suggestion ?? {}).length), "success");
  }

  function uebernehmen(field: OfferTextField) {
    const wert = vorschlaege[field];
    if (!wert) return;
    setzeFeld(field, wert);
    verwerfen(field);
  }

  function verwerfen(field: OfferTextField) {
    setVorschlaege((v) => {
      const next = { ...v };
      delete next[field];
      return next;
    });
  }

  const felder: { key: OfferTextField; label: string; hint: string; rows: number }[] = OFFER_TEXT_FIELDS.map(
    (key) => ({ key, label: O.fields[key].label, hint: O.fields[key].hint, rows: key === "tone" ? 2 : 3 })
  );

  return (
    <div className="space-y-5">
      {/* Die Auswahl. Bei genau einem Angebot waere eine Reiterleiste ohne
          Alternative nur Zierde -- der Anlegen-Knopf steht trotzdem immer da. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {offers.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => wechsle(o.id)}
            className={
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors " +
              (o.id === selectedId
                ? "border-sky-500/60 bg-sky-500/10 font-medium text-sky-700 dark:text-sky-300"
                : "border-edge2 text-soft hover:border-edge3 hover:text-ink")
            }
          >
            {o.name}
            {o.is_default && (
              <span title={O.defaultTitle} className="text-[10px] text-amber-500">
                ★
              </span>
            )}
          </button>
        ))}
        {offers.length < MAX_OFFERS && !legeAn && (
          <button
            type="button"
            onClick={() => setLegeAn(true)}
            className="rounded-lg border border-dashed border-edge2 px-2.5 py-1 text-xs text-faint transition-colors hover:border-sky-500/50 hover:text-sky-600 dark:hover:text-sky-400"
          >
            + {O.newOffer}
          </button>
        )}
      </div>

      {legeAn && (
        <div className={cardCls}>
          <label className="mb-1.5 block text-xs font-medium text-faint">{O.namePrompt}</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={neuerName}
              onChange={(e) => setNeuerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && anlegen()}
              placeholder={O.namePlaceholder}
              className={inputCls + " min-w-64 flex-1"}
            />
            <button onClick={anlegen} disabled={!neuerName.trim() || busy} className={primaryBtnCls}>
              {t.common.save}
            </button>
            {offers.length > 0 && (
              <button onClick={() => setLegeAn(false)} className={secondaryBtnCls}>
                {O.cancel}
              </button>
            )}
          </div>
          {offers.length === 0 && <p className="mt-2 text-xs text-mute">{O.emptyHint}</p>}
        </div>
      )}

      {aktuell && (
        <>
          {/* Sprache und Anrede stehen VOR den Textfeldern: sie entscheiden,
              in welcher Sprache die erzeugten Mails herauskommen, und diese
              Auskunft nachtraeglich zu geben waere zu spaet. */}
          <div className={cardCls}>
            <h2 className="mb-1 font-medium text-ink">{O.languageHeading}</h2>
            <p className="mb-3 text-sm text-faint">{O.languageSubtitle}</p>
            <div className="flex flex-wrap gap-4">
              <div className="flex gap-2">
                {(["de", "en"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setzeFeld("language", code)}
                    className={
                      "rounded-lg border px-3 py-1.5 text-sm transition-colors " +
                      (entwurf.language === code
                        ? "border-sky-500/60 bg-sky-500/10 font-medium text-sky-700 dark:text-sky-300"
                        : "border-edge2 text-soft hover:border-edge3")
                    }
                  >
                    {O.languageOptions[code]}
                  </button>
                ))}
              </div>
              {/* Die Anrede gibt es im Englischen nicht -- eine Auswahl
                  zwischen "du" und "Sie" waere dort eine Frage ohne Bedeutung. */}
              {entwurf.language === "de" && (
                <div className="flex gap-2">
                  {(["du", "sie"] as const).map((form) => (
                    <button
                      key={form}
                      type="button"
                      onClick={() => setzeFeld("address_form", form)}
                      className={
                        "rounded-lg border px-3 py-1.5 text-sm transition-colors " +
                        (entwurf.address_form === form
                          ? "border-sky-500/60 bg-sky-500/10 font-medium text-sky-700 dark:text-sky-300"
                          : "border-edge2 text-soft hover:border-edge3")
                      }
                    >
                      {O.addressOptions[form]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={cardCls}>
            <h2 className="mb-1 font-medium text-ink">{O.websiteHeading}</h2>
            <p className="mb-3 text-sm text-faint">{O.websiteSubtitle}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={entwurf.website ?? ""}
                onChange={(e) => setzeFeld("website", e.target.value)}
                placeholder={O.websitePlaceholder}
                className={inputCls + " min-w-64 flex-1"}
              />
              <button
                onClick={ausWebsite}
                disabled={!entwurf.website?.trim() || lese}
                className={secondaryBtnCls}
              >
                {lese ? O.reading : O.readWebsite}
              </button>
            </div>
            <p className="mt-2 text-xs text-mute">{O.websiteHint}</p>
          </div>

          <div className={cardCls}>
            <div className="mb-4 flex items-baseline justify-between gap-2">
              <h2 className="font-medium text-ink">{O.fieldsHeading}</h2>
              <span className="text-xs text-faint">{O.completeness(prozent)}</span>
            </div>

            <div className="space-y-4">
              {felder.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-sm font-medium text-ink">
                    {f.label}
                    {/* Pflicht nur fuer das Erzeugen, nicht fuers Speichern:
                        ein halb ausgefuelltes Angebot muss sicherbar sein,
                        sonst geht angefangene Arbeit beim Wegklicken verloren. */}
                    {fehlend.includes(f.key) && (
                      <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-amber-600 dark:text-amber-500">
                        {O.neededForGeneration}
                      </span>
                    )}
                  </label>
                  <p className="mb-1.5 text-xs text-faint">{f.hint}</p>
                  <textarea
                    value={entwurf[f.key]}
                    onChange={(e) => setzeFeld(f.key, e.target.value)}
                    rows={f.rows}
                    className={inputCls + " w-full resize-y"}
                  />
                  {vorschlaege[f.key] && (
                    <div className="mt-1.5 rounded-lg border-l-2 border-sky-500/50 bg-sky-500/5 px-3 py-2">
                      <p className="text-xs leading-relaxed text-soft">{vorschlaege[f.key]}</p>
                      <div className="mt-1.5 flex gap-3 text-[11px]">
                        <button
                          onClick={() => uebernehmen(f.key)}
                          className="font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400"
                        >
                          {O.applySuggestion}
                        </button>
                        <button onClick={() => verwerfen(f.key)} className="text-faint hover:text-ink">
                          {O.discardSuggestion}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button onClick={speichern} disabled={busy || !geaendert} className={primaryBtnCls}>
                {geaendert ? t.common.save : t.common.savedOk}
              </button>
              {fehlend.length === 0 ? (
                <Link href="/instantly/campaigns/new" className={secondaryBtnCls}>
                  {O.toCampaign}
                </Link>
              ) : (
                <span className="text-xs text-amber-600 dark:text-amber-500">
                  {O.missingForGeneration(fehlend.map((f) => O.fields[f].label).join(", "))}
                </span>
              )}
              <span className="ml-auto flex items-center gap-3 text-[11px]">
                {!aktuell.is_default && (
                  <button onClick={alsStandard} disabled={busy} className="text-faint hover:text-ink disabled:opacity-40">
                    {O.makeDefault}
                  </button>
                )}
                <button
                  onClick={loeschen}
                  disabled={busy}
                  className="text-faint transition-colors hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                >
                  {t.common.delete}
                </button>
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
