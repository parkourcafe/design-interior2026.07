"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { inviteMember, removeMember } from "./actions";
import type { StudioMemberRow } from "@/lib/studio";

// «Команда» (v1, равный доступ). Владелец приглашает по email и убирает
// участников; участники видят ростер только на чтение.
export default function TeamMembers({
  members,
  role,
  currentEmail,
}: {
  members: StudioMemberRow[];
  role: "owner" | "member";
  currentEmail: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await inviteMember(email);
      if (res.ok) {
        setEmail("");
        router.refresh();
      } else {
        setError(res.error ?? "Не удалось пригласить.");
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      await removeMember(id);
      router.refresh();
    });
  }

  return (
    <section className="card mt-6">
      <h2 className="font-display text-xl font-semibold">{ru.team.heading}</h2>
      <p className="mt-1 text-sm text-muted">{ru.team.hint}</p>

      <ul className="mt-4 divide-y divide-line">
        {members.length === 0 && <li className="py-2 text-sm text-muted">{ru.team.empty}</li>}
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm">
              <span className="font-mono">{m.email}</span>
              {m.email === currentEmail && (
                <span className="ml-1 text-muted">({ru.team.you})</span>
              )}
              <span className="ml-2 text-xs text-muted">
                · {m.status === "active" ? ru.team.active : ru.team.invited}
              </span>
            </span>
            {role === "owner" && (
              <button
                onClick={() => remove(m.id)}
                disabled={pending}
                className="btn-ghost px-3 text-sm"
              >
                {ru.team.remove}
              </button>
            )}
          </li>
        ))}
      </ul>

      {role === "owner" ? (
        <form onSubmit={invite} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={ru.team.invitePlaceholder}
            className="input flex-1"
          />
          <button type="submit" disabled={pending} className="btn-primary whitespace-nowrap">
            {pending ? ru.team.inviting : ru.team.invite}
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-muted">{ru.team.memberNote}</p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
