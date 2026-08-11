/**
 * Приём входящих update (A7 / DEC-031, гейт TG2).
 *
 * ЧТО ЗДЕСЬ ПРОИСХОДИТ И В КАКОМ ПОРЯДКЕ:
 *
 *   1. секрет вебхука;
 *   2. строгая схема и allowlist типов;
 *   3. поиск привязки по внешнему чату;
 *   4. durable-запись;
 *   5. быстрый `2xx`.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ: LLM, скачивания файлов, бизнес-команд. Всё
 * это живёт в воркерах. Причина не в чистоте слоёв: у запроса Telegram есть
 * таймаут, и если внутри него окажется вызов модели, приём переписки будет
 * падать ровно тогда, когда модель медленная.
 *
 * ТРИ ИСХОДА, И ИХ РАЗЛИЧИЕ ЗАГРУЖЕНО СМЫСЛОМ:
 *
 *   * `accepted` / `ignored` → `2xx`. Telegram больше не повторяет;
 *   * `rejected` → `4xx`. Тело не прошло проверку подлинности; повторять
 *     нечего;
 *   * `retry` → `5xx`. Запись не удалась по временной причине, и повтор
 *     Telegram — единственное, что спасёт сообщение. Отвечать `2xx` здесь
 *     значило бы потерять его молча.
 *
 * ПОДЛИННЫЙ, НО НЕПОДДЕРЖИВАЕМЫЙ update получает `2xx` и уходит в dead letter.
 * Ответить ему ошибкой значит обречь Telegram повторять его до скончания времён.
 */

import { createHash } from "node:crypto";

import {
  consoleBridgeLogger,
  sanitizeFailureCode,
  type TelegramBridgeLogger,
} from "./bridge-log";
import type { TelegramSystemPort } from "./gateway-port";
import type { TelegramApi } from "./telegram-api";
import {
  extractStartToken,
  normalizeTelegramUpdate,
  suspendsBinding,
  type NormalizedUpdate,
} from "./update-schema";
import { ProjectIntelligenceAdapterError } from "../../project-intelligence/adapters/postgres";

/** Версия текста уведомления участников группы. Живёт рядом со строками. */
export const TELEGRAM_NOTICE_VERSION = "notice/0.1" as const;

export type WebhookOutcome =
  | { readonly status: "accepted"; readonly eventId: string | null; readonly duplicate: boolean }
  | { readonly status: "ignored"; readonly code: string }
  | { readonly status: "rejected"; readonly code: string }
  | { readonly status: "retry"; readonly code: string };

export interface WebhookDependencies {
  readonly port: TelegramSystemPort;
  readonly api: TelegramApi;
  readonly botInstanceId: string;
  readonly webhookSecret: string;
  readonly noticeText: string;
  readonly unboundChatText: string;
  readonly logger?: TelegramBridgeLogger;
}

/**
 * Сравнение секрета за постоянное время. Telegram шлёт его открытым заголовком,
 * и обычное `===` протекает по времени ровно столько, сколько нужно для подбора
 * по символу.
 */
export function secretMatches(expected: string, received: string | null): boolean {
  if (received === null) return false;
  const left = createHash("sha256").update(expected, "utf8").digest();
  const right = createHash("sha256").update(received, "utf8").digest();
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index]! ^ right[index]!;
  }
  return diff === 0;
}

function isTransient(error: unknown): boolean {
  if (error instanceof ProjectIntelligenceAdapterError) {
    // Временное — то, что имеет шанс пройти со второй попытки. Отказ по правам
    // и по содержимому такого шанса не имеет, и повторять его бессмысленно.
    return error.code === "internal_error" || error.code === "stale_state";
  }
  // Чужой сбой неизвестной природы считается временным намеренно: потерять
  // сообщение хуже, чем получить лишний повтор от Telegram.
  return true;
}

/**
 * Обработка одного update. Функция не бросает: у вебхука нет исхода «упал» —
 * есть только код ответа, и его надо выбрать осознанно.
 */
