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
  // Реальный текст ошибки Supabase (SMTP/лимит/конфиг) — под общим сообщением,
  // чтобы причина сбоя отправки была видна, а не пряталась (QA BUG #2).
  const [sendErrorDetail, setSendErrorDetail] = useState<string | null>(null);

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
    setSendErrorDetail(error ? error.message : null);
    setState(error ? "error" : "sent");
  }

  // Вход через Google (OAuth) — без писем вообще. Redirect на /auth/callback,
  // который уже умеет обменять ?code на сессию (PKCE).
  async function google() {
    const supabase = await supabaseClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${appUrl()}/auth/callback` },
    });
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

      {state !== "sent" && (
        <div className="mt-6 space-y-4">
          <button
            type="button"
            onClick={google}
            className="btn flex w-full items-center justify-center gap-3 border border-line bg-white py-3 text-ink hover:border-ink/40"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z"
              />
            </svg>
            {ru.auth.google}
          </button>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            {ru.auth.or}
            <span className="h-px flex-1 bg-line" />
          </div>
        </div>
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
          {state === "error" && (
            <div className="space-y-1">
              <p className="text-sm text-red-600">{ru.auth.error}</p>
              {sendErrorDetail && (
                <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  {sendErrorDetail}
                </p>
              )}
            </div>
          )}
        </form>
      )}
    </main>
  );
}
