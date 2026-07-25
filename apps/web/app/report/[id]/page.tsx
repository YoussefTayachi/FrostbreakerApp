import { createClient } from "@/lib/supabase/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";

export const dynamic = "force-dynamic";

/**
 * Oeffentlicher, nicht eingeloggter Report fuer einen einzelnen Workspace.
 *
 * Gedacht als teilbarer Link, den eine Agentur an den eigenen Endkunden
 * weitergibt (Punkt 4 Stufe 2 im Differenzierungs-Plan: Branding pro
 * Client-Workspace). Zeigt bewusst NUR aggregierte Kennzahlen, keine
 * einzelnen Kontakte/E-Mails/Namen -- die Daten kommen ausschliesslich aus
 * der SECURITY DEFINER-Funktion get_workspace_report(), die genau das
 * garantiert (siehe supabase/migrations/0021_...).
 *
 * Sicherheit beruht auf der Unraet-barkeit der Workspace-UUID im Link,
 * analog zu den meisten "Share-Link"-Features (z.B. Figma, Loom) -- es gibt
 * bewusst keinen Login-Zwang, damit der Endkunde der Agentur den Link ohne
 * eigenen Account oeffnen kann.
 */
export default async function WorkspaceReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lang = await getLangServer();
  const t = dict[lang].report;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_workspace_report", {
    p_workspace_id: id,
  });

  if (error || !data || !data.workspace_name) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm text-neutral-500">
        {t.notFound}
      </div>
    );
  }

  const brandName: string = data.brand_name || data.workspace_name;
  const brandColor: string = /^#([0-9a-f]{3}){1,2}$/i.test(data.brand_color ?? "")
    ? data.brand_color
    : "#0EA5E9";
  const logoUrl: string | null = data.brand_logo_url || null;

  const cards: { label: string; value: string }[] = [
    { label: t.leadsFound, value: String(data.contacts_total ?? 0) },
    { label: t.withEmail, value: String(data.contacts_with_email ?? 0) },
    { label: t.emailsSent, value: String(data.emails_sent ?? 0) },
    { label: t.replies, value: String(data.replies_unique ?? 0) },
    { label: t.meetings, value: String(data.meetings_booked ?? 0) },
    {
      label: t.pipelineValue,
      value: new Intl.NumberFormat(lang === "en" ? "en-US" : "de-DE", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(Number(data.opportunity_value ?? 0)),
    },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10 dark:bg-neutral-950 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={brandName} className="h-10 w-auto rounded" />
          ) : (
            <span
              className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: brandColor }}
            >
              {brandName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {brandName}
            </h1>
            <p className="text-sm text-neutral-500">{t.subtitle}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {cards.map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <p className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                {c.value}
              </p>
              <p className="mt-1 text-xs text-neutral-500">{c.label}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-neutral-400">
          {t.poweredBy} ·{" "}
          <span className="font-semibold" style={{ color: brandColor }}>
            frostbreaker
          </span>
        </p>
      </div>
    </div>
  );
}
