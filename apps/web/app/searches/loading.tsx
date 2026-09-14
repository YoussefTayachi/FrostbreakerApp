export default function Loading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="skeleton h-8 w-40" />
        <div className="skeleton mt-2 h-4 w-64" />
      </div>
      {/* Filterleiste und Ordnerreiter stehen auf der fertigen Seite ueber der
          Liste; ohne sie sprang beim Eintreffen alles um rund 80 Pixel. */}
      <div className="flex flex-wrap gap-2">
        <div className="skeleton h-9 w-56 rounded-lg" />
        <div className="skeleton h-9 w-36 rounded-lg" />
        <div className="skeleton h-9 w-36 rounded-lg" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
