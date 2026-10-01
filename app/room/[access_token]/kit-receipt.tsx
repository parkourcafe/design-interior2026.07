"use client";

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";

const h = ru.handover;

// «Получил комплект» — отметка исполнителя; повтор возвращает ту же дату.
export default function KitReceipt({ token, initialReceivedAt }: { token: string; initialReceivedAt: string | null }) {
  const [receivedAt, setReceivedAt] = useState<string | null>(initialReceivedAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  if (receivedAt) {
    return <p className="text-sm font-medium">{h.received(new Date(receivedAt).toLocaleString("ru-RU"))}</p>;
  }
  return (
    <div>
      <button
        className="btn-primary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(false);
          const res = await fetch("/api/project-room/kit-receipt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          }).catch(() => null);
          const json = (await res?.json().catch(() => null)) as { receivedAt?: string } | null;
          if (res?.ok && json?.receivedAt) setReceivedAt(json.receivedAt);
          else setError(true);
          setPending(false);
        }}
      >
        {pending ? h.receiving : h.receive}
      </button>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{h.receiveError}</p> : null}
    </div>
  );
}
