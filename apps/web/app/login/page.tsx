"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";

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
    <div className="dot-grid flex min-h-screen items-center justify-center px-4">
      <div className="fade-up w-full max-w-sm">
        <div className="mb-7">
          <span className="text-4xl font-bold tracking-[-0.045em] text-[#0EA5E9]">frostbreaker</span>
          <p className="mt-2 text-sm text-faint">{t.login.tagline}</p>
        </div>

        <div className="rounded-2xl border border-edge/70 bg-panel p-6 shadow-lg sm:p-7">
          <h2 className="mb-5 text-lg font-semibold text-ink">{t.login.heading}</h2>
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email" required placeholder={t.login.emailPlaceholder} value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-edge2 bg-field px-3.5 py-3 text-sm text-ink placeholder-mute outline-none transition-[border-color,box-shadow] focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
            />
            <input
              type="password" required placeholder={t.login.passwordPlaceholder} value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-edge2 bg-field px-3.5 py-3 text-sm text-ink placeholder-mute outline-none transition-[border-color,box-shadow] focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
            />
            <button
              disabled={loading}
              className="w-full rounded-lg bg-ink py-3 text-sm font-semibold text-surface shadow-sm transition-[opacity,transform] hover:opacity-85 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? t.login.submitting : t.login.submit}
            </button>
          </form>
        </div>
        <p className="mt-5 text-center text-xs text-mute">
          {t.login.noAccount}{" "}
          <a href="/signup" className="font-medium text-ink underline underline-offset-2">
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
