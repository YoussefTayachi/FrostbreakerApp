"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pickPrimaryContactPerBusiness, splitByEngagement, splitBySendability } from "@/lib/contacts";
import { filterSuppressed } from "@/lib/suppression";
import { useT } from "../../../language-provider";
import { useToast } from "../../../toast-provider";
import { useWorkspace } from "../../../workspace-provider";
import CampaignForm, { emptyCampaignFormValue, type CampaignFormValue } from "../campaign-form";
import CampaignReadinessPanel, { type ReadinessResult } from "../campaign-readiness-panel";

type SearchOption = { id: string; name: string | null; query: string; location: string; instantly_campaign_id: string | null };

/** Vorschau auf die Menge, die tatsaechlich versendet wuerde -- dieselben
 *  Filter wie in api/instantly/campaigns (ungueltig, blockiert, kein
 *  Interesse, eine Person pro Firma), damit die Zahl hier nicht hoeher ist
 *  als die spaeter tatsaechlich angelegte Kampagne. */
type LeadPreview = { sendable: number; invalid: number };

export default function NewCampaignPage() {
  const { t } = useT();
  const F = t.instantly.campaigns.form;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [searches, setSearches] = useState<SearchOption[] | null>(null);
  const preselected = searchParams.get("searchId");
  const [searchIds, setSearchIds] = useState<string[]>(preselected ? [preselected] : []);
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

  const handleReadiness = useCallback((r: ReadinessResult | null) => {
    setReadiness((prev) => {
      if (prev && r && prev.blockers === r.blockers && prev.warnings === r.warnings) return prev;
      setOverride(false);
      return r;
    });
  }, []);

  function toggleSearch(id: string) {
    setSearchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  useEffect(() => {
    createClient()
      .from("searches")
      .select("id, name, query, location, instantly_campaign_id")
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
    ]).then(([contactsRes, suppressionRes]) => {
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
      // reagiert hat -- auch auf LinkedIn -- zaehlt hier nicht mit, sonst
      // verspricht die Vorschau mehr Empfaenger, als danach rausgehen.
      const { contactable: notDeclined } = splitByEngagement(rows);
      const { sendable, unsendable } = splitBySendability(
        filterSuppressed(notDeclined, suppressionRes.data ?? [])
      );
      setPreview({
        sendable: pickPrimaryContactPerBusiness(sendable).length,
        invalid: unsendable.length,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [searchIds, workspaceId]);

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

      <div>
        <p className="mb-1.5 text-xs font-medium text-faint">{F.searchLabel}</p>
        <p className="mb-2 text-xs text-faint">{F.searchHint}</p>
        {searches !== null && searches.length === 0 && <p className="text-xs text-faint">{F.noSearches}</p>}
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-edge2 bg-field p-2">
          {(searches ?? []).map((s) => {
            const linked = !!s.instantly_campaign_id;
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
                  checked={searchIds.includes(s.id)}
                  disabled={linked}
                  onChange={() => toggleSearch(s.id)}
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

      <CampaignForm
        value={value}
        onChange={setValue}
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
