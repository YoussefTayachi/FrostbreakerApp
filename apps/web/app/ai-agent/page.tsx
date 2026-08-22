"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_BANNED_WORDS,
  DEFAULT_MAX_WORDS,
  MAX_PERSONALIZATION_EXAMPLES,
  getDefaultPrompt,
} from "@/lib/personalization-defaults";
import { cardCls, inputCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";
import HelpLink from "../help-link";

type BusinessOption = { id: string; name: string; company_summary: string | null; website: string | null };
type TestResult = {
  text: string;
  problems: string[];
  wordCount: number;
  corrected: boolean;
  exampleCount?: number;
};
type CustomTemplate = {
  id: string;
  name: string;
  prompt: string;
  max_words: number;
  banned_words: string;
};

/** Ein hinterlegtes Few-Shot-Paar (personalization_examples, Migration 0097). */
type Example = {
  id: string;
  input_context: string;
  icebreaker: string;
  sort_order: number;
};

const MAX_CUSTOM_TEMPLATES = 5;

/**
 * Die Klassen fuer Feld, Karte und Knopf standen hier als woertliche Kopie aus
 * lib/ui.ts. Zwei gleiche Zeichenketten an zwei Orten heisst: die naechste
 * Aenderung am Fokusring oder am Radius wirkt auf der halben App und hier
 * nicht. Deshalb importiert, nicht abgeschrieben.
 */
const iconBtnCls =
  "flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-colors " +
  "hover:bg-chip hover:text-ink disabled:pointer-events-none disabled:opacity-30 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

export default function AiAgentPage() {
  const { t, lang } = useT();
  const { push } = useToast();
  const { workspaceId: wsId } = useWorkspace();
  const [systemPrompt, setSystemPrompt] = useState("");
  /**
   * Sprache der erzeugten Icebreaker, NICHT die Sprache der Oberflaeche.
   *
   * Bis zum 2026-08-09 gab es dieses Feld nicht, und der angezeigte
   * Standardprompt richtete sich nach `lang`, also danach, in welcher Sprache
   * jemand die App gerade bedient. Beim Speichern wurde ein unveraenderter
   * Standardprompt als null abgelegt, und der Worker setzte dafuer seinen
   * eigenen ein, fest auf Deutsch. Wer die Oberflaeche auf Englisch stellte,
   * sah also den englischen Prompt und bekam deutsche Texte.
   *
   * Beides gehoert getrennt: eine deutsche Oberflaeche und amerikanische
   * Zielkunden sind der Normalfall, nicht die Ausnahme.
   */
  const [outputLang, setOutputLang] = useState<"de" | "en">("de");
  const [source, setSource] = useState<string>("company_summary");
  const [maxWords, setMaxWords] = useState(DEFAULT_MAX_WORDS);
  const [bannedWordsText, setBannedWordsText] = useState(DEFAULT_BANNED_WORDS.join(", "));
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("default");

  const [examples, setExamples] = useState<Example[]>([]);
  const [savingExample, setSavingExample] = useState(false);
  /**
   * Welches Beispiel aufgeklappt ist. Reine Anzeige, nichts davon wird
   * gespeichert.
   *
   * Ein Paar sind zwei lange Texte; zehn Paare untereinander sind eine Wand,
   * durch die man scrollt, ohne noch zu wissen, welcher Kontext zu welcher
   * Zeile gehoert. Deshalb steht offen immer nur eines, wie bei den vier
   * Stufen im Angebotsformular.
   *
   * "letztes" statt einer id: ein neu angelegtes Beispiel soll offen sein,
   * seine id kennt die Seite aber erst nach dem naechsten Laden. Es ist per
   * Konstruktion das letzte der Liste (hoechste sort_order), und genau das
   * loest der Platzhalter beim Rendern auf.
   */
  const [openExample, setOpenExample] = useState<string | null>(null);

  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [savingNewTemplate, setSavingNewTemplate] = useState(false);

  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [testBusinessId, setTestBusinessId] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testStatus, setTestStatus] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("workspaces")
      .select(
        // Ein Literal, keine Konkatenation: Supabase leitet die Feldtypen aus
        // dem String ab und faellt sonst auf GenericStringError zurueck.
        "personalization_prompt, personalization_source, personalization_max_words, personalization_banned_words, personalization_language"
      )
      .eq("id", wsId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const saved: "de" | "en" = data.personalization_language === "en" ? "en" : "de";
        setOutputLang(saved);
        setSource(data.personalization_source || "company_summary");
        setMaxWords(data.personalization_max_words || DEFAULT_MAX_WORDS);
        setBannedWordsText(data.personalization_banned_words || DEFAULT_BANNED_WORDS.join(", "));
        if (data.personalization_prompt) {
          setSystemPrompt(data.personalization_prompt);
          setSelectedTemplateId("custom");
        } else {
          // Der gespeicherte Wert, nicht der State: setOutputLang oben wirkt
          // erst im naechsten Rendern.
          setSystemPrompt(getDefaultPrompt(saved));
          setSelectedTemplateId("default");
        }
      });
    supabase
      .from("businesses")
      .select("id, name, company_summary, website")
      .eq("workspace_id", wsId)
      .or("company_summary.not.is.null,website.not.is.null")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setBusinesses(data ?? []));
    loadTemplates();
    loadExamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  // Der angezeigte Standardprompt folgt der AUSGABESPRACHE, nicht der Sprache
  // der Oberflaeche. Vorher haing er an `lang`; daher stand dort Englisch,
  // waehrend der Worker Deutsch erzeugte.
  useEffect(() => {
    if (selectedTemplateId === "default") {
      setSystemPrompt(getDefaultPrompt(outputLang));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputLang]);

  // Reconcile: falls ein gespeicherter Custom-Prompt zu einer geladenen Vorlage passt,
  // die passende Karte als aktiv markieren statt generisch "Eigene Vorlage".
  useEffect(() => {
    if (selectedTemplateId !== "custom") return;
    const match = customTemplates.find((tpl) => tpl.prompt.trim() === systemPrompt.trim() && tpl.prompt.trim() !== "");
    if (match) setSelectedTemplateId(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customTemplates]);

  async function loadTemplates() {
    const supabase = createClient();
    const { data } = await supabase
      .from("personalization_templates")
      .select("id, name, prompt, max_words, banned_words")
      .eq("workspace_id", wsId)
      .order("created_at", { ascending: true });
    setCustomTemplates(data ?? []);
  }

  /**
   * Die Beispiel-Paare.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * JEDE Abfrage hier filtert zusaetzlich auf workspace_id.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * RLS entscheidet nur, auf welche ACCOUNTS jemand zugreifen darf, nicht,
   * welcher der eigenen Workspaces gemeint ist. Ohne den Filter kaemen die
   * Beispiele aller Workspaces desselben Kontos zurueck, und sie landeten
   * ungefragt im Prompt jedes Leads.
   *
   * Zeilenoperationen (anlegen, loeschen, umsortieren) schreiben sofort, weil
   * sie Zeilen sind und nicht Formularinhalt. Die beiden Textfelder speichern
   * beim Verlassen des Feldes. Ein gemischtes Modell mit einem
   * Sammel-Speichern-Knopf haette bedeutet, dass ein geloeschtes Beispiel weg
   * ist, ein geaenderter Text aber nicht.
   */
  async function loadExamples() {
    const supabase = createClient();
    const { data } = await supabase
      .from("personalization_examples")
      .select("id, input_context, icebreaker, sort_order")
      .eq("workspace_id", wsId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    setExamples(data ?? []);
  }

  async function addExample() {
    if (examples.length >= MAX_PERSONALIZATION_EXAMPLES) return;
    setSavingExample(true);
    const supabase = createClient();
    const nextOrder = examples.length ? Math.max(...examples.map((e) => e.sort_order)) + 1 : 0;
    const { error } = await supabase.from("personalization_examples").insert({
      workspace_id: wsId,
      input_context: "",
      icebreaker: "",
      sort_order: nextOrder,
    });
    setSavingExample(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    loadExamples();
  }

  async function saveExample(id: string, patch: Partial<Pick<Example, "input_context" | "icebreaker">>) {
    const supabase = createClient();
    const { error } = await supabase
      .from("personalization_examples")
      .update(patch)
      .eq("id", id)
      .eq("workspace_id", wsId);
    if (error) push(t.common.error + error.message, "error");
  }

  async function deleteExample(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("personalization_examples")
      .delete()
      .eq("id", id)
      .eq("workspace_id", wsId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    loadExamples();
  }

  /**
   * Ein Beispiel um eine Position verschieben. Die Reihenfolge ist nicht nur
   * Anzeige: sie bestimmt die Reihenfolge der Turns im Prompt.
   *
   * Es werden ALLE Zeilen neu durchnummeriert, nicht nur die beiden
   * getauschten. Sonst passiert bei zwei zufaellig gleichen sort_order-Werten
   * nichts sichtbares: die Anzeige faellt dann auf created_at zurueck, der
   * Tausch schreibt zweimal denselben Wert, und der Knopf wirkt kaputt.
   * Zehn Zeilen sind das Maximum, der Aufwand ist also gedeckelt.
   */
  async function moveExample(index: number, direction: -1 | 1) {
    const other = index + direction;
    if (other < 0 || other >= examples.length) return;
    const reordered = [...examples];
    [reordered[index], reordered[other]] = [reordered[other], reordered[index]];
    const supabase = createClient();
    for (let i = 0; i < reordered.length; i++) {
      await supabase
        .from("personalization_examples")
        .update({ sort_order: i })
        .eq("id", reordered[i].id)
        .eq("workspace_id", wsId);
    }
    loadExamples();
  }

  function selectDefault() {
    setSelectedTemplateId("default");
    setSystemPrompt(getDefaultPrompt(outputLang));
    setMaxWords(DEFAULT_MAX_WORDS);
    setBannedWordsText(DEFAULT_BANNED_WORDS.join(", "));
  }

  function selectCustomTemplate(tpl: CustomTemplate) {
    setSelectedTemplateId(tpl.id);
    setSystemPrompt(tpl.prompt);
    setMaxWords(tpl.max_words);
    setBannedWordsText(tpl.banned_words);
  }

  async function createTemplate() {
    if (!newTemplateName.trim() || customTemplates.length >= MAX_CUSTOM_TEMPLATES) return;
    setSavingNewTemplate(true);
    const supabase = createClient();
    const { error } = await supabase.from("personalization_templates").insert({
      workspace_id: wsId,
      name: newTemplateName.trim(),
      prompt: "",
      max_words: DEFAULT_MAX_WORDS,
      banned_words: DEFAULT_BANNED_WORDS.join(", "),
    });
    setSavingNewTemplate(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setNewTemplateName("");
    setAddingTemplate(false);
    push(t.aiAgent.templateSaved, "success");
    loadTemplates();
  }

  async function deleteTemplate(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const supabase = createClient();
    const { error } = await supabase
      .from("personalization_templates")
      .delete()
      .eq("id", id)
      .eq("workspace_id", wsId);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    if (selectedTemplateId === id) selectDefault();
    push(t.aiAgent.templateDeleted, "success");
    loadTemplates();
  }

  async function save() {
    const supabase = createClient();
    const isCustomTemplateSelected = customTemplates.some((tpl) => tpl.id === selectedTemplateId);

    const { error } = await supabase
      .from("workspaces")
      .update({
        // null heisst "nimm den Standard". Welcher Standard das ist, sagt
        // jetzt personalization_language; vorher ging genau diese Auskunft
        // beim Speichern verloren und der Worker riet Deutsch.
        personalization_prompt:
          systemPrompt.trim() === getDefaultPrompt(outputLang).trim() ? null : systemPrompt.trim(),
        personalization_language: outputLang,
        // personalization_model wird bewusst nicht mehr geschrieben: die
        // Spalte gibt es weiter (Migration 0097), der Claude-Pfad dahinter ist
        // am 2026-08-22 entfallen. Wer Claude will, verbindet sein eigenes Abo
        // ueber den MCP-Zugang.
        personalization_source: source,
        personalization_max_words: maxWords,
        personalization_banned_words:
          bannedWordsText.trim() === DEFAULT_BANNED_WORDS.join(", ") ? null : bannedWordsText.trim(),
      })
      .eq("id", wsId);

    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }

    if (isCustomTemplateSelected) {
      await supabase
        .from("personalization_templates")
        .update({
          prompt: systemPrompt.trim(),
          max_words: maxWords,
          banned_words: bannedWordsText.trim(),
        })
        .eq("id", selectedTemplateId)
        .eq("workspace_id", wsId);
      loadTemplates();
    }

    push(t.common.savedOk, "success");
  }

  async function runTest() {
    if (!testBusinessId) return;
    setTestStatus(t.common.saving);
    setTestResult(null);
    const res = await fetch("/api/personalize-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: testBusinessId,
        system_prompt: systemPrompt,
        source,
        max_words: maxWords,
        banned_words: bannedWordsText.split(",").map((w) => w.trim()).filter(Boolean),
        lang,
        // Ungespeichert mitgeschickt: der Test soll zeigen, was die aktuelle
        // Auswahl bewirkt, nicht was zuletzt gespeichert wurde.
        output_lang: outputLang,
      }),
    });
    const body = await res.json();
    setTestStatus("");
    if (!res.ok) {
      setTestStatus(t.common.error + (body.error ?? res.status));
      return;
    }
    setTestResult(body);
  }

  const selectedBusiness = businesses.find((b) => b.id === testBusinessId);
  // Nur zaehlen und Zeichen zaehlen, KEINE Token-Schaetzung. Ein
  // Umrechnungsfaktor waere hier eine erfundene Zahl: er haengt an Sprache und
  // Inhalt, und belastbar waere nur, den Text wirklich durch den Tokenizer des
  // Modells zu schicken, also Rechenaufwand fuer eine Anzeige.
  const exampleChars = examples.reduce(
    (sum, e) => sum + e.input_context.length + e.icebreaker.length,
    0
  );
  // Halbe Paare werden von Worker UND Live-Test aussortiert. Das gehoert
  // hierhin gesagt, sonst wundert sich jemand, warum sein achtes Beispiel
  // nichts bewirkt.
  const incompleteExamples = examples.filter(
    (e) => !e.input_context.trim() || !e.icebreaker.trim()
  ).length;
  const openExampleId =
    openExample === "letztes" ? (examples[examples.length - 1]?.id ?? null) : openExample;

  return (
    <div className="fade-up max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.aiAgent.title}</h1>
        <p className="text-sm text-faint">
          {t.aiAgent.subtitle}{" "}
          <HelpLink section="agent" label={t.guide.helpLink} />
        </p>
      </div>

      {/* Steht immer da. Bis zum 2026-08-22 hing dieser Abschnitt an der Wahl
          "Claude"; die Wahl gibt es nicht mehr, und die Beispiele gehen jetzt
          bei jedem Lead in den OpenAI-Aufruf (siehe generate() in
          worker/pipelines/personalize.py). */}
      <div className={cardCls}>
        <h2 className="mb-1 font-medium text-ink">{t.aiAgent.examplesHeading}</h2>
        <p className="mb-3 max-w-[68ch] text-sm leading-relaxed text-faint">
          {t.aiAgent.examplesSubtitle}
        </p>

        {/* Anzahl und Zeichen sind Fakten und stehen als Text da; nur der
            Befund "unvollstaendig" bekommt eine Plakette, weil er etwas
            verlangt. Drei gleich aussehende Plaketten haetten alle drei
            gleich laut gemacht.

            Gezaehlt wird nur, was wirklich gezaehlt wurde: Beispiele und
            Zeichen. Keine Token, keine Kosten, beides waere geraten. */}
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-faint">
          <span>{t.aiAgent.examplesCount(examples.length, MAX_PERSONALIZATION_EXAMPLES)}</span>
          <span aria-hidden className="text-mute">·</span>
          <span>{t.aiAgent.examplesChars(exampleChars)}</span>
          {incompleteExamples > 0 && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-amber-700 dark:text-amber-300">
              {t.aiAgent.examplesIncomplete(incompleteExamples)}
            </span>
          )}
        </div>

        {examples.length === 0 ? (
          /* Der leere Zustand traegt seinen naechsten Schritt selbst: Satz
             und Knopf in einem gestrichelten Feld, statt eines Hinweises
             oben und eines Knopfes irgendwo darunter. */
          <div className="rounded-lg border border-dashed border-edge2 px-4 py-6 text-center">
            <p className="mx-auto max-w-[52ch] text-sm leading-relaxed text-faint">
              {t.aiAgent.examplesEmpty}
            </p>
            <button
              type="button"
              onClick={async () => {
                await addExample();
                setOpenExample("letztes");
              }}
              disabled={savingExample}
              className={secondaryBtnCls + " mt-4"}
            >
              + {t.aiAgent.addExample}
            </button>
          </div>
        ) : (
          /* Kein overflow-hidden am Rahmen: der Fokusring des ersten und
             letzten Aufklappers liegt sonst genau auf der Kante und wird
             abgeschnitten. Stattdessen 6 Pixel Luft nach innen (px-1.5),
             damit der Ring Platz hat. */
          <ul className="divide-y divide-edge rounded-lg border border-edge2">
            {examples.map((ex, i) => {
              const offen = openExampleId === ex.id;
              const vorschau = ex.icebreaker.trim();
              return (
                <li key={ex.id}>
                  <div className="flex items-center gap-1 px-1.5">
                    {/* Der Aufklapper ist ein eigener Knopf und umschliesst
                        die drei Zeilenknoepfe NICHT: ein button im button
                        waere ungueltiges HTML, und ein Klick auf Loeschen
                        soll die Zeile nicht auch noch aufklappen. */}
                    <button
                      type="button"
                      onClick={() => setOpenExample(offen ? null : ex.id)}
                      aria-expanded={offen}
                      aria-controls={`example-body-${ex.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2.5 pl-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      <span
                        aria-hidden
                        // text-faint und nicht text-mute: die Spitze sagt,
                        // ob die Zeile offen ist, und ein Bedienhinweis
                        // braucht 3:1 gegen seinen Grund.
                        className="shrink-0 text-faint transition-transform duration-200"
                        style={{ transform: offen ? "rotate(90deg)" : "none" }}
                      >
                        ›
                      </span>
                      {/* Die Nummer ist keine Zierde: die Reihenfolge der
                          Beispiele ist die Reihenfolge im Prompt. */}
                      <span className="shrink-0 text-xs font-medium text-faint">
                        {t.aiAgent.exampleNumber(i + 1)}
                      </span>
                      {/* Erkannt wird ein Beispiel an der Zeile, die man
                          selbst geschrieben hat, nicht am Rohtext. Fehlt
                          sie, tritt der Kontext ein, blasser, weil er
                          nicht das ist, was hier stehen sollte. */}
                      {vorschau ? (
                        <span className="truncate text-sm text-soft">{vorschau}</span>
                      ) : (
                        <span className="truncate text-sm text-faint">
                          {ex.input_context.trim()}
                        </span>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveExample(i, -1)}
                        disabled={i === 0}
                        aria-label={t.aiAgent.exampleMoveUp}
                        title={t.aiAgent.exampleMoveUp}
                        className={iconBtnCls}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveExample(i, 1)}
                        disabled={i === examples.length - 1}
                        aria-label={t.aiAgent.exampleMoveDown}
                        title={t.aiAgent.exampleMoveDown}
                        className={iconBtnCls}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteExample(ex.id)}
                        aria-label={t.common.delete}
                        title={t.common.delete}
                        className={iconBtnCls + " hover:text-red-600 dark:hover:text-red-400"}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {offen && (
                    <div
                      id={`example-body-${ex.id}`}
                      // Nur eine Linie und Abstand, keine zweite Flaeche: die
                      // gedrehte Spitze und der Inhalt selbst sagen schon,
                      // welche Zeile offen ist.
                      className="fade-up space-y-3 border-t border-edge px-3 pb-4 pt-3.5"
                    >
                      <div>
                        <label
                          htmlFor={`example-context-${ex.id}`}
                          className="mb-1 block text-xs font-medium text-faint"
                        >
                          {t.aiAgent.exampleContextLabel}
                        </label>
                        {/* Monoschrift, weil das hier kein geschriebener
                            Satz ist, sondern der Rohtext, den das Modell
                            vorgelegt bekommt. Der Icebreaker darunter steht
                            in der Schrift der Oberflaeche: er ist Prosa.
                            Dieser Unterschied traegt das Paar, ohne dass
                            eine zusaetzliche Linie oder ein Pfeil noetig
                            waere. */}
                        <textarea
                          id={`example-context-${ex.id}`}
                          value={ex.input_context}
                          rows={5}
                          placeholder={t.aiAgent.exampleContextPlaceholder}
                          onChange={(e) =>
                            setExamples((list) =>
                              list.map((x) =>
                                x.id === ex.id ? { ...x, input_context: e.target.value } : x
                              )
                            )
                          }
                          onBlur={(e) => saveExample(ex.id, { input_context: e.target.value })}
                          className={inputCls + " w-full resize-y font-mono text-[13px] leading-relaxed"}
                        />
                      </div>

                      <div>
                        <label
                          htmlFor={`example-icebreaker-${ex.id}`}
                          className="mb-1 block text-xs font-medium text-faint"
                        >
                          {t.aiAgent.exampleIcebreakerLabel}
                        </label>
                        <textarea
                          id={`example-icebreaker-${ex.id}`}
                          value={ex.icebreaker}
                          rows={2}
                          placeholder={t.aiAgent.exampleIcebreakerPlaceholder}
                          onChange={(e) =>
                            setExamples((list) =>
                              list.map((x) =>
                                x.id === ex.id ? { ...x, icebreaker: e.target.value } : x
                              )
                            )
                          }
                          onBlur={(e) => saveExample(ex.id, { icebreaker: e.target.value })}
                          className={inputCls + " w-full resize-y text-[13px] leading-relaxed"}
                        />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {examples.length > 0 &&
          (examples.length < MAX_PERSONALIZATION_EXAMPLES ? (
            <button
              type="button"
              onClick={async () => {
                await addExample();
                setOpenExample("letztes");
              }}
              disabled={savingExample}
              className={secondaryBtnCls + " mt-4"}
            >
              + {t.aiAgent.addExample}
            </button>
          ) : (
            <p className="mt-4 max-w-[68ch] text-xs leading-relaxed text-faint">
              {t.aiAgent.examplesLimitReached(MAX_PERSONALIZATION_EXAMPLES)}
            </p>
          ))}

        <p className="mt-3 max-w-[68ch] text-xs leading-relaxed text-faint">
          {t.aiAgent.examplesSaveHint}
        </p>
      </div>

      {/* Vor der Datenquelle, weil diese Auswahl den Prompt-Text weiter unten
          umschaltet — eine Einstellung, die sichtbar etwas anderes veraendert,
          gehoert davor und nicht dahinter. */}
      <div className={cardCls}>
        <h2 className="mb-1 font-medium text-ink">{t.aiAgent.languageHeading}</h2>
        <p className="mb-3 text-sm text-faint">{t.aiAgent.languageSubtitle}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["de", "en"] as const).map((code) => (
            <label
              key={code}
              className={
                "cursor-pointer rounded-lg border p-3 text-sm transition-colors " +
                (outputLang === code
                  ? "border-sky-500/60 bg-sky-500/5"
                  : "border-edge2 hover:border-edge3")
              }
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="outputLang"
                  checked={outputLang === code}
                  onChange={() => setOutputLang(code)}
                  className="h-3.5 w-3.5 accent-sky-500"
                />
                <span className="font-medium text-ink">{t.aiAgent.languageOptions[code]}</span>
              </div>
            </label>
          ))}
        </div>
        <p className="mt-3 max-w-[68ch] text-xs leading-relaxed text-faint">{t.aiAgent.languageHint}</p>
      </div>

      <div className={cardCls}>
        <h2 className="mb-1 font-medium text-ink">{t.aiAgent.sourceHeading}</h2>
        <p className="mb-3 text-sm text-faint">{t.aiAgent.sourceSubtitle}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {t.aiAgent.sourceOptions.map((opt) => (
            <label
              key={opt.value}
              className={
                "cursor-pointer rounded-lg border p-3 text-sm transition-colors " +
                (source === opt.value
                  ? "border-sky-500/60 bg-sky-500/5"
                  : "border-edge2 hover:border-edge3")
              }
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="source"
                  checked={source === opt.value}
                  onChange={() => setSource(opt.value)}
                  className="h-3.5 w-3.5 accent-sky-500"
                />
                <span className="font-medium text-ink">{opt.label}</span>
              </div>
              <p className="mt-1 text-xs text-faint">{opt.hint}</p>
            </label>
          ))}
        </div>
      </div>

      <div className={cardCls}>
        <h2 className="mb-1 font-medium text-ink">{t.aiAgent.templateHeading}</h2>
        <p className="mb-3 text-sm text-faint">{t.aiAgent.templateSubtitle}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label
            className={
              "cursor-pointer rounded-lg border p-3 text-sm transition-colors " +
              (selectedTemplateId === "default"
                ? "border-sky-500/60 bg-sky-500/5"
                : "border-edge2 hover:border-edge3")
            }
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="template"
                checked={selectedTemplateId === "default"}
                onChange={selectDefault}
                className="h-3.5 w-3.5 accent-sky-500"
              />
              <span className="font-medium text-ink">{t.aiAgent.thawTemplateLabel}</span>
              <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
                {t.aiAgent.thawTemplateBadge}
              </span>
            </div>
            <p className="mt-1 text-xs text-faint">{t.aiAgent.thawTemplateHint}</p>
          </label>

          {customTemplates.map((tpl) => (
            <label
              key={tpl.id}
              className={
                "group relative cursor-pointer rounded-lg border p-3 text-sm transition-colors " +
                (selectedTemplateId === tpl.id
                  ? "border-sky-500/60 bg-sky-500/5"
                  : "border-edge2 hover:border-edge3")
              }
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="template"
                  checked={selectedTemplateId === tpl.id}
                  onChange={() => selectCustomTemplate(tpl)}
                  className="h-3.5 w-3.5 accent-sky-500"
                />
                <span className="truncate font-medium text-ink">{tpl.name}</span>
              </div>
              {!tpl.prompt && (
                <p className="mt-1 text-xs text-faint">{t.aiAgent.emptyTemplateHint}</p>
              )}
              <button
                type="button"
                onClick={(e) => deleteTemplate(tpl.id, e)}
                className="absolute right-2 top-2 hidden text-faint hover:text-red-500 group-hover:block"
                aria-label={t.common.delete}
              >
                ✕
              </button>
            </label>
          ))}

          {customTemplates.length < MAX_CUSTOM_TEMPLATES &&
            (addingTemplate ? (
              <div className="rounded-lg border border-sky-500/60 bg-sky-500/5 p-3 text-sm">
                <input
                  autoFocus
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder={t.aiAgent.newTemplateNamePlaceholder}
                  className="w-full rounded-md border border-edge2 bg-field px-2 py-1.5 text-sm text-ink outline-none focus:border-sky-500"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={createTemplate}
                    disabled={!newTemplateName.trim() || savingNewTemplate}
                    className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {t.common.save}
                  </button>
                  <button
                    onClick={() => {
                      setAddingTemplate(false);
                      setNewTemplateName("");
                    }}
                    className="rounded-md border border-edge2 px-2.5 py-1 text-xs text-soft hover:text-ink"
                  >
                    {t.aiAgent.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingTemplate(true)}
                className="flex items-center justify-center rounded-lg border border-dashed border-edge3 p-3 text-sm text-faint transition-colors hover:border-sky-500/60 hover:text-sky-600"
              >
                + {t.aiAgent.newTemplate}
              </button>
            ))}
        </div>
      </div>

      <div className={cardCls}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-medium text-ink">{t.aiAgent.promptHeading}</h2>
          <button onClick={selectDefault} className="text-xs text-faint hover:text-ink">
            {t.aiAgent.resetToDefault}
          </button>
        </div>
        <p className="mb-3 text-sm text-faint">{t.aiAgent.promptDescription}</p>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={14}
          placeholder={selectedTemplateId !== "default" ? t.aiAgent.emptyTemplateHint : ""}
          className={inputCls + " w-full resize-y font-mono text-[13px] leading-relaxed"}
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-faint">{t.aiAgent.maxWords}</label>
            <input
              type="number"
              min={5}
              max={100}
              value={maxWords}
              onChange={(e) => setMaxWords(Number(e.target.value) || DEFAULT_MAX_WORDS)}
              className={inputCls + " w-28"}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-faint">{t.aiAgent.bannedWords}</label>
            <input
              value={bannedWordsText}
              onChange={(e) => setBannedWordsText(e.target.value)}
              className={inputCls + " w-full"}
            />
          </div>
        </div>

        {/* Ohne diesen Hinweis wirken die beiden Felder wie eine reine
            Nachpruefung — genau das waren sie auch, und genau daran lag der
            Fehler: die Wortgrenze stand nie im Prompt, das Modell erfuhr sie
            erst im Korrekturversuch und lag im Schnitt darueber. */}
        <p className="mt-3 max-w-[68ch] text-xs leading-relaxed text-faint">{t.aiAgent.limitsInPromptHint}</p>

        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} className={primaryBtnCls}>{t.aiAgent.save}</button>
        </div>
      </div>

      <div className={cardCls}>
        <h2 className="mb-1 font-medium text-ink">{t.aiAgent.liveTestHeading}</h2>
        <p className="mb-3 text-sm text-faint">{t.aiAgent.liveTestDescription}</p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={testBusinessId}
            onChange={(e) => setTestBusinessId(e.target.value)}
            className={inputCls + " min-w-64"}
          >
            <option value="">{t.aiAgent.chooseBusiness}</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button onClick={runTest} disabled={!testBusinessId} className={secondaryBtnCls}>
            {t.aiAgent.test}
          </button>
          {testStatus && <span className="text-xs text-faint">{testStatus}</span>}
        </div>

        {selectedBusiness?.company_summary && (
          <p className="mt-3 text-xs leading-relaxed text-faint">
            <span className="font-medium text-soft">{t.aiAgent.companySummaryPrefix}</span>
            {selectedBusiness.company_summary}
          </p>
        )}

        {testResult && (
          <div className="lock-pop mt-4 rounded-lg border-l-2 border-sky-500/50 bg-sky-500/5 p-4">
            <p className="text-sm italic leading-relaxed text-ink">{testResult.text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-faint">{testResult.wordCount} {t.aiAgent.words}</span>
              {/* Der Testlauf sagt dazu, wie viele Beispiele mitgingen. Ohne
                  diese Zahl bleibt offen, ob das Ergebnis vom Prompt oder von
                  den Beispielen kommt, und ein halbes Paar (das beide Seiten
                  aussortieren) sieht aus wie ein ganzes. */}
              {(testResult.exampleCount ?? 0) > 0 && (
                <span className="rounded-full border border-edge2 px-2 py-0.5 text-soft">
                  {t.aiAgent.testExamplesUsed(testResult.exampleCount ?? 0)}
                </span>
              )}
              {testResult.corrected && (
                <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-600 dark:text-sky-300">
                  {t.aiAgent.correctedNote}
                </span>
              )}
              {testResult.problems.length === 0 ? (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-300">
                  {t.aiAgent.rulesFollowed}
                </span>
              ) : (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                  {testResult.problems.join(" · ")}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
