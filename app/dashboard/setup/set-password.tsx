"use client";

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";

async function supabaseClient() {
  const { createClient } = await import("@/lib/supabase/browser");
  return createClient();
}

// Задать/сменить пароль для уже залогиненного дизайнера. Включает вход по
// почте+паролю с любого устройства (и передачу доступа общим логином/паролем).
export default function SetPassword({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(false);
    const supabase = await supabaseClient();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
    } else {
      setOk(true);
      setPassword("");
    }
  }

  return (
    <section className="card mt-6">
      <h2 className="font-display text-xl font-semibold">{ru.setPassword.heading}</h2>
      <p className="mt-1 text-sm text-muted">{ru.setPassword.hint}</p>
      {email && (
        <p className="mt-3 text-sm">
          {ru.setPassword.yourLogin} <span className="font-mono">{email}</span>
        </p>
      )}
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="label" htmlFor="new-password">
            {ru.setPassword.label}
          </label>
          <input
            id="new-password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={ru.setPassword.placeholder}
            className="input"
          />
        </div>
        <button type="submit" disabled={busy || password.length < 6} className="btn-primary">
          {busy ? ru.setPassword.saving : ru.setPassword.submit}
        </button>
      </form>
      {ok && <p className="mt-2 text-sm text-green-700">{ru.setPassword.ok}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
