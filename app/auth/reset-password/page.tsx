"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";

async function supabaseClient() {
  const { createClient } = await import("@/lib/supabase/browser");
  return createClient();
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 6) return setError(ru.auth.passwordTooShort);
    if (password !== confirm) return setError(ru.auth.passwordMismatch);

    setBusy(true);
    try {
      const supabase = await supabaseClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message || ru.auth.resetError);
      } else {
        setSaved(true);
      }
    } catch {
      setError(ru.auth.resetError);
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <h1 className="font-display text-3xl font-semibold">{ru.auth.resetTitle}</h1>
        <p className="mt-3 rounded-md border border-accent/30 bg-accent/5 p-4 text-sm">{ru.auth.resetSuccess}</p>
        <button type="button" onClick={() => router.push("/dashboard")} className="btn-primary mt-5 w-full">
          {ru.auth.goToDashboard}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-3xl font-semibold">{ru.auth.resetTitle}</h1>
      <p className="mt-2 text-sm text-muted">{ru.auth.resetSubtitle}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="new-password">{ru.auth.newPasswordLabel}</label>
          <input id="new-password" type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="confirm-password">{ru.auth.confirmPasswordLabel}</label>
          <input id="confirm-password" type="password" required minLength={6} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="input" />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? ru.auth.savingPassword : ru.auth.savePassword}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </main>
  );
}
