"use client";
import { createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import type { Lang } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "de",
  setLang: () => {},
});

// lang kommt vom Server (Cookie, ueber getLangServer in layout.tsx); dadurch ist der
// erste Client-Render identisch zum Server-Render, kein Hydration-Mismatch/Flackern.
export function LanguageProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const router = useRouter();
  function setLang(next: Lang) {
    document.cookie = `lang=${next}; path=/; max-age=31536000`;
    router.refresh();
  }
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}

/** Bequemer Zugriff auf das Dictionary der aktuellen Sprache in Client-Komponenten. */
export function useT() {
  const { lang } = useContext(LangContext);
  return { t: dict[lang], lang };
}

export function LanguageToggle() {
  const { lang, setLang } = useLang();
  return (
    <button
      onClick={() => setLang(lang === "de" ? "en" : "de")}
      title={lang === "de" ? "Switch to English" : "Auf Deutsch wechseln"}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-edge/60 text-[11px] font-semibold uppercase text-soft transition-all hover:border-edge2 hover:text-ink active:scale-90"
    >
      {lang === "de" ? "EN" : "DE"}
    </button>
  );
}
