"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  IMPORT_TARGETS,
  detectDelimiter,
  guessMapping,
  parseCsv,
  planImport,
  toRow,
  type ImportPlan,
  type ImportTarget,
} from "@/lib/crm/csv-import";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

/**
 * Import aus einer CSV-Datei, vor allem aus Pipedrive-Exporten.
 *
 * Die Bruecke fuer den Umstieg: wer drei Jahre Historie in Pipedrive hat,
 * wechselt nicht ohne sie. Ohne Import ist jede andere Verbesserung fuer
 * einen Umsteiger belanglos -- er kaeme mit einem leeren System an.
 *
 * Dreischrittig, weil ein Import sich nicht rueckgaengig machen laesst:
 *
 *   1. Datei waehlen  -> Spalten werden erkannt und vorgeschlagen
 *   2. Zuordnung pruefen und korrigieren
 *   3. Vorschau lesen ("300 von 500 sind Dubletten"), dann erst uebernehmen
 *
 * Pipedrive macht es genauso. Wer vorher sieht, dass die Haelfte Dubletten
 * sind, bricht ab und schaut nach, statt seinen Bestand zu verdoppeln.
 *
 * Die Zerlegung, Zuordnung und Vorschau liegen mit 30 Tests in
 * lib/crm/csv-import.ts -- hier steht nur die Bedienung und das Schreiben.
 */

/** Import in Bloecken, damit ein grosser Bestand nicht an einer Anfrage haengt. */
const CHUNK = 100;

type Step = "pick" | "map" | "done";

