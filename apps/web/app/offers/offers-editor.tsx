"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  OFFER_COLUMNS,
  OFFER_STAGES,
  OFFER_TEXT_FIELDS,
  REQUIRED_FOR_GENERATION,
  completeness,
  emptyOffer,
  fieldNumber,
  missingForGeneration,
  type Offer,
  type OfferStageId,
  type OfferTextField,
} from "@/lib/offers";
import type { OfferSuggestion } from "@/lib/copy/offer-from-website";
import { FINDING_FIELD, offerFindings, type OfferFinding } from "@/lib/copy/offer-tests";
import type { CoachFinding } from "@/lib/copy/coach-prompt";
import OfferMap from "./offer-map";
import Herkunft from "./herkunft";
import Thaw from "../thaw";
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
 * Eine Lead-Liste in der Auswahl des zweiten Kerns.
 *
 * Genau die Spalten, die in der Zeile stehen, plus der Status: eine laufende
 * Suche hat ihre Firmenbeschreibungen noch nicht vollstaendig, und die Route
 * lehnt sie ohnehin ab (409). Sie hier gleich stumpf zu zeigen erspart den
 * Fehlversuch.
 */
type ListenOption = {
  id: string;
  name: string | null;
  query: string | null;
  location: string | null;
  status: string | null;
};

/** Woher die Vorschlaege stammen, die gerade unter den Feldern stehen. Nur
 *  fuer Beschriftung und Farbe -- die Uebernahme ist in beiden Faellen
 *  dieselbe. */
