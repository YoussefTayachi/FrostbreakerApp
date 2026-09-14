"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cardCls, inputCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";

/**
 * Wie der Report nach aussen aussieht.
 *
 * Eigene Seite, weil dieser Bereich als einziger fuer FREMDE Augen bestimmt
 * ist: der Report-Link geht an den Kunden, alles andere in den Einstellungen
 * sieht nur der Betreiber. Zwischen API-Schluesseln stand das an der
 * falschen Stelle.
 */
export default function BrandingPage() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [brandName, setBrandName] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const reportOrigin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    createClient()
      .from("workspaces")
      .select("brand_name, brand_color, brand_logo_url")
      .eq("id", workspaceId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setBrandName(data.brand_name ?? "");
        setBrandColor(data.brand_color ?? "");
        setBrandLogoUrl(data.brand_logo_url ?? "");
      });
  }, [workspaceId]);

  async function save() {
    setSaving(true);
    const { error } = await createClient()
      .from("workspaces")
      .update({
        brand_name: brandName.trim() || null,
        brand_color: brandColor.trim() || null,
        brand_logo_url: brandLogoUrl.trim() || null,
      })
      .eq("id", workspaceId);
    setSaving(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    push(t.branding.saved, "success");
  }

  function copyReportLink() {
    navigator.clipboard.writeText(`${reportOrigin}/report/${workspaceId}`);
    setLinkCopied(true);
    push(t.branding.linkCopied, "success");
    setTimeout(() => setLinkCopied(false), 2000);
  }

  return (
    <div className="fade-up max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.branding.heading}</h1>
        <p className="mt-1 text-sm text-faint">{t.branding.description}</p>
      </div>

      <div className={cardCls}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-soft">{t.branding.brandNameLabel}</label>
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder={t.branding.brandNamePlaceholder}
              className={inputCls + " w-full"}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-soft">{t.branding.brandColorLabel}</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#([0-9a-f]{3}){1,2}$/i.test(brandColor) ? brandColor : "#0ea5e9"}
                onChange={(e) => setBrandColor(e.target.value)}
                aria-label={t.branding.brandColorLabel}
                className="h-[42px] w-12 shrink-0 cursor-pointer rounded-lg border border-edge2 bg-field p-1"
              />
              <input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#0EA5E9"
                className={inputCls + " w-full"}
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-soft">{t.branding.brandLogoLabel}</label>
            <input
              value={brandLogoUrl}
              onChange={(e) => setBrandLogoUrl(e.target.value)}
              placeholder={t.branding.brandLogoPlaceholder}
              className={inputCls + " w-full"}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={save} disabled={saving} className={primaryBtnCls + " w-full sm:w-auto"}>
            {saving ? t.branding.saving : t.branding.save}
          </button>
        </div>

        <div className="mt-6 border-t border-edge/70 pt-5">
          <h3 className="text-base font-semibold text-ink">{t.branding.reportLinkHeading}</h3>
          <p className="mb-4 mt-1 text-sm leading-relaxed text-faint">{t.branding.reportLinkDescription}</p>
          {/* Der Link ist lang: unter sm gehoert der Kopierknopf unter das
              Feld, sonst bleibt vom Link ein Streifen von vier Zeichen. */}
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <input
              readOnly
              value={`${reportOrigin}/report/${workspaceId}`}
              onFocus={(e) => e.currentTarget.select()}
              className={inputCls + " w-full text-faint sm:flex-1"}
            />
            <button onClick={copyReportLink} className={secondaryBtnCls}>
              {linkCopied ? t.branding.linkCopied : t.branding.copyLink}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
