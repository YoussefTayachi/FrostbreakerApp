"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  OFFER_COLUMNS,
  OFFER_TEXT_FIELDS,
  REQUIRED_FOR_GENERATION,
  completeness,
  emptyOffer,
  missingForGeneration,
  type Offer,
  type OfferTextField,
} from "@/lib/offers";
import type { OfferSuggestion } from "@/lib/copy/offer-from-website";
import { FINDING_FIELD, offerFindings, type OfferFinding } from "@/lib/copy/offer-tests";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import OfferCore from "./offer-core";

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
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ZWEI SPALTEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Links wird geschrieben, rechts steht, was daraus folgt: der Ring, die
 * fehlenden Felder und der Weg zur Kampagne. Beides gleichzeitig sichtbar,
 * weil die Frage beim Tippen immer dieselbe ist -- "reicht das jetzt?".
 * Unter den Feldern haette die Antwort erst gescrollt werden muessen.
 */

type Entwurf = Omit<Offer, "id" | "is_default">;

const MAX_OFFERS = 10;

/**
 * Eingabefelder dieser Seite, groesser als das app-weite inputCls.
 *
 * Hier wird nicht ein Wert eingetragen, sondern ein Absatz formuliert -- und
 * denselben Text liest der Generator danach als Vorgabe. Auf 14 Pixeln in
 * einer 40 Pixel hohen Zeile las sich das wie ein Suchfeld; jetzt 15 Pixel mit
 * offener Zeilenhoehe.
 *
 * Bewusst NICHT als "inputCls + Zusatz" geschrieben: bei Tailwind entscheidet
 * die Reihenfolge im erzeugten Stylesheet, nicht die im class-Attribut --
 * px-4 hinter px-3.5 zu haengen gewinnt also nicht zuverlaessig.
 */
const feldBasis =
  "rounded-lg border border-edge2 bg-field px-4 py-3 text-[15px] leading-[1.6] text-ink " +
  "placeholder-mute outline-none transition-colors focus:border-sky-500";
const textfeldCls = feldBasis + " w-full resize-y";

/** Karte der Instrumentenfläche: Haarlinienrahmen, Eckwinkel, Monoschild. */
function Karte({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        "fb-ticks relative rounded-xl border border-edge/60 bg-panel p-5 " + className
      }
    >
      <p className="fb-label mb-3 text-mute">{label}</p>
      {children}
    </section>
  );
}

/** Ein Playbook-Befund als Satz. Die Texte stehen in dict.ts, entschieden wird
 *  nichts hier -- diese Funktion ordnet nur zu. */
function findingText(f: OfferFinding, T: ReturnType<typeof useT>["t"]["offers"]["findings"]): string {
  switch (f.kind) {
    case "outcomeNoTimeframe":
      return T.outcomeNoTimeframe;
    case "outcomeNoNumber":
      return T.outcomeNoNumber;
    case "mechanismJargon":
      return T.mechanismJargon(f.words);
    case "microYes":
      // Nur der erste Befund: bei einer Terminbitte stimmt meistens auch das
      // Fragezeichen nicht, und drei Saetze unter einem Feld liest niemand.
      switch (f.problems[0]) {
        case "multiline":
          return T.microYesMultiline;
        case "meeting":
          return T.microYesMeeting;
        case "link":
          return T.microYesLink;
        case "tooLong":
          return T.microYesTooLong;
        default:
          return T.microYesNoQuestion;
      }
    case "reviewTimeMissing":
      return T.reviewTimeMissing;
    case "reviewTimeVague":
      return T.reviewTimeVague;
    case "frictionTooBroad":
      return T.frictionTooBroad;
    case "tooLongToSay":
      return T.tooLongToSay(f.words, f.max);
  }
}

