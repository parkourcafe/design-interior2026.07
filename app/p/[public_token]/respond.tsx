"use client";

// CTA клиента на публичном КП: принять / обсудить / запросить правки.
// Первый ответ фиксируется; состояние приходит с сервера (события проекта).

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";

const r = ru.landing.respond;

// event type → ключ в r.already
const ALREADY_KEY: Record<string, string> = {
  proposal_accepted: "accepted",
  proposal_discussion_requested: "discussion_requested",
  proposal_changes_requested: "changes_requested",
};

const DONE_MSG: Record<string, string> = {
  proposal_accepted: r.acceptedMsg,
  proposal_discussion_requested: r.discussMsg,
  proposal_changes_requested: r.changesMsg,
};

export default function ProposalRespond({
  token,
  initialResponse,
}: {
  token: string;
  initialResponse: string | null;
}) {
  const [response, setResponse] = useState<string | null>(initialResponse);
  const [justResponded, setJustResponded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "accept" | "discuss" | "changes") {
    setPending(action);
    setError(null);
    try {
      const res = await fetch("/api/proposal/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const json = (await res.json().catch(() => ({}))) as { response?: string };
      if (res.ok && json.response) {
        setResponse(json.response);
        setJustResponded(true);
      } else {
        setError(r.error);
      }
    } catch {
      setError(r.error);
    }
    setPending(null);
  }

  return (
    <section className="no-print card mt-2 border-clientaccent/25 bg-[#faf6f8]">
      <h2 className="mb-1 font-display text-2xl font-semibold">{r.title}</h2>
      {!response ? (
        <>
          <p className="mb-4 text-sm text-muted">{r.sub}</p>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <button onClick={() => send("accept")} disabled={pending !== null} className="btn-primary flex-1">
              {pending === "accept" ? r.sending : r.accept}
            </button>
            <button onClick={() => send("discuss")} disabled={pending !== null} className="btn-ghost flex-1">
              {pending === "discuss" ? r.sending : r.discuss}
            </button>
            <button onClick={() => send("changes")} disabled={pending !== null} className="btn-ghost flex-1">
              {pending === "changes" ? r.sending : r.changes}
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </>
      ) : (
        <div className="animate-rise mt-2 rounded-lg border border-line bg-white px-4 py-3.5 text-[15px] leading-relaxed text-ink/90">
          {(() => {
            const alreadyKey = ALREADY_KEY[response];
            const alreadyText = (alreadyKey && r.already[alreadyKey]) || "";
            const doneText = DONE_MSG[response] ?? alreadyText;
            return justResponded ? doneText : alreadyText || doneText;
          })()}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{r.note}</p>
    </section>
  );
}