type VorschlagQuelle = "website" | "search";

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
  const [vorschlagQuelle, setVorschlagQuelle] = useState<VorschlagQuelle>("website");
  /** Die Listenauswahl des zweiten Kerns: zu, offen, und was gerade laeuft. */
  const [listeOffen, setListeOffen] = useState(false);
  const [listen, setListen] = useState<ListenOption[] | null>(null);
  const [liestListe, setLiestListe] = useState<string | null>(null);
  /**
   * Der Name der Liste, aus der die Vorschlaege stammen.
   *
   * Er steht in jedem Vorschlagskasten, und deshalb ist er ein eigener Zustand
   * und keine Ableitung aus `listen`: die Auswahl klappt nach dem Lesen zu, und
   * eine Stunde spaeter soll immer noch dranstehen, WOHER der Vorschlag kam --
   * "der violette" ist keine Antwort, die sich jemand merkt.
   */
  const [listenName, setListenName] = useState<string | null>(null);
  /** Der eine Satz, warum es mit dieser Liste nicht geht. Steht im Kasten und
   *  nicht als Hinweisblase: er gehoert zu der Liste, die man gerade angeklickt
   *  hat, und eine Blase ist weg, bevor man die naechste waehlt. */
  const [listenFehler, setListenFehler] = useState<string | null>(null);
  const [neuerName, setNeuerName] = useState("");
  const [legeAn, setLegeAn] = useState(initial.length === 0);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState(false);
  /**
   * Welcher Abschnitt aufgeklappt ist.
   *
   * null heisst nicht "keiner", sondern "noch nicht von Hand entschieden" --
   * dann oeffnet sich der Abschnitt mit der naechsten offenen Pflichtfrage.
   * So landet man beim Oeffnen der Seite immer dort, wo die Arbeit liegt,
   * kann aber jeden anderen aufklappen, ohne dass die Automatik zurueckspringt.
   */
  const [geoeffnetManuell, setGeoeffnetManuell] = useState<OfferStageId | null>(null);
  const [coachBefunde, setCoachBefunde] = useState<CoachFinding[] | null>(null);
  const [coachLaeuft, setCoachLaeuft] = useState(false);
  /**
   * Karte oder Liste.
   *
   * Die Karte braucht vier Spalten nebeneinander -- darunter waeren die Knoten
   * schmaler als ihre Beschriftung. Statt sie zu quetschen, faellt sie auf die
   * Abschnittsansicht zurueck: dieselben Daten, dieselben Bausteine, andere
   * Anordnung. Gerendert wird immer nur EINE von beiden, sonst gaebe es jedes
   * Textfeld zweimal im Dokument (und damit zwei Elemente mit derselben id).
   *
   * Die Schwelle stand bis zum 2026-08-13 bei 1180 und war damit zu niedrig.
   * Am Live-Bauteil nachgemessen: die laengste Frage ("What does the customer
   * struggle with beforehand?") braucht 343 Pixel, und bei einem 1180er
   * Fenster bleiben je Knoten rund 254. Die Karte schaltete sich also genau
   * dort ein, wo sie schmaler wurde als die Liste, die sie ersetzt. Ab 1500
   * traegt sie -- darunter ist die Abschnittsansicht die bessere Wahl.
   */
  const [breit, setBreit] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1500px)");
    const an = () => setBreit(mq.matches);
    an();
    mq.addEventListener("change", an);
    return () => mq.removeEventListener("change", an);
  }, []);

  /**
   * Die Lead-Listen -- erst beim Aufklappen, und dann einmal.
   *
   * Nicht beim Laden der Seite: die meisten Besuche dieser Seite tippen ein
   * Angebot und fassen den zweiten Kern nie an. Gefiltert wie ueberall, wo
   * Listen angeboten werden (siehe instantly/campaigns/new): nicht geloescht,
   * neueste zuerst.
   */
  useEffect(() => {
    if (!listeOffen || listen !== null) return;
    createClient()
      .from("searches")
      .select("id, name, query, location, status")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setListen((data ?? []) as ListenOption[]));
  }, [listeOffen, listen, workspaceId]);

  /**
   * Der aktuelle Stand in Refs.
   *
   * Das automatische Speichern laeuft aus einem Timer heraus. Ein Timer sieht
   * die Zustaende, die beim Aufsetzen galten -- er wuerde also einen veralteten
   * Entwurf schreiben und die letzten Tastenanschlaege ueberschreiben. Refs
   * zeigen immer auf das Jetzige.
   */
  const entwurfRef = useRef(entwurf);
  const offersRef = useRef(offers);
  const selectedIdRef = useRef(selectedId);
  entwurfRef.current = entwurf;
  offersRef.current = offers;
  selectedIdRef.current = selectedId;

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

  /** Der Abschnitt, der gerade offen steht: der von Hand gewaehlte, sonst der
   *  mit der ersten offenen Pflichtfrage, sonst der erste. */
  const geoeffnet: OfferStageId | null =
    geoeffnetManuell ??
    OFFER_STAGES.find((s) => (s.fields as readonly OfferTextField[]).some((f) => fehlend.includes(f)))?.id ??
    OFFER_STAGES[0].id;

  function setzeFeld<K extends keyof Entwurf>(key: K, value: Entwurf[K]) {
    setEntwurf((v) => ({ ...v, [key]: value }));
  }

  /** Vom Ring zum Feld. Ohne den Sprung wäre die Legende eine Diagnose ohne
   *  Behandlung -- man wüsste, was fehlt, und müsste es selbst suchen. */
  function springeZu(field: OfferTextField) {
    // Erst aufklappen, dann springen: seit die Felder in Abschnitten liegen,
    // zeigt die Legende sonst auf ein Feld, das gar nicht im Dokument steht.
    const stufe = OFFER_STAGES.find((s) => (s.fields as readonly OfferTextField[]).includes(field));
    if (stufe) setGeoeffnetManuell(stufe.id);
    // Ein Bildaufbau spaeter -- vorher gibt es das Element noch nicht.
    requestAnimationFrame(() => {
      const el = document.getElementById(`feld-${field}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
    });
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
    setListenFehler(null);
  }

  /**
   * Angebot wechseln.
   *
   * Ohne Rueckfrage: seit dem automatischen Speichern gibt es nichts
   * Ungesichertes zu verlieren. Steht doch noch etwas aus (der Timer laeuft
   * noch, oder der letzte Versuch ist gescheitert), wird es hier zuerst
   * geschrieben -- eine Rueckfrage waere an dieser Stelle nur die Bitte, ein
   * Problem zu entscheiden, das die App selbst loesen kann.
   */
  function wechsle(id: string) {
    if (geaendert) speichern(true);
    const ziel = offers.find((o) => o.id === id);
    if (!ziel) return;
    setSelectedId(id);
    const next = { ...ziel };
    setEntwurf(next);
    setGespeichert(JSON.stringify(next));
    setVorschlaege({});
    setListenFehler(null);
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

  /**
   * Speichern.
   *
   * `leise` unterdrueckt die Erfolgsmeldung -- das automatische Speichern
   * laeuft alle paar Sekunden, und eine Meldung je Lauf waere ein Dauerfeuer.
   * Fehler melden BEIDE Wege: ein stiller Fehlschlag ist genau das, was hier
   * schiefgehen darf.
   */
  const speichern = useCallback(
    async (leise = false) => {
      const ziel = offersRef.current.find((o) => o.id === selectedIdRef.current);
      const stand = entwurfRef.current;
      if (!ziel) return;
      setSpeichert(true);
      const { error } = await createClient()
        .from("offers")
        .update({ ...stand, updated_at: new Date().toISOString() })
        .eq("id", ziel.id)
        .eq("workspace_id", workspaceId);
      setSpeichert(false);
      if (error) {
        setFehler(true);
        return push(t.common.error + error.message, "error");
      }
      setFehler(false);
      setGespeichert(JSON.stringify(stand));
      setOffers((list) => list.map((o) => (o.id === ziel.id ? { ...o, ...stand } : o)));
      if (!leise) push(t.common.savedOk, "success");
    },
    // t und push sind ueber die Sitzung stabil; workspaceId wechselt nur beim
    // Workspace-Wechsel, und dann wird die ganze Seite ohnehin neu geladen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  );

  /**
   * Automatisches Speichern.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * WARUM NICHT MEHR NUR AUF KNOPFDRUCK
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Gemeldet am 2026-08-13: "Änderungen werden nicht gespeichert -- wenn ich
   * von Deutsch auf Englisch stelle, bleibt es Deutsch." In der Datenbank
   * stand die Sprache richtig; die Aenderung war also angekommen, nur eben
   * erst nach einem Klick auf Speichern.
   *
   * Und genau da liegt der Fehler im Entwurf: ein Schalter, der nach einem
   * Klick eingerastet AUSSIEHT, ist damit auch angewendet. Bei einem Textfeld
   * erwartet man einen Speicherknopf, bei einem Umschalter niemand. Wer
   * danach das Angebot wechselte, bekam eine Rueckfrage, klickte sie weg --
   * und die Umstellung war fort.
   *
   * Zwei Sekunden nach dem letzten Anschlag statt sofort: bei jedem Zeichen
   * zu schreiben waere ein Schreibvorgang je Buchstabe.
   */
  useEffect(() => {
    if (!geaendert || !selectedId) return;
    const id = setTimeout(() => speichern(true), 2000);
    return () => clearTimeout(id);
  }, [geaendert, entwurf, selectedId, speichern]);


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
    setVorschlagQuelle("website");
    setVorschlaege(body.suggestion ?? {});
    push(O.suggestionsReady(Object.keys(body.suggestion ?? {}).length), "success");
  }

  /**
   * Dasselbe Angebot, zugeschnitten auf EINE Lead-Liste.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * WARUM KEIN ZWEITES ANGEBOT MEHR
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Bis zum 2026-08-15 stand das auf der Suchdetailseite und legte beim
   * Speichern eine KOPIE des Standardangebots an. Damit gab es zwei Stellen,
   * an denen Angebote entstehen, und die Kopie wurde nie wieder angefasst --
   * geaendert wurde weiter am Original. Jetzt reichert es das Angebot an, das
   * hier gerade offen steht: derselbe Kasten, dieselben Uebernehmen/Verwerfen-
   * Knoepfe wie beim Website-Vorschlag, und gespeichert wird ueber denselben
   * Weg wie jede andere Aenderung am Angebot.
   *
   * Erst sichern wie bei `pruefen`: die Route liest das Angebot aus der
   * Datenbank, und outcome/mechanism werden aus dem gelesenen Stand
   * umformuliert. Ohne das Sichern arbeitet sie mit dem Stand von vor zwei
   * Sekunden.
   */
  async function ausListe(liste: ListenOption) {
    if (!aktuell || liestListe) return;
    if (geaendert) await speichern(true);
    setLiestListe(liste.id);
    setListenFehler(null);
    setVorschlaege({});
    const res = await fetch("/api/offers/from-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchId: liste.id, offerId: aktuell.id }),
    });
    const body = await res.json().catch(() => ({}));
    setLiestListe(null);
    // Der Fehler bleibt im Kasten stehen, statt als Blase wegzulaufen: die
    // haeufigsten Faelle (kein OpenAI-Schluessel, Suche laeuft noch, keine
    // Firmenbeschreibungen) sagen dem Nutzer, was er tun muss -- das liest
    // niemand in zwei Sekunden.
    if (!res.ok) return setListenFehler((body.error as string) ?? String(res.status));

    const vorschlag = (body.suggestion ?? {}) as OfferSuggestion;
    if (Object.keys(vorschlag).length === 0) return setListenFehler(O.fromSearch.nothing);
    setVorschlagQuelle("search");
    // Derselbe Text, der in der Zeile stand, die gerade angeklickt wurde --
    // sonst hiesse die Liste im Kasten anders als in der Auswahl.
    setListenName(liste.name ?? liste.query ?? null);
    setVorschlaege(vorschlag);
    setListeOffen(false);
    push(O.fromSearch.ready(Object.keys(vorschlag).length), "success");
  }

  /**
   * THAW liest gegen.
   *
   * Ein Aufruf, ein Ergebnis, keine Korrekturrunde -- ein Befund, den das
   * Modell im zweiten Anlauf anders formuliert, ist kein besserer Befund.
   * Eine leere Liste ist ein gutes Ergebnis und wird auch so gemeldet: ein
   * Coach, der immer etwas findet, ist nach zwei Wochen Rauschen.
   */
  async function pruefen() {
    if (!aktuell || coachLaeuft) return;
    // Erst sichern, sonst liest THAW den Stand von vor zwei Sekunden.
    if (geaendert) await speichern(true);
    setCoachLaeuft(true);
    const res = await fetch("/api/copy/offer-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId: aktuell.id }),
    });
    const body = await res.json().catch(() => ({}));
    setCoachLaeuft(false);
    if (!res.ok) return push(t.common.error + (body.error ?? res.status), "error");
    const gefunden = (body.findings ?? []) as CoachFinding[];
    setCoachBefunde(gefunden);
    push(gefunden.length === 0 ? O.coach.clean : O.coach.found(gefunden.length), "success");
  }

  /** Einen Vorschlag von THAW uebernehmen -- und den Befund damit erledigen. */
  function coachUebernehmen(feld: OfferTextField, wert: string) {
    setzeFeld(feld, wert);
    coachVerwerfen(feld);
  }

  function coachVerwerfen(feld: OfferTextField) {
    setCoachBefunde((v) => (v ?? []).filter((c) => c.field !== feld));
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

  /**
   * Woher der Vorschlag kommt -- als Satz, nicht als Farbe.
   *
   * Die Farbe (Frost fuer die Website, --fb-aim fuer die Liste) gehoert zum
   * Kern, der den Vorschlag erzeugt hat, und bleibt. Sie darf die Herkunft aber
   * nicht ALLEIN tragen: eine Farbbedeutung muss man sich merken, und wer die
   * Seite morgen wieder aufmacht, hat sechs Kaesten vor sich und keine Legende.
   * Bei Rot-Gruen-Schwaeche oder in einem Screenreader ist sie ohnehin nicht da.
   * Deshalb steht die Herkunft ausgeschrieben im Kasten -- bei der Liste mit
   * ihrem Namen, weil "aus einer Liste" die Frage nur verschiebt.
   */
  const ausListeQuelle = vorschlagQuelle === "search";
  const vorschlagFarbe = ausListeQuelle ? "var(--fb-aim)" : "var(--fb-frost)";
  const vorschlagLabel = ausListeQuelle
    ? listenName
      ? O.fromSearch.fromList(listenName)
      : O.fromSearch.suggestionLabel
    : O.suggestionLabel;

  /**
   * Was in der Mitte der Karte steht.
   *
   * Alles, was frueher in der Seitenspalte stand, aber ohne die Legende: die
   * zaehlt zwoelf Felder auf, und genau die zwoelf stehen als Knoten drumherum.
   * Zweimal dieselbe Liste ist eine Frage zu viel.
   */
  const hubInhalt = (
    <div className="fb-ticks rounded-2xl border border-edge/60 bg-panel px-4 py-4 shadow-xl">
      <div className="flex flex-col items-center">
        <Thaw
          state={fehlend.length === 0 ? "ready" : gefuellt.size === 0 ? "cold" : "listening"}
          size={96}
        />
        <span
          className="fb-num -mt-1 text-[20px] font-semibold leading-none"
          style={{ color: fehlend.length === 0 ? "var(--fb-ready)" : "var(--fb-frost)" }}
        >
          {prozent}%
        </span>
        <p className="mt-2 min-h-8 text-center text-[12.5px] leading-[1.4] text-soft">
          {fehlend.length === 0
            ? gefuellt.size === OFFER_TEXT_FIELDS.length
              ? O.sayComplete
              : O.sayReady
            : gefuellt.size === 0
              ? O.sayCold
              : O.sayMissing(O.fields[fehlend[0]].label)}
        </p>
      </div>

      <button
        onClick={pruefen}
        disabled={coachLaeuft || gefuellt.size === 0}
        className="relative mt-2 min-h-10 w-full overflow-hidden rounded-lg border text-[13.5px] font-medium transition-all hover:brightness-110 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        style={{
          borderColor: "color-mix(in srgb, var(--fb-frost) 45%, transparent)",
          color: "var(--fb-frost)",
          background: "color-mix(in srgb, var(--fb-frost) 8%, transparent)",
        }}
      >
        {coachLaeuft && <span className="fb-scan" aria-hidden />}
        <span className="relative">{coachLaeuft ? O.coach.running : O.coach.run}</span>
      </button>

      {coachBefunde !== null && !coachLaeuft && (
        <p className="fb-open mt-1.5 text-center text-[12px] leading-snug text-soft">
          {coachBefunde.length === 0 ? O.coach.clean : O.coach.found(coachBefunde.length)}
        </p>
      )}

      {fehlend.length === 0 && (
        <Link
          href="/instantly/campaigns/new"
          className="mt-2 flex min-h-10 w-full items-center justify-center rounded-lg border text-[13.5px] font-medium transition-all hover:brightness-110"
          style={{
            borderColor: "color-mix(in srgb, var(--fb-ready) 50%, transparent)",
            color: "var(--fb-ready)",
            background: "color-mix(in srgb, var(--fb-ready) 9%, transparent)",
          }}
        >
          {O.toCampaign}
        </Link>
      )}

      <p className="mt-2 text-center text-[11px] text-mute">
        {fehler ? O.saveState.failed : speichert || geaendert ? O.saveState.saving : O.saveState.saved}
      </p>
    </div>
  );

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
        // Breit: die Karte bekommt die GANZE Breite und THAW steht in ihrer
        // Mitte. Am Live-Bild geprueft: neben der 340 Pixel breiten
        // Statusspalte blieben je Kartenspalte 250 Pixel, und darin brach jede
        // Frage auf vier Zeilen um -- die Karte war schmaler als das Formular,
        // das sie ersetzen sollte.
        <div className={breit ? "space-y-5" : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"}>
          <div className={breit ? "grid gap-5 lg:grid-cols-2" : "min-w-0 space-y-5"}>
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
                {/* Zeilenlaenge gedeckelt: seit die Seite 1408 statt 1024
                    Pixel breit ist, sind diese beiden Karten 664 statt 502
                    breit, und der Hinweis lief auf rund 85 Zeichen je Zeile.
                    Lesbar sind 60 bis 75. */}
                <p className="mt-1.5 max-w-[54ch] text-[13px] leading-relaxed text-mute">{O.signatureHint}</p>
              </div>
            </Karte>

            <Karte label={O.websiteHeading}>
              {/* 14 Pixel wie im Listen-Kasten daneben: die beiden Karten tun
                  dasselbe und muessen sich gleich lesen. Die uebrigen
                  Unterzeilen der Seite bleiben bei 13 -- die stehen an
                  Eingabefeldern und nicht an einem Handgriff. */}
              <p className="mb-3 text-[14px] leading-relaxed text-soft">{O.websiteSubtitle}</p>
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
              {/* text-faint statt text-mute: --c-mute liegt auf Weiss bei 2,4:1
                  und ist damit fuer Platzhalter gedacht, nicht fuer einen Satz,
                  der erklaert, was gleich mit den Feldern passiert. text-faint
                  sind 4,5:1. Gilt hier und im Listen-Kasten -- die uebrigen
                  Hinweise der Seite stehen noch auf text-mute. */}
              <p className="mt-2 max-w-[54ch] text-[13px] leading-relaxed text-faint">{O.websiteHint}</p>
            </Karte>

            {/* ── Der zweite Kern ──────────────────────────────────────
                Direkt neben dem Website-Kasten, weil beide dasselbe tun: sie
                schlagen Felder vor, die man einzeln uebernimmt. Der
                Unterschied steht im Material -- die Website sagt, was DU
                verkaufst, die Lead-Liste, an WEN. Deshalb ein eigener Kern in
                eigener Farbe (--fb-aim) und nicht ein zweiter Knopf im
                Website-Kasten: zwei Knoepfe nebeneinander waeren zwei
                Fassungen desselben Handgriffs. */}
            <Karte label={O.fromSearch.heading}>
              <div className="flex items-start gap-4">
                <button
                  type="button"
                  onClick={() => setListeOffen((v) => !v)}
                  disabled={!!liestListe}
                  aria-expanded={listeOffen}
                  aria-label={O.fromSearch.open}
                  className="-m-1 shrink-0 rounded-full p-1 transition-transform hover:scale-105 disabled:cursor-wait focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  {/* "working" nur waehrend des Aufrufs: der Kern rast dann
                      durch seine Bahnen und ist die Wartezeitanzeige. Sonst
                      "listening" -- er wartet auf die Liste, nicht auf das
                      Angebot, und darf deshalb nie "ready" zeigen. */}
                  <Thaw
                    state={liestListe ? "working" : "listening"}
                    size={64}
                    accent="var(--fb-aim)"
                  />
                </button>
                <div className="min-w-0 flex-1">
                  {/* Eine Stufe groesser als die Karten-Unterzeilen sonst
                      (13 Pixel): dieser Absatz ist nicht der Nachsatz zu einem
                      Eingabefeld, sondern die einzige Erklaerung dessen, was
                      der Knopf daneben tut. */}
                  <p className="max-w-[54ch] text-[14px] leading-relaxed text-soft">
                    {O.fromSearch.subtitle}
                  </p>
                  {!listeOffen && (
                    <button
                      type="button"
                      onClick={() => setListeOffen(true)}
                      disabled={!!liestListe}
                      className="mt-2.5 min-h-9 rounded-lg border px-4 text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                      style={{
                        borderColor: "color-mix(in srgb, var(--fb-aim) 45%, transparent)",
                        color: "var(--fb-aim)",
                        background: "color-mix(in srgb, var(--fb-aim) 8%, transparent)",
                      }}
                    >
                      {liestListe ? O.fromSearch.reading : O.fromSearch.open}
                    </button>
                  )}

                  {listeOffen && (
                    <div className="mt-3">
                      {/* Kein fb-label: das ist eine Frage an den Nutzer und
                          kein Instrumentenschild. Gesetzt wie die anderen
                          Fragen dieser Seite ("Wie sprichst du an?"). */}
                      <p className="mb-2 text-[13px] text-faint">{O.fromSearch.pickHeading}</p>
                      <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-edge2 bg-field p-2">
                        {listen === null && (
                          <p className="px-2 py-2 text-[14px] text-mute">{O.fromSearch.loading}</p>
                        )}
                        {/* text-faint, nicht text-mute: „Lädt..." ist ein
                            Platzhalter und darf blass sein, „noch keine Liste"
                            ist die Antwort auf die gestellte Frage. */}
                        {listen?.length === 0 && (
                          <p className="px-2 py-2 text-[14px] text-faint">
                            {O.fromSearch.noSearches}
                          </p>
                        )}
                        {(listen ?? []).map((s) => {
                          // Dieselbe Bedingung, mit der die Route ablehnt
                          // (409): eine laufende Suche hat ihre
                          // Firmenbeschreibungen noch nicht vollstaendig.
                          const laeuft = s.status === "pending" || s.status === "running";
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => void ausListe(s)}
                              disabled={laeuft || !!liestListe}
                              className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[14px] text-ink transition-colors hover:bg-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:text-mute disabled:hover:bg-transparent"
                            >
                              <span className="min-w-0 flex-1 truncate">{s.name ?? s.query}</span>
                              {s.location && (
                                <span className="shrink-0 text-[13px] text-mute">{s.location}</span>
                              )}
                              {laeuft && (
                                <span className="shrink-0 text-[13px] text-mute">
                                  {O.fromSearch.running}
                                </span>
                              )}
                              {liestListe === s.id && (
                                <span
                                  className="shrink-0 text-[13px] font-medium"
                                  style={{ color: "var(--fb-aim)" }}
                                >
                                  {O.fromSearch.reading}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => setListeOffen(false)}
                        className="mt-2 min-h-8 rounded text-[13px] text-faint transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                      >
                        {O.cancel}
                      </button>
                    </div>
                  )}

                  {listenFehler && (
                    <p
                      role="alert"
                      className="mt-3 max-w-[54ch] text-[14px] leading-relaxed"
                      style={{ color: "var(--fb-warn)" }}
                    >
                      {listenFehler}
                    </p>
                  )}
                </div>
              </div>
              <p className="mt-3 max-w-[54ch] text-[13px] leading-relaxed text-faint">
                {O.fromSearch.hint}
              </p>
            </Karte>

            {!breit && (
            <>
            {/* ── Die vier Stufen ───────────────────────────────────────
                Zwoelf Textfelder untereinander waren eine Wand: man scrollt an
                Feld vier vorbei und weiss nicht mehr, worauf das Ganze
                hinauslaeuft. Die Stufen sind nicht erfunden, sie sind der
                Aufbau der ersten Mail -- wer an wen, woran haengt der Leser,
                was hat er davon, worum wird er gebeten.

                Die Linie links verbindet sie zu einem Weg statt zu vier
                Kaesten. Offen ist immer genau eine: die mit der naechsten
                offenen Pflichtfrage. */}
            <div className="relative">
              {/* Die Linie MUSS durch die Knotenmitte laufen, sonst laeuft sie
                  daneben und verbindet nichts. Die Mitte liegt bei 36 Pixeln:
                  16 Pixel Innenabstand des Kopfes (px-4) plus der halbe Knoten
                  (40/2). Am Bild geprueft -- bei 19 lag sie links daneben. */}
              <div
                aria-hidden
                className="pointer-events-none absolute bottom-8 left-[35px] top-8 w-px"
                style={{
                  background:
                    "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--fb-frost) 30%, transparent) 12%, color-mix(in srgb, var(--fb-frost) 30%, transparent) 88%, transparent)",
                }}
              />
              <div className="space-y-3">
                {OFFER_STAGES.map((stufe) => {
                  const felder = stufe.fields as readonly OfferTextField[];
                  const voll = felder.filter((f) => entwurf[f].trim().length > 0).length;
                  const offeneStufe = stufe.id === geoeffnet;
                  const fehltHier = felder.some((f) => fehlend.includes(f));
                  const farbe = fehltHier
                    ? "var(--fb-frost)"
                    : voll === felder.length
                      ? "var(--fb-ready)"
                      : "var(--color-edge3)";
                  return (
                    <section
                      key={stufe.id}
                      className="fb-ticks relative rounded-xl border border-edge/60 bg-panel"
                    >
                      <button
                        type="button"
                        onClick={() => setGeoeffnetManuell(offeneStufe ? null : stufe.id)}
                        aria-expanded={offeneStufe}
                        className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
                      >
                        {/* Der Knoten. Er traegt drei Aussagen auf einmal:
                            wievielter Abschnitt, wie voll, und ob hier noch
                            eine Pflichtfrage offen ist. */}
                        <span
                          aria-hidden
                          className="fb-num relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-panel text-[13px] font-semibold transition-colors"
                          style={{ borderColor: farbe, color: farbe }}
                        >
                          {voll}/{felder.length}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium text-ink">
                            {O.stages[stufe.id].label}
                          </span>
                          <span className="mt-0.5 block text-[13px] leading-relaxed text-faint">
                            {O.stages[stufe.id].hint}
                          </span>
                        </span>
                        <span
                          aria-hidden
                          className="shrink-0 text-mute transition-transform duration-200"
                          style={{ transform: offeneStufe ? "rotate(90deg)" : "none" }}
                        >
                          ›
                        </span>
                      </button>

                      {offeneStufe && (
                        <div className="space-y-5 border-t border-edge/60 px-4 pb-5 pt-4">
                          {felder.map((key) => {
                            const pflicht = REQUIRED_FOR_GENERATION.includes(key);
                            const offen = fehlend.includes(key);
                            return (
                              <div key={key}>
                                <div className="mb-1 flex items-baseline gap-2">
                                  {/* Die Nummer ist keine Zierde: die zwoelf
                                      Felder sind eine Reihenfolge, und genau so
                                      ist auch die Legende am Ring sortiert. */}
                                  <span className="fb-num shrink-0 text-[11px] text-mute">
                                    {String(fieldNumber(key)).padStart(2, "0")}
                                  </span>
                                  <label htmlFor={`feld-${key}`} className="text-[15px] font-medium text-ink">
                                    {O.fields[key].label}
                                  </label>
                                  {/* Pflicht nur fuers Erzeugen, nicht fuers
                                      Speichern: ein halb ausgefuelltes Angebot
                                      muss sicherbar sein. */}
                                  {pflicht && offen && (
                                    <span className="fb-label" style={{ color: "var(--fb-frost)" }}>
                                      {O.neededForGeneration}
                                    </span>
                                  )}
                                </div>
                                <p className="mb-2 pl-6 text-[13px] leading-relaxed text-faint">
                                  {O.fields[key].hint}
                                </p>
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
                        {/* Der Vorschlag steht so gross wie das Feld darueber
                            (15 Pixel): er IST der Text, der gleich im Feld
                            stehen koennte, und wer zwischen zwei Fassungen
                            waehlt, muss beide gleich gut lesen koennen. Auf
                            13,5 Pixeln las er sich wie eine Fussnote zum
                            eigenen Text. */}
                        {vorschlaege[key] && (
                          <div
                            className="lock-pop mt-2 rounded-lg border-l-2 px-3.5 py-3"
                            style={{
                              borderColor: vorschlagFarbe,
                              background: `color-mix(in srgb, ${vorschlagFarbe} 7%, transparent)`,
                            }}
                          >
                            <Herkunft farbe={vorschlagFarbe} label={vorschlagLabel} />
                            <p className="text-[15px] leading-relaxed text-ink">{vorschlaege[key]}</p>
                            <div className="mt-2.5 flex items-center gap-4 text-[13px]">
                              <button
                                type="button"
                                onClick={() => uebernehmen(key)}
                                className="min-h-8 rounded font-medium transition-opacity hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                                style={{ color: vorschlagFarbe }}
                              >
                                {O.applySuggestion}
                              </button>
                              <button
                                type="button"
                                onClick={() => verwerfen(key)}
                                className="min-h-8 rounded text-faint transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                              >
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
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
            </>
            )}
          </div>


          {/* Die Karte, ueber die ganze Breite. THAW steht in ihrer Mitte
              statt in einer Spalte am Rand: er liest das Ganze. */}
          {breit && (
              <OfferMap
                werte={entwurf}
                fehlend={fehlend}
                befunde={Object.fromEntries(
                  [...befunde.entries()].map(([feld, liste]) => [feld, findingText(liste[0], O.findings)])
                )}
                coach={coachBefunde ?? []}
                vorschlaege={vorschlaege}
                onChange={setzeFeld}
                onApply={coachUebernehmen}
                onDismiss={coachVerwerfen}
                onApplySuggestion={uebernehmen}
                onDiscardSuggestion={verwerfen}
                texte={{
                  stages: O.stages,
                  fields: O.fields,
                  edges: O.edges,
                  neededForGeneration: O.neededForGeneration,
                  optional: O.optional,
                  suggestion: {
                    label: vorschlagLabel,
                    farbe: vorschlagFarbe,
                    apply: O.applySuggestion,
                    discard: O.discardSuggestion,
                  },
                  coach: {
                    verdictLabel: O.coach.verdictLabel,
                    apply: O.coach.apply,
                    dismiss: O.coach.dismiss,
                    related: O.coach.related,
                  },
                }}
                hub={hubInhalt}
              />
          )}

          {/* ── Rechts: was daraus folgt ───────────────────────────────
              Nur in der schmalen Ansicht. Breit steht dasselbe in der Mitte
              der Karte -- zweimal derselbe Messwert waere eine Frage zu viel
              ("welcher gilt jetzt?"). */}
          {!breit && (
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

                {/* THAWs Knopf steht direkt unter ihm, nicht bei den anderen:
                    er ist der einzige auf dieser Seite, der etwas LIEST statt
                    etwas zu speichern oder weiterzugehen. */}
                <div className="mt-4 border-t border-edge/60 pt-4">
                  <button
                    onClick={pruefen}
                    disabled={coachLaeuft || gefuellt.size === 0}
                    className="relative min-h-10 w-full overflow-hidden rounded-lg border text-[13.5px] font-medium transition-all hover:brightness-110 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    style={{
                      borderColor: "color-mix(in srgb, var(--fb-frost) 45%, transparent)",
                      color: "var(--fb-frost)",
                      background: "color-mix(in srgb, var(--fb-frost) 8%, transparent)",
                    }}
                  >
                    {coachLaeuft && <span className="fb-scan" aria-hidden />}
                    <span className="relative">{coachLaeuft ? O.coach.running : O.coach.run}</span>
                  </button>
                  {coachBefunde !== null && !coachLaeuft && (
                    <p className="fb-open mt-2 text-center text-[12.5px] leading-relaxed text-soft">
                      {coachBefunde.length === 0 ? O.coach.clean : O.coach.found(coachBefunde.length)}
                    </p>
                  )}
                  {coachBefunde === null && !coachLaeuft && (
                    <p className="mt-2 text-center text-[12px] leading-relaxed text-mute">{O.coach.hint}</p>
                  )}
                </div>

                <div className="mt-4 space-y-2 border-t border-edge/60 pt-4">
                  {/* Kein Speicherknopf mehr, sondern eine Anzeige.
                      Der Knopf war die Ursache des gemeldeten Fehlers: ein
                      Umschalter, der eingerastet AUSSAH, war es erst nach
                      einem Klick woanders. Anklickbar bleibt die Anzeige nur
                      fuer den Fall, dass ein Speichern fehlgeschlagen ist --
                      dann braucht es einen zweiten Versuch von Hand. */}
                  <button
                    onClick={() => speichern()}
                    disabled={speichert || (!geaendert && !fehler)}
                    aria-live="polite"
                    className={
                      "flex min-h-9 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-medium transition-colors " +
                      (fehler
                        ? "border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400"
                        : "text-mute")
                    }
                  >
                    <span
                      aria-hidden
                      className={"h-1.5 w-1.5 rounded-full " + (speichert ? "fb-breathe" : "")}
                      style={{
                        background: fehler
                          ? "currentColor"
                          : speichert
                            ? "var(--fb-frost)"
                            : "var(--fb-ready)",
                      }}
                    />
                    {fehler
                      ? O.saveState.failed
                      : speichert || geaendert
                        ? O.saveState.saving
                        : O.saveState.saved}
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
          )}
        </div>
      )}
    </div>
  );
}
