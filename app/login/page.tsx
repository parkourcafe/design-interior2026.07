"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { safeDashboardPath } from "@/lib/auth/redirect";

// Supabase-клиент (~70 КБ) грузим лениво — только когда пользователь реально
// отправляет форму. Так стартовый бандл страницы входа остаётся лёгким.
async function supabaseClient() {
  const { createClient } = await import("@/lib/supabase/browser");
  return createClient();
}

type Tab = "password" | "code";
type OtpType = "email" | "signup";

export default function LoginPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("password");
  const [email, setEmail] = useState("");
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/dashboard");

  // Показываем реальную причину, если /auth/callback вернул сюда с ?error=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) setCallbackError(err);
    setNextPath(safeDashboardPath(params.get("next")));
  }, []);

  function callbackUrl() {
    const url = new URL("/auth/callback", window.location.origin);
    url.searchParams.set("next", nextPath);
    return url.toString();
  }

  function goToProtectedPage() {
    router.push(nextPath);
    router.refresh();
  }

  // ── Вход через Google (OAuth) ──────────────────────────────
  async function google() {
    const supabase = await supabaseClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Возврат на текущий origin (не из env) — иначе Supabase не найдёт адрес
      // в allow-list и увезёт на Site URL (главную).
      options: { redirectTo: callbackUrl() },
    });
    if (error) setCallbackError(error.message);
  }

  // ── Вход/регистрация по паролю ─────────────────────────────
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  async function passwordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwError(null);
    const supabase = await supabaseClient();

    if (signup) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: callbackUrl() },
      });
      setPwBusy(false);
      if (error) return setPwError(error.message);
      if (data.session) return goToProtectedPage();

      // При включённом Confirm email Supabase не создаёт сессию до проверки
      // ссылки или 6-значного кода из письма.
      setSignup(false);
      setOtpType("signup");
      setOtp("sent");
      setTab("code");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPwBusy(false);
    if (error) return setPwError(error.message);
    goToProtectedPage();
  }

  // ── Вход по коду на почту (passwordless OTP) ───────────────
  const [code, setCode] = useState("");
  const [otp, setOtp] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [otpType, setOtpType] = useState<OtpType>("email");
  const [otpDetail, setOtpDetail] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setOtp("sending");
    setOtpType("email");
    const supabase = await supabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl(),
        shouldCreateUser: false,
      },
    });
    setOtpDetail(error ? error.message : null);
    setOtp(error ? "error" : "sent");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setCodeError(null);
    const supabase = await supabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: otpType,
    });
    setVerifying(false);
    if (error) return setCodeError(error.message);
    goToProtectedPage();
  }

  const inCodeEntry = tab === "code" && otp === "sent";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-3xl font-semibold">{ru.auth.title}</h1>
      <p className="mt-2 text-sm text-muted">{ru.auth.subtitle}</p>

      {callbackError && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700">
          Не удалось войти по ссылке: {callbackError}
        </p>
      )}

      {/* Google + разделитель — всегда сверху, кроме экрана ввода кода */}
      {!inCodeEntry && (
        <div className="mt-6 space-y-4">
          <button
            type="button"
            onClick={google}
            className="btn flex w-full items-center justify-center gap-3 border border-line bg-white py-3 text-ink hover:border-ink/40"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
            </svg>
            {ru.auth.google}
          </button>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            {ru.auth.or}
            <span className="h-px flex-1 bg-line" />
          </div>

          {/* Переключатель способа: пароль / код на почту */}
          <div className="flex rounded-lg border border-line p-1 text-sm">
            <button
              type="button"
              onClick={() => setTab("password")}
              className={`flex-1 rounded-md py-1.5 ${tab === "password" ? "bg-line/60 font-medium" : "text-muted"}`}
            >
              {ru.auth.tabPassword}
            </button>
            <button
              type="button"
              onClick={() => setTab("code")}
              className={`flex-1 rounded-md py-1.5 ${tab === "code" ? "bg-line/60 font-medium" : "text-muted"}`}
            >
              {ru.auth.tabCode}
            </button>
          </div>
        </div>
      )}

      {/* ── Вкладка: почта и пароль ── */}
      {tab === "password" && (
        <form onSubmit={passwordSubmit} className="mt-5 space-y-4">
          <div>
            <label className="label" htmlFor="email">{ru.auth.emailLabel}</label>
            <input
              id="email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={ru.auth.emailPlaceholder} className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">{ru.auth.passwordLabel}</label>
            <input
              id="password" type="password" required minLength={signup ? 8 : 6}
              autoComplete={signup ? "new-password" : "current-password"}
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={signup ? ru.auth.passwordPlaceholder : ru.auth.passwordLoginPlaceholder}
              className="input"
            />
          </div>
          <button type="submit" disabled={pwBusy} className="btn-primary w-full">
            {pwBusy ? (signup ? ru.auth.signingUp : ru.auth.signingIn) : signup ? ru.auth.signUp : ru.auth.signIn}
          </button>
          {pwError && <p className="text-sm text-red-600">{pwError}</p>}
          <button
            type="button"
            onClick={() => { setSignup(!signup); setPwError(null); }}
            className="text-sm text-muted hover:text-ink"
          >
            {signup ? ru.auth.haveAccount : ru.auth.noAccount}
          </button>
        </form>
      )}

      {/* ── Вкладка: код на почту ── */}
      {tab === "code" && otp !== "sent" && (
        <form onSubmit={sendCode} className="mt-5 space-y-4">
          <div>
            <label className="label" htmlFor="email-code">{ru.auth.emailLabel}</label>
            <input
              id="email-code" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={ru.auth.emailPlaceholder} className="input"
            />
          </div>
          <button type="submit" disabled={otp === "sending"} className="btn-primary w-full">
            {otp === "sending" ? ru.auth.sending : ru.auth.sendCode}
          </button>
          {otp === "error" && (
            <div className="space-y-1">
              <p className="text-sm text-red-600">{ru.auth.error}</p>
              {otpDetail && (
                <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{otpDetail}</p>
              )}
            </div>
          )}
        </form>
      )}

      {inCodeEntry && (
        <div className="mt-6 space-y-5">
          <p className="rounded-md border border-accent/30 bg-accent/5 p-4 text-sm">
            {otpType === "signup" ? ru.auth.confirmSent : ru.auth.sent}
          </p>
          <form onSubmit={verifyCode} className="space-y-3">
            <div>
              <label className="label" htmlFor="code">{ru.auth.codeLabel}</label>
              <input
                id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*"
                maxLength={6} required value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000" className="input tracking-[0.4em]"
              />
            </div>
            <button type="submit" disabled={verifying || code.length < 6} className="btn-primary w-full">
              {verifying ? ru.auth.codeChecking : ru.auth.codeSubmit}
            </button>
            {codeError && <p className="text-sm text-red-600">{ru.auth.codeInvalid}</p>}
          </form>
          <button
            onClick={() => { setOtp("idle"); setOtpType("email"); }}
            className="text-sm text-muted hover:text-ink"
          >
            {ru.auth.otherEmail}
          </button>
        </div>
      )}
    </main>
  );
}
