import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { OFFER_COLUMNS, type Offer } from "@/lib/offers";
import OffersEditor from "./offers-editor";

/**
 * Das Angebot -- was dieser Workspace verkauft.
 *
 * Die Seite, ohne die der Sequenzgenerator nichts zu sagen haette. Sie holt
 * nur die Daten; alles Weitere passiert im Formular, weil dort getippt,
 * gewechselt und vorbefuellt wird.
 *
 * Breiter als die uebrigen Formularseiten (max-w-5xl statt 3xl): rechts steht
 * die Anzeige, die den Zustand des Angebots traegt, und die braucht eine
 * eigene Spalte, sonst waere sie eine Fussnote unter dem letzten Feld.
 */
export default async function OffersPage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;

  const { data } = await supabase
    .from("offers")
    .select(OFFER_COLUMNS)
    .eq("workspace_id", ws.workspace.id)
    .order("created_at", { ascending: true });

  return (
    <div className="fade-up fb-hud max-w-5xl space-y-5">
      <div className="relative overflow-hidden rounded-xl border border-edge/60 bg-panel px-6 py-5">
        <div className="fb-grid-bg absolute inset-0" aria-hidden />
        <div className="relative">
          <p className="fb-label mb-1.5" style={{ color: "var(--fb-frost)" }}>
            {t.offers.eyebrow}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.offers.title}</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-faint">{t.offers.subtitle}</p>
        </div>
      </div>
      <OffersEditor initial={(data ?? []) as unknown as Offer[]} />
    </div>
  );
}
