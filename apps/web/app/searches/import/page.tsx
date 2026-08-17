"use client";
import Link from "next/link";
import { cardCls } from "@/lib/ui";
import { useT } from "../../language-provider";
import ImportCsv from "../import-csv";

/**
 * CSV-Import als Teil der Lead-Beschaffung, nicht der Einstellungen.
 *
 * Er stand bis 2026-08-04 zwischen API-Schluesseln und Farbwerten, und das
 * war nicht nur eine Frage der Ordnung: importierte Firmen bekamen dort
 * search_id = null und landeten damit in keiner Liste. Sie waren unter "Alle
 * Leads" sichtbar, aber als Kampagnenquelle nicht auswaehlbar, also genau
 * fuer den einen Zweck unbrauchbar, fuer den man sie importiert.
 *
 * Hier entsteht aus der Datei eine Lead-Liste wie jede gesuchte auch: sie
 * steht in der Uebersicht, laesst sich als Kampagnenquelle waehlen, taucht in
 * der Pipeline auf und wird in der Wirkungs-Ansicht eigenstaendig
 * ausgewertet.
 */
export default function ImportPage() {
  const { t } = useT();

  return (
    <div className="fade-up max-w-2xl space-y-6">
      <div>
        <Link href="/searches" className="text-xs text-faint transition-colors hover:text-ink">
          ← {t.searches.title}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{t.importCsv.heading}</h1>
        <p className="text-sm text-faint">{t.importCsv.description}</p>
      </div>

      <div className={cardCls}>
        <ImportCsv />
      </div>
    </div>
  );
}
