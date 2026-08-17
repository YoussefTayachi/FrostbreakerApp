"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * maxMs begrenzt, wie lange nachgeladen wird.
 *
 * Das Dashboard laesst es weg: dort haengt das Nachladen an "es laufen Jobs",
 * und wenn keine mehr laufen, verschwindet die Komponente von selbst. Die
 * Suchdetail-Seite braucht die Grenze, weil ihre Bedingung "eine Firma ohne
 * Aufhaenger" auch dann wahr bleibt, wenn der Job endgueltig gescheitert ist
 * — ohne Grenze wuerde der Tab bis zum naechsten Neustart alle fuenf
 * Sekunden die Seite neu holen.
 */
export default function AutoRefresh({
  intervalMs = 5000,
  maxMs,
}: {
  intervalMs?: number;
  maxMs?: number;
} = {}) {
  const router = useRouter();
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      if (maxMs !== undefined && Date.now() - start > maxMs) {
        clearInterval(t);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs, maxMs]);
  return null;
}
