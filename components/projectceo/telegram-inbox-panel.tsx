"use client";

import { useCallback, useEffect, useState } from "react";

import { ru } from "@/lib/i18n/ru";

/**
 * Project Inbox: предложения из чата, ожидающие решения человека.
 *
 * Главное в этом экране — не список, а подпись над ним. Она говорит прямо, что
 * ни одна карточка не является решением, изменением или приёмкой, пока человек
 * не подтвердит её СВОЕЙ командой в RemHaOS. Граница A7 §1.6–1.7 держится не
 * только правами в базе, но и тем, что человек видит её раньше, чем нажимает
 * кнопку.
 *
 * Кнопка «Принять в работу» отмечает карточку рассмотренной и ничего не
 * создаёт. Официальный объект появляется отдельной командой модуля — поэтому
 * рядом с кнопкой стоит подпись, а не умолчание.
 */

const strings = ru.telegramBridge.inbox;

type CandidateKind = keyof typeof strings.kinds;
type CandidateStatus = keyof typeof strings.statuses;
type Origin = keyof typeof strings.origins;
type Confidence = keyof typeof strings.confidence;

interface Candidate {
  readonly candidateId: string;
  readonly candidateKind: CandidateKind;
  readonly origin: Origin;
  readonly summary: string;
  readonly confidence: Confidence | null;
  readonly status: CandidateStatus;
  readonly createdAt: string;
}

interface Inbox {
  readonly canReview: boolean;
  readonly candidates: readonly Candidate[];
}

export function TelegramInboxPanel({ projectId }: { readonly projectId: string }) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const response = await fetch(
      `/api/integrations/telegram/inbox?projectId=${encodeURIComponent(projectId)}`,
      { cache: "no-store" },
    );
    if (response.status === 404) {
      // Мост выключен — панели просто нет. Пустой блок «ничего не пришло»
      // обещал бы работающий канал там, где его нет.
      setHidden(true);
      return;
    }
    if (!response.ok) {
      setFailed(true);
      return;
    }
    const payload = (await response.json()) as { readonly inbox: Inbox };
    setInbox(payload.inbox);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = useCallback(
    async (candidateId: string, decision: "confirm" | "reject") => {
      setPendingId(candidateId);
      try {
        await fetch("/api/integrations/telegram/inbox", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, candidateId, decision }),
        });
        await load();
      } finally {
        setPendingId(null);
      }
    },
    [load, projectId],
  );

  if (hidden) return null;

  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <h3 className="text-sm font-semibold">{strings.title}</h3>
      <p className="mt-1 text-sm text-neutral-600">{strings.subtitle}</p>

      {inbox === null && !failed ? (
        <p className="mt-3 text-sm text-neutral-500">{strings.loading}</p>
      ) : null}
      {failed ? <p className="mt-3 text-sm text-red-700">{strings.failed}</p> : null}

      {inbox !== null && inbox.candidates.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">{strings.empty}</p>
      ) : null}

      {inbox !== null && inbox.candidates.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {inbox.candidates.map((candidate) => (
            <li
              key={candidate.candidateId}
              className="rounded border border-neutral-200 p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span className="rounded bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700">
                  {strings.kinds[candidate.candidateKind]}
                </span>
                <span>{strings.origins[candidate.origin]}</span>
                {candidate.confidence ? (
                  <span>{strings.confidence[candidate.confidence]}</span>
                ) : null}
                <span>{strings.statuses[candidate.status]}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{candidate.summary}</p>

              {inbox.canReview && candidate.status === "pending" ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pendingId === candidate.candidateId}
                      className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                      onClick={() => void review(candidate.candidateId, "confirm")}
                    >
                      {strings.actions.confirm}
                    </button>
                    <button
                      type="button"
                      disabled={pendingId === candidate.candidateId}
                      className="rounded border border-neutral-300 px-3 py-1.5 text-xs disabled:opacity-50"
                      onClick={() => void review(candidate.candidateId, "reject")}
                    >
                      {strings.actions.reject}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">{strings.confirmHint}</p>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {inbox !== null && !inbox.canReview ? (
        <p className="mt-3 text-xs text-neutral-500">{strings.noPermission}</p>
      ) : null}
    </section>
  );
}
