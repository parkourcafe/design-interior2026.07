"use client";

/**
 * Настройки проекта → «Telegram-чат проекта» (A7 / DEC-031, гейт TG2).
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ЭКРАНА: он не обещает того, чего Bot API не даёт. Бот не
 * может создать человеческую группу — её создаёт или выбирает пользователь, и
 * текст действия зафиксирован A7 §5.1 дословно: «Создать или подключить
 * Telegram-чат». Формулировки вида «мы создадим чат проекта» здесь запрещены.
 *
 * ВОСЕМЬ СОСТОЯНИЙ, а не два. «Подключено / не подключено» скрывает ровно те
 * случаи, в которых человек застревает: аккаунт не связан, группа выбрана, но
 * бот без прав, ссылка отправлена и ждёт. Каждое состояние называет и причину, и
 * следующий шаг.
 */

import { useState } from "react";

import { ru } from "@/lib/i18n/ru";
import type { ProjectChannelState } from "@/lib/integration-gateway/telegram/gateway-port";

const strings = ru.telegramBridge;

export type TelegramChannelStatus =
  | "not_connected"
  | "identity_required"
  | "choose_group"
  | "bot_needs_rights"
  | "awaiting_confirmation"
  | "active"
  | "suspended"
  | "revoked";

/**
 * Состояние выводится из фактов, а не хранится отдельным полем. Отдельное поле
 * рано или поздно разошлось бы с привязкой — и экран уверенно показывал бы не
 * то, что происходит.
 */
export function deriveChannelStatus(
  state: ProjectChannelState,
  pendingConnect: boolean,
): TelegramChannelStatus {
  if (!state.identity.linked) return "identity_required";
  const binding = state.binding;
  if (!binding) return pendingConnect ? "awaiting_confirmation" : "not_connected";
  if (binding.status === "suspended") {
    // Причина приостановки названа явно: бот потерял права — это чинится в
    // Telegram, а не здесь.
    return binding.statusReason === "bot_membership_lost" ? "bot_needs_rights" : "suspended";
  }
  if (binding.status === "pending") return "awaiting_confirmation";
  if (binding.status === "active") {
    // Активная привязка до уведомления участников — ещё не приём: бот в группе,
    // но объявить о себе не смог, и полного захвата нет.
    return binding.captureMode === "full_after_notice" ? "active" : "choose_group";
  }
  return "revoked";
}

const STATUS_LABEL: Readonly<Record<TelegramChannelStatus, string>> = {
  not_connected: strings.status.notConnected,
  identity_required: strings.status.identityRequired,
  choose_group: strings.status.chooseGroup,
  bot_needs_rights: strings.status.botNeedsRights,
  awaiting_confirmation: strings.status.awaitingConfirmation,
  active: strings.status.active,
  suspended: strings.status.suspended,
  revoked: strings.status.revoked,
};

const STATUS_HINT: Readonly<Record<TelegramChannelStatus, string>> = {
  not_connected: strings.statusHint.notConnected,
  identity_required: strings.statusHint.identityRequired,
  choose_group: strings.statusHint.chooseGroup,
  bot_needs_rights: strings.statusHint.botNeedsRights,
  awaiting_confirmation: strings.statusHint.awaitingConfirmation,
  active: strings.statusHint.active,
  suspended: strings.statusHint.suspended,
  revoked: strings.statusHint.revoked,
};

interface ConnectResponse {
  readonly status: string;
  readonly result?: { readonly url: string; readonly expiresAt: string };
}

export function TelegramChannelPanel({
  projectId,
  state,
}: {
  readonly projectId: string;
  readonly state: ProjectChannelState;
}): JSX.Element {
  const [pendingConnect, setPendingConnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = deriveChannelStatus(state, pendingConnect);

  async function requestLink(purpose: "identity_link" | "channel_binding"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/telegram/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, purpose }),
      });
      const payload = await response.json() as ConnectResponse;
      if (!response.ok || !payload.result) {
        setError(response.status === 403 ? strings.errors.forbidden : strings.errors.failed);
        return;
      }
      setPendingConnect(true);
      // Ссылка открывается сразу: она одноразовая и живёт 10 минут, поэтому
      // показывать её как текст, который можно отложить «на потом», было бы
      // обещанием, которого она не выполнит.
      window.open(payload.result.url, "_blank", "noopener,noreferrer");
    } catch {
      setError(strings.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    if (!state.binding) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/telegram/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, bindingId: state.binding.bindingId }),
      });
      if (!response.ok) {
        setError(response.status === 403 ? strings.errors.forbidden : strings.errors.failed);
        return;
      }
      window.location.reload();
    } catch {
      setError(strings.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  const canConnect = status === "not_connected"
    || status === "choose_group"
    || status === "revoked";

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-900">{strings.panel.title}</h2>
        <p className="mt-2 text-sm text-neutral-600">{strings.panel.hint}</p>
      </header>

      <div className="mb-5 rounded-xl bg-neutral-50 p-4">
        <p className="text-sm font-medium text-neutral-900" data-testid="telegram-status">
          {STATUS_LABEL[status]}
        </p>
        <p className="mt-1 text-sm text-neutral-600">{STATUS_HINT[status]}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {status === "identity_required" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void requestLink("identity_link")}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {strings.panel.linkAccountAction}
          </button>
        ) : null}

        {canConnect ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void requestLink("channel_binding")}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            data-testid="telegram-connect"
          >
            {/* Дословно по A7 §5.1. Автоматического создания чата не обещаем. */}
            {strings.panel.connectAction}
          </button>
        ) : null}

        {/* Отозванная привязка в состояние не приходит вовсе — читающая RPC
            отдаёт только pending/active/suspended, — поэтому кнопка отключения
            показывается по факту наличия привязки, а не по её статусу. */}
        {state.binding ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void disconnect()}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-800 disabled:opacity-50"
            data-testid="telegram-disconnect"
          >
            {strings.panel.disconnectAction}
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6 border-t border-neutral-200 pt-4">
        <h3 className="text-sm font-medium text-neutral-900">{strings.panel.stepsTitle}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-600">
          {strings.panel.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
    </section>
  );
}
