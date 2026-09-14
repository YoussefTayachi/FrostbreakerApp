export default function Loading() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="skeleton h-7 w-44" />
        <div className="skeleton mt-2 h-4 w-64" />
      </div>
      {/* Platzhalter in der Form des echten Inhalts: Abokarte, dann das
          Kachelraster der Bereiche, dann zwei Karten. */}
      <div className="skeleton h-44 rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-[88px] rounded-xl" />
        ))}
      </div>
      <div className="skeleton h-40 rounded-xl" />
    </div>
  );
}
