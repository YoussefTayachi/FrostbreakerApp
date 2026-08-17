import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { GUIDE } from "@/lib/guide/content";
import GuideView from "./guide-view";

/**
 * Hilfe-Bereich.
 *
 * Die Onboarding-Checkliste auf dem Dashboard sagt, WAS zu tun ist ("API-Key
 * hinterlegen", "Kampagne anlegen"). Sie erklaert aber nicht, WARUM — und
 * genau daran scheitert ein Laie: dass man Kaltakquise nicht ueber die
 * Hauptdomain verschickt und dass Warmup Wochen dauert, steht nirgends, ist
 * aber der Unterschied zwischen funktionierendem Outreach und einer verbrannten
 * Domain.
 *
 * Reine Server-Komponente ohne Datenbankzugriff: der Inhalt ist statisch
 * (lib/guide/content.ts), nur das Auf- und Zuklappen braucht Client-Code.
 */
export default async function GuidePage() {
  const lang = await getLangServer();
  const t = dict[lang];
  return (
    <div className="fade-up max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.guide.title}</h1>
        <p className="text-sm text-faint">{t.guide.subtitle}</p>
      </div>
      <GuideView sections={GUIDE[lang]} labels={t.guide} />
    </div>
  );
}
