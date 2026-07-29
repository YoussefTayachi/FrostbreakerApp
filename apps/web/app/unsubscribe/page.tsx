import { dict } from "@/lib/i18n/dict";
import { getLangServer } from "@/lib/i18n/lang";
import { cardCls } from "@/lib/ui";

export const dynamic = "force-dynamic";

/**
 * Oeffentliche Bestaetigungsseite fuer den Opt-out-Link aus Kampagnen-Mails.
 * Die eigentliche Eintragung in die Sperrliste passiert schon in
 * app/api/unsubscribe/route.ts (GET, Service-Role-Client) -- diese Seite
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className={cardCls + " max-w-md text-center"}>
        <h1 className="text-lg font-semibold text-ink">{ok ? u.doneTitle : u.invalidTitle}</h1>
        <p className="mt-2 text-sm text-faint">{ok ? u.doneBody : u.invalidBody}</p>
      </div>
    </div>
  );
}
