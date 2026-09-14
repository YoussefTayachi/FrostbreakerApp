export default function Loading() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="skeleton h-7 w-32" />
        <div className="skeleton mt-2 h-4 w-72" />
      </div>
      <div className="skeleton h-32 rounded-xl" />
      <div className="skeleton h-96 rounded-xl" />
      <div className="skeleton h-40 rounded-xl" />
    </div>
  );
}
