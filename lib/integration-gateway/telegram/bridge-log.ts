/**
 * Санитизированная диагностика моста (A7 §7, AGENTS.md про logs).
 *
 * ПРАВИЛО, ради которого этот файл существует: в structured logs не попадает ни
 * строки переписки, ни имени файла, ни токена бота, ни секрета вебхука, ни
 * download URL. Не «мы стараемся» — здесь просто нет способа их туда положить:
 * поля события ограничены типом, а значения проходят через фильтр.
 *
 * Почему фильтр, если поля и так ограничены типом: типы стирает `unknown`,
 * приходящий из внешних библиотек и из `catch`. Ошибка Telegram или PostgREST —
 * это чужой объект, и он может нести что угодно, включая URL с токеном.
 */

/** Что произошло. Список закрытый: событие, которого здесь нет, не логируется. */
export type TelegramBridgeEventName =
  | "webhook_rejected"
  | "webhook_accepted"
  | "webhook_duplicate"
  | "webhook_dead_letter"
  | "binding_activated"
  | "binding_suspended"
  | "binding_revoked"
  | "identity_linked"
  | "notification_projected"
  | "notification_sent"
  | "notification_retry"
  | "notification_failed"
  | "notification_cancelled"
  | "event_processed"
  | "candidate_recorded";

/**
 * Поля события. Только идентификаторы, коды и числа.
 *
 * `externalChatId` и `externalActorId` НЕ входят сюда намеренно: внешние
 * идентификаторы участников чата — персональные данные третьих лиц, и место им
 * в базе под RLS, а не в потоке логов, который читают шире.
 */
export interface TelegramBridgeEvent {
  readonly event: TelegramBridgeEventName;
  readonly requestId?: string;
  readonly projectId?: string;
  readonly bindingId?: string;
  readonly eventId?: string;
  readonly notificationId?: string;
  readonly candidateId?: string;
  readonly updateId?: number;
  readonly updateKind?: string;
  readonly candidateType?: string;
  /** Санитизированный КОД, не текст. Форма совпадает с доменом базы. */
  readonly code?: string;
  readonly attempts?: number;
  readonly durationMs?: number;
  readonly count?: number;
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

/**
 * Приводит любой чужой сбой к коду. Сообщение исходной ошибки НЕ переносится:
 * ответ Bot API на `getFile` содержит путь к файлу, а ответ на любой запрос —
 * URL с токеном бота внутри.
 */
export function sanitizeFailureCode(value: unknown, fallback = "unknown_failure"): string {
  if (typeof value === "string" && CODE_PATTERN.test(value)) return value;
  if (
    value !== null && typeof value === "object"
    && "code" in value && typeof (value as { code: unknown }).code === "string"
  ) {
    const code = (value as { code: string }).code;
    if (CODE_PATTERN.test(code)) return code;
    // Коды PostgREST и PostgreSQL приходят как `P1103`, `23505`, `PGRST202` —
    // они не PII и полезны, но под общую форму не подходят. Приводим явно.
    const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (CODE_PATTERN.test(normalized)) return normalized;
  }
  return fallback;
}

export interface TelegramBridgeLogger {
  emit(event: TelegramBridgeEvent): void;
}

/**
 * Единственная точка, где событие превращается в строку. Значения, не прошедшие
 * фильтр, отбрасываются целиком: логировать «что-то похожее на код» опаснее, чем
 * не логировать ничего.
 */
export function sanitizeBridgeEvent(event: TelegramBridgeEvent): Record<string, unknown> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const out: Record<string, unknown> = { channel: "telegram", event: event.event };

  for (const key of ["requestId", "projectId", "bindingId", "eventId", "notificationId", "candidateId"] as const) {
    const value = event[key];
    if (typeof value === "string" && uuid.test(value)) out[key] = value;
  }
  for (const key of ["updateId", "attempts", "durationMs", "count"] as const) {
    const value = event[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  if (typeof event.updateKind === "string" && CODE_PATTERN.test(event.updateKind)) {
    out.updateKind = event.updateKind;
  }
  if (typeof event.candidateType === "string" && CODE_PATTERN.test(event.candidateType)) {
    out.candidateType = event.candidateType;
  }
  if (typeof event.code === "string" && CODE_PATTERN.test(event.code)) out.code = event.code;

  return out;
}

export const consoleBridgeLogger: TelegramBridgeLogger = {
  emit(event) {
    // Одна строка JSON — то, что умеет читать любой сборщик логов, и ровно то,
    // что прошло фильтр.
    console.info(JSON.stringify(sanitizeBridgeEvent(event)));
  },
};

/** Логгер, который ничего не делает. Нужен тестам и выключенному мосту. */
export const silentBridgeLogger: TelegramBridgeLogger = { emit() {} };
