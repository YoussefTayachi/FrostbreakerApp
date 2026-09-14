/**
 * Der Ladezustand des Dashboards hat die Form des Dashboards.
 *
 * Vorher standen hier acht gleich grosse Kacheln und zwei Bloecke, also ein
 * Raster, das es auf der fertigen Seite gar nicht gibt: der Inhalt sprang beim
 * Eintreffen an eine voellig andere Stelle. Jetzt bilden die Platzhalter die
 * echte Reihenfolge ab (Kopf, KPI-Leiste, Diagramm plus Leads, Suchformular,
 * Liste), damit nichts springt, was schon an seinem Platz stand.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <div>
        <div className="skeleton h-8 w-48" />
        <div className="skeleton mt-2 h-4 w-72" />
      </div>

      {/* KPI-Leiste: sechs Felder in einer Reihe, auf dem Handy zwei Spalten. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge/70 bg-edge/70 sm:grid-cols-3 md:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-panel px-4 py-4">
            <div className="skeleton h-3 w-16 rounded-md" />
            <div className="skeleton mt-2 h-7 w-14 rounded-md" />
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="skeleton h-64 rounded-xl lg:col-span-3" />
        <div className="skeleton h-64 rounded-xl lg:col-span-2" />
      </div>

      <div className="skeleton h-56 rounded-xl" />
      <div className="skeleton h-64 rounded-xl" />
    </div>
  );
}