export async function handleTelegramUpdate(
  body: unknown,
  dependencies: WebhookDependencies,
  requestId: string,
): Promise<WebhookOutcome> {
  const logger = dependencies.logger ?? consoleBridgeLogger;

  const normalized = normalizeTelegramUpdate(body);
  if (!normalized.ok) {
    logger.emit({
      event: normalized.reason === "malformed" ? "webhook_rejected" : "webhook_dead_letter",
      requestId,
      code: normalized.code,
    });
    // Неподдерживаемый — не ошибка отправителя: `2xx`, и Telegram успокаивается.
    return normalized.reason === "malformed"
      ? { status: "rejected", code: normalized.code }
      : { status: "ignored", code: normalized.code };
  }

  const update = normalized.update;

  try {
    const binding = await dependencies.port.resolveBinding({
      botInstanceId: dependencies.botInstanceId,
      externalChatId: update.externalChatId,
    });

    // Приватный чат бота: единственное, что там бывает нужным, — токен
    // связывания или подключения. Ничего другого мы в личке не храним.
    if (!binding) {
      return await handleUnboundChat(update, dependencies, requestId);
    }

    // Бота удалили или понизили — полный приём больше невозможен, и делать вид,
    // что он работает, нельзя.
    if (update.kind === "my_chat_member" && suspendsBinding(update.botMembershipStatus)) {
      await dependencies.port.suspendBinding({
        bindingId: binding.bindingId,
        reasonCode: "bot_membership_lost",
      });
      logger.emit({
        event: "binding_suspended",
        requestId,
        bindingId: binding.bindingId,
        projectId: binding.projectId,
        code: "bot_membership_lost",
      });
      return { status: "ignored", code: "binding_suspended" };
    }

    // Права бота восстановились и уведомление ещё не публиковалось — публикуем
    // и открываем полный приём. Это единственный путь к `full_after_notice`.
    if (binding.status === "active" && binding.captureMode === "notice_pending") {
      await announceAndOpenCapture(
        binding.bindingId, update.externalChatId, dependencies, requestId,
      );
    }

    // Callback официального действия не выполняет никогда (A7 §3). Событие
    // принимается только чтобы кнопка не висела — и не сохраняется.
    if (update.kind === "callback_query") {
      return { status: "ignored", code: "callback_not_actionable" };
    }

    if (update.kind !== "message" && update.kind !== "edited_message") {
      return { status: "ignored", code: "membership_event_only" };
    }

    // Приостановленная привязка ничего не сохраняет: RPC откажет, и это
    // правильный отказ, а не сбой.
    if (binding.status !== "active" || binding.captureMode !== "full_after_notice") {
      logger.emit({
        event: "webhook_dead_letter",
        requestId,
        bindingId: binding.bindingId,
        code: "capture_not_active",
      });
      return { status: "ignored", code: "capture_not_active" };
    }

    const recorded = await dependencies.port.recordEvent({
      bindingId: binding.bindingId,
      update,
    });

    if (recorded.duplicate) {
      logger.emit({
        event: "webhook_duplicate",
        requestId,
        eventId: recorded.eventId ?? undefined,
        updateId: update.updateId,
        projectId: binding.projectId,
      });
      return { status: "accepted", eventId: recorded.eventId, duplicate: true };
    }

    if (recorded.eventId) {
      await recordAttachments(recorded.eventId, update, dependencies);
    }

    logger.emit({
      event: "webhook_accepted",
      requestId,
      eventId: recorded.eventId ?? undefined,
      bindingId: binding.bindingId,
      projectId: binding.projectId,
      updateId: update.updateId,
      updateKind: update.kind,
    });
    return { status: "accepted", eventId: recorded.eventId, duplicate: false };
  } catch (error) {
    const code = sanitizeFailureCode(
      error instanceof ProjectIntelligenceAdapterError ? error.code : error,
      "ingest_failed",
    );
    logger.emit({ event: "webhook_dead_letter", requestId, code });
    // Отказ по содержимому или правам повторять нечем — он и со второй попытки
    // будет тем же. Временный сбой обязан вернуться: иначе сообщение исчезнет.
    return isTransient(error)
      ? { status: "retry", code }
      : { status: "ignored", code };
  }
}

/**
 * Чат, который мы не знаем. Здесь ровно два законных случая: человек прислал
 * боту в личку токен связывания, либо бота добавили в постороннюю группу.
 *
 * ВО ВТОРОМ СЛУЧАЕ СОДЕРЖИМОЕ НЕ СОХРАНЯЕТСЯ. Бот сообщает, что подключение не
 * завершено, и молчит дальше.
 */