/** Auswahl in Schalterform -- Sprache, Anrede. */
function Schalter({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "min-h-9 rounded-lg border px-3.5 text-sm transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 " +
        (active
          ? "border-transparent font-medium text-ink shadow-sm"
          : "border-edge2 text-faint hover:border-edge3 hover:text-soft")
      }
      style={
        active
          ? {
              background: "color-mix(in srgb, var(--fb-frost) 14%, transparent)",
              borderColor: "color-mix(in srgb, var(--fb-frost) 45%, transparent)",
            }
          : undefined
      }
    >
      {children}
    </button>
  );
}

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

  const [entwurf, setEntwurf] = useState<Entwurf>(() => (aktuell ? { ...aktuell } : emptyOffer("")));
  const [gespeichert, setGespeichert] = useState<string>(() => JSON.stringify(entwurf));
  const [busy, setBusy] = useState(false);
  const [lese, setLese] = useState(false);
  const [vorschlaege, setVorschlaege] = useState<OfferSuggestion>({});
  const [neuerName, setNeuerName] = useState("");
  const [legeAn, setLegeAn] = useState(initial.length === 0);

  const geaendert = JSON.stringify(entwurf) !== gespeichert;
  const fehlend = missingForGeneration(entwurf);
  /**
   * Die Playbook-Befunde, nach Feld sortiert.
   *
   * Sie stehen UNTER dem Feld und nicht in einer Liste am Rand: ein Befund,
   * der neben dem Formular steht, muss erst zugeordnet werden, und genau das
   * passiert dann nicht mehr. Nur ausgefuellte Felder werden geprueft -- ein
   * frisches Angebot soll nicht mit acht roten Hinweisen begruessen.
   */
  const befunde = new Map<OfferTextField, OfferFinding[]>();
  for (const f of offerFindings(entwurf)) {
    const feld = FINDING_FIELD[f.kind];
    befunde.set(feld, [...(befunde.get(feld) ?? []), f]);
  }
  const prozent = completeness(entwurf);
  const gefuellt = new Set(OFFER_TEXT_FIELDS.filter((f) => entwurf[f].trim().length > 0));

  function setzeFeld<K extends keyof Entwurf>(key: K, value: Entwurf[K]) {
    setEntwurf((v) => ({ ...v, [key]: value }));
  }

  /** Vom Ring zum Feld. Ohne den Sprung wäre die Legende eine Diagnose ohne
   *  Behandlung -- man wüsste, was fehlt, und müsste es selbst suchen. */
  function springeZu(field: OfferTextField) {
    const el = document.getElementById(`feld-${field}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
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

  const feldLabels = Object.fromEntries(
    OFFER_TEXT_FIELDS.map((f) => [f, O.fields[f].label])
  ) as Record<OfferTextField, string>;

  return (
    <div className="space-y-5">
      {/* Angebotswahl als schmale Leiste über allem: sie entscheidet, was
          darunter steht. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {offers.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => wechsle(o.id)}
            className={
              "flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 " +
              (o.id === selectedId
                ? "border-transparent font-medium text-ink shadow-sm"
                : "border-edge2 text-soft hover:border-edge3 hover:text-ink")
            }
            style={
              o.id === selectedId
                ? {
                    background: "color-mix(in srgb, var(--fb-frost) 14%, transparent)",
                    borderColor: "color-mix(in srgb, var(--fb-frost) 45%, transparent)",
                  }
                : undefined
            }
          >
            {o.name}
            {o.is_default && (
              <span title={O.defaultTitle} aria-label={O.defaultTitle} className="text-[10px] text-amber-500">
                ★
              </span>
            )}
          </button>
        ))}
        {offers.length < MAX_OFFERS && !legeAn && (
          <button
            type="button"
            onClick={() => setLegeAn(true)}
            className="min-h-9 rounded-lg border border-dashed border-edge2 px-3 text-[13px] text-faint transition-colors hover:border-sky-500/50 hover:text-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:text-sky-400"
          >
            + {O.newOffer}
          </button>
        )}
      </div>

      {legeAn && (
        <Karte label={O.namePrompt}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={neuerName}
              onChange={(e) => setNeuerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && anlegen()}
              placeholder={O.namePlaceholder}
              className={feldBasis + " min-w-64 flex-1"}
            />
            <button
              onClick={anlegen}
              disabled={!neuerName.trim() || busy}
              className="min-h-10 rounded-lg px-5 text-sm font-medium text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              style={{ background: "var(--fb-frost)" }}
            >
              {t.common.save}
            </button>
            {offers.length > 0 && (
              <button
                onClick={() => setLegeAn(false)}
                className="min-h-10 rounded-lg border border-edge2 px-4 text-sm text-soft transition-colors hover:text-ink"
              >
                {O.cancel}
              </button>
            )}
          </div>
          {offers.length === 0 && <p className="mt-2.5 text-xs leading-relaxed text-mute">{O.emptyHint}</p>}
        </Karte>
      )}

      {aktuell && (
        // 340 statt 308 Pixel: der Kern ist gewachsen (offer-core.tsx), und
        // die Legende darunter soll dabei nicht enger werden.
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ── Links: hier wird geschrieben ─────────────────────────── */}
          <div className="min-w-0 space-y-5">
            <Karte label={O.languageHeading}>
              <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
                <div>
                  <p className="mb-2 text-[13px] text-faint">{O.languageSubtitle}</p>
                  <div className="flex gap-2">
                    {(["de", "en"] as const).map((code) => (
                      <Schalter
                        key={code}
                        active={entwurf.language === code}
                        onClick={() => setzeFeld("language", code)}
                      >
                        {O.languageOptions[code]}
                      </Schalter>
                    ))}
                  </div>
                </div>
                {/* Die Anrede gibt es im Englischen nicht -- eine Auswahl
                    zwischen "du" und "Sie" waere dort eine Frage ohne
                    Bedeutung. */}
                {entwurf.language === "de" && (
                  <div>
                    <p className="mb-2 text-[13px] text-faint">{O.addressSubtitle}</p>
                    <div className="flex gap-2">
                      {(["du", "sie"] as const).map((form) => (
                        <Schalter
                          key={form}
                          active={entwurf.address_form === form}
                          onClick={() => setzeFeld("address_form", form)}
                        >
                          {O.addressOptions[form]}
                        </Schalter>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Absender direkt darunter: Sprache, Anrede und Unterschrift
                  beantworten zusammen die Frage "wer schreibt hier wem, und
                  wie". Getrennte Karten haetten drei Antworten auf drei
                  Seiten verteilt. */}
              <div className="mt-5 border-t border-edge/60 pt-4">
                <label htmlFor="feld-signature" className="block text-[15px] font-medium text-ink">
                  {O.signatureHeading}
                </label>
                <p className="mb-2 mt-0.5 text-[13px] text-faint">{O.signatureSubtitle}</p>
                <textarea
                  id="feld-signature"
                  value={entwurf.signature}
                  onChange={(e) => setzeFeld("signature", e.target.value)}
                  rows={3}
                  placeholder={O.signaturePlaceholder}
                  className={textfeldCls}
                />
                <p className="mt-1.5 text-[13px] leading-relaxed text-mute">{O.signatureHint}</p>
              </div>
            </Karte>

            <Karte label={O.websiteHeading}>
              <p className="mb-3 text-[13px] text-faint">{O.websiteSubtitle}</p>
              <div className="relative flex flex-wrap items-center gap-2">
                <input
                  value={entwurf.website ?? ""}
                  onChange={(e) => setzeFeld("website", e.target.value)}
                  placeholder={O.websitePlaceholder}
                  className={feldBasis + " min-w-56 flex-1"}
                />
                <button
                  onClick={ausWebsite}
                  disabled={!entwurf.website?.trim() || lese}
                  className="relative min-h-10 overflow-hidden rounded-lg border px-4 text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  style={{
                    borderColor: "color-mix(in srgb, var(--fb-frost) 45%, transparent)",
                    color: "var(--fb-frost)",
                    background: "color-mix(in srgb, var(--fb-frost) 8%, transparent)",
                  }}
                >
                  {lese && <span className="fb-scan" aria-hidden />}
                  <span className="relative">{lese ? O.reading : O.readWebsite}</span>
                </button>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-mute">{O.websiteHint}</p>
            </Karte>

            <Karte label={O.fieldsHeading}>
              <div className="space-y-5">
                {OFFER_TEXT_FIELDS.map((key, i) => {
                  const pflicht = REQUIRED_FOR_GENERATION.includes(key);
                  const offen = fehlend.includes(key);
                  return (
                    <div key={key}>
                      <div className="mb-1 flex items-baseline gap-2">
                        {/* Die Nummer ist keine Zierde: die sieben Felder sind
                            eine Reihenfolge -- was, an wen, welches Problem,
                            was danach. Genau so ist auch die Legende am Ring
                            sortiert. */}
                        <span className="fb-num shrink-0 text-[11px] text-mute">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <label htmlFor={`feld-${key}`} className="text-[15px] font-medium text-ink">
                          {O.fields[key].label}
                        </label>
                        {/* Pflicht nur fuers Erzeugen, nicht fuers Speichern:
                            ein halb ausgefuelltes Angebot muss sicherbar
                            sein, sonst geht angefangene Arbeit beim
                            Wegklicken verloren. */}
                        {pflicht && offen && (
                          <span className="fb-label" style={{ color: "var(--fb-frost)" }}>
                            {O.neededForGeneration}
                          </span>
                        )}
                      </div>
                      <p className="mb-2 pl-6 text-[13px] leading-relaxed text-faint">{O.fields[key].hint}</p>
                      <div className="pl-6">
                        <textarea
                          id={`feld-${key}`}
                          value={entwurf[key]}
                          onChange={(e) => setzeFeld(key, e.target.value)}
                          rows={key === "tone" ? 2 : 4}
                          className={textfeldCls}
                        />
                        {/* Der Befund direkt unter seinem Feld. Bernstein und
                            nicht rot: es ist ein Hinweis auf schwächere
                            Wirkung, kein Fehler -- speichern und erzeugen geht
                            trotzdem. */}
                        {(befunde.get(key) ?? []).map((f, n) => (
                          <p
                            key={n}
                            className="mt-1.5 rounded-lg border-l-2 border-amber-500/50 bg-amber-500/5 px-3 py-1.5 text-[13px] leading-relaxed text-soft"
                          >
                            <span className="fb-label mr-1.5 text-amber-700 dark:text-amber-400">
                              {O.findings.heading}
                            </span>
                            {findingText(f, O.findings)}
                          </p>
                        ))}
                        {vorschlaege[key] && (
                          <div
                            className="lock-pop mt-1.5 rounded-lg border-l-2 px-3 py-2"
                            style={{
                              borderColor: "var(--fb-frost)",
                              background: "color-mix(in srgb, var(--fb-frost) 7%, transparent)",
                            }}
                          >
                            <p className="fb-label mb-1 text-mute">{O.suggestionLabel}</p>
                            <p className="text-[13.5px] leading-relaxed text-soft">{vorschlaege[key]}</p>
                            <div className="mt-2 flex gap-3 text-xs">
                              <button
                                onClick={() => uebernehmen(key)}
                                className="font-medium transition-opacity hover:opacity-75"
                                style={{ color: "var(--fb-frost)" }}
                              >
                                {O.applySuggestion}
                              </button>
                              <button onClick={() => verwerfen(key)} className="text-faint hover:text-ink">
                                {O.discardSuggestion}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Karte>
          </div>

          {/* ── Rechts: was daraus folgt ─────────────────────────────── */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="fb-ticks relative overflow-hidden rounded-xl border border-edge/60 bg-panel p-6">
              <div className="fb-grid-bg absolute inset-0" aria-hidden />
              <div className="relative">
                <p className="fb-label mb-4 text-mute">{O.coreLabel}</p>

                <OfferCore
                  filled={gefuellt}
                  required={new Set(REQUIRED_FOR_GENERATION)}
                  ready={fehlend.length === 0}
                  percent={prozent}
                  labels={feldLabels}
                  onJump={springeZu}
                  readyLabel={O.coreReady}
                  missingLabel={O.coreMissing}
                  say={
                    fehlend.length === 0
                      ? gefuellt.size === OFFER_TEXT_FIELDS.length
                        ? O.sayComplete
                        : O.sayReady
                      : gefuellt.size === 0
                        ? O.sayCold
                        : O.sayMissing(O.fields[fehlend[0]].label)
                  }
                />

                <div className="mt-5 space-y-2 border-t border-edge/60 pt-4">
                  <button
                    onClick={speichern}
                    disabled={busy || !geaendert}
                    className="min-h-11 w-full rounded-lg text-[15px] font-medium text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    style={{ background: geaendert ? "var(--fb-frost)" : "var(--color-edge3)" }}
                  >
                    {geaendert ? t.common.save : t.common.savedOk}
                  </button>

                  {fehlend.length === 0 ? (
                    <Link
                      href="/instantly/campaigns/new"
                      className="flex min-h-11 w-full items-center justify-center rounded-lg border text-[15px] font-medium transition-all hover:brightness-110"
                      style={{
                        borderColor: "color-mix(in srgb, var(--fb-ready) 50%, transparent)",
                        color: "var(--fb-ready)",
                        background: "color-mix(in srgb, var(--fb-ready) 9%, transparent)",
                      }}
                    >
                      {O.toCampaign}
                    </Link>
                  ) : (
                    <p className="text-center text-xs leading-relaxed text-faint">
                      {O.coreMissing(fehlend.length)}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-edge/60 pt-3 text-xs">
                  {!aktuell.is_default ? (
                    <button
                      onClick={alsStandard}
                      disabled={busy}
                      className="text-faint transition-colors hover:text-ink disabled:opacity-40"
                    >
                      {O.makeDefault}
                    </button>
                  ) : (
                    <span className="fb-label text-mute">{O.defaultTitle}</span>
                  )}
                  <button
                    onClick={loeschen}
                    disabled={busy}
                    className="text-faint transition-colors hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                  >
                    {t.common.delete}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
