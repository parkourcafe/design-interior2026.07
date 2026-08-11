/**
 * Прогон исходящей очереди уведомлений (A7 / DEC-031, гейт TG2).
 *
 * Форма взята у Release Artifact Worker (DEC-030) намеренно: новый универсальный
 * worker framework в P0 не строится (A7 §12), а два воркера, устроенные
 * одинаково, читаются как один.
 *
 * ЧТО ЗДЕСЬ ГАРАНТИРУЕТСЯ И ЧЕМ:
 *
 *   * **Только системная identity.** Проектор и очередь выданы `service_role` и
 *     никому больше; `authenticated` не достаёт ни до одной из них;
 *   * **Ничего не теряется.** Проектор ищет выдачи без строки в outbox по
 *     персистентному состоянию, а не по одноразовому сигналу: падение после
 *     записи выдачи и до отправки уведомление не теряет;
 *   * **at-least-once, а не exactly-once.** Telegram `sendMessage` не принимает
 *     внешнего ключа идемпотентности. После неопределённого сетевого результата
 *     редкий повтор УВЕДОМЛЕНИЯ допустим; повтор БИЗНЕС-ДЕЙСТВИЯ — нет, и он
 *     закрыт идемпотентностью командных RPC, а не этим воркером;
 *   * **Аренда переживает перезапуск.** Истёкшая аренда возвращает работу в
 *     очередь: воркер, умерший на полпути, не уносит уведомление с собой;
 *   * **`429 retry_after` соблюдается ровно.** Удвоить его от себя значит
 *     превратить вежливый лимит Telegram в собственный простой;
 *   * **Отозванная привязка отменяет отправку.** Слать в чат, который больше не
 *     наш, нельзя;
 *   * **Пустая очередь — no-op.** Ни одного вызова записи.
 *
 * ЧЕГО ЗДЕСЬ НЕТ: ни одного HTTP-маршрута. Воркер запускается процессом, а не
 * запросом, и человеческой поверхности не создаёт.
 */

import {
  consoleBridgeLogger,
  sanitizeFailureCode,
  type TelegramBridgeLogger,
} from "./bridge-log";
import type { ClaimedNotification, TelegramSystemPort } from "./gateway-port";
import { TelegramApi, TelegramApiError } from "./telegram-api";

export type NotificationOutcome = "sent" | "retry" | "failed" | "cancelled";

export interface NotificationRunResult {
  readonly projected: number;
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly cancelled: number;
}

/**
 * Текст уведомления собирает вызывающий: шаблон принадлежит домену, а не
 * транспорту. Воркер знает только, что у уведомления есть текст и ссылка.
 */
export interface NotificationTemplate {
  render(notification: ClaimedNotification): { readonly text: string } | null;
}

export interface NotificationRunnerOptions {
  readonly port: TelegramSystemPort;
  readonly api: TelegramApi;
  readonly template: NotificationTemplate;
  readonly maxRows?: number;
  readonly leaseSeconds?: number;
  readonly logger?: TelegramBridgeLogger;
  /** Верхняя граница попыток. Дальше — dead letter, а не вечный круг. */
  readonly maxAttempts?: number;
}

/**
 * Задержка следующей попытки: экспонента с джиттером. Джиттер не украшение —
 * без него все уведомления, упавшие на одном сбое, вернутся одновременно и
 * повторят его.
 */
export function retryDelaySeconds(attempts: number, random = Math.random): number {
  const base = Math.min(60 * 2 ** Math.max(0, attempts - 1), 3600);
  const jitter = Math.floor(base * 0.25 * random());
  return Math.min(base + jitter, 3600);
}

