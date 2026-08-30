"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "../../../language-provider";
import { useToast } from "../../../toast-provider";
import { cardCls, secondaryBtnCls, STATUS_BADGE_CLS } from "@/lib/ui";
import CampaignLeadsPanel from "./campaign-leads-panel";
import VariantPanel from "./variant-panel";
import CampaignForm, { type CampaignFormValue } from "../campaign-form";

type CampaignDetail = {
  id: string;
  name: string;
  status: string;
  instantlyCampaignId: string;
  search: { id: string; name: string | null; query: string; location: string } | null;
  /** Alle verknuepften Lead-Listen (Migration 0050). */
  searches?: { id: string; name: string | null; query: string; location: string }[];
  mailboxes: string[];
  steps: { subject: string; body: string; delayDays: number }[];
  days: number[];
  from: string;
  to: string;
  timezone: string;
  dailyLimit: number | null;
  leadsAdded: number;
  leadsAvailable: number;
  stats: {
    emails_sent_count: number;
    open_count: number;
    reply_count_unique: number;
    bounced_count: number;
    contacted_count: number;
  } | null;
};

export default function CampaignDetail({ id }: { id: string }) {
  const { t } = useT();
  const C = t.instantly.campaigns;
  const D = C.detail;
  const { push } = useToast();
  const router = useRouter();

  const [data, setData] = useState<CampaignDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [formValue, setFormValue] = useState<CampaignFormValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [addingLeads, setAddingLeads] = useState(false);
  /** Die Lead-Liste haengt an einem Klick, siehe Kommentar an CampaignLeadsPanel. */
  const [leadsOpen, setLeadsOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function load() {
    fetch(`/api/instantly/campaigns/${id}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setNotFound(true);
          return;
        }
        setData(body);
        setFormValue({
          name: body.name,
          mailboxes: body.mailboxes,
          steps: body.steps,
          days: body.days,
          from: body.from,
          to: body.to,
          timezone: body.timezone,
          // Beim Bearbeiten kommt der Zustand von Instantly. Null (vor
          // Migration 0071 angelegt) wird als "aus" dargestellt, und beim
          // Speichern damit auch so gesetzt, was die Unklarheit aufloest.
          openTracking: body.openTracking === true,
          linkTracking: body.linkTracking === true,
          dailyLimit: body.dailyLimit ? String(body.dailyLimit) : "",
        });
      })
      .catch(() => setNotFound(true));
  }

  useEffect(load, [id]);

  async function saveChanges() {
    if (!formValue) return;
    setSaving(true);
    const res = await fetch(`/api/instantly/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formValue.name,
        mailboxes: formValue.mailboxes,
        steps: formValue.steps,
        days: formValue.days,
        from: formValue.from,
        to: formValue.to,
        timezone: formValue.timezone,
        dailyLimit: Number(formValue.dailyLimit) || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      push(C.form.saved, "success");
      load();
    } else {
      push(t.common.error + (body.error ?? res.status), "error");
    }
  }

  async function activate() {
    if (!confirm(C.activateConfirm)) return;
    setActivating(true);
    const res = await fetch(`/api/instantly/campaigns/${id}/activate`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setActivating(false);
    if (res.ok) {
      push(C.activated, "success");
      load();
    } else {
      push(t.common.error + (body.error ?? res.status), "error");
    }
  }

  async function pause() {
    setActivating(true);
    const res = await fetch(`/api/instantly/campaigns/${id}/pause`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setActivating(false);
    if (res.ok) {
      push(C.pausedToast, "success");
      load();
    } else {
      push(t.common.error + (body.error ?? res.status), "error");
    }
  }

  async function addLeads() {
    setAddingLeads(true);
    const res = await fetch(`/api/instantly/campaigns/${id}/leads`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setAddingLeads(false);
    if (res.ok) {
      if (body.added > 0) {
        push(D.leadsAddedToast(body.added), "success");
        load();
      } else {
        push(D.noNewLeads, "success");
      }
    } else {
      push(t.common.error + (body.error ?? res.status), "error");
    }
  }

  async function deleteCampaign() {
    if (!confirm(C.deleteConfirm(data?.name ?? ""))) return;
    setDeleting(true);
    const res = await fetch(`/api/instantly/campaigns/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      push(C.deleted, "success");
      router.push("/instantly/campaigns");
    } else {
      setDeleting(false);
      push(C.deleteError + (body.error ?? res.status), "error");
    }
  }

  if (notFound) {
    return (
      <div className="max-w-2xl space-y-4">
        <p className="text-faint">{D.notFound}</p>
        <button
          onClick={deleteCampaign}
          disabled={deleting}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 transition-colors hover:border-red-500 disabled:opacity-50 dark:border-red-900/60 dark:text-red-400 dark:hover:border-red-500"
        >
          {C.delete}
        </button>
      </div>
    );
  }
  if (!data || !formValue) return <p className="text-sm text-faint">{t.common.saving}</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/instantly/campaigns" className="text-xs text-faint hover:text-ink">
          {D.back}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{data.name}</h1>
          <span className={"rounded-full border px-2 py-0.5 text-[11px] " + (STATUS_BADGE_CLS[data.status] ?? "")}>
            {t.instantly.statusLabels[data.status as keyof typeof t.instantly.statusLabels] ?? data.status}
          </span>
        </div>
        {/* Alle verknuepften Listen, nicht nur die erste: eine Kampagne kann
            seit Migration 0050 aus mehreren gespeist werden, und wer wissen
            will, wen er da anschreibt, braucht sie vollstaendig. */}
        {(data.searches?.length ? data.searches : data.search ? [data.search] : []).length > 0 && (
          <p className="text-sm text-faint">
            {D.linkedSearch}{" "}
            {(data.searches?.length ? data.searches : [data.search!]).map((s, i) => (
              <span key={s.id}>
                {i > 0 && ", "}
                <Link href={`/searches/${s.id}`} className="text-sky-600 hover:text-sky-500 dark:text-sky-400">
                  {s.name || s.query}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>

      {data.status === "draft" && (
        <div className={cardCls + " border-amber-500/30"}>
          <p className="mb-3 text-sm text-faint">{D.draftHint}</p>
          <button
            onClick={activate}
            disabled={activating}
            className="w-full rounded-lg bg-sky-600 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-sky-600/25 transition-all hover:bg-sky-500 disabled:opacity-50 sm:w-auto sm:py-2.5"
          >
            {C.activate}
          </button>
        </div>
      )}
      {/* w-full auf dem Handy: "Pausieren" und "Fortsetzen" sind die
          folgenreichsten Knoepfe dieser Seite und standen als 110 Pixel
          breite Kaestchen am linken Rand. */}
      {data.status === "active" && (
        <button onClick={pause} disabled={activating} className={secondaryBtnCls + " w-full sm:w-auto"}>
          {C.pause}
        </button>
      )}
      {data.status === "paused" && (
        <button onClick={activate} disabled={activating} className={secondaryBtnCls + " w-full sm:w-auto"}>
          {C.resume}
        </button>
      )}

      {data.stats && (
        <div className={cardCls}>
          <h2 className="mb-4 font-medium text-ink">{D.statsHeading}</h2>
          {/* grid-cols-2 bleibt auf dem Handy: vier text-2xl-Zahlen
              nebeneinander bekaemen dort je 75 Pixel, und "Bounces" bricht
              darunter in zwei Zeilen um. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-2xl font-semibold text-ink">{data.stats.emails_sent_count}</p>
              <p className="text-xs text-faint">{t.instantly.overview.statsSent}</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{data.stats.open_count}</p>
              <p className="text-xs text-faint">{t.instantly.overview.statsOpens}</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{data.stats.reply_count_unique}</p>
              <p className="text-xs text-faint">{t.instantly.overview.statsReplies}</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{data.stats.bounced_count}</p>
              <p className="text-xs text-faint">{t.instantly.overview.statsBounces}</p>
            </div>
          </div>
        </div>
      )}

      <div className={cardCls}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="mb-1 font-medium text-ink">{D.leadsHeading}</h2>
            <p className="text-sm text-faint">{D.leadsAddedOf(data.leadsAdded, data.leadsAvailable)}</p>
          </div>
          {/* Drei Knoepfe mit Beschriftungen wie "Lead-Liste anzeigen" und
              "Weitere Leads hinzufuegen": nebeneinander brauchen sie rund 480
              Pixel. Auf dem Handy standen sie deshalb in drei Zeilen, aber
              jeder in seiner eigenen Wunschbreite, also treppenfoermig
              versetzt. Gestapelt und in voller Breite sind es drei Zeilen mit
              gerader Kante. */}
          <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center">
            <button onClick={() => setLeadsOpen((v) => !v)} className={secondaryBtnCls}>
              {leadsOpen ? D.hideLeadList : D.showLeadList}
            </button>
            {/* Neben der Lead-Liste, nicht in einem eigenen Block: beides
                beantwortet dieselbe Frage aus zwei Richtungen — wen habe ich
                erreicht, und womit. */}
            <button onClick={() => setVariantsOpen((v) => !v)} className={secondaryBtnCls}>
              {variantsOpen ? D.hideVariants : D.showVariants}
            </button>
            <button onClick={addLeads} disabled={addingLeads || data.leadsAdded >= data.leadsAvailable} className={secondaryBtnCls}>
              {addingLeads ? D.addingLeads : D.addMoreLeads}
            </button>
          </div>
        </div>

        {/* Erst auf Klick: der Abruf kostet je nach Groesse mehrere Anfragen
            an Instantly, und wer nur den Zeitplan aendern will, braucht ihn
            nicht. Die Komponente laedt selbst, sobald sie gerendert wird. */}
        {leadsOpen && <CampaignLeadsPanel campaignId={id} />}
        {variantsOpen && <VariantPanel campaignId={id} />}
      </div>

      <div className={cardCls}>
        <h2 className="mb-4 font-medium text-ink">{D.editHeading}</h2>
        {/* Die Mail-Vorschau gab es bis zum 2026-08-28 NUR beim Anlegen einer
            Kampagne. Wer eine bestehende oeffnete, sah die Textfelder mit
            {{websiteFinding}} als Platzhalter und nirgends, was der Empfaenger
            daraus liest. Genau da faellt aber auf, ob eine Variable leer
            bleibt, und genau das ist am 2026-08-27 an 858 Leads
            unbemerkt geblieben.

            searchIds kommen aus derselben Quelle wie die Liste weiter oben:
            searches, mit Rueckfall auf die einzelne search fuer Kampagnen von
            vor Migration 0050. */}
        <CampaignForm
          value={formValue}
          onChange={setFormValue}
          onSubmit={saveChanges}
          submitting={saving}
          submitLabel={C.form.save}
          submittingLabel={C.form.saving}
          previewSearchIds={
            data.searches?.length
              ? data.searches.map((s) => s.id)
              : data.search
                ? [data.search.id]
                : []
          }
        />
        <div className="mt-6 flex justify-end border-t border-edge/60 pt-4">
          <button
            onClick={deleteCampaign}
            disabled={deleting}
            className="text-sm font-medium text-faint transition-colors hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
          >
            {C.delete}
          </button>
        </div>
      </div>
    </div>
  );
}
