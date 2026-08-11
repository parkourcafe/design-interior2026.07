/**
 * Структурный лог моста.
 *
 * Правило A7: в логи не попадают ни текст переписки, ни токены, ни ссылки на
 * скачивание, ни имена файлов. Приём здесь не «не забыть вычистить», а «нечем
 * запачкать»: функция принимает ЗАКРЫТЫЙ набор полей известных типов, и
 * произвольный объект в неё не передать — это не проходит компиляцию.
 *
 * Почему так, а не `redact(payload)`: чистильщик, который получает всё и
 * вырезает лишнее, ошибается ровно один раз — на поле, о котором не знал. При
 * списке разрешённого новое поле по умолчанию не логируется вовсе.
 *
 * Идентификаторы чата и отправителя Telegram — сами по себе персональные
 * данные, поэтому наружу они идут только хешем: для сопоставления строк лога
 * между собой этого достаточно, для установления человека — нет.
 */

import { createHash } from "node:crypto";

export type TelegramBridgeOutcome =
  | "ignored_bridge_disabled"
  | "ignored_bad_secret"
  | "ignored_oversized"
  | "ignored_malformed"
  | "ignored_unknown_update"
  | "ignored_not_group"
  | "ignored_chat_not_bound"
  | "binding_activated"
  | "binding_rejected"
  | "binding_suspended"
  | "identity_linked"
  | "identity_rejected"
  | "stored"
  | "duplicate"
  | "notification_sent"
  | "notification_failed"
  | "notification_skipped"
  | "internal_error";

export interface TelegramBridgeLogEvent {
  readonly outcome: TelegramBridgeOutcome;
  /** Наш идентификатор запроса, не Telegram'а. */
  readonly requestId: string;
  /** `update_id` — число Telegram, не содержимое. */
  readonly updateId?: number;
  readonly eventKind?: string;
  /** Хеш идентификатора чата, не сам идентификатор. */
  readonly chatRef?: string;
  readonly durationMs?: number;
  /** Санитизированный код, не текст ошибки провайдера. */
  readonly failureCode?: string;
}

/** Короткий стабильный хеш. Не обратим до идентификатора без словаря чатов. */
export function chatRef(chatId: number): string {
  return createHash("sha256")
    .update(`telegram:chat:${chatId}`, "utf8")
    .digest("hex")
    .slice(0, 12);
}

export function logTelegramBridgeEvent(event: TelegramBridgeLogEvent): void {
  // Одна строка JSON — так её читает и человек, и сборщик логов.
  const line = JSON.stringify({ scope: "telegram-bridge", ...event });
  if (event.outcome === "internal_error") {
    console.error(line);
    return;
  }
  console.info(line);
}
