"use client";

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";

export default function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function removeAccount() {
    setBusy(true);
    setError("");

    const response = await fetch("/api/account/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setError(result.error ?? ru.deleteAccount.error);
      setBusy(false);
      return;
    }

    window.location.assign("/");
  }

  return (
    <section className="mt-8 rounded-xl border border-red-200 bg-red-50 p-5">
      <h2 className="font-display text-xl font-semibold text-red-900">{ru.deleteAccount.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-red-800">{ru.deleteAccount.description}</p>
      {!open ? (
        <button type="button" className="mt-4 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-800" onClick={() => setOpen(true)}>
          {ru.deleteAccount.open}
        </button>
      ) : (
        <div className="mt-4 max-w-md space-y-3">
          <label className="block text-sm text-red-900" htmlFor="delete-confirmation">
            {ru.deleteAccount.confirmation}
          </label>
          <input id="delete-confirmation" className="input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          <div className="flex gap-3">
            <button type="button" className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy || confirmation !== "УДАЛИТЬ"} onClick={removeAccount}>
              {busy ? ru.deleteAccount.deleting : ru.deleteAccount.submit}
            </button>
            <button type="button" className="px-3 py-2 text-sm text-muted" disabled={busy} onClick={() => setOpen(false)}>
              {ru.deleteAccount.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
