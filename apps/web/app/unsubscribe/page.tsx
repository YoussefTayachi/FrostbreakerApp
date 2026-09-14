import { dict } from "@/lib/i18n/dict";
import { getLangServer } from "@/lib/i18n/lang";
import { cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

/**
 * Oeffentliche Bestaetigungsseite fuer den Opt-out-Link aus Kampagnen-Mails.
 * Die eigentliche Eintragung in die Sperrliste passiert schon in
 * app/api/unsubscribe/route.ts (GET, Service-Role-Client); diese Seite
 * zeigt nur das Ergebnis per ?status=ok|error|invalid. Kein Login noetig,
 * dafuer in middleware.ts als oeffentlicher Pfad gefuehrt, analog zu /login.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const lang = await getLangServer();
  const u = dict[lang].unsubscribePage;
  const ok = status === "ok";

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className={cardCls + " fade-up w-full max-w-md text-center"}>
        {/* Das Ergebnis zuerst als Zeichen, dann als Satz: wer den Link aus einer
            Mail heraus oeffnet, will in einer halben Sekunde wissen, ob es
            geklappt hat. */}
        <span
          aria-hidden
          className={
            "mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full " +
            (ok
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-300")
          }
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            {ok ? <path d="m5 13 4 4L19 7" /> : <><path d="M12 8v5" /><path d="M12 17h.01" /></>}
          </svg>
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {ok ? u.doneTitle : u.invalidTitle}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-faint">
          {ok ? u.doneBody : u.invalidBody}
        </p>
      </div>
    </div>
  );
}
