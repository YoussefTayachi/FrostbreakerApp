"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { inputCls, primaryBtnCls } from "@/lib/ui";

/**
 * Wohin nach der Anmeldung, wenn die Middleware ein Ziel mitgegeben hat.
 *
 * Nur eigene Pfade. Ein "next", das mit "//" oder einem Schema beginnt, waere
 * eine offene Weiterleitung: ein Angreifer schickt jemandem
 * /login?next=//boese.example, das Opfer meldet sich bei Frostbreaker an und
 * landet auf einer fremden Seite, die wie Frostbreaker aussieht. Deshalb muss
 * der Wert mit genau einem Schraegstrich beginnen, sonst gilt "/".
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useT();
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get("error") === "confirm_failed") {
      push(t.login.confirmFailed, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      push(t.login.failed + error.message, "error");
      return;
    }
    router.push(safeNext(searchParams.get("next")));
    router.refresh();
  }

  return (
    <div className="auth-bg flex min-h-screen items-center justify-center px-4 py-10">
      <div className="fade-up w-full max-w-[26rem]">
        <div className="mb-8 text-center">
          <span className="text-[40px] font-bold leading-none tracking-[-0.045em] text-[#0EA5E9]">frostbreaker</span>
          <p className="mt-3 text-sm text-faint">{t.login.tagline}</p>
        </div>

        <div className="rounded-2xl bg-panel p-6 shadow-xl ring-1 ring-edge/70 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{t.login.heading}</h1>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-soft">{t.login.emailPlaceholder}</span>
              <input
                type="email" required autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls + " h-11 w-full"}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-soft">{t.login.passwordPlaceholder}</span>
              <input
                type="password" required autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls + " h-11 w-full"}
              />
            </label>
            <button disabled={loading} className={primaryBtnCls + " mt-2 h-11 w-full"}>
              {loading ? t.login.submitting : t.login.submit}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-faint">
          {t.login.noAccount}{" "}
          <a href="/signup" className="font-medium text-sky-600 transition-colors hover:text-sky-500 dark:text-sky-400">
            {t.login.signupLink}
          </a>
        </p>
        <p className="mt-2 text-center text-xs text-mute">{t.login.footer}</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