export default function ImportCsv() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const I = t.importCsv;

  const [step, setStep] = useState<Step>("pick");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ImportTarget[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ contacts: number; companies: number } | null>(null);

  async function pickFile(file: File) {
    const text = await file.text();
    const rows = parseCsv(text, detectDelimiter(text));
    if (rows.length < 2) {
      push(I.tooShort, "error");
      return;
    }
    const [head, ...rest] = rows;
    setHeaders(head);
    setDataRows(rest);
    setMapping(guessMapping(head));
    setPlan(null);
    setStep("map");
  }

  /**
   * Vorschau bilden.
   *
   * Die vorhandenen Adressen kommen aus der Datenbank, nicht aus einem
   * Zwischenspeicher: zwischen Datei-Auswahl und Uebernahme koennen Minuten
   * liegen, und ein zwischenzeitlich angelegter Kontakt soll als Dublette
   * erkannt werden.
   */
  async function preview() {
    setBusy(true);
    const { data } = await createClient()
      .from("contacts")
      .select("email")
      .eq("workspace_id", workspaceId)
      .not("email", "is", null)
      .limit(10000);
    const existing = (data ?? []).map((c) => c.email as string);
    setPlan(planImport(dataRows.map((cells) => toRow(cells, mapping)), existing));
    setBusy(false);
  }

  /**
   * Uebernehmen.
   *
   * Firmen werden je Name einmal angelegt und wiederverwendet -- eine
   * CSV-Datei mit fuenf Ansprechpartnern derselben Firma soll nicht fuenf
   * Firmen erzeugen. Der Abgleich laeuft ueber den Namen, weil Pipedrive-
   * Exporte keine stabile Firmen-Kennung mitliefern.
   */
  async function run() {
    if (!plan || busy) return;
    setBusy(true);
    const supabase = createClient();

    // Vorhandene Firmen einmal laden statt je Zeile zu fragen.
    const { data: existing } = await supabase
      .from("businesses")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .limit(10000);
    const byName = new Map<string, string>();
    for (const b of existing ?? []) byName.set((b.name as string).toLowerCase(), b.id as string);

    let createdCompanies = 0;
    let createdContacts = 0;

    for (let i = 0; i < plan.usable.length; i += CHUNK) {
      const chunk = plan.usable.slice(i, i + CHUNK);

      // Fehlende Firmen dieses Blocks anlegen.
      const missing = [...new Set(
        chunk
          .map((r) => r.company_name!.trim())
          .filter((name) => !byName.has(name.toLowerCase()))
      )];
      if (missing.length > 0) {
        const { data: inserted, error } = await supabase
          .from("businesses")
          .insert(
            missing.map((name) => ({
              workspace_id: workspaceId,
              name,
              website: chunk.find((r) => r.company_name?.trim() === name)?.company_website ?? null,
              // Ohne Suche importiert: search_id bleibt leer, damit diese
              // Firmen nicht faelschlich in einer Lead-Liste auftauchen.
              search_id: null,
            }))
          )
          .select("id, name");
        if (error) {
          setBusy(false);
          push(t.common.error + error.message, "error");
          return;
        }
        for (const b of inserted ?? []) byName.set((b.name as string).toLowerCase(), b.id as string);
        createdCompanies += inserted?.length ?? 0;
      }

      const { error: contactError } = await supabase.from("contacts").insert(
        chunk.map((r) => ({
          workspace_id: workspaceId,
          business_id: byName.get(r.company_name!.trim().toLowerCase())!,
          first_name: r.first_name,
          last_name: r.last_name,
          full_name: r.full_name,
          email: r.email,
          phone: r.phone,
          title: r.title,
          linkedin: r.linkedin,
          // 'manual' ist der einzige Quellwert, der nicht behauptet, die
          // Daten kaemen aus einer unserer Suchen (CHECK in Migration 0051).
          source: "manual",
        }))
      );
      if (contactError) {
        setBusy(false);
        push(t.common.error + contactError.message, "error");
        return;
      }
      createdContacts += chunk.length;
    }

    setBusy(false);
    setResult({ contacts: createdContacts, companies: createdCompanies });
    setStep("done");
  }

  function reset() {
    setStep("pick");
    setHeaders([]);
    setDataRows([]);
    setMapping([]);
    setPlan(null);
    setResult(null);
  }

  const selectCls =
    "rounded-lg border border-edge2 bg-field px-2 py-1 text-xs text-ink outline-none focus:border-sky-500";

  if (step === "done" && result) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-4 py-3">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          {I.doneTitle(result.contacts, result.companies)}
        </p>
        <button
          onClick={reset}
          className="mt-2 text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400"
        >
          {I.again}
        </button>
      </div>
    );
  }

  if (step === "pick") {
    return (
      <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-edge3 px-4 py-8 text-center transition-colors hover:border-sky-500/60">
        <span className="text-sm font-medium text-ink">{I.pickFile}</span>
        <span className="text-xs text-faint">{I.pickHint}</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pickFile(file);
            // Zuruecksetzen, damit dieselbe Datei erneut gewaehlt werden kann.
            e.target.value = "";
          }}
        />
      </label>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-faint">{I.foundRows(dataRows.length)}</p>
        <button onClick={reset} className="text-xs text-faint transition-colors hover:text-ink">
          {I.otherFile}
        </button>
      </div>

      {/* Zuordnung: je Spalte ein Ziel. Die Vorschau der ersten Zeile steht
          daneben, weil eine Spaltenueberschrift allein oft nicht verraet, was
          drinsteht ("Feld 3"). */}
      <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-edge2 p-2">
        {headers.map((header, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink">{header || I.noHeader}</p>
              <p className="truncate text-[11px] text-mute">{dataRows[0]?.[i] || "—"}</p>
            </div>
            <select
              value={mapping[i] ?? "ignore"}
              onChange={(e) => {
                const next = [...mapping];
                next[i] = e.target.value as ImportTarget;
                setMapping(next);
                setPlan(null); // Vorschau ist damit veraltet
              }}
              className={selectCls}
            >
              {IMPORT_TARGETS.map((target) => (
                <option key={target} value={target}>
                  {I.targetLabels[target]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {plan ? (
        <div className="rounded-lg border border-edge2 bg-surface/60 px-3 py-2.5 text-xs">
          <p className="font-medium text-ink">{I.planUsable(plan.usable.length)}</p>
          <ul className="mt-1 space-y-0.5 text-faint">
            {plan.duplicates > 0 && <li>{I.planDuplicates(plan.duplicates)}</li>}
            {plan.duplicatesInFile > 0 && <li>{I.planInFile(plan.duplicatesInFile)}</li>}
            {plan.withoutCompany > 0 && <li>{I.planNoCompany(plan.withoutCompany)}</li>}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={preview}
          disabled={busy}
          className="rounded-lg border border-edge2 px-3.5 py-2 text-sm text-soft transition-colors hover:text-ink disabled:opacity-40"
        >
          {busy && !plan ? t.common.saving : I.check}
        </button>
        <button
          onClick={run}
          disabled={busy || !plan || plan.usable.length === 0}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {busy && plan ? t.common.saving : I.run}
        </button>
      </div>
    </div>
  );
}
