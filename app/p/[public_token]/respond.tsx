"use client";

// CTA клиента на публичном КП: принять / обсудить / запросить правки.
// Один ответ на версию КП (proposal_responses); к «обсудить» и «правкам» можно
// приложить замечание. Состояние приходит с сервера.

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
  archived = false,
  superseded = false,
}: {
  token: string;
  initialResponse: string | null;
  /** Аккаунт дизайнера в сроке удаления: ответ невозможен (DEC-044 (a)). */
  archived?: boolean;
  /** Дизайнер выпустил более новую версию — отвечать на эту нельзя. */
  superseded?: boolean;
}) {
  const [response, setResponse] = useState<string | null>(initialResponse);
  const [justResponded, setJustResponded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [isSuperseded, setSuperseded] = useState(superseded);

  async function send(action: "accept" | "discuss" | "changes") {
    setPending(action);
    setError(null);
    try {
      const res = await fetch("/api/proposal/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, ...(action === "accept" ? {} : { comment }) }),
      });
      const json = (await res.json().catch(() => ({}))) as { response?: string; error?: string };
      if (res.ok && json.response) {
        setResponse(json.response);
        setJustResponded(true);
      } else if (res.status === 409 && json.error === "superseded") {
        setSuperseded(true);
      } else if (res.status === 409 && json.error === "already_responded" && json.response) {
        // Ответ на эту версию уже есть (вторая вкладка) — показываем его, а не «успех».
        setResponse(json.response);
        setError(r.alreadyOther);
      } else if (res.status === 400 && json.error === "comment_too_long") {
        setError(r.commentTooLong);
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
      {isSuperseded ? (
        <p className="mt-2 text-sm text-muted">{r.superseded}</p>
      ) : archived && !response ? (
        <p className="mt-2 text-sm text-muted">{r.archived}</p>
      ) : !response ? (
        <>
          <p className="mb-4 text-sm text-muted">{r.sub}</p>
          <label className="mb-3 block">
            <span className="label">{r.commentLabel}</span>
            <textarea
              className="input min-h-20"
              maxLength={2000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={r.commentPlaceholder}
            />
          </label>
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
      {response && error && <p className="mt-3 text-sm text-muted">{error}</p>}
      <p className="mt-3 text-xs text-muted">{r.note}</p>
    </section>
  );
}
