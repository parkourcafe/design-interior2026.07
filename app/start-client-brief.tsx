"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";

// Кнопка «Я клиент»: создаёт проект без дизайнера и ведёт в бриф.
export default function StartClientBrief({
  label,
  variant = "cli",
}: {
  label?: string;
  variant?: "cli" | "outline";
}) {
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

  const cls =
    variant === "outline"
      ? "btn self-start border border-line bg-transparent px-6 py-3.5 text-base text-ink hover:border-ink/40"
      : "btn self-start bg-clientaccent px-5 py-3 text-white hover:bg-clientaccent/90";

  return (
    <button onClick={start} disabled={pending} className={cls}>
      {pending ? ru.client.starting : (label ?? ru.home.clientCta)}
      <span className="ml-2">→</span>
    </button>
  );
}
