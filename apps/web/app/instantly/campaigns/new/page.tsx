"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pickPrimaryContactPerBusiness, splitByEngagement, splitBySendability } from "@/lib/contacts";
import { groupPickerOptions } from "@/lib/search-group";
import { filterSuppressed } from "@/lib/suppression";
import { useT } from "../../../language-provider";
import { useToast } from "../../../toast-provider";
import { useWorkspace } from "../../../workspace-provider";
import CampaignForm, { emptyCampaignFormValue, type CampaignFormValue } from "../campaign-form";
import CampaignReadinessPanel, { type ReadinessResult } from "../campaign-readiness-panel";
import GenerateSequence from "../generate-sequence";

type SearchOption = {
  id: string;
  name: string | null;
  query: string;
  location: string;
  instantly_campaign_id: string | null;
  // Gebuendelte Mehrfach-Suche (Migration 0096): angeboten wird die Gruppe,
  // ausgewaehlt werden ihre Teilsuchen; an der Huelle selbst haengt keine
  // einzige Firma. Siehe lib/search-group.ts.
  parent_search_id: string | null;
  is_search_group: boolean;
};

/** Vorschau auf die Menge, die tatsaechlich versendet wuerde: dieselben
 *  Filter wie in api/instantly/campaigns (ungueltig, blockiert, kein
 *  Interesse, eine Person pro Firma), damit die Zahl hier nicht hoeher ist
 *  als die spaeter tatsaechlich angelegte Kampagne. */
type LeadPreview = { sendable: number; invalid: number };

/**
 * Der halbfertige Entwurf im Browser.
 *
 * Postfaecher waehlen, vier Stufen erzeugen, drueberlesen, Zeitplan setzen:
 * das dauert Minuten, und bis hierher war jeder Klick auf einen anderen
 * Menuepunkt der Verlust von allem: die Seite haelt ihren Zustand in React,
 * und React unmountet sie beim Routenwechsel.
 *
 * Bewusst nur localStorage und bewusst nur dieser eine Fluss. Server-seitige
 * Entwuerfe waeren eine Tabelle, eine Migration und die Frage, wann sie
 * aufgeraeumt wird, fuer ein Formular, das in derselben Sitzung fertig wird.
 *
 * Der Schluessel haengt am Workspace: sonst taucht der Entwurf der einen
 * Agentur-Kundschaft im Formular der naechsten auf.
 */
const DRAFT_KEY = "thaw:campaign-draft:";
type CampaignDraft = { searchIds: string[]; value: CampaignFormValue };

/**
 * Lohnt sich das Speichern ueberhaupt?
 *
 * Ein unangetastetes Formular zu sichern hiesse, beim naechsten Besuch
 * "Entwurf wiederhergestellt" ueber leere Felder zu schreiben. Gezaehlt wird
 * nur, was der Nutzer selbst getan haben muss: Zeitplan und Messung sind
 * vorbelegt und sagen nichts darueber aus, ob hier jemand gearbeitet hat.
 */
function hatInhalt(searchIds: string[], v: CampaignFormValue): boolean {
  return (
    searchIds.length > 0 ||
    v.name.trim().length > 0 ||
    v.mailboxes.length > 0 ||
    v.steps.some((s) => s.variants.some((x) => x.subject.trim().length > 0 || x.body.trim().length > 0))
  );
}

