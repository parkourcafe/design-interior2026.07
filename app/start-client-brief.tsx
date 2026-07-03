"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";

// Кнопка «Я клиент»: создаёт проект без дизайнера и ведёт в бриф.
// Стиль — той же весомости, что и кнопка дизайнера, но другим цветом.
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
    <button
      onClick={start}
      disabled={pending}
      className="btn mt-6 bg-clientaccent text-white hover:bg-clientaccent/90"
    >
      {pending ? ru.client.starting : ru.home.clientCta}
    </button>
  );
}
