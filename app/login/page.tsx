"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { appUrl } from "@/lib/env";
import { ru } from "@/lib/i18n/ru";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${appUrl()}/auth/callback` },
    });
    setState(error ? "error" : "sent");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{ru.auth.title}</h1>
      <p className="mt-2 text-sm text-muted">{ru.auth.subtitle}</p>

      {state === "sent" ? (
        <p className="mt-6 rounded-md border border-accent/30 bg-accent/5 p-4 text-sm">
          {ru.auth.sent}
        </p>
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
