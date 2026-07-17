"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { acceptInvite } from "./actions";

export default function JoinButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const j = ru.join;

  function join() {
    setError(null);
    start(async () => {
      const res = await acceptInvite(token);
      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setError(res.error === "invalid" ? j.invalid : j.error);
      }
    });
  }

  return (
    <div className="mt-4">
      <button onClick={join} disabled={pending} className="btn-primary">
        {pending ? j.joining : j.cta}
      </button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
