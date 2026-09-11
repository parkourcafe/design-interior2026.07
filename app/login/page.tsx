"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { safeProjectCeoLoginNext } from "@/lib/project-intelligence/delivery/projectceo/invitation-login";

// Клиент загружается только после явного выбора data cell.
async function supabaseClient(market: "ru" | "international") {
  const { createRegionalBrowserClient } = await import("@/lib/supabase/regional");
  return createRegionalBrowserClient(market === "ru" ? "ru" : "us");
}

type Tab = "password" | "code";

function authErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() && message.trim() !== "{}") {
      return message.trim();
    }
  }
  return fallback;
}

function passwordErrorMessage(error: unknown): string {
  const message = authErrorMessage(error, ru.auth.genericError);
  return /invalid login credentials/i.test(message) ? ru.auth.invalidCredentials : message;
}

export default function LoginPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("password");
  const [email, setEmail] = useState("");
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [showGoogle, setShowGoogle] = useState(false);

  // Показываем реальную причину, если /auth/callback вернул сюда с ?error=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error_description") || params.get("error");
    if (err) {
      setCallbackError(err === "no_auth_params" ? ru.auth.noAuthParams : err.replaceAll("+", " "));
    }
  }, []);

  // Google OAuth нельзя открывать внутри WKWebView: провайдер блокирует такой
  // сценарий, а App Store ожидает эквивалентный Apple-вход для стороннего
  // социального логина. В native iOS оставляем собственные способы входа
  // (пароль и одноразовый код); в браузере и Android Google остаётся доступен.
  useEffect(() => {
    let active = true;

    void import("@capacitor/core")
      .then(({ Capacitor }) => {
        if (!active) return;
        const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
        setShowGoogle(!isNativeIos);
      })
      .catch(() => {
        if (active) setShowGoogle(true);
      });

    return () => {
      active = false;
    };
  }, []);

  function loginNext(): string {
    return safeProjectCeoLoginNext(window.location.search);
  }

  function authCallbackUrl(next = loginNext()): string {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  }

  function goToAuthenticatedDestination() {
    router.push(loginNext());
    router.refresh();
  }

  const [market, setMarket] = useState<"ru" | "international" | "">("");

  async function selectMarket(): Promise<"ru" | "international" | null> {
    if (!market) {
      setCallbackError(ru.auth.marketSelectionError);
      return null;
    }
    const response = await fetch("/api/market/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market }),
    });
    if (!response.ok) {
      setCallbackError(ru.auth.marketSelectionError);
      return null;
    }
    return market;
  }

  async function bindSelectedMarket(): Promise<boolean> {
    const response = await fetch("/api/auth/market-binding", { method: "POST" });
    if (response.ok) return true;
    setCallbackError(ru.auth.marketSelectionError);
    return false;
  }

  // ── Вход через Google (OAuth) ──────────────────────────────
  async function google() {
    setCallbackError(null);
    try {
      const selectedMarket = await selectMarket();
      if (!selectedMarket) return;
      const supabase = await supabaseClient(selectedMarket);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        // Возврат на текущий origin (не из env) — иначе Supabase не найдёт адрес
        // в allow-list и увезёт на Site URL (главную).
        options: { redirectTo: authCallbackUrl() },
      });
      if (error) setCallbackError(authErrorMessage(error, ru.auth.googleError));
    } catch (error) {
      setCallbackError(authErrorMessage(error, ru.auth.googleError));
    }
  }

  // ── Вход/регистрация по паролю ─────────────────────────────
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [signupConfirmationSent, setSignupConfirmationSent] = useState(false);

  async function passwordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwError(null);
    setSignupConfirmationSent(false);
    try {
      if (signup) {
        const selectedMarket = await selectMarket();
        if (!selectedMarket) {
          setPwBusy(false);
          return setPwError(ru.auth.marketSelectionError);
        }
        const registerResponse = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const result = await registerResponse.json().catch(() => ({})) as {
          error?: unknown;
          requiresConfirmation?: unknown;
        };
        setPwBusy(false);
        if (!registerResponse.ok) {
          return setPwError(typeof result.error === "string" ? result.error : ru.auth.genericError);
        }
        if (result.requiresConfirmation !== false) {
          setSignupConfirmationSent(true);
          return;
        }
        goToAuthenticatedDestination();
        return;
      }

      const selectedMarket = await selectMarket();
      if (!selectedMarket) {
        setPwBusy(false);
        return setPwError(ru.auth.marketSelectionError);
      }
      const supabase = await supabaseClient(selectedMarket);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setPwBusy(false);
      if (error) return setPwError(passwordErrorMessage(error));
      if (!(await bindSelectedMarket())) return;
      goToAuthenticatedDestination();
    } catch (error) {
      setPwBusy(false);
      setPwError(passwordErrorMessage(error));
    }
  }

  async function resetPassword() {
    setPwError(null);
    if (!email.trim()) {
      setPwError(ru.auth.emailRequiredForReset);
      return;
    }
    setPwBusy(true);
    try {
      const selectedMarket = await selectMarket();
      if (!selectedMarket) return;
      const supabase = await supabaseClient(selectedMarket);
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: authCallbackUrl("/auth/reset-password"),
      });
      if (error) {
        setPwError(authErrorMessage(error, ru.auth.resetError));
      } else {
        setSignupConfirmationSent(true);
      }
    } catch (error) {
      setPwError(authErrorMessage(error, ru.auth.resetError));
    } finally {
      setPwBusy(false);
    }
  }

  // ── Вход по коду на почту (passwordless OTP) ───────────────
  const [code, setCode] = useState("");
  const [otp, setOtp] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [otpDetail, setOtpDetail] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setOtp("sending");
    try {
      const selectedMarket = await selectMarket();
      if (!selectedMarket) {
        setOtp("error");
        setOtpDetail(ru.auth.marketSelectionError);
        return;
      }
      const supabase = await supabaseClient(selectedMarket);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: authCallbackUrl() },
      });
      setOtpDetail(error ? authErrorMessage(error, ru.auth.otpError) : null);
      setOtp(error ? "error" : "sent");
    } catch (error) {
      setOtpDetail(authErrorMessage(error, ru.auth.otpError));
      setOtp("error");
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setCodeError(null);
    try {
      const selectedMarket = await selectMarket();
      if (!selectedMarket) {
        setVerifying(false);
        return setCodeError(ru.auth.marketSelectionError);
      }
      const supabase = await supabaseClient(selectedMarket);
      const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
      setVerifying(false);
      if (error) return setCodeError(error.message);
      if (!(await bindSelectedMarket())) return;
      goToAuthenticatedDestination();
    } catch {
      setVerifying(false);
      setCodeError(ru.auth.codeInvalid);
    }
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

      <label className="label mt-5" htmlFor="market">
        {ru.auth.marketLabel}
        <select
          id="market"
          value={market}
          onChange={(event) => setMarket(event.target.value as "ru" | "international" | "")}
          className="input mt-1"
        >
          <option value="" disabled>{ru.auth.marketPlaceholder}</option>
          <option value="ru">{ru.auth.marketRu}</option>
          <option value="international">{ru.auth.marketInternational}</option>
        </select>
        <span className="mt-1 block text-xs font-normal text-muted">{ru.auth.marketHint}</span>
      </label>

      {/* Способы входа — всегда сверху, кроме экрана ввода кода. */}
      {!inCodeEntry && (
        <div className="mt-6 space-y-4">
          {showGoogle && !signup && (
            <>
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
            </>
          )}

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
              id="password" type="password" required minLength={6}
              autoComplete={signup ? "new-password" : "current-password"}
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={ru.auth.passwordPlaceholder} className="input"
            />
          </div>
          {!signup && (
            <button
              type="button"
              onClick={resetPassword}
              disabled={pwBusy}
              className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              {ru.auth.forgotPassword}
            </button>
          )}
          <button type="submit" disabled={pwBusy} className="btn-primary w-full">
            {pwBusy ? (signup ? ru.auth.signingUp : ru.auth.signingIn) : signup ? ru.auth.signUp : ru.auth.signIn}
          </button>
          {pwError && <p className="text-sm text-red-600">{pwError}</p>}
          {signupConfirmationSent && (
            <p className="rounded-md border border-accent/30 bg-accent/5 p-3 text-sm">
              {ru.auth.confirmSent}
            </p>
          )}
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
          <p className="rounded-md border border-accent/30 bg-accent/5 p-4 text-sm">{ru.auth.sent}</p>
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
          <button onClick={() => setOtp("idle")} className="text-sm text-muted hover:text-ink">
            {ru.auth.otherEmail}
          </button>
        </div>
      )}
    </main>
  );
}
