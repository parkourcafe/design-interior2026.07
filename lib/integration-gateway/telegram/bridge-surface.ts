/**
 * Матрица поверхности Telegram Chat Bridge: функция → контур → способ закрытия.
 *
 * Зачем таблица, а не комментарий — урок чужой, и он дорого достался дважды.
 * Guardrail модуля 3 выглядел исчерпывающим и не был им; guardrail модуля 4
 * отзывал права сплошь по имени схемы и пропустил четыре командные RPC, живущие
 * в чужой схеме. Ни один тест этого поймать не мог: сверять было не с чем.
 * Здесь есть с чем — `telegram-bridge-surface-matrix.test.ts` сверяет эту
 * таблицу с текстом миграции и со скриптом среды, а `tests/db4/09_...` — с
 * настоящей базой.
 *
 * ДВА КОНТУРА:
 *
 *   * `human` — работает от `auth.uid()` через `_authorize_project_human`.
 *     Закрыт по умолчанию тем же `revoke`, что и всё остальное, и возвращается
 *     ЯВНО только там, где мост намеренно открыт
 *     (`tests/ap1/environment/enable-telegram-bridge.sql`). Это механизм
 *     одноразовой непроизводственной среды — **не** production feature flag и
 *     **не** entitlement (то же решение владельца, что для M3 и M4: DEC-029);
 *   * `system` — webhook и воркеры. Выдан ТОЛЬКО `service_role` и отозван у
 *     `authenticated` НАВСЕГДА. Ни одна среда его не возвращает. Системная
 *     функция, доступная человеческой сессии, означала бы, что кто угодно может
 *     сфабриковать входящее сообщение чужого проекта.
 */

export type TelegramBridgeCircuit = "human" | "system";

export type TelegramBridgeClosure =
  /** Закрыто в базе навсегда для человеческой сессии. */
  | "revoked_from_authenticated"
  /** Закрыто по умолчанию; возвращается явно там, где мост открыт. */
  | "enabled_by_environment_script";

export interface TelegramBridgeRpc {
  /** Схема и имя ровно так, как их видит PostgREST. */
  readonly schema: "projectceo_gateway_api";
  readonly name: string;
  /** Полная сигнатура — по ней проверяются права в базе. */
  readonly signature: string;
  readonly circuit: TelegramBridgeCircuit;
  readonly closure: TelegramBridgeClosure;
  /** Что делает функция. Одна строка, без «и ещё немного». */
  readonly purpose: string;
}

const gateway = "projectceo_gateway_api" as const;

