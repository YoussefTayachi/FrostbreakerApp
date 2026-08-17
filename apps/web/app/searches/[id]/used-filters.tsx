import { searchFilterLines, type FilterKey } from "@/lib/search-filter-lines";
import type { SearchRowForPreset } from "@/lib/search-presets";
import { TECHNOLOGIES } from "@/lib/technologies";
import { dict } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

/**
 * "Womit habe ich eigentlich gesucht?"
 *
 * Server-Komponente ohne jeden Zustand: die Werte stehen fest, sobald die
 * Suche angelegt wurde. Ein Client-Bundle dafuer waere reine Verschwendung.
 *
 * Die Beschriftungen stehen als eigene Karte im Woerterbuch
 * (searchDetail.filterLabels) und nicht als Verweise auf die Texte des
 * Formulars. Naheliegend waere das andere gewesen; gescheitert ist es an den
 * Namen: derselbe Filter heisst im Formular apolloSegments und hier
 * marketSegments, und drei Prospeo-Felder (Herkunftsorte der Person,
 * Finanzierung, Kaufabsicht) haben dort ueberhaupt keine Beschriftung, weil
 * das Formular sie gar nicht anbietet. Die WOERTER sind trotzdem dieselben,
 * das ist der Punkt, auf den es fuer den Nutzer ankommt.
 */
export default function UsedFilters({ row, lang }: { row: SearchRowForPreset; lang: Lang }) {
  const t = dict[lang];
  const zeilen = searchFilterLines(row);
  if (zeilen.length === 0) return null;

  const LABEL = t.searchDetail.filterLabels as Record<FilterKey, string>;

  /** Rohwerte lesbar machen, wo die Oberflaeche einen besseren Namen kennt. */
  function anzeigen(key: FilterKey, items: string[], provider?: "apollo" | "hunter"): string {
    if (key === "seniorities") {
      const labels = t.newSearchForm.apolloSeniorityLabels as Record<string, string>;
      return items.map((i) => labels[i] ?? i).join(", ");
    }
    if (key === "technologies" && provider) {
      // Der Slug des Anbieters ("woo_commerce") ist nicht der Name, den der
      // Nutzer angeklickt hat ("WooCommerce").
      return items
        .map((slug) => TECHNOLOGIES.find((tech) => tech[provider] === slug)?.label ?? slug)
        .join(", ");
    }
    if (key === "noWebsite") return t.searchDetail.filterYes;
    return items.join(", ");
  }

  return (
    <details className="group mt-2 rounded-lg border border-edge/60 bg-panel px-3 py-2">
      <summary className="cursor-pointer list-none text-xs font-medium text-soft transition-colors hover:text-ink">
        {t.searchDetail.usedFilters}
        <span className="ml-1 text-mute group-open:hidden">
          ({zeilen.length})
        </span>
      </summary>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {zeilen.map((z) => (
          <div key={z.key} className="flex gap-2 text-xs">
            <dt className="shrink-0 text-faint">{LABEL[z.key]}:</dt>
            <dd className="min-w-0 text-ink">{anzeigen(z.key, z.items, z.provider)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
