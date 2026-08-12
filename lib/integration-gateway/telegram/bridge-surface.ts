/**
 * Матрица поверхности Telegram Chat Bridge: дверь → кто зовёт → чем закрыта.
 *
 * Зачем таблица, а не комментарий — урок модулей 3 и 4, где «модуль закрыт»
 * до поры проверялось на глаз, и оба раза оказывалось, что закрыта половина.
 * Здесь состав поверхности — данные, а рядом тесты
 * (`telegram-bridge-surface.test.ts`, `tests/db4/42_telegram_bridge_boundary.sql`),
 * которые роняют CI, если матрица разойдётся с миграцией или с базой.
 *
 * ЧТО ЗНАЧИТ `audience`:
 *
 *   * `system` — только `service_role`. Транспорт и воркер. Человеческая
 *     сессия не достаёт до этих функций ни при каком значении флага: у роли
 *     `authenticated` на них нет прав в базе;
 *   * `human` — `authenticated`, авторизация внутри функции через
 *     `_authorize_project_human` по членству и capability. Права в базе есть,
 *     но без членства и capability функция отказывает сама.
 *
 * ЧЕГО В МАТРИЦЕ НЕТ И НЕ БУДЕТ: двери, создающей официальный объект домена.
 * Кандидат остаётся кандидатом; изменение, приёмку и подтверждение выполняют
 * существующие команды RemHaOS (A7 §1.7).
 */

export type TelegramBridgeAudience = "system" | "human";

export interface TelegramBridgeRpc {
  readonly schema: "remhaos_channel_api";
  readonly name: string;
  /** Полная сигнатура — по ней проверяются права в базе. */
  readonly signature: string;
  readonly audience: TelegramBridgeAudience;
  /** Capability, которую функция требует внутри; null для системных. */
  readonly capability: string | null;
}

export const TELEGRAM_BRIDGE_SURFACE: readonly TelegramBridgeRpc[] = [
  {
    schema: "remhaos_channel_api",
    name: "create_identity_link_intent",
    signature: "remhaos_channel_api.create_identity_link_intent(bytea, integer)",
    audience: "human",
    // Связывает человек СЕБЯ, поэтому проектной capability нет: проверяется
    // только то, что сессия существует.
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "create_binding_intent",
    signature: "remhaos_channel_api.create_binding_intent(uuid, bytea, integer)",
    audience: "human",
    capability: "manage_project_integrations",
  },
  {
    schema: "remhaos_channel_api",
    name: "get_project_channel_state",
    signature: "remhaos_channel_api.get_project_channel_state(uuid)",
    audience: "human",
    capability: "view_project",
  },
  {
    schema: "remhaos_channel_api",
    name: "disconnect_project_channel",
    signature: "remhaos_channel_api.disconnect_project_channel(uuid, text)",
    audience: "human",
    capability: "manage_project_integrations",
  },
  {
    schema: "remhaos_channel_api",
    name: "consume_identity_link_intent",
    signature: "remhaos_channel_api.consume_identity_link_intent(bytea, bigint)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "activate_project_binding",
    // Два обязательных утверждения об администраторстве — инициатора и самого
    // бота. Их проверяет транспорт (база не умеет спросить Telegram), но отказ
    // живёт в RPC: пропустить обязательный аргумент труднее, чем забыть вызов.
    signature:
      "remhaos_channel_api.activate_project_binding(bytea, bigint, text, bigint, text, text, boolean, boolean)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "terminate_pending_binding",
    signature: "remhaos_channel_api.terminate_pending_binding(uuid, text, text)",
    audience: "system",
    // Закрывает недоведённую связь безопасным терминальным состоянием, чтобы
    // постоянный отказ не оставлял `notice_pending` навсегда.
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "find_pending_notice_binding",
    signature: "remhaos_channel_api.find_pending_notice_binding(text, bigint)",
    audience: "system",
    // Существует ради повтора публикации уведомления: одноразовый секрет к
    // этому моменту потрачен, и без этой двери зависший `notice_pending`
    // нельзя сдвинуть ничем, кроме ручной правки базы.
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "mark_channel_notice_posted",
    // Связь становится активной и приём открывается ТОЛЬКО здесь — после того
    // как участники группы получили уведомление о сборе.
    signature:
      "remhaos_channel_api.mark_channel_notice_posted(uuid, text, boolean, boolean)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "suspend_project_binding",
    signature: "remhaos_channel_api.suspend_project_binding(text, bigint, text)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "ingest_channel_update",
    signature:
      "remhaos_channel_api.ingest_channel_update(text, bigint, bigint, bigint, text, bigint, timestamptz, bigint, text, jsonb)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "enqueue_notification",
    signature:
      "remhaos_channel_api.enqueue_notification(uuid, text, text, text, jsonb, text)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "claim_notification_batch",
    signature: "remhaos_channel_api.claim_notification_batch(integer, integer)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "mark_notification_sent",
    signature: "remhaos_channel_api.mark_notification_sent(uuid, uuid, bigint)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "mark_notification_failed",
    signature: "remhaos_channel_api.mark_notification_failed(uuid, uuid, text, integer)",
    audience: "system",
    capability: null,
  },
  // ── Вертикаль M3 → M4 (миграция 20260811060000) ──────────────────────────
  {
    schema: "remhaos_channel_api",
    name: "claim_channel_events",
    signature: "remhaos_channel_api.claim_channel_events(integer, integer)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "record_inbox_candidate",
    signature:
      "remhaos_channel_api.record_inbox_candidate(uuid, text, text, text, text, text, text)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "complete_channel_event",
    signature: "remhaos_channel_api.complete_channel_event(uuid, text, text)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "list_distribution_notification_backlog",
    signature:
      "remhaos_channel_api.list_distribution_notification_backlog(integer)",
    audience: "system",
    capability: null,
  },
  {
    schema: "remhaos_channel_api",
    name: "list_project_inbox",
    signature: "remhaos_channel_api.list_project_inbox(uuid, integer)",
    audience: "human",
    capability: "view_project",
  },
  {
    schema: "remhaos_channel_api",
    name: "review_inbox_candidate",
    signature:
      "remhaos_channel_api.review_inbox_candidate(uuid, uuid, text, text, text)",
    audience: "human",
    // Решение по кандидату — то же право, что и на разбор входящего
    // источника: строитель и заказчик его не имеют, дизайнер и архитектор
    // имеют. Новой capability мост не вводит: их и так уже двадцать одна.
    capability: "review_source",
  },
];

/** Приватная схема моста. Data API её не видит и видеть не должен. */
export const TELEGRAM_BRIDGE_PRIVATE_SCHEMA = "remhaos_channel" as const;

/** Единственная capability, которую вводит мост. В P0 — только у владельца. */
export const TELEGRAM_BRIDGE_CAPABILITY = "manage_project_integrations" as const;

export const TELEGRAM_BRIDGE_SYSTEM_SIGNATURES: readonly string[] =
  TELEGRAM_BRIDGE_SURFACE.filter((rpc) => rpc.audience === "system").map(
    (rpc) => rpc.signature,
  );

export const TELEGRAM_BRIDGE_HUMAN_SIGNATURES: readonly string[] =
  TELEGRAM_BRIDGE_SURFACE.filter((rpc) => rpc.audience === "human").map(
    (rpc) => rpc.signature,
  );
