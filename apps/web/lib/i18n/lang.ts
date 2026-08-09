import { cookies } from "next/headers";

export type Lang = "de" | "en";
export const COOKIE_NAME = "lang";

export async function getLangServer(): Promise<Lang> {
  const store = await cookies();
  const v = store.get(COOKIE_NAME)?.value;
  return v === "de" ? "de" : "en";
}

// Die Umsetzung steht in lib/format-time.ts, damit auch Client-Komponenten
// sie benutzen koennen: diese Datei importiert next/headers und ist deshalb
// server-only. Hier nur weitergereicht, damit die bestehenden Aufrufer
// unveraendert bleiben.
export { formatDate } from "@/lib/format-time";
