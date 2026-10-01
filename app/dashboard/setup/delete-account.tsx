"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";

// DEC-047: удаление аккаунта — запрос сразу закрывает аккаунт, данные
// уничтожаются в течение 30 дней. Экспорт — до запроса; отмена — через
// поддержку.

type Retention = {
  readonly status: string;
  readonly purgeAfter: string;
  readonly legalHold: boolean;
};

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return value;
  }
}

export default function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retention, setRetention] = useState<Retention | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/account/retention")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { retention?: Retention | null } | null) => {
        if (active && (body?.retention?.status === "requested" || body?.retention?.status === "expired")) {
          setRetention(body.retention);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function requestDeletion() {
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
    // Аккаунт закрыт с момента запроса — экран «Аккаунт закрыт».
    router.push("/account-closed");
  }

  return (
    <section className="mt-8 rounded-xl border border-red-200 bg-red-50 p-5">
      <h2 className="font-display text-xl font-semibold text-red-900">{ru.deleteAccount.title}</h2>
      {retention ? (
        <div className="mt-2 space-y-3">
          <p className="text-sm leading-relaxed text-red-800">
            {ru.deleteAccount.pending(formatDate(retention.purgeAfter))}
          </p>
          {retention.legalHold ? <p className="text-sm text-red-800">{ru.deleteAccount.legalHold}</p> : null}
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-red-800">{ru.deleteAccount.description}</p>
          {!open ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-800" onClick={() => setOpen(true)}>
                {ru.deleteAccount.open}
              </button>
              <a href="/api/account/export" className="px-3 py-2 text-sm text-red-800 underline">
                {ru.deleteAccount.export}
              </a>
            </div>
          ) : (
            <div className="mt-4 max-w-md space-y-3">
              <label className="block text-sm text-red-900" htmlFor="delete-confirmation">
                {ru.deleteAccount.confirmation}
              </label>
              <input id="delete-confirmation" className="input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
              {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
              <div className="flex gap-3">
                <button type="button" className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy || confirmation !== "УДАЛИТЬ"} onClick={requestDeletion}>
                  {busy ? ru.deleteAccount.deleting : ru.deleteAccount.submit}
                </button>
                <button type="button" className="px-3 py-2 text-sm text-muted" disabled={busy} onClick={() => setOpen(false)}>
                  {ru.deleteAccount.cancel}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