async function sendOne(
  notification: ClaimedNotification,
  options: NotificationRunnerOptions,
): Promise<{
  readonly outcome: NotificationOutcome;
  readonly messageId: number | null;
  readonly code: string | null;
  readonly retryAfter: number | null;
}> {
  const rendered = options.template.render(notification);
  if (!rendered) {
    // Шаблона под этот источник нет. Это дефект кода, а не сети: повторять
    // нечего, и висеть в очереди такому уведомлению незачем.
    return { outcome: "failed", messageId: null, code: "template_missing", retryAfter: null };
  }

  try {
    const result = await options.api.sendMessage({
      chatId: notification.externalChatId,
      text: rendered.text,
    });
    return { outcome: "sent", messageId: result.messageId, code: null, retryAfter: null };
  } catch (error) {
    if (error instanceof TelegramApiError) {
      const transient = error.code === "rate_limited"
        || error.code === "upstream_error"
        || error.code === "network_error"
        || error.code === "timeout";
      return {
        outcome: transient ? "retry" : "failed",
        messageId: null,
        code: error.code,
        // Telegram назвал срок — соблюдаем ровно его.
        retryAfter: error.retryAfterSeconds,
      };
    }
    return {
      outcome: "retry",
      messageId: null,
      code: sanitizeFailureCode(error, "send_failed"),
      retryAfter: null,
    };
  }
}

/** Один проход. Не бросает на нормальных исходах гонки и сети. */
export async function runTelegramNotificationWorker(
  options: NotificationRunnerOptions,
): Promise<NotificationRunResult> {
  const logger = options.logger ?? consoleBridgeLogger;
  const maxRows = options.maxRows ?? 20;
  const leaseSeconds = options.leaseSeconds ?? 120;
  const maxAttempts = options.maxAttempts ?? 8;

  // Сначала проектор: он превращает персистентное состояние выдач в работу.
  // Порядок важен — иначе первый же проход после падения увидел бы пустую
  // очередь и отчитался «работы нет».
  const projected = await options.port.projectReleaseNotifications(maxRows);
  if (projected.created > 0) {
    logger.emit({ event: "notification_projected", count: projected.created });
  }

  const claimed = await options.port.claimNotifications({ maxRows, leaseSeconds });
  let sent = 0;
  let retried = 0;
  let failed = 0;
  let cancelled = 0;

  for (const notification of claimed) {
    const result = await sendOne(notification, options);

    // Слишком много попыток — dead letter. Вечный круг хуже потери: он ещё и
    // скрывает её за шумом.
    const outcome: NotificationOutcome =
      result.outcome === "retry" && notification.attempts >= maxAttempts
        ? "failed"
        : result.outcome;

    const completion = await options.port.completeNotification({
      notificationId: notification.notificationId,
      outcome,
      externalMessageId: result.messageId,
      failureCode: result.code,
      retryAfterSeconds: outcome === "retry"
        ? result.retryAfter ?? retryDelaySeconds(notification.attempts)
        : null,
    });

    // Привязку отозвали, пока мы слали. RPC отвечает `cancelled`, и это не
    // ошибка: работа отменена, следующий проход её не увидит.
    const effective = completion.outcome === "cancelled" ? "cancelled" : outcome;

    if (effective === "sent") {
      sent += 1;
      logger.emit({
        event: "notification_sent",
        notificationId: notification.notificationId,
        projectId: notification.projectId,
        attempts: notification.attempts,
      });
    } else if (effective === "retry") {
      retried += 1;
      logger.emit({
        event: "notification_retry",
        notificationId: notification.notificationId,
        attempts: notification.attempts,
        code: result.code ?? undefined,
      });
    } else if (effective === "cancelled") {
      cancelled += 1;
      logger.emit({
        event: "notification_cancelled",
        notificationId: notification.notificationId,
      });
    } else {
      failed += 1;
      logger.emit({
        event: "notification_failed",
        notificationId: notification.notificationId,
        attempts: notification.attempts,
        code: result.code ?? undefined,
      });
    }
  }

  return {
    projected: projected.created,
    claimed: claimed.length,
    sent,
    retried,
    failed,
    cancelled,
  };
}
