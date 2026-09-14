export default function ActivityChart({ data }: { data: { day: string; leads: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.leads));
  return (
    <div className="flex h-28 items-end gap-1.5">
      {data.map((d, i) => {
        const h = Math.max(4, (d.leads / max) * 100);
        return (
          <div key={i} className="group relative flex h-full flex-1 items-end">
            <div
              className={
                "bar-rise w-full rounded-t-md transition-colors duration-150 " +
                (d.leads > 0
                  ? "bg-gradient-to-t from-sky-600/80 to-sky-400/80 group-hover:from-sky-500 group-hover:to-sky-300"
                  : "bg-chip")
              }
              style={{ height: h + "%", animationDelay: i * 35 + "ms" }}
            />
            <div className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-edge2 bg-panel px-2.5 py-1 text-2xs font-medium text-soft opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
              {d.day}: {d.leads} Leads
            </div>
          </div>
        );
      })}
    </div>
  );
}
