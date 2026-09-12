import type { TimelinePoint } from "@/lib/report/timeline";

/**
 * Der Zeitverlauf: drei Streifen uebereinander, eine gemeinsame Zeitachse.
 *
 * BEWUSST KEINE GEMEINSAME SKALA. 200 gesendete Mails und 2 Antworten am
 * selben Tag passen auf keine ehrliche gemeinsame Achse: entweder sind die
 * Antworten unsichtbar oder die Sendungen gestaucht. Instantly legt beides
 * uebereinander, und genau dort stand am 2026-09-12 "Reply rate 0%" ueber
 * einer Tabelle mit 4 Antworten. Drei getrennte Streifen mit je eigener
 * Skala zeigen dieselbe Zeitachse, ohne eine der Reihen zu verzerren.
 *
 * HTML-Balken statt SVG: die Seite ist auf 768px begrenzt und auf dem
 * Telefon halb so breit. Ein skalierendes SVG wuerde jede Beschriftung
 * mitschrumpfen; HTML-Text bleibt lesbar, und die Balken tragen als
 * title-Attribut ihren genauen Wert. Die exakten Zahlen stehen zusaetzlich
 * in der aufklappbaren Tabelle darunter -- der Verlauf zeigt die Form,
 * nicht die Nachkommastelle.
 */

type Labels = {
  sent: string;
  replies: string;
  interested: string;
  inWindow: (n: number, days: number) => string;
  noneYet: string;
  asTable: string;
  day: string;
};

function formatDay(day: string, lang: "de" | "en"): string {
  return new Date(day + "T00:00:00Z").toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function Strip({
  points,
  value,
  label,
  summary,
  barClass,
  height,
  lang,
}: {
  points: TimelinePoint[];
  value: (p: TimelinePoint) => number;
  label: string;
  summary: string;
  barClass: string;
  height: string;
  lang: "de" | "en";
}) {
  const max = Math.max(...points.map(value), 1);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-soft">{label}</span>
        <span className="text-xs tabular-nums text-mute">{summary}</span>
      </div>
      {/* items-end + Grundlinie: alle Balken wachsen von derselben Kante.
          gap-px ist der Flaechen-Zwischenraum, der die Tage trennt, statt
          einer Umrandung je Balken. */}
      <div className={"mt-1 flex items-end gap-px border-b border-edge2/70 " + height}>
        {points.map((p) => {
          const v = value(p);
          return (
            <div
              key={p.day}
              className="flex h-full flex-1 items-end"
              title={`${formatDay(p.day, lang)}: ${v}`}
            >
              {v > 0 && (
                <div
                  className={"w-full rounded-t-[3px] " + barClass}
                  // Mindesthoehe 3px: ein Tag mit 1 von 300 waere sonst ein
                  // unsichtbarer Strich, und gerade die seltenen Antworten
                  // sind das, wonach man hier sucht.
                  style={{ height: `${Math.max(6, (v / max) * 100)}%`, minHeight: "3px" }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TimelineChart({
  points,
  labels: L,
  lang,
}: {
  points: TimelinePoint[];
  labels: Labels;
  lang: "de" | "en";
}) {
  const days = points.length;
  const totalSent = points.reduce((n, p) => n + p.sent, 0);
  const totalReplies = points.reduce((n, p) => n + p.replies, 0);
  const totalInterested = points.reduce((n, p) => n + p.interested, 0);
  const mid = points[Math.floor(days / 2)];
  const active = points.filter((p) => p.sent > 0 || p.replies > 0);

  return (
    <div>
      <div className="space-y-4">
        <Strip
          points={points}
          value={(p) => p.sent}
          label={L.sent}
          summary={L.inWindow(totalSent, days)}
          barClass="bg-sky-500/25"
          height="h-16"
          lang={lang}
        />
        <Strip
          points={points}
          value={(p) => p.replies}
          label={L.replies}
          summary={L.inWindow(totalReplies, days)}
          barClass="bg-sky-500"
          height="h-10"
          lang={lang}
        />
        <Strip
          points={points}
          value={(p) => p.interested}
          label={L.interested}
          summary={totalInterested > 0 ? L.inWindow(totalInterested, days) : L.noneYet}
          barClass="bg-emerald-500"
          height="h-10"
          lang={lang}
        />
      </div>

      {/* Die gemeinsame Zeitachse, einmal fuer alle drei Streifen. */}
      <div className="mt-1.5 flex justify-between text-xs text-mute">
        <span>{formatDay(points[0].day, lang)}</span>
        {mid && <span>{formatDay(mid.day, lang)}</span>}
        <span>{formatDay(points[days - 1].day, lang)}</span>
      </div>

      {/* Der Tabellen-Zwilling: jede Zahl ist auch ohne Hover erreichbar. */}
      {active.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-faint transition-colors hover:text-soft">
            {L.asTable}
          </summary>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-mute">
                <th className="py-1 pr-2 font-medium">{L.day}</th>
                <th className="py-1 pr-2 text-right font-medium">{L.sent}</th>
                <th className="py-1 pr-2 text-right font-medium">{L.replies}</th>
                <th className="py-1 text-right font-medium">{L.interested}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-soft">
              {active.map((p) => (
                <tr key={p.day} className="border-t border-edge2/50">
                  <td className="py-1 pr-2">{formatDay(p.day, lang)}</td>
                  <td className="py-1 pr-2 text-right">{p.sent}</td>
                  <td className="py-1 pr-2 text-right">{p.replies}</td>
                  <td className="py-1 text-right">
                    {p.interested > 0 ? (
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        {p.interested}
                      </span>
                    ) : (
                      0
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
