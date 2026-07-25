import { cookies } from "next/headers";

export type Lang = "de" | "en";
export const COOKIE_NAME = "lang";

export async function getLangServer(): Promise<Lang> {
  const store = await cookies();
  const v = store.get(COOKIE_NAME)?.value;
  return v === "de" ? "de" : "en";
}

export function formatDate(
  iso: string,
  lang: Lang,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" }
): string {
  return new Date(iso).toLocaleString(lang === "en" ? "en-US" : "de-DE", opts);
}
