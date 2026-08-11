"use client";

import { useCallback, useEffect, useState } from "react";

import { ru } from "@/lib/i18n/ru";

/**
 * Экран подключения Telegram-чата к проекту.
 *
 * Панель НЕ встроена в общий read-port рабочего пространства и обращается к
 * собственному маршруту. Это не удобство, а требование A7 §2.1: мост
 * горизонтальный, и Telegram-код не живёт внутри модулей M1–M4. Протянув
 * состояние канала через делевери-слой модуля, мы бы нарушили ровно тот
 * инвариант, ради которого мост вынесен отдельно.
 *
 * Панель ничего не обещает сверх того, что умеет платформа. Бот не может
 * создать группу (A7 §1.5), поэтому действие называется «Создать или
 * подключить Telegram-чат»: человек создаёт чат сам, а мы подключаем.
 */

const strings = ru.telegramBridge;

type BindingStatus = "pending" | "active" | "suspended";

interface ChannelState {
  readonly identityLinked: boolean;
  readonly canManage: boolean;
  readonly binding: { readonly status: BindingStatus } | null;
}

interface IssuedLink {
  readonly url: string;
  readonly manualCommand?: string;
}

async function postAction(body: Readonly<Record<string, unknown>>): Promise<unknown> {
  const response = await fetch("/api/integrations/telegram/channel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { readonly error?: { readonly code?: string } }
      | null;
    throw new Error(payload?.error?.code ?? "failed");
  }
  return response.json();
}

function messageForCode(code: string): string {
  if (code === "forbidden") return strings.errors.forbidden;
  if (code === "conflict") return strings.errors.alreadyBound;
  return strings.errors.failed;
}

export function TelegramChannelPanel({ projectId }: { readonly projectId: string }) {
  const [state, setState] = useState<ChannelState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [bridgeDisabled, setBridgeDisabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedLink | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    const response = await fetch(
      `/api/integrations/telegram/channel?projectId=${encodeURIComponent(projectId)}`,
      { cache: "no-store" },
    );
    if (response.status === 404) {
      setBridgeDisabled(true);
      return;
    }
    if (!response.ok) {
      setLoadFailed(true);
      return;
    }
    const payload = (await response.json()) as { readonly state: ChannelState };
    setState(payload.state);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: Readonly<Record<string, unknown>>) => {
      setPending(true);
      setError(null);
      try {
        const result = (await postAction(body)) as IssuedLink & { readonly url?: string };
        // Одноразовая ссылка показывается ровно один раз, в ответе на действие.
        // Она не хранится и после перезагрузки страницы не вернётся.
        setIssued(result.url ? { url: result.url, manualCommand: result.manualCommand } : null);
        await load();
      } catch (caught) {
        setError(messageForCode(caught instanceof Error ? caught.message : "failed"));
      } finally {
        setPending(false);
      }
    },
    [load],
  );

  if (bridgeDisabled) {
    return (
      <section className="rounded-lg border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">{strings.section.title}</h3>
        <p className="mt-2 text-sm text-neutral-600">{strings.section.disabled}</p>
      </section>
    );
  }

  const status = state?.binding?.status;
  const statusLabel = status === "active"
    ? strings.status.active
    : status === "pending"
      ? strings.status.pending
      : status === "suspended"
        ? strings.status.suspended
        : strings.status.notConnected;

  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <h3 className="text-sm font-semibold">{strings.section.title}</h3>
      <p className="mt-1 text-sm text-neutral-600">{strings.section.subtitle}</p>

      {state === null && !loadFailed ? (
        <p className="mt-3 text-sm text-neutral-500">{strings.section.loading}</p>
      ) : null}

      {loadFailed ? (
        <div className="mt-3">
          <p className="text-sm text-red-700">{strings.section.failed}</p>
          <button
            type="button"
            className="mt-2 rounded border border-neutral-300 px-3 py-1.5 text-sm"
            onClick={() => void load()}
          >
            {strings.actions.retry}
          </button>
        </div>
      ) : null}

      {state !== null ? (
        <>
          <p className="mt-3 text-sm font-medium">{statusLabel}</p>
          <p className="mt-1 text-xs text-neutral-500">{strings.hints.oneChat}</p>

          {!state.canManage ? (
            <p className="mt-3 text-sm text-neutral-600">{strings.status.noPermission}</p>
          ) : null}

          {state.canManage && !state.identityLinked ? (
            <div className="mt-3">
              <p className="text-sm text-neutral-600">{strings.hints.linkStep}</p>
              <button
                type="button"
                disabled={pending}
                className="mt-2 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                onClick={() => void run({ action: "link_identity" })}
              >
                {strings.actions.linkIdentity}
              </button>
            </div>
          ) : null}

          {state.canManage && state.identityLinked && status !== "active" ? (
            <div className="mt-3">
              <p className="text-sm text-neutral-600">{strings.hints.connectStep}</p>
              <p className="mt-1 text-xs text-neutral-500">{strings.hints.adminRequired}</p>
              <button
                type="button"
                disabled={pending}
                className="mt-2 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                onClick={() => void run({ action: "connect", projectId })}
              >
                {strings.actions.connect}
              </button>
            </div>
          ) : null}

          {state.canManage && status === "active" ? (
            <button
              type="button"
              disabled={pending}
              className="mt-3 rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={() =>
                void run({
                  action: "disconnect",
                  projectId,
                  reason: "disconnected_by_owner",
                })
              }
            >
              {strings.actions.disconnect}
            </button>
          ) : null}
        </>
      ) : null}

      {issued !== null ? (
        <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-3">
          <a
            href={issued.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm font-medium underline"
          >
            {issued.url}
          </a>
          <p className="mt-1 text-xs text-neutral-500">{strings.hints.linkLifetime}</p>
          {issued.manualCommand ? (
            <>
              <p className="mt-2 text-xs text-neutral-600">{strings.hints.manualFallback}</p>
              <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">
                {issued.manualCommand}
              </code>
            </>
          ) : null}
        </div>
      ) : null}

      {error !== null ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
