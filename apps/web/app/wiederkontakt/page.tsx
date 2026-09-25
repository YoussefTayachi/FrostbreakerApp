import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import WiederkontaktList from "./wiederkontakt-list";

/**
 * Wiederkontakt: wer abwesend war, wartet hier auf seine Woche.
 *
 * Die Seite zeigt nur den Stand und den einen Knopf je Woche und Absender.
 * Was er tut, steht in lib/wiederkontakt-server.ts (createBucket); der
 * Wochen-Cron drueckt ihn jeden Montag von selbst.
 */
export default async function WiederkontaktPage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const W = t.wiederkontakt;
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return null;

  return (
    <div className="fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{W.title}</h1>
        <p className="mt-1 text-sm text-faint">{W.subtitle}</p>
      </div>
      <WiederkontaktList />
      <div className="rounded-xl border border-edge/70 bg-panel p-5 shadow-sm sm:p-6">
        <div className="text-2xs font-medium uppercase tracking-wider text-mute">{W.howTitle}</div>
        <ol className="mt-2 space-y-1.5 text-sm text-soft">
          {W.how.map((zeile, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="tabular text-mute">{i + 1}.</span>
              <span>{zeile}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
