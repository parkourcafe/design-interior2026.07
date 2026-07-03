"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { appUrl } from "@/lib/env";
import { ru } from "@/lib/i18n/ru";

// Supabase-клиент (~70 КБ) грузим лениво — только когда пользователь реально
// отправляет форму. Так стартовый бандл страницы входа остаётся лёгким.
async function supabaseClient() {
  const { createClient } = await import("@/lib/supabase/browser");
  return createClient();
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(null);

  // Показываем реальную причину, если /auth/callback вернул сюда с ?error=...
  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setCallbackError(err);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = await supabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${appUrl()}/auth/callback` },
    });
    setState(error ? "error" : "sent");
  }

  // Вход по 6-значному коду из письма (не требует клика по ссылке).
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setCodeError(null);
    const supabase = await supabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    setVerifying(false);
    if (error) {
      setCodeError(error.message);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-3xl font-semibold">{ru.auth.title}</h1>
      <p className="mt-2 text-sm text-muted">{ru.auth.subtitle}</p>

      {callbackError && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700">
          Не удалось войти по ссылке: {callbackError}
        </p>
      )}

      {state === "sent" ? (
        <div className="mt-6 space-y-5">
          <p className="rounded-md border border-accent/30 bg-accent/5 p-4 text-sm">{ru.auth.sent}</p>

          <form onSubmit={verifyCode} className="space-y-3">
            <div>
              <label className="label" htmlFor="code">
                Или введите код из письма
              </label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="input tracking-[0.4em]"
              />
            </div>
            <button type="submit" disabled={verifying || code.length < 6} className="btn-primary w-full">
              {verifying ? "Проверяем…" : "Войти по коду"}
            </button>
            {codeError && <p className="text-sm text-red-600">Неверный или просроченный код.</p>}
          </form>

          <button onClick={() => setState("idle")} className="text-sm text-muted hover:text-ink">
            ← Другой email
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">
              {ru.auth.emailLabel}
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={ru.auth.emailPlaceholder}
              className="input"
            />
          </div>
          <button type="submit" disabled={state === "sending"} className="btn-primary w-full">
            {state === "sending" ? ru.auth.sending : ru.auth.submit}
          </button>
          {state === "error" && <p className="text-sm text-red-600">{ru.auth.error}</p>}
        </form>
      )}
    </main>
  );
}
