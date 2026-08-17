"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconLogout } from "./icons";
import { useT } from "./language-provider";

/**
 * Abmelden.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DER KNOPF AUSSIEHT WIE EIN KNOPF
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Bis zum 2026-08-09 stand hier ein "text-xs text-faint"-Link unter der
 * E-Mail-Adresse, also grauer Kleinsttext neben grauem Kleinsttext, ohne
 * Rahmen, ohne Symbol. Er war da, aber niemand fand ihn. Ein Bedienelement,
 * das man suchen muss, gibt es fuer den Nutzer nicht.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ZWEI DINGE, DIE VORHER STILL SCHIEFGEHEN KONNTEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. signOut() konnte scheitern (kein Netz, Supabase nicht erreichbar);
 *    der Rueckgabewert wurde nicht angesehen. Danach lief router.push("/login")
 *    trotzdem, die Middleware sah eine gueltige Sitzung und schickte zurueck
 *    aufs Dashboard. Fuer den Nutzer sah das aus, als haette der Knopf nichts
 *    getan. Jetzt steht die Ursache daneben.
 *
 * 2. Zweimal klicken schickte zwei Abmeldungen los. Harmlos, aber der Knopf
 *    gab bis zum Seitenwechsel keinerlei Rueckmeldung; bei langsamer
 *    Verbindung die haeufigste Ursache fuers zweite Klicken.
 *
 * scope bleibt bewusst auf Supabases Vorgabe 'global': damit enden ALLE
 * Sitzungen dieses Kontos, auch die auf anderen Geraeten. Wer sich abmeldet,
 * meint in aller Regel genau das. 'local' waere die stillere Variante und
 * genau deshalb die falsche.
 */
export default function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: signOutError } = await createClient().auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      setBusy(false);
      return;
    }
    router.push("/login");
    router.refresh();
  }

  // Im Kopf der mobilen Ansicht ist neben Logo und Workspace-Wahl kein Platz
  // fuer ein Wort. Der Fehlerfall faellt dort weg: eine Meldung in einer
  // 56 Pixel hohen Leiste bricht das Layout; sichtbar bleibt, dass die Seite
  // eben nicht wechselt, und in der Seitenleiste steht der Grund.
  if (compact) {
    return (
      <button
        onClick={logout}
        disabled={busy}
        title={t.logout}
        aria-label={t.logout}
        className="shrink-0 rounded-lg border border-edge2 p-1.5 text-soft transition-colors hover:border-edge3 hover:text-ink disabled:opacity-50"
      >
        <IconLogout />
      </button>
    );
  }

  return (
    <>
      <button
        onClick={logout}
        disabled={busy}
        title={t.logoutTitle}
        className="flex w-full items-center gap-1.5 rounded-lg border border-edge2 px-2 py-1 text-xs text-soft transition-colors hover:border-edge3 hover:text-ink disabled:opacity-50"
      >
        <IconLogout className="h-3.5 w-3.5 shrink-0" />
        {busy ? t.loggingOut : t.logout}
      </button>
      {error && <p className="mt-1 text-[11px] leading-snug text-red-600 dark:text-red-400">{error}</p>}
    </>
  );
}
