"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";

// Кнопка «Я клиент — собрать бриф»: создаёт проект без дизайнера и ведёт в бриф.
export default function StartClientBrief() {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function start() {
    setPending(true);
    const res = await fetch("/api/client/create", { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { token?: string };
    if (json.token) {
      router.push(`/i/${json.token}`);
    } else {
      setPending(false);
    }
  }

  return (
    <div className="mt-4">
      <button onClick={start} disabled={pending} className="btn-ghost">
        {pending ? ru.client.starting : ru.client.cta}
      </button>
      <p className="mt-2 max-w-md text-xs text-muted">{ru.client.ctaHint}</p>
    </div>
  );
}
