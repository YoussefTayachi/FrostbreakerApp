"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { inputCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import type {
  IcebreakerState,
  ReviewKind,
  ReviewState,
  ReviewSummary,
  ReviewVerdict,
} from "@/lib/personalization/review";

/**
 * Die 766 markierten Aufhaenger abarbeiten, ohne 766 Klicks.
 *
 * DIE DREI HANDGRIFFE, UND WARUM ES GENAU DIESE SIND
 *
 *   Sammelaktion: die veralteten Markierungen in einem Zug abraeumen. Nach
 *                 der Bindestrich-Korrektur vom 2026-08-02 ist der
 *                 Grossteil davon gegenstandslos; die einzeln
 *                 wegzuklicken waere Beschaeftigung, keine Arbeit.
 *   Neu erzeugen: der Regelfall bei "zu lang". Kostet einen Modellaufruf,
 *                 deshalb auswaehlbar und nicht automatisch.
 *   Selbst schreiben: die Antwort auf "das Modell kriegt es nicht hin".
 *
 * Bewusst NICHT gebaut: ein automatisches Kuerzen. Ein Aufhaenger, den ein
 * Programm auf 22 Woerter stutzt, endet mitten im Gedanken, und geht dann
 * genau so an einen Fremden raus.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ZWEI TEXTSORTEN, EINE LISTE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Seit dem 2026-08-24 haengt oben eine Umschaltung zwischen Aufhaenger und
 * Website-Befund (Migration 0103). KEINE zweite Seite, und das ist eine
 * Entscheidung, keine Bequemlichkeit: es ist dieselbe Arbeit an derselben
 * Sorte Text, mit denselben drei Handgriffen. Zwei Seiten wuerden bei der
 * naechsten Aenderung an einer Stelle nachgezogen und an der anderen
 * vergessen; genau diese Begruendung steht auch bei ReviewKind in
 * lib/personalization/review.ts, wo dieselbe Doppelung fuer die Bewertung
 * vermieden wurde.
 */
type ReviewResponse = {
  kind: ReviewKind;
  settings: { maxWords: number; bannedWords: string[] };
  summary: ReviewSummary;
  items: ReviewVerdict[];
  truncated: boolean;
};

const KINDS: ReviewKind[] = ["icebreaker", "finding"];
const STATES: IcebreakerState[] = ["failing", "stale", "clean"];

/** Takt der Nachfrage, waehrend Neuerzeugungen laufen. Ein Modellaufruf
 *  braucht ueblicherweise zwei bis fuenf Sekunden. */
const POLL_MS = 4000;
/** Nach so vielen Durchlaeufen (= 4 Minuten) wird aufgegeben. Ohne Grenze
 *  bliebe eine Zeile, die der Worker nie anfasst (etwa weil das
 *  OpenAI-Guthaben leer ist) fuer immer als "wird erzeugt" stehen. */
const POLL_LIMIT = 60;

/**
 * "empty" ist BEWUSST unauffaellig: kein Rot, kein Gelb, dieselbe Farbe wie
 * ein Chip ohne Aussage.
 *
 * Ein Lead ohne Website-Befund ist kein Mangel, sondern ein haeufiges,
 * richtiges Ergebnis (keine Website, Seite nicht erreichbar, keine der acht
 * Pruefungen schlaegt an, siehe worker/pipelines/website_finding.py). Ihn wie
 * einen Fehler zu faerben hiesse, jemanden auf eine Zeile zu ziehen, an der
 * es nichts zu tun gibt.
 *
 * Aus der Liste kommt dieser Zustand heute nicht: leere Texte filtert
 * reviewTexts vorher weg, und warum das richtig ist, steht dort. Er steht
 * trotzdem hier, weil eine einzelne Zeile ihn liefern kann (reviewText) und
 * weil eine unvollstaendige Tabelle beim naechsten Mal an dieser Stelle
 * abstuerzt. Beim Aufhaenger kommt "empty" gar nicht vor.
 */
const STATE_CLS: Record<ReviewState, string> = {
  failing: "border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400",
  stale: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-500",
  clean: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  empty: "border-edge2 bg-chip text-soft",
};

