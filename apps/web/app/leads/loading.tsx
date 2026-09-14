export default function Loading() {
  return (
    <div className="space-y-6">
      <div>
        {/* Hoehe des echten Titels (text-2xl, 34px Zeilenhoehe), nicht eine
            beliebige: sonst springt die Seite beim Eintreffen der Daten. */}
        <div className="skeleton h-8 w-48" />
        <div className="skeleton mt-2 h-5 w-72" />
      </div>
      <div className="skeleton h-[480px] rounded-xl" />
    </div>
  );
}
