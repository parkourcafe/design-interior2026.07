"use client";

/**
 * Project Inbox — входящие из чата (A7 / DEC-031, гейт TG3).
 *
 * ГЛАВНОЕ, ЧТО ЭТОТ ЭКРАН ОБЯЗАН СКАЗАТЬ ЧЕЛОВЕКУ: перед ним предложение, а не
 * решение. Поэтому карточка показывает источник, автора и **признана ли его
 * личность**, дату, исходное сообщение, вложения, предложенный тип, статус и
 * причину, по которой AI так решил. Спрятать любое из этих полей значит
 * попросить человека подтвердить то, чего он не видел.
 *
 * «ПРОВЕРИТЬ В REMHAOS» ОТКРЫВАЕТ ФОРМУ, А НЕ ВЫПОЛНЯЕТ ДЕЙСТВИЕ. Текст
 * предзаполнен предложением модели и **редактируется**: уходит в проект то, что
 * человек прочитал и при необходимости переписал. Только после его submit
 * вызывается существующая команда `create_change` — обычным путём, человеческой
 * сессией, с собственной идемпотентностью.
 *
 * Отметка «проверено» ставится ПОСЛЕ успешной команды и отдельным вызовом.
 * Порядок именно такой: если команда не прошла, кандидат обязан остаться
 * ждущим, а не получить отметку о проверке, за которой ничего не стоит.
 */

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ru } from "@/lib/i18n/ru";
import type { ProjectInboxCandidateView } from "@/lib/integration-gateway/telegram/gateway-port";
import { PROJECTCEO_COMMAND_CONTRACT_VERSION } from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { sendProjectCeoCommand } from "./command-client";

const strings = ru.telegramBridge.inbox;

type CandidateTypeKey = keyof typeof strings.types;

function typeLabel(candidateType: string): string {
  return candidateType in strings.types
    ? strings.types[candidateType as CandidateTypeKey]
    : candidateType;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function attachmentNote(scanStatus: string): string | null {
  if (scanStatus === "clean") return null;
  if (scanStatus === "too_large") return strings.attachmentTooLarge;
  // До `CLEAN` вложение для продукта не существует — и человек должен видеть
  // именно это, а не пустую иконку файла.
  return strings.attachmentBlocked;
}

export function ProjectInboxPanel({
  projectId,
  candidates,
  changeTargetVersionId,
}: {
  readonly projectId: string;
  readonly candidates: readonly ProjectInboxCandidateView[];
  /**
   * Версия пакета, от которой создаётся изменение. Приходит из существующей
   * проекции рабочего пространства; `null` означает, что предпосылки команды
   * ещё нет — и тогда форма не предлагается вовсе, а не падает при submit.
   */
  readonly changeTargetVersionId: string | null;
}): JSX.Element {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandId = useRef(crypto.randomUUID());

  async function resolve(candidateId: string, decision: "confirmed" | "rejected"): Promise<void> {
    await fetch("/api/integrations/telegram/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, candidateId, decision }),
    });
  }

  async function reject(candidateId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await resolve(candidateId, "rejected");
      router.refresh();
    } catch {
      setError(ru.telegramBridge.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  async function submitChange(candidateId: string): Promise<void> {
    if (!changeTargetVersionId || draft.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      // Существующая команда RemHaOS, обычным путём и человеческой сессией.
      const response = await sendProjectCeoCommand({
        contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
        kind: "create_change",
        projectId,
        payload: {
          reason: draft.trim(),
          fromProductionPackageVersionId: changeTargetVersionId,
          deltaCostRub: 0,
          deltaDays: 0,
        },
      }, commandId.current);

      if (response.status !== "completed") {
        // Кандидат остаётся ждущим: отметка о проверке, за которой ничего не
        // стоит, хуже отсутствия отметки.
        setError(ru.telegramBridge.errors.failed);
        return;
      }

      await resolve(candidateId, "confirmed");
      commandId.current = crypto.randomUUID();
      setOpenId(null);
      setDraft("");
      router.refresh();
    } catch {
      setError(ru.telegramBridge.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  if (candidates.length === 0) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-neutral-900">{strings.title}</h2>
        <p className="mt-3 text-sm text-neutral-600">{strings.empty}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-neutral-900">{strings.title}</h2>
        <p className="mt-1 text-sm text-neutral-600">{strings.disclaimer}</p>
      </header>

      {candidates.map((candidate) => (
        <article
          key={candidate.candidateId}
          className="rounded-2xl border border-neutral-200 bg-white p-5"
          data-testid="inbox-candidate"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span className="rounded-full bg-neutral-100 px-2 py-1 font-medium text-neutral-800">
              {typeLabel(candidate.candidateType)}
            </span>
            <span data-testid="inbox-status">
              {candidate.status === "pending" ? strings.pending
                : candidate.status === "confirmed" ? strings.confirmed
                  : strings.rejected}
            </span>
            <span>·</span>
            {/* Признана ли личность автора — отдельным полем, а не догадкой по
                имени: неопознанный автор не делает сообщение недействительным,
                но человек обязан знать, что оно неопознано. */}
            <span data-testid="inbox-identity">
              {candidate.source.identity === "verified"
                ? strings.identityVerified
                : strings.identityUnverified}
            </span>
            <span>·</span>
            <span>{formatDate(candidate.source.receivedAt)}</span>
            {candidate.confidence ? <><span>·</span><span>{candidate.confidence}</span></> : null}
          </div>

          {candidate.source.text ? (
            <blockquote className="mt-3 border-l-2 border-neutral-300 pl-3 text-sm text-neutral-800">
              {candidate.source.text}
            </blockquote>
          ) : null}

          {candidate.rationale ? (
            <p className="mt-3 text-sm text-neutral-600">{candidate.rationale}</p>
          ) : null}

          {candidate.attachments.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-neutral-600">
              {candidate.attachments.map((attachment) => (
                <li key={attachment.attachmentId}>
                  {attachment.kind}
                  {attachmentNote(attachment.scanStatus)
                    ? ` — ${attachmentNote(attachment.scanStatus)}`
                    : null}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-3 text-xs text-neutral-500">
            Telegram · сообщение {candidate.source.externalMessageId ?? "—"}
            {candidate.source.sourceRevision > 1
              ? `, редакция ${candidate.source.sourceRevision}`
              : null}
            {" · "}
            {candidate.extractionSchemaVersion}
          </p>

          {candidate.status === "pending" ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void reject(candidate.candidateId)}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50"
                data-testid="inbox-reject"
              >
                {strings.reject}
              </button>
              {candidate.candidateType === "change_request_candidate" && changeTargetVersionId ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setOpenId(candidate.candidateId);
                    // Предзаполняем предложением модели — и оставляем
                    // редактируемым: в проект уходит то, что человек прочитал.
                    setDraft(candidate.proposedText ?? candidate.source.text ?? "");
                  }}
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                  data-testid="inbox-review"
                >
                  {strings.review}
                </button>
              ) : null}
            </div>
          ) : null}

          {openId === candidate.candidateId ? (
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitChange(candidate.candidateId);
              }}
            >
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-neutral-300 p-3 text-sm"
                data-testid="inbox-change-reason"
              />
              <button
                type="submit"
                disabled={busy || draft.trim().length < 3}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                data-testid="inbox-change-submit"
              >
                {ru.projectCeo.workspace.changes.heading}
              </button>
            </form>
          ) : null}
        </article>
      ))}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
