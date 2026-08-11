import type { ClaimedNotification, TelegramSystemPort } from "./channel-port";
import { extractSentMessageId, type TelegramCallOutcome } from "./bot-api";
import { renderNotification } from "./notification-template";
import { chatRef, logTelegramBridgeEvent } from "./observability";

/**
 * Отправитель очереди уведомлений.
 *
 * Обещание — at-least-once, и это не смирение, а точность: Telegram
 * `sendMessage` не принимает внешний ключ идемпотентности, поэтому «ровно один
 * раз» здесь недостижимо в принципе. Что достижимо и сделано:
 *
 *   * запись ставится в очередь один раз на доменный факт (дедупликация в
 *     базе по `(binding_id, idempotency_key)`);
 *   * захват — лизой, а не удалением: упавший отправитель не уносит работу;
 *   * потерянный ответ Telegram приводит к повтору, а не к тишине.
 *
 * Значит, в худшем случае человек увидит сообщение дважды. Это честная цена, и
 * она заметно лучше, чем не увидеть его ни разу.
 */

export interface TelegramSender {
  sendMessage(input: {
    readonly chatId: number;
    readonly text: string;
  }): Promise<TelegramCallOutcome>;
}

export interface NotificationRunResult {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface NotificationRunOptions {
  readonly maxRows?: number;
  readonly leaseSeconds?: number;
  readonly appBaseUrl: string;
}

const DEFAULT_MAX_ROWS = 20;
const DEFAULT_LEASE_SECONDS = 60;

async function deliverOne(
  notification: ClaimedNotification,
  port: TelegramSystemPort,
  sender: TelegramSender,
  appBaseUrl: string,
): Promise<"sent" | "failed" | "skipped"> {
  const rendered = renderNotification({
    templateVersion: notification.templateVersion,
    payload: notification.payload,
    appBaseUrl,
  });

  if (rendered === null) {
    // Нераспознанный шаблон не ретраится: повтор не сделает его понятным, а
    // очередь будет занята вечно. Запись остаётся в базе с кодом отказа —
    // видимой, а не потерянной.
    await port.markNotificationFailed({
      notificationId: notification.notificationId,
      leaseToken: notification.leaseToken,
      failureCode: "template_unknown",
      retryAfterSeconds: 0,
    });
    return "skipped";
  }

  const outcome = await sender.sendMessage({
    chatId: notification.externalChatId,
    text: rendered.text,
  });

  if (outcome.ok) {
    await port.markNotificationSent({
      notificationId: notification.notificationId,
      leaseToken: notification.leaseToken,
      externalMessageId: extractSentMessageId(outcome.result),
    });
    return "sent";
  }

  await port.markNotificationFailed({
    notificationId: notification.notificationId,
    leaseToken: notification.leaseToken,
    failureCode: outcome.failureCode,
    // Неретраибельный отказ отдаётся с нулевой паузой: решение «больше не
    // пробовать» принимает база по счётчику попыток, а не отправитель.
    retryAfterSeconds: outcome.retryable ? outcome.retryAfterSeconds : 0,
  });
  return "failed";
}

export async function runTelegramNotificationBatch(
  port: TelegramSystemPort,
  sender: TelegramSender,
  options: NotificationRunOptions,
): Promise<NotificationRunResult> {
  const claimed = await port.claimNotificationBatch({
    maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
    leaseSeconds: options.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of claimed) {
    // Последовательно, а не параллельно: Telegram считает частоту отправки на
    // чат, и веер сообщений упирается в 429 быстрее, чем экономит время.
    const outcome = await deliverOne(notification, port, sender, options.appBaseUrl);
    if (outcome === "sent") sent += 1;
    else if (outcome === "failed") failed += 1;
    else skipped += 1;

    logTelegramBridgeEvent({
      outcome: `notification_${outcome}`,
      requestId: notification.notificationId,
      chatRef: chatRef(notification.externalChatId),
      eventKind: notification.templateVersion,
    });
  }

  return { claimed: claimed.length, sent, failed, skipped };
}