export const TELEGRAM_BRIDGE_SURFACE: readonly TelegramBridgeRpc[] = [
  {
    schema: gateway,
    name: "create_channel_link_intent",
    signature: "projectceo_gateway_api.create_channel_link_intent(uuid, text, text, text, integer)",
    circuit: "human",
    closure: "enabled_by_environment_script",
    purpose: "Завести одноразовый интент связывания или подключения",
  },
  {
    schema: gateway,
    name: "get_project_channel_state",
    signature: "projectceo_gateway_api.get_project_channel_state(uuid)",
    circuit: "human",
    closure: "enabled_by_environment_script",
    purpose: "Состояние подключения для экрана настроек проекта",
  },
  {
    schema: gateway,
    name: "revoke_channel_binding",
    signature: "projectceo_gateway_api.revoke_channel_binding(uuid, uuid, text)",
    circuit: "human",
    closure: "enabled_by_environment_script",
    purpose: "Отключить чат и отменить неотправленные уведомления",
  },
  {
    schema: gateway,
    name: "list_project_inbox_candidates",
    signature: "projectceo_gateway_api.list_project_inbox_candidates(uuid, integer)",
    circuit: "human",
    closure: "enabled_by_environment_script",
    purpose: "Прочитать Project Inbox проекта",
  },
  {
    schema: gateway,
    name: "resolve_project_inbox_candidate",
    signature: "projectceo_gateway_api.resolve_project_inbox_candidate(uuid, uuid, text)",
    circuit: "human",
    closure: "enabled_by_environment_script",
    purpose: "Решение человека по кандидату — БЕЗ создания доменного объекта",
  },
  {
    schema: gateway,
    name: "consume_channel_link_intent",
    signature: "projectceo_gateway_api.consume_channel_link_intent(text, text, text, text)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Погасить одноразовый интент по хешу секрета",
  },
  {
    schema: gateway,
    name: "complete_identity_link",
    signature: "projectceo_gateway_api.complete_identity_link(uuid, text)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Связать числовой Telegram-идентификатор с аккаунтом RemHaOS",
  },
  {
    schema: gateway,
    name: "complete_channel_binding",
    signature: "projectceo_gateway_api.complete_channel_binding(uuid, text, text, text, boolean, text)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Подключить чат к проекту после проверок транспорта и прав",
  },
  {
    schema: gateway,
    name: "mark_channel_notice_posted",
    signature: "projectceo_gateway_api.mark_channel_notice_posted(uuid, text)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Уведомление участникам опубликовано — начинается полный приём",
  },
  {
    schema: gateway,
    name: "suspend_channel_binding",
    signature: "projectceo_gateway_api.suspend_channel_binding(uuid, text)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Бот удалён или понижен — приостановить привязку",
  },
  {
    schema: gateway,
    name: "resolve_channel_binding",
    signature: "projectceo_gateway_api.resolve_channel_binding(text, text)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Найти активную привязку по внешнему чату",
  },
  {
    schema: gateway,
    name: "record_channel_event",
    signature: "projectceo_gateway_api.record_channel_event(uuid, bigint, text, bigint, text, text, integer, timestamptz, bigint, text, timestamptz, text)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Durable-запись входящего update до ответа Telegram",
  },
  {
    schema: gateway,
    name: "record_channel_attachment",
    signature: "projectceo_gateway_api.record_channel_attachment(uuid, text, text, text, bigint, text, text, text)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Метаданные вложения и его карантинный статус",
  },
  {
    schema: gateway,
    name: "claim_channel_events",
    signature: "projectceo_gateway_api.claim_channel_events(integer, integer)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Взять очередь входящих в аренду",
  },
  {
    schema: gateway,
    name: "complete_channel_event",
    signature: "projectceo_gateway_api.complete_channel_event(uuid, text, text, integer)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Отметить исход обработки входящего события",
  },
  {
    schema: gateway,
    name: "record_inbox_candidate",
    signature: "projectceo_gateway_api.record_inbox_candidate(uuid, text, text, text, text, text, text, text)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Записать НЕПОДТВЕРЖДЁННОГО кандидата Project Inbox",
  },
  {
    schema: gateway,
    name: "project_release_notifications",
    signature: "projectceo_gateway_api.project_release_notifications(integer)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Догоняющий проектор: выдачи без уведомления → outbox",
  },
  {
    schema: gateway,
    name: "claim_notifications",
    signature: "projectceo_gateway_api.claim_notifications(integer, integer)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Взять очередь уведомлений в аренду",
  },
  {
    schema: gateway,
    name: "complete_notification",
    signature: "projectceo_gateway_api.complete_notification(uuid, text, bigint, text, integer)",
    circuit: "system",
    closure: "revoked_from_authenticated",
    purpose: "Отметить исход отправки уведомления",
  },
];

function signatures(predicate: (rpc: TelegramBridgeRpc) => boolean): readonly string[] {
  return TELEGRAM_BRIDGE_SURFACE.filter(predicate).map((rpc) => rpc.signature);
}

/** Отозвано у `authenticated` навсегда — ни одна среда не возвращает. */
export const TELEGRAM_BRIDGE_SYSTEM_SIGNATURES: readonly string[] = signatures(
  (rpc) => rpc.circuit === "system",
);

/** Закрыто по умолчанию, открывается явно там, где мост намеренно включён. */
export const TELEGRAM_BRIDGE_HUMAN_SIGNATURES: readonly string[] = signatures(
  (rpc) => rpc.circuit === "human",
);

/**
 * Таблицы шлюза. Ни одна не отдана Data API и ни одна не читается человеческой
 * ролью напрямую: всё идёт через фиксированные RPC выше.
 */
export const TELEGRAM_BRIDGE_TABLES: readonly string[] = [
  "project_channel_bindings",
  "channel_identity_links",
  "channel_link_intents",
  "channel_events",
  "channel_attachments",
  "project_inbox_candidates",
  "notification_outbox",
];

/**
 * Типы кандидатов Project Inbox в P0.
 *
 * `ignored` в списке НЕ случайно: модель обязана уметь сказать «ничего», иначе
 * она станет придумывать кандидатов из «ок, спасибо».
 */
export const PROJECT_INBOX_CANDIDATE_TYPES = [
  "question",
  "decision_candidate",
  "change_request_candidate",
  "risk_candidate",
  "general_note",
  "ignored",
] as const;

export type ProjectInboxCandidateType = (typeof PROJECT_INBOX_CANDIDATE_TYPES)[number];