export default function NewCampaignPage() {
  const { t } = useT();
  const F = t.instantly.campaigns.form;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [searches, setSearches] = useState<SearchOption[] | null>(null);
  /**
   * Vorausgewaehlte Listen aus ?searchId=.
   *
   * Mehrfach erlaubt: eine gebuendelte Mehrfach-Suche schickt von ihrer
   * Detailseite alle Teilsuchen mit, weil an ihrer eigenen ID keine Firmen
   * haengen (Migration 0096). Der Umweg ueber den zusammengefuegten String
   * haelt die Abhaengigkeit der Effekte unten stabil: getAll() gibt bei
   * jedem Rendern ein neues Array zurueck und wuerde sie endlos ausloesen.
   */
  const preselectedRaw = searchParams.getAll("searchId").join(",");
  const preselected = useMemo(
    () => (preselectedRaw ? preselectedRaw.split(",") : []),
    [preselectedRaw]
  );
  const [searchIds, setSearchIds] = useState<string[]>(preselected);
  const [value, setValue] = useState<CampaignFormValue>(emptyCampaignFormValue());
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<LeadPreview | null>(null);
  /**
   * Der Torwart und die bewusste Entscheidung, ihn zu uebergehen.
   *
   * Das Uebergehen wird zurueckgesetzt, sobald sich die Bewertung aendert:
   * wer die Postfaecher wechselt, hat die neuen Blocker noch nie gesehen, und
   * ein einmal gesetztes "trotzdem" wuerde stillschweigend auch fuer die
   * gelten.
   */
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [override, setOverride] = useState(false);
  /** Das Angebot, aus dem erzeugt wurde; es wandert weiter an die Stufenkarten,
   *  damit das Nachschaerfen denselben Zusammenhang kennt. */
  const [offerId, setOfferId] = useState<string | null>(null);
  const handleOfferChange = useCallback((id: string | null) => setOfferId(id), []);
  /**
   * Der wiederhergestellte Entwurf und der Workspace, fuer den er geholt
   * wurde.
   *
   * `restoredFor` ist die Bremse fuers Speichern: erst wenn fuer DIESEN
   * Workspace gelesen wurde, darf geschrieben werden. Sonst kippt der leere
   * Anfangszustand den gespeicherten Entwurf, bevor er ankommt.
   */
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const [restoreNotice, setRestoreNotice] = useState(false);

  const handleReadiness = useCallback((r: ReadinessResult | null) => {
    setReadiness((prev) => {
      if (prev && r && prev.blockers === r.blockers && prev.warnings === r.warnings) return prev;
      setOverride(false);
      return r;
    });
  }, []);

  /** Ein Haken kann mehrere Listen meinen: bei einer Gruppe sind es ihre
   *  Teilsuchen. Alles dahinter (Vorschau, Anlegen, campaign_searches)
   *  arbeitet unveraendert mit echten Such-IDs weiter. */
  function toggleSearch(ids: string[]) {
    setSearchIds((prev) =>
      ids.every((id) => prev.includes(id))
        ? prev.filter((x) => !ids.includes(x))
        : Array.from(new Set([...prev, ...ids]))
    );
  }

  function forgetDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY + workspaceId);
    } catch {
      // Gesperrter Storage: dann gab es auch nichts zu loeschen.
    }
  }

  /** Von vorn anfangen: der Entwurf ist weg, das Formular wieder leer. Die
   *  per ?searchId= mitgebrachte Liste bleibt: sie ist der Grund, warum der
   *  Nutzer ueberhaupt auf dieser Seite steht. */
  function discardDraft() {
    forgetDraft();
    setSearchIds(preselected);
    setValue(emptyCampaignFormValue());
    setRestoreNotice(false);
  }

  // Entwurf holen. Laeuft vor dem Speichern-Effekt und setzt restoredFor;
  // ohne diese Reihenfolge ueberschreibt der leere Anfangszustand das
  // Gespeicherte, bevor es im Formular ankommt.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY + workspaceId);
      const draft = raw ? (JSON.parse(raw) as CampaignDraft) : null;
      if (draft?.value) {
        // Fehlende Felder aus dem Leerwert auffuellen: ein Entwurf von vor
        // einer Formularerweiterung darf kein undefined ins Formular tragen.
        setValue({ ...emptyCampaignFormValue(), ...draft.value });
        // Eine per ?searchId= mitgebrachte Liste schlaegt den Entwurf nicht,
        // sie kommt dazu: wer aus einer Liste heraus hierher klickt, meint sie.
        const ids = draft.searchIds ?? [];
        setSearchIds(Array.from(new Set([...ids, ...preselected])));
        setRestoreNotice(true);
      }
    } catch {
      // Kaputter oder gesperrter Storage (Privatmodus): dann eben ohne
      // Entwurf. Ein leeres Formular ist hier kein Fehlerfall.
    }
    setRestoredFor(workspaceId);
  }, [workspaceId, preselected]);

  // Entwurf sichern. Verzoegert, weil er einen Seitenwechsel ueberleben muss
  // und nicht jeden Tastendruck.
  useEffect(() => {
    if (restoredFor !== workspaceId) return;
    const timer = setTimeout(() => {
      try {
        if (hatInhalt(searchIds, value)) {
          localStorage.setItem(DRAFT_KEY + workspaceId, JSON.stringify({ searchIds, value } satisfies CampaignDraft));
        } else {
          localStorage.removeItem(DRAFT_KEY + workspaceId);
        }
      } catch {
        // Voller oder gesperrter Storage. Der Entwurf ist eine Bequemlichkeit
        // und kein Grund, das Anlegen scheitern zu lassen.
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [restoredFor, workspaceId, searchIds, value]);

  useEffect(() => {
    createClient()
      .from("searches")
      .select("id, name, query, location, instantly_campaign_id, parent_search_id, is_search_group")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => setSearches(data ?? []));
  }, [workspaceId]);

  useEffect(() => {
    if (searchIds.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase
        .from("contacts")
        .select("id, email, title, business_id, is_primary, outreach_status, email_verification_status, businesses!inner(search_id, website)")
        .eq("workspace_id", workspaceId)
        .in("businesses.search_id", searchIds)
        .not("email", "is", null)
        .limit(5000),
      supabase.from("suppression_list").select("email, domain").eq("workspace_id", workspaceId),
      // Muss mitlaufen, weil der Server-Pfad es auch tut (Migration 0095);
      // sonst verspricht die Vorschau Empfaenger, die beim Anlegen wegfallen.
      supabase
        .from("contact_archive")
        .select("email")
        .eq("workspace_id", workspaceId)
        .not("email", "is", null),
    ]).then(([contactsRes, suppressionRes, archivedRes]) => {
      if (cancelled) return;
      const rows = (contactsRes.data ?? []) as unknown as {
        email: string | null;
        title: string | null;
        business_id: string | null;
        is_primary: boolean;
        outreach_status: string;
        email_verification_status: string | null;
        businesses: { website: string | null } | null;
      }[];
      // Dieselbe Regel wie im Server-Pfad (lib/contacts.ts): wer schon
      // reagiert hat (auch auf LinkedIn), zaehlt hier nicht mit, sonst
      // verspricht die Vorschau mehr Empfaenger, als danach rausgehen.
      const { contactable: notDeclined } = splitByEngagement(rows);
      const blocked = [
        ...(suppressionRes.data ?? []),
        ...((archivedRes.data ?? []) as { email: string | null }[]).map((a) => ({
          email: a.email,
          domain: null,
        })),
      ];
      const { sendable, unsendable } = splitBySendability(filterSuppressed(notDeclined, blocked));
      setPreview({
        sendable: pickPrimaryContactPerBusiness(sendable).length,
        invalid: unsendable.length,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [searchIds, workspaceId]);

  /**
   * Die angebotenen Listen: Teilsuchen verschwinden hinter ihrer Gruppe.
   *
   * Ohne das stuenden hier bei einer Laender-Abdeckung sechzig Zeilen "Nische ·
   * Stadt" und eine leere Huelle dazwischen, und wer die Huelle anhakt,
   * bekaeme null Empfaenger.
   */
  const listenOptionen = useMemo(() => groupPickerOptions(searches ?? []), [searches]);
  const listenNachId = useMemo(
    () => new Map((searches ?? []).map((s) => [s.id, s])),
    [searches]
  );

  const blocked = (readiness?.blockers ?? 0) > 0;

  async function create() {
    // Zweite Schranke neben dem abgeschalteten Knopf: das Formular kann per
    // Enter abgeschickt werden, und dann greift disabled nicht.
    if (blocked && !override) {
      push(t.campaignReadiness.blockedTitle(readiness!.blockers), "error");
      return;
    }
    if (
      searchIds.length === 0 ||
      !value.name.trim() ||
      value.mailboxes.length === 0 ||
      value.steps.some((s) => s.variants.some((v) => !v.subject.trim() || !v.body.trim()))
    ) {
      push(F.validationError, "error");
      return;
    }
    setCreating(true);
    const res = await fetch("/api/instantly/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchIds,
        name: value.name,
        mailboxes: value.mailboxes,
        steps: value.steps,
        days: value.days,
        from: value.from,
        to: value.to,
        timezone: value.timezone,
        dailyLimit: Number(value.dailyLimit) || undefined,
        openTracking: value.openTracking,
        linkTracking: value.linkTracking,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setCreating(false);
    if (res.ok) {
      push(
        body.skipped_unverified > 0 ? `${F.created} · ${F.previewSkipped(body.skipped_unverified)}` : F.created,
        "success"
      );
      // Die Kampagne steht, der Entwurf hat sich erledigt: sonst begruesst er
      // beim naechsten Anlegen mit einer Sequenz, die schon verschickt wird.
      forgetDraft();
      router.push(`/instantly/campaigns/${body.campaign_id}`);
    } else {
      push(t.common.error + (body.error ?? res.status), "error");
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.instantly.campaigns.newPageTitle}</h1>
      </div>

      {/* Steht ganz oben, weil es erklaert, warum in den Feldern schon etwas
          steht. Ohne den Hinweis waere das Wiederherstellen eine stille
          Ueberraschung — und niemand traut Feldern, die sich selbst
          ausfuellen. */}
      {restoreNotice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-edge2 bg-field px-3 py-2 text-xs text-faint">
          <span>{F.draftRestored}</span>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={discardDraft}
              className="font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400"
            >
              {F.draftDiscard}
            </button>
            <button type="button" onClick={() => setRestoreNotice(false)} aria-label={F.draftDismiss}>
              ×
            </button>
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-faint">{F.searchLabel}</p>
        <p className="mb-2 text-xs text-faint">{F.searchHint}</p>
        {searches !== null && searches.length === 0 && <p className="text-xs text-faint">{F.noSearches}</p>}
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-edge2 bg-field p-2">
          {listenOptionen.map(({ row: s, searchIds: ids }) => {
            // "Bereits verknuepft" gilt fuer eine Gruppe erst, wenn ALLE ihre
            // Teilsuchen an einer Kampagne haengen: die Verknuepfung schreibt
            // die API auf die Teilsuchen, nie auf die Huelle.
            const linked = ids.every((i) => !!listenNachId.get(i)?.instantly_campaign_id);
            return (
              <label
                key={s.id}
                className={
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm " +
                  (linked ? "cursor-not-allowed text-mute" : "cursor-pointer text-ink hover:bg-chip")
                }
              >
                <input
                  type="checkbox"
                  checked={ids.every((i) => searchIds.includes(i))}
                  disabled={linked}
                  onChange={() => toggleSearch(ids)}
                />
                <span className="truncate">
                  {(s.name || s.query) + " · " + s.location}
                  {linked && " (bereits verknüpft)"}
                </span>
              </label>
            );
          })}
        </div>
        {preview && (
          <p className="mt-2 text-xs text-faint">
            {F.previewSendable(preview.sendable)}
            {preview.invalid > 0 && (
              <span className="text-amber-600 dark:text-amber-500"> · {F.previewSkipped(preview.invalid)}</span>
            )}
          </p>
        )}
      </div>

      {/* Ueber dem Formular, weil es das Formular ausfuellt. Der Name bleibt
          unangetastet: den hat der Nutzer vielleicht schon getippt, und ein
          Generator, der ihn ueberschreibt, waere uebergriffig. */}
      <GenerateSequence
        onGenerated={(steps) => setValue((v) => ({ ...v, steps }))}
        onOfferChange={handleOfferChange}
      />

      <CampaignForm
        value={value}
        onChange={setValue}
        offerId={offerId}
        onSubmit={create}
        submitting={creating}
        submitLabel={F.create}
        submittingLabel={F.creating}
        // Steht ueber dem Absenden-Knopf, nicht darunter: was den Start
        // verhindert, muss gelesen sein, bevor die Hand am Knopf ist.
        beforeSubmit={
          <>
            <CampaignReadinessPanel
              searchIds={searchIds}
              mailboxes={value.mailboxes}
              steps={value.steps}
              onResult={handleReadiness}
            />
            {blocked && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3">
                <p className="text-xs text-faint">{t.campaignReadiness.overrideHint}</p>
                <label className="mt-2 flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  {t.campaignReadiness.override}
                </label>
              </div>
            )}
          </>
        }
        submitDisabled={blocked && !override}
      />
    </div>
  );
}
