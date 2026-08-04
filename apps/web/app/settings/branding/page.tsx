"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cardCls, inputCls, primaryBtnCls } from "@/lib/ui";
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
    <div className="fade-up max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.branding.heading}</h1>
        <p className="text-sm text-faint">{t.branding.description}</p>
      </div>

      <div className={cardCls}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-faint">{t.branding.brandNameLabel}</label>
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder={t.branding.brandNamePlaceholder}
              className={inputCls + " w-full"}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-faint">{t.branding.brandColorLabel}</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#([0-9a-f]{3}){1,2}$/i.test(brandColor) ? brandColor : "#0ea5e9"}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-edge2 bg-field"
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
            <label className="mb-1.5 block text-xs font-medium text-faint">{t.branding.brandLogoLabel}</label>
            <input
              value={brandLogoUrl}
              onChange={(e) => setBrandLogoUrl(e.target.value)}
              placeholder={t.branding.brandLogoPlaceholder}
              className={inputCls + " w-full"}
            />
          </div>
        </div>
        <button onClick={save} disabled={saving} className={primaryBtnCls + " mt-4"}>
          {saving ? t.branding.saving : t.branding.save}
        </button>

        <div className="mt-6 border-t border-edge/60 pt-5">
          <h3 className="text-sm font-medium text-ink">{t.branding.reportLinkHeading}</h3>
          <p className="mb-3 mt-1 text-xs text-faint">{t.branding.reportLinkDescription}</p>
          <div className="flex gap-3">
            <input
              readOnly
              value={`${reportOrigin}/report/${workspaceId}`}
              onFocus={(e) => e.currentTarget.select()}
              className={inputCls + " flex-1 text-faint"}
            />
            <button
              onClick={copyReportLink}
              className="rounded-lg border border-edge2 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400"
            >
              {linkCopied ? t.branding.linkCopied : t.branding.copyLink}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