export default function IcebreakerReview() {
  const { t, lang } = useT();
  const R = t.icebreakerReview;
  const { push } = useToast();

  const [kind, setKind] = useState<ReviewKind>("icebreaker");
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<IcebreakerState | "all">("failing");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /**
   * Zeilen, deren Neuerzeugung eingereiht ist, mit ihrem Text VON VORHER.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * WARUM ES DIESEN ZUSTAND BRAUCHT
   * ═══════════════════════════════════════════════════════════════════════
   *
   * "Neu erzeugen" reiht einen Job ein, den ein Worker ein paar Sekunden
   * spaeter abarbeitet. Die Liste lud aber SOFORT nach dem Klick neu, also
   * zu einem Zeitpunkt, an dem noch der alte Text in der Datenbank stand.
   * Sichtbar aenderte sich nichts, und ein erfolgreicher Klick sah aus wie
   * ein wirkungsloser. Genau so wurde es auch gemeldet.
   *
   * Der alte Text ist die Abbruchbedingung: sobald ein anderer dasteht, ist
   * der Job durch. Das ist verlaesslicher als den Job-Status abzufragen:
   * die Zeile zeigt dann garantiert schon das Ergebnis und nicht nur ein
   * "fertig", dem die Anzeige noch hinterherhinkt.
   */
  const [pending, setPending] = useState<Map<string, string>>(new Map());
  /**
   * Das Laden ist gescheitert, und die Liste braucht deshalb einen Ausgang.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * WARUM DER TOAST NICHT REICHT
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Ohne diesen Zustand kehrte `load` bei einer Fehlerantwort einfach zurueck,
   * ohne `setData` anzufassen. `data` blieb dann die Antwort der ALTEN
   * Textsorte, `current` also dauerhaft null (siehe die Pruefung
   * data.kind === kind weiter unten) -- und damit stand die Ansicht
   * unbegrenzt im Skelettzustand. Eine Sackgasse: der Toast ist nach drei
   * Sekunden weg, die Seite bleibt kaputt, und es gibt keinen Handgriff, der
   * es nochmal versucht.
   *
   * Am wahrscheinlichsten beim Umschalten der Textsorte, weil dort ohnehin
   * neu geladen wird.
   */
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Beim (Wieder-)Versuch zurueck auf Anfang: sonst stuende die Meldung
    // neben der frisch geladenen Liste.
    setLoadFailed(false);
    try {
      const res = await fetch(`/api/personalization/review?lang=${lang}&kind=${kind}`);
      const body = await res.json();
      if (!res.ok) {
        push(t.common.error + (body.error ?? res.status), "error");
        setLoadFailed(true);
        return;
      }
      setData(body);
      setSelected(new Set());
    } catch (e) {
      // Abgerissene Verbindung oder eine Antwort, die kein JSON ist: dieselbe
      // Sackgasse wie eine Fehlerantwort, also derselbe Ausgang. Ohne dieses
      // catch waere es zusaetzlich eine unbehandelte Promise-Ablehnung, weil
      // `load` auch aus dem Takt der Fortschrittsanzeige heraus laeuft.
      push(t.common.error + (e instanceof Error ? e.message : String(e)), "error");
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [lang, kind, push, t.common.error]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Die Textsorte wechseln, und zwar SOFORT alles mit, was an der alten hing.
   *
   * Das ist die Stelle, an der so etwas kaputtgeht. `load` raeumt die Auswahl
   * zwar auch auf, aber erst wenn die Antwort da ist; bis dahin steht die alte
   * Liste noch auf dem Schirm, samt Sammelaktionsleiste. Ein Klick darauf
   * wuerde Zeilen der ANDEREN Textsorte treffen: "3 neu erzeugen" haette dann
   * drei Aufhaenger neu erzeugt, waehrend die Ueberschrift Website-Befund
   * sagt, und das sind drei bezahlte Modellaufrufe.
   *
   * Aus demselben Grund gehen Entwurf und Fortschrittsanzeige mit: ein
   * angefangener Text gehoert zu einer Zeile der alten Sorte, und die
   * Fortschrittsanzeige vergleicht ihn mit Texten, die es hier nicht gibt. Die
   * eingereihten Jobs laufen im Worker weiter; das Ergebnis steht beim
   * Zurueckwechseln einfach da.
   *
   * Der Filter faellt auf "failing" zurueck statt mitzuwandern: die Chips sind
   * je Textsorte verschieden besetzt, und ein aktiver Chip mit 0 Treffern
   * sieht aus wie eine leere Liste.
   */
  /**
   * Die Leiste per Pfeiltaste bedienen.
   *
   * role=tablist verspricht genau das: EIN Tabulatorhalt fuer die Gruppe, der
   * Wechsel danach mit den Pfeiltasten. Ohne diesen Griff waere die Rolle eine
   * Behauptung, und wer sich auf sie verlaesst, kaeme mit der Tastatur nicht
   * mehr auf die zweite Schaltflaeche (tabIndex={-1}).
   *
   * Der Fokus wandert mit dem gewaehlten Reiter: der alte faellt im selben
   * Rendern aus dem Tabulator-Fluss.
   */
  const tabsRef = useRef<HTMLDivElement>(null);
  function onTabKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // Dieselbe Sperre wie am disabled-Attribut der Knoepfe: waehrend einer
    // laufenden Aktion darf auch die Tastatur die Textsorte nicht wechseln.
    if (busy) return;
    e.preventDefault();
    const i = KINDS.indexOf(kind);
    const next = KINDS[(i + (e.key === "ArrowRight" ? 1 : KINDS.length - 1)) % KINDS.length];
    switchKind(next);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-kind="${next}"]`)?.focus();
  }

  function switchKind(next: ReviewKind) {
    if (next === kind) return;
    setKind(next);
    setSelected(new Set());
    setEditing(null);
    setDraft("");
    setPending(new Map());
    setFilter("failing");
  }

  /**
   * Solange etwas eingereiht ist, alle paar Sekunden nachsehen.
   *
   * Vier Sekunden, weil ein Modellaufruf ueblicherweise zwei bis fuenf
   * braucht: haeufiger fragen belastet nur, seltener fuehlt sich haengend an.
   * Der Takt endet von selbst, sobald die letzte Zeile einen neuen Text
   * traegt; kein Zaehler, kein Zeitlimit, das man raten muesste.
   *
   * Zeilen, die der Worker gar nicht anfasst (kein OpenAI-Guthaben, Firma
   * ohne Datenbasis), blieben so allerdings ewig als "wird erzeugt" stehen.
   * Deshalb doch eine Obergrenze: nach POLL_LIMIT Durchlaeufen wird die
   * Markierung geraeumt und die Zeile zeigt wieder ihren echten Zustand.
   */
  useEffect(() => {
    if (pending.size === 0) return;
    let rounds = 0;
    const timer = setInterval(async () => {
      rounds += 1;
      if (rounds > POLL_LIMIT) {
        setPending(new Map());
        push(R.regenerateTimeout, "error");
        return;
      }
      await load();
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.size === 0]);

  // Fertig ist, wessen Text sich geaendert hat. Laeuft nach jedem Laden.
  useEffect(() => {
    if (!data || pending.size === 0) return;
    const byId = new Map(data.items.map((v) => [v.id, v.text]));
    setPending((prev) => {
      const next = new Map(prev);
      for (const [id, before] of prev) {
        const now = byId.get(id);
        // Verschwundene Zeile (Suche geloescht) ebenfalls raeumen.
        if (now === undefined || now !== before) next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [data]);

  /**
   * Nach jeder Aktion neu laden statt lokal nachzupflegen.
   *
   * Der Zustand einer Zeile haengt an den Vorgaben des Workspaces, und die
   * koennen sich in einem anderen Tab geaendert haben. Eine Liste, die aus
   * dem Ergebnis der eigenen Klicks weitergerechnet wird, driftet dabei
   * langsam von der Wahrheit weg, und zwar genau in der Ansicht, deren
   * einziger Zweck es ist, die Wahrheit zu zeigen.
   */
  async function act(body: Record<string, unknown>, done: (n: number) => void) {
    setBusy(true);
    try {
      const res = await fetch("/api/personalization/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, lang, kind }),
      });
      const result = await res.json();
      if (!res.ok) {
        // Fehlt die Datenbankfunktion, steht in result.error bereits ein
        // ganzer Satz mit dem Namen der Migration (lib/personalization/
        // requeue.ts). Ihn nicht zu ueberschreiben ist der ganze Sinn dieser
        // Meldung: der Klick war richtig, es fehlt ein Stueck Einrichtung.
        push(t.common.error + (result.error ?? res.status), "error");
        return;
      }
      done(result.queued ?? result.accepted ?? 0);
      // Eingereihte Neuerzeugungen merken, BEVOR neu geladen wird: der
      // alte Text ist danach nicht mehr zu haben.
      if (Array.isArray(result.ids) && result.ids.length > 0 && data) {
        const byId = new Map(data.items.map((v) => [v.id, v.text]));
        setPending((prev) => {
          const next = new Map(prev);
          for (const id of result.ids as string[]) {
            const before = byId.get(id);
            if (before !== undefined) next.set(id, before);
          }
          return next;
        });
      }
      if (typeof result.alreadyExported === "number" && result.alreadyExported > 0) {
        push(R.alreadyExportedWarning(result.alreadyExported), "error");
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/personalization/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text: draft, lang, kind }),
      });
      const result = await res.json();
      if (!res.ok) {
        push(t.common.error + (result.error ?? res.status), "error");
        return;
      }
      // Ehrlich melden, wenn der eigene Text die Vorgaben auch nicht haelt;
      // sonst verschwindet die Zeile scheinbar und taucht beim Neuladen wieder auf.
      push(result.problems?.length ? R.savedWithProblems : R.saved, result.problems?.length ? "error" : "success");
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Die Antwort gehoert zur gerade gewaehlten Textsorte, oder sie zaehlt nicht.
   *
   * Zwischen dem Klick auf die Umschaltung und der Antwort steht noch die alte
   * Liste im Zustand. Sie unter der neuen Ueberschrift weiter anzuzeigen waere
   * die zweite Haelfte desselben Fehlers, gegen den switchKind die Auswahl
   * raeumt: die Zeilen darunter waeren die der anderen Sorte. Die Antwort sagt
   * selbst, wofuer sie gilt (Feld `kind` der Route), also wird genau das
   * geprueft statt es an einem zweiten Zustand mitzufuehren.
   */
  const current = data && data.kind === kind ? data : null;

  const visible = useMemo(
    () => (current?.items ?? []).filter((v) => filter === "all" || v.state === filter),
    [current, filter]
  );

  // Auswaehlbar sind nur die sichtbaren: eine Sammelaktion darf nichts
  // anfassen, was gerade nicht auf dem Schirm steht.
  const selectedVisible = visible.filter((v) => selected.has(v.id));
  // Was "Alle neu erzeugen" treffen wuerde: genau die Menge hinter dem
  // aktiven Chip. Der Server rechnet sie noch einmal selbst nach; diese Zahl
  // ist nur die Ansage im Knopf und in der Rueckfrage.
  const visibleCount = visible.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const summary = current?.summary;
  const isFinding = kind === "finding";

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        {/* Die Umschaltung steht auf der Hoehe der Ueberschrift, nicht ueber den
            Chips.
            Das ist kein Geschmack, sondern die Rangfolge: Untertitel, Erklaerung
            und Vorgaben-Hinweis darunter gehoeren ALLE der gewaehlten Textsorte
            und aendern sich mit ihr. Stand die Umschaltung darunter, las man
            erst drei Saetze und fand danach den Schalter, der sie umschreibt.
            Auf Kopfhoehe ist auf einen Blick klar, dass sie ueber allem steht --
            und zwischen ihr und den Zustands-Chips liegt jetzt ein Absatz Text
            statt einer zweiten Knopfreihe. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{R.title}</h1>
          <div
            ref={tabsRef}
            role="tablist"
            aria-label={R.kindSwitchLabel}
            onKeyDown={onTabKey}
            /* bg-chip/bg-panel getauscht statt gespiegelt: die gewaehlte
               Flaeche muss in BEIDEN Themes die hellere von beiden sein. Im
               Dunklen war sie mit bg-panel (#131315) auf bg-chip (#202023) die
               dunklere und las sich als Loch statt als Auswahl. */
            className="flex gap-1 rounded-lg border border-edge2 bg-chip p-1 dark:bg-panel"
          >
            {KINDS.map((k) => (
              <button
                key={k}
                role="tab"
                data-kind={k}
                aria-selected={kind === k}
                /* Genau ein Tabulatorhalt fuer die ganze Gruppe, danach
                   Pfeiltasten -- so verlangt es role=tablist, und so kostet die
                   Leiste den Tastaturweg nicht zweimal. */
                tabIndex={kind === k ? 0 : -1}
                onClick={() => switchKind(k)}
                disabled={busy}
                className={
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 " +
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 " +
                  (kind === k ? "bg-panel shadow-sm text-ink dark:bg-chip" : "text-soft hover:text-ink")
                }
              >
                {R.kinds[k]}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-sm text-faint">{isFinding ? R.findingSubtitle : R.subtitle}</p>
        {/* text-faint statt text-mute: das sind erklaerende Saetze und keine
            Platzhalter. text-mute liegt auf Weiss bei 2,4:1. */}
        <p className="mt-2 text-xs text-faint">{R.explainer}</p>
        {current && (
          <p className="mt-1 text-xs text-faint">
            {/* Beim Befund steht dort eine FESTE Zahl und keine Einstellung
                (Migration 0103, Abschnitt 4). Derselbe Hinweistext waere hier
                eine falsche Auskunft: er verspricht, dass sich die Zahl unter
                "Vorgaben aendern" aendern liesse. */}
            {isFinding
              ? R.findingSettingsHint(current.settings.maxWords, current.settings.bannedWords.join(" "))
              : R.settingsHint(current.settings.maxWords, current.settings.bannedWords.join(" "))}{" "}
            <Link href="/ai-agent" className="text-sky-600 hover:underline dark:text-sky-400">
              {R.settingsLink}
            </Link>
          </p>
        )}
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-2">
          {/* "Alle" als eigener Chip: den Zustand gab es intern schon, aber
              man erreichte ihn nur, indem man den aktiven Chip ein zweites
              Mal klickte, also durch Ausprobieren. */}
          <button
            onClick={() => setFilter("all")}
            className={
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
              (filter === "all"
                ? "border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
            }
          >
            {R.states.all}
            <span className="tabular-nums">{summary.total}</span>
          </button>
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? "all" : s)}
              disabled={summary[s] === 0}
              className={
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 " +
                (filter === s ? STATE_CLS[s] : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
              }
            >
              {R.states[s]}
              <span className="tabular-nums">{summary[s]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Warum in dieser Liste weniger Leads stehen, als der Workspace hat.
          Ohne den Satz sieht eine kurze Liste nach einem Fehler aus, dabei ist
          "kein Befund" das haeufigste Ergebnis des Website-Checks. */}
      {isFinding && <p className="text-xs leading-relaxed text-faint">{R.findingNoneHint}</p>}

      {/* Fortschritt, solange etwas laeuft. Ohne diese Zeile sah ein
          erfolgreicher Klick aus wie ein wirkungsloser: der Worker braucht
          Sekunden, die Liste lud aber sofort neu und zeigte den alten Text. */}
      {pending.size > 0 && (
        <div className="sticky top-2 z-10 rounded-lg border border-sky-500/40 bg-sky-500/5 px-4 py-2.5 text-sm text-sky-700 dark:text-sky-300">
          {R.regenerating(pending.size)}
        </div>
      )}

      {/* Alles auf einmal: der Fall "die Vorgaben haben sich grundlegend
          geaendert", etwa nach dem Umstellen der Sprache. Ohne ihn muesste
          man je Zeile ein Kaestchen anhaken. */}
      {summary && visibleCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge2 bg-panel px-4 py-3">
          <p className="flex-1 text-xs text-faint">{R.regenerateAllHint}</p>
          <button
            onClick={() => {
              if (!confirm(R.regenerateAllConfirm(visibleCount))) return;
              act(
                { action: "regenerateAll", ...(filter === "all" ? {} : { state: filter }) },
                (n) => push(n > 0 ? R.queued(n) : R.queuedNone, n > 0 ? "success" : "error")
              );
            }}
            disabled={busy || pending.size > 0}
            className={primaryBtnCls + " !px-3 !py-1.5 !text-xs"}
          >
            {R.regenerateAll(visibleCount)}
          </button>
        </div>
      )}

      {/* Die Sammelaktion steht oben und nicht am Ende der Liste: sie ist der
          Grund, warum diese Seite ueberhaupt in vertretbarer Zeit zu
          bearbeiten ist. */}
      {summary && summary.stale > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-sm text-ink">{R.staleExplain}</p>
          <button
            onClick={() => act({ action: "acceptStale" }, (n) => push(R.accepted(n), "success"))}
            disabled={busy}
            className="mt-2 rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-500"
          >
            {R.acceptStale(summary.stale)}
          </button>
        </div>
      )}

      {selectedVisible.length > 0 && (
        <div className="sticky top-2 z-10 flex items-center gap-2 rounded-lg border border-edge2 bg-panel px-4 py-2 shadow-sm">
          <span className="text-xs text-soft">{selectedVisible.length}</span>
          <button
            onClick={() =>
              act({ action: "regenerate", ids: selectedVisible.map((v) => v.id) }, (n) =>
                push(n > 0 ? R.queued(n) : R.queuedNone, n > 0 ? "success" : "error")
              )
            }
            disabled={busy}
            className={primaryBtnCls + " !px-3 !py-1.5 !text-xs"}
          >
            {R.regenerateAll(selectedVisible.length)}
          </button>
          <button
            onClick={() =>
              act({ action: "accept", ids: selectedVisible.map((v) => v.id) }, (n) =>
                push(R.accepted(n), "success")
              )
            }
            disabled={busy}
            className="rounded-lg border border-edge2 px-3 py-1.5 text-xs font-medium text-soft transition-colors hover:text-ink disabled:opacity-40"
          >
            {R.accept}
          </button>
        </div>
      )}

      {current?.truncated && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
          {R.truncated}
        </p>
      )}

      {/* Der leere Zustand bekommt einen Rahmen, wie der leere Beispielkasten
          im KI-Tab: ein Satz, der frei in der Seitenmitte haengt, sieht aus wie
          etwas, das nicht geladen hat. Gestrichelt heisst hier wie dort "diese
          Flaeche ist richtig, sie ist nur noch leer". */}
      {summary?.total === 0 && (
        <div className="rounded-lg border border-dashed border-edge2 px-4 py-8 text-center">
          <p className="mx-auto max-w-[52ch] text-sm leading-relaxed text-faint">
            {isFinding ? R.findingEmpty : R.empty}
          </p>
        </div>
      )}
      {summary && summary.total > 0 && summary.failing === 0 && summary.stale === 0 && filter === "failing" && (
        <div className="rounded-lg border border-dashed border-edge2 px-4 py-8 text-center">
          <p className="mx-auto max-w-[52ch] text-sm leading-relaxed text-faint">
            {isFinding ? R.findingAllClean : R.allClean}
          </p>
        </div>
      )}

      {/* Warten sieht aus wie das, worauf gewartet wird.
          Frueher hing an dieser Stelle ein "wird gespeichert" ueber der ganzen
          Seite, und beim Wechsel der Textsorte gar nichts: `current` ist dann
          null, bis die Antwort da ist, also verschwanden Chips, Sammelaktion
          und Liste fuer einen Moment ersatzlos. Drei Platzhalterzeilen in der
          Form der echten halten das Bild ruhig.
          aria-hidden, weil hier nichts steht, was vorgelesen werden koennte;
          aria-busy sagt es stattdessen an der Liste selbst. */}
      <div className="space-y-2" aria-busy={!current && !loadFailed}>
        {/* Gescheitertes Laden statt Skelett: gewartet wird hier nicht mehr,
            also darf es auch nicht mehr danach aussehen (aria-busy oben faellt
            mit). Gestrichelter Rahmen wie bei den Leerzustaenden darueber --
            die Flaeche ist richtig, es steht nur nichts drin. */}
        {!current && loadFailed && (
          <div className="rounded-lg border border-dashed border-edge2 px-4 py-8 text-center">
            <p className="mx-auto max-w-[52ch] text-sm leading-relaxed text-faint">{R.loadError}</p>
            <button onClick={() => load()} className={secondaryBtnCls + " mt-3 !px-3 !py-1.5 !text-xs"}>
              {R.retry}
            </button>
          </div>
        )}
        {!current &&
          !loadFailed &&
          [0, 1, 2].map((i) => (
            <div key={i} aria-hidden className="rounded-lg border border-edge/60 bg-panel px-4 py-3">
              <div className="skeleton h-3.5 w-40" />
              <div className="skeleton mt-2.5 h-3 w-full" />
              <div className="skeleton mt-1.5 h-3 w-2/3" />
            </div>
          ))}
        {visible.map((v) => (
          <div
            key={v.id}
            className={
              "rounded-lg border bg-panel px-4 py-3 " +
              (pending.has(v.id) ? "border-sky-500/50" : "border-edge/60")
            }
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(v.id)}
                onChange={() => toggle(v.id)}
                disabled={pending.has(v.id)}
                className="mt-1 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Was hier fehlen kann, ist NUR der Name: die Route laedt je
                      Zeile id, Text und Markierung, sonst nichts (app/api/
                      personalization/review/route.ts, selectFor). Die id ist
                      eine UUID und hilft niemandem, also ein benannter
                      Platzhalter statt eines erfundenen Ersatzes.
                      Kein Gedankenstrich mehr: er sagte nichts aus und steht in
                      diesem Workspace selbst auf der Verbotsliste.
                      .trim() || statt ?? , weil businesses.name seit Migration
                      0001 not null ist -- leer heisst hier praktisch "" und
                      nicht null. */}
                  <span className="truncate text-sm font-medium text-ink">
                    {v.name?.trim() || R.noName}
                  </span>
                  {pending.has(v.id) ? (
                    // Der Zustand von vorhin ist waehrend der Neuerzeugung
                    // keine Auskunft mehr, nur noch eine Ablenkung.
                    <span className="rounded-full border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                      {R.regeneratingRow}
                    </span>
                  ) : (
                    <>
                      <span className={"rounded-full border px-2 py-0.5 text-[11px] font-medium " + STATE_CLS[v.state]}>
                        {R.states[v.state]}
                      </span>
                      {/* Die Wortzahl nur, wo es einen Text gibt. "0 von 20
                          Woertern" an einer Zeile ohne Befund liest sich wie
                          ein verfehltes Ziel, und genau das ist es nicht. */}
                      {v.text && (
                        <span className="text-[11px] tabular-nums text-faint">
                          {R.words(v.words, current!.settings.maxWords)}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {editing === v.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      className={inputCls + " w-full"}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => saveDraft(v.id)} disabled={busy} className={primaryBtnCls + " !px-3 !py-1.5 !text-xs"}>
                        {R.save}
                      </button>
                      <button onClick={() => setEditing(null)} className="text-xs text-faint hover:text-ink">
                        {R.cancel}
                      </button>
                    </div>
                  </div>
                ) : v.text ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-soft">{v.text}</p>
                ) : (
                  <p className="mt-1 text-sm leading-relaxed text-faint">{R.emptyRow}</p>
                )}

                {v.problems.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {v.problems.map((p) => (
                      <li key={p} className="text-xs text-red-600 dark:text-red-400">
                        {p}
                      </li>
                    ))}
                  </ul>
                )}

                {editing !== v.id && !pending.has(v.id) && (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <button
                      onClick={() => {
                        setEditing(v.id);
                        setDraft(v.text);
                      }}
                      className="font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400"
                    >
                      {R.edit}
                    </button>
                    <button
                      onClick={() =>
                        act({ action: "regenerate", ids: [v.id] }, (n) =>
                          push(n > 0 ? R.queued(n) : R.queuedNone, n > 0 ? "success" : "error")
                        )
                      }
                      disabled={busy}
                      className="text-faint transition-colors hover:text-ink disabled:opacity-40"
                    >
                      {R.regenerate}
                    </button>
                    {/* Abnehmen kann man nur eine Markierung. "clean" hat
                        keine, "empty" darf keine haben (der Worker markiert
                        nur, was er geschrieben hat). */}
                    {(v.state === "failing" || v.state === "stale") && (
                      <button
                        onClick={() => act({ action: "accept", ids: [v.id] }, (n) => push(R.accepted(n), "success"))}
                        disabled={busy}
                        className="text-faint transition-colors hover:text-ink disabled:opacity-40"
                      >
                        {R.accept}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