async function handleUnboundChat(
  update: NormalizedUpdate,
  dependencies: WebhookDependencies,
  requestId: string,
): Promise<WebhookOutcome> {
  const logger = dependencies.logger ?? consoleBridgeLogger;
  const token = extractStartToken(update.textContent);

  if (!token) {
    if (update.kind === "my_chat_member" && !suspendsBinding(update.botMembershipStatus)) {
      // Бота добавили в несвязанную группу. Один ответ — и тишина.
      await dependencies.api.sendMessage({
        chatId: update.externalChatId,
        text: dependencies.unboundChatText,
      }).catch(() => undefined);
    }
    logger.emit({ event: "webhook_dead_letter", requestId, code: "chat_not_bound" });
    return { status: "ignored", code: "chat_not_bound" };
  }

  if (!update.externalActorId) {
    return { status: "ignored", code: "start_without_actor" };
  }

  // Токен непрозрачен, и что он открывает — решает база, а не текст команды.
  // Пробуем оба назначения: сначала связывание, затем подключение.
  const digest = createHash("sha256").update(token, "utf8").digest("hex");
  const isGroup = update.chatType === "group" || update.chatType === "supergroup";

  try {
    if (!isGroup) {
      const intent = await dependencies.port.consumeIntent({
        nonceDigestHex: digest,
        purpose: "identity_link",
        botInstanceId: dependencies.botInstanceId,
        externalActorId: update.externalActorId,
      });
      await dependencies.port.completeIdentityLink({
        intentId: intent.intentId,
        externalActorId: update.externalActorId,
      });
      logger.emit({
        event: "identity_linked",
        requestId,
        projectId: intent.projectId,
      });
      return { status: "ignored", code: "identity_linked" };
    }

    const intent = await dependencies.port.consumeIntent({
      nonceDigestHex: digest,
      purpose: "channel_binding",
      botInstanceId: dependencies.botInstanceId,
      externalActorId: update.externalActorId,
    });

    // Администратор ли этот человек в ЭТОЙ группе. База спросить Telegram не
    // умеет, поэтому спрашиваем здесь — и отказ всё равно живёт в RPC.
    const isAdmin = await dependencies.api.isChatAdministrator({
      chatId: update.externalChatId,
      userId: update.externalActorId,
    }).catch(() => false);

    const binding = await dependencies.port.completeChannelBinding({
      intentId: intent.intentId,
      externalActorId: update.externalActorId,
      externalChatId: update.externalChatId,
      chatType: update.chatType === "group" ? "group" : "supergroup",
      initiatorIsChatAdmin: isAdmin,
      noticeVersion: TELEGRAM_NOTICE_VERSION,
    });

    logger.emit({
      event: "binding_activated",
      requestId,
      bindingId: binding.bindingId,
      projectId: binding.projectId,
    });

    await announceAndOpenCapture(
      binding.bindingId, update.externalChatId, dependencies, requestId,
    );
    return { status: "ignored", code: "binding_activated" };
  } catch (error) {
    const code = sanitizeFailureCode(
      error instanceof ProjectIntelligenceAdapterError ? error.code : error,
      "start_token_rejected",
    );
    logger.emit({ event: "webhook_dead_letter", requestId, code });
    // Негодный токен — не повод просить Telegram повторить: он негоден навсегда.
    return isTransient(error) && !(error instanceof ProjectIntelligenceAdapterError)
      ? { status: "retry", code }
      : { status: "ignored", code };
  }
}

/**
 * Уведомление участников и открытие полного приёма — ровно в этом порядке.
 *
 * Если сообщение не ушло, приём НЕ открывается: обещание «участники знают»
 * должно быть правдой, а не намерением. Следующее событие в этом чате повторит
 * попытку.
 */
async function announceAndOpenCapture(
  bindingId: string,
  externalChatId: string,
  dependencies: WebhookDependencies,
  requestId: string,
): Promise<void> {
  const logger = dependencies.logger ?? consoleBridgeLogger;
  try {
    await dependencies.api.sendMessage({
      chatId: externalChatId,
      text: dependencies.noticeText,
    });
  } catch {
    logger.emit({ event: "webhook_dead_letter", requestId, bindingId, code: "notice_not_posted" });
    return;
  }
  await dependencies.port.markNoticePosted({
    bindingId,
    noticeVersion: TELEGRAM_NOTICE_VERSION,
  });
}

async function recordAttachments(
  eventId: string,
  update: NormalizedUpdate,
  dependencies: WebhookDependencies,
): Promise<void> {
  for (const attachment of update.attachments) {
    // Байты НЕ скачиваются. Общий карантинный конвейер для этого источника ещё
    // не доказан, а заводить рядом отдельное телеграм-хранилище — худшее из
    // решений: оно выглядело бы работающим. Метаданные сохраняются, статус
    // называет причину честно.
    const scanStatus = attachment.initialScanStatus === "too_large"
      ? "too_large" as const
      : "materialization_blocked" as const;
    const scanReason = attachment.initialScanStatus === "too_large"
      ? attachment.initialScanReason
      : "quarantine_pipeline_unproven";
    await dependencies.port.recordAttachment({
      eventId,
      attachment,
      scanStatus,
      scanReason,
    });
  }
}
