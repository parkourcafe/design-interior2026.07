import { z } from "zod";

import type {
  PostgresBytea,
  PostgresRpcClient,
} from "@/lib/project-intelligence/adapters/postgres";
import { claimedEventSchema, type ClaimedChannelEvent } from "./extraction/runner";

/**
 * Порты к схеме `remhaos_channel_api`. Два класса, а не один, и это главное в
 * этом файле.
 *
 * `TelegramSystemPort` держит клиент `service_role` и умеет ТОЛЬКО системные
 * двери: приём, активация, очередь. `TelegramHumanPort` держит
 * request-bound клиент с человеческим JWT и умеет только человеческие.
 *
 * Разделение не косметическое. A7 §2.1 запрещает звать human RPC через
 * `service_role`; при одном классе с обоими методами такой вызов — это
 * опечатка в одну строку, и никакой тест её не заметит. При двух классах у
 * системного порта человеческого метода просто нет, и опечатка не
 * компилируется. База закрывает то же самое с другой стороны: у `authenticated`
 * нет прав на системные функции. Граница держится дважды.
 */

const envelopeSchema = z.object({
  contractVersion: z.literal("remhaos-channel/0.1"),
  requestId: z.string().min(1),
  data: z.unknown().nullable(),
  error: z.unknown().nullable(),
});

export class TelegramChannelRpcError extends Error {
  constructor(
    readonly operation: string,
    /** Санитизированный код: SQLSTATE или `rpc_failed`. Не текст провайдера. */
    readonly failureCode: string,
  ) {
    super(`telegram_channel_rpc_failed:${operation}`);
    this.name = "TelegramChannelRpcError";
  }
}

function sanitizedFailureCode(error: {
  readonly code?: string | null;
}): string {
  const code = error.code ?? "";
  // Сообщение провайдера может содержать значения строки, поэтому наружу
  // отдаётся только SQLSTATE — он из фиксированного алфавита.
  return /^[A-Za-z0-9]{5}$/.test(code) ? code : "rpc_failed";
}

async function callChannelRpc(
  client: PostgresRpcClient,
  operation: string,
  args: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const response = await client.schema("remhaos_channel_api").rpc(operation, args);
  if (response.error) {
    throw new TelegramChannelRpcError(operation, sanitizedFailureCode(response.error));
  }
  const parsed = envelopeSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new TelegramChannelRpcError(operation, "envelope_invalid");
  }
  return parsed.data.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Системная сторона: транспорт и отправитель
// ─────────────────────────────────────────────────────────────────────────────

const ingestResultSchema = z.object({
  stored: z.boolean(),
  duplicate: z.boolean().optional(),
  reason: z.string().optional(),
  eventId: z.string().optional(),
  projectId: z.string().optional(),
  sourceRevision: z.number().int().optional(),
});

/**
 * Форма ровно та, что строит `claim_notification_batch`. Схема здесь не
 * украшение: она ловит расхождение с базой на первом же запуске, а не на
 * поле, которого не оказалось в проде.
 */
const claimedNotificationSchema = z.object({
  notificationId: z.string(),
  bindingId: z.string(),
  templateVersion: z.string(),
  attemptCount: z.number().int().nonnegative(),
  // Токен аренды. Возвращается захватом и требуется завершением: без него
  // «захват» был бы обещанием, а не механизмом.
  leaseToken: z.string(),
  payload: z.record(z.unknown()),
  externalChatId: z.number(),
  botInstanceId: z.string(),
});

export type ClaimedNotification = z.infer<typeof claimedNotificationSchema>;

const pendingNoticeSchema = z.object({
  pending: z.boolean(),
  bindingId: z.string().optional(),
  noticeVersion: z.string().optional(),
  initiatorExternalUserId: z.number().nullable().optional(),
});

export interface PendingNoticeBinding {
  readonly bindingId: string;
  readonly noticeVersion: string;
  /** null — связь личности инициатора отозвана; финализация обязана отказать. */
  readonly initiatorExternalUserId: number | null;
}

export interface IngestChannelUpdateInput {
  readonly botInstanceId: string;
  readonly updateId: number;
  readonly chatId: number;
  readonly messageId: number;
  readonly eventKind: string;
  readonly senderId: number | null;
  readonly sentAt: string | null;
  readonly replyToMessageId: number | null;
  readonly forwardOriginKind: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export class TelegramSystemPort {
  constructor(private readonly client: PostgresRpcClient) {}

  async consumeIdentityLinkIntent(input: {
    readonly nonceDigest: PostgresBytea;
    readonly externalUserId: number;
  }): Promise<void> {
    await callChannelRpc(this.client, "consume_identity_link_intent", {
      nonce_digest: input.nonceDigest,
      external_user_id: input.externalUserId,
    });
  }

  /**
   * Создаёт связь в состоянии `notice_pending`: приём ещё НЕ открыт. Открывает
   * его только `markChannelNoticePosted` — после того, как участники группы
   * получили сообщение о сборе.
   *
   * Оба факта об администраторстве проверяет транспорт (база не умеет спросить
   * Telegram) и передаёт их явными аргументами. Отказ при `false` живёт в самой
   * RPC: пропустить обязательный аргумент труднее, чем забыть проверку.
   */
  async activateProjectBinding(input: {
    readonly nonceDigest: PostgresBytea;
    readonly externalUserId: number;
    readonly botInstanceId: string;
    readonly chatId: number;
    readonly chatType: string;
    readonly noticeVersion: string;
    readonly initiatorIsChatAdmin: boolean;
    readonly botIsChatAdmin: boolean;
  }): Promise<{ readonly projectId: string; readonly bindingId: string }> {
    const data = await callChannelRpc(this.client, "activate_project_binding", {
      nonce_digest: input.nonceDigest,
      external_user_id: input.externalUserId,
      bot_instance_id: input.botInstanceId,
      external_chat_id: input.chatId,
      external_chat_type: input.chatType,
      notice_version: input.noticeVersion,
      initiator_is_chat_admin: input.initiatorIsChatAdmin,
      bot_is_chat_admin: input.botIsChatAdmin,
    });
    const parsed = z
      .object({ projectId: z.string(), bindingId: z.string() })
      .safeParse(data);
    if (!parsed.success) {
      throw new TelegramChannelRpcError("activate_project_binding", "shape_invalid");
    }
    return parsed.data;
  }

  /**
   * Уведомление опубликовано — связь становится активной и приём открывается.
   * Отдельный шаг, потому что отдельный факт: между созданием связи и словами в
   * чате может пройти минута, а может не пройти ничего.
   */
  async markChannelNoticePosted(input: {
    readonly bindingId: string;
    readonly noticeVersion: string;
    readonly initiatorIsChatAdmin: boolean;
    readonly botIsChatAdmin: boolean;
  }): Promise<{ readonly changed: boolean }> {
    const data = await callChannelRpc(this.client, "mark_channel_notice_posted", {
      binding_id: input.bindingId,
      notice_version: input.noticeVersion,
      initiator_is_chat_admin: input.initiatorIsChatAdmin,
      bot_is_chat_admin: input.botIsChatAdmin,
    });
    const parsed = z.object({ changed: z.boolean() }).safeParse(data);
    return { changed: parsed.success ? parsed.data.changed : false };
  }

  /**
   * Закончить недоведённую связь безопасным терминальным состоянием.
   *
   * Нужна ровно затем, чтобы постоянный отказ не оставлял `notice_pending`
   * навсегда: иначе мост слал бы уведомление на каждом обновлении чата и
   * никогда не завершал подключение.
   */
  async terminatePendingBinding(input: {
    readonly bindingId: string;
    readonly reason: string;
  }): Promise<{ readonly terminated: boolean }> {
    const data = await callChannelRpc(this.client, "terminate_pending_binding", {
      binding_id: input.bindingId,
      reason: input.reason,
    });
    const parsed = z.object({ terminated: z.boolean() }).safeParse(data);
    return { terminated: parsed.success ? parsed.data.terminated : false };
  }

  /**
   * Связь этого чата, ожидающая публикации уведомления.
   *
   * Существует ровно ради повтора: одноразовый секрет потрачен при создании
   * связи, и без этой двери зависший `notice_pending` нельзя было бы сдвинуть
   * ничем, кроме ручной правки базы.
   */
  async findPendingNoticeBinding(input: {
    readonly botInstanceId: string;
    readonly chatId: number;
  }): Promise<PendingNoticeBinding | null> {
    const data = await callChannelRpc(this.client, "find_pending_notice_binding", {
      bot_instance_id: input.botInstanceId,
      external_chat_id: input.chatId,
    });
    const parsed = pendingNoticeSchema.safeParse(data);
    if (!parsed.success || !parsed.data.pending) return null;
    return {
      bindingId: parsed.data.bindingId ?? "",
      noticeVersion: parsed.data.noticeVersion ?? "",
      initiatorExternalUserId: parsed.data.initiatorExternalUserId ?? null,
    };
  }

  async suspendProjectBinding(input: {
    readonly botInstanceId: string;
    readonly chatId: number;
    readonly reason: string;
  }): Promise<void> {
    await callChannelRpc(this.client, "suspend_project_binding", {
      bot_instance_id: input.botInstanceId,
      external_chat_id: input.chatId,
      reason: input.reason,
    });
  }

  async ingestChannelUpdate(
    input: IngestChannelUpdateInput,
  ): Promise<z.infer<typeof ingestResultSchema>> {
    const data = await callChannelRpc(this.client, "ingest_channel_update", {
      bot_instance_id: input.botInstanceId,
      update_id: input.updateId,
      external_chat_id: input.chatId,
      external_message_id: input.messageId,
      event_kind: input.eventKind,
      external_sender_id: input.senderId,
      external_sent_at: input.sentAt,
      reply_to_message_id: input.replyToMessageId,
      forward_origin_kind: input.forwardOriginKind,
      payload: input.payload,
    });
    const parsed = ingestResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new TelegramChannelRpcError("ingest_channel_update", "shape_invalid");
    }
    return parsed.data;
  }

  async enqueueNotification(input: {
    readonly projectId: string;
    readonly sourceKind: string;
    readonly sourceId: string;
    readonly templateVersion: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly idempotencyKey: string;
  }): Promise<{ readonly queued: boolean; readonly reason: string | null }> {
    const data = await callChannelRpc(this.client, "enqueue_notification", {
      project_id: input.projectId,
      source_kind: input.sourceKind,
      source_id: input.sourceId,
      template_version: input.templateVersion,
      payload: input.payload,
      idempotency_key: input.idempotencyKey,
    });
    // Причина возвращается наружу, а не сворачивается в `queued: false`.
    // «Связь отозвали, пока строился хвост» и «уже стояло в очереди» — разные
    // события, и счётчик, который их складывает, ничего не считает.
    const parsed = z
      .object({ queued: z.boolean(), reason: z.string().optional() })
      .safeParse(data);
    if (!parsed.success) return { queued: false, reason: "shape_invalid" };
    return { queued: parsed.data.queued, reason: parsed.data.reason ?? null };
  }

  async claimNotificationBatch(input: {
    readonly maxRows: number;
    readonly leaseSeconds: number;
  }): Promise<readonly ClaimedNotification[]> {
    const data = await callChannelRpc(this.client, "claim_notification_batch", {
      max_rows: input.maxRows,
      lease_seconds: input.leaseSeconds,
    });
    const parsed = z.array(claimedNotificationSchema).safeParse(data ?? []);
    return parsed.success ? parsed.data : [];
  }

  /**
   * Завершение требует ТОЙ ЖЕ аренды, что и захват. Воркер, чью работу уже
   * забрали по истёкшей аренде, ничего не подтверждает — и, что важнее, не
   * воскрешает отменённое уведомление.
   */
  async markNotificationSent(input: {
    readonly notificationId: string;
    readonly leaseToken: string;
    readonly externalMessageId: number | null;
  }): Promise<void> {
    await callChannelRpc(this.client, "mark_notification_sent", {
      notification_id: input.notificationId,
      lease_token: input.leaseToken,
      external_message_id: input.externalMessageId,
    });
  }

  async markNotificationFailed(input: {
    readonly notificationId: string;
    readonly leaseToken: string;
    readonly failureCode: string;
    readonly retryAfterSeconds: number;
  }): Promise<void> {
    await callChannelRpc(this.client, "mark_notification_failed", {
      notification_id: input.notificationId,
      lease_token: input.leaseToken,
      failure_code: input.failureCode,
      retry_after_seconds: input.retryAfterSeconds,
    });
  }

  // ── Разбор канала: сообщение → кандидат ───────────────────────────────────

  async claimChannelEvents(input: {
    readonly maxRows: number;
    readonly leaseSeconds: number;
  }): Promise<readonly ClaimedChannelEvent[]> {
    const data = await callChannelRpc(this.client, "claim_channel_events", {
      max_rows: input.maxRows,
      lease_seconds: input.leaseSeconds,
    });
    const parsed = z.array(claimedEventSchema).safeParse(data ?? []);
    return parsed.success ? parsed.data : [];
  }

  async recordInboxCandidate(input: {
    readonly eventId: string;
    readonly candidateKind: string;
    readonly origin: "rule" | "ai";
    readonly extractionSchemaVersion: string;
    readonly summary: string;
    readonly confidence: string | null;
  }): Promise<{ readonly created: boolean }> {
    const data = await callChannelRpc(this.client, "record_inbox_candidate", {
      event_id: input.eventId,
      candidate_kind: input.candidateKind,
      origin: input.origin,
      extraction_schema_version: input.extractionSchemaVersion,
      summary: input.summary,
      confidence: input.confidence,
      // Модель не называется, потому что её здесь нет: классификатор
      // детерминированный. Пустое поле честнее выдуманного имени.
      extraction_model: null,
    });
    const parsed = z.object({ created: z.boolean() }).safeParse(data);
    return { created: parsed.success ? parsed.data.created : false };
  }

  async completeChannelEvent(input: {
    readonly eventId: string;
    readonly outcome: "processed" | "ignored" | "failed";
    readonly failureCode: string | null;
  }): Promise<void> {
    await callChannelRpc(this.client, "complete_channel_event", {
      event_id: input.eventId,
      outcome: input.outcome,
      failure_code: input.failureCode,
    });
  }

  // ── Проектор уведомлений: читает состояние M4, не трогает его команды ─────

  async listDistributionNotificationBacklog(input: {
    readonly maxRows: number;
  }): Promise<readonly DistributionBacklogItem[]> {
    const data = await callChannelRpc(
      this.client,
      "list_distribution_notification_backlog",
      { max_rows: input.maxRows },
    );
    const parsed = z.array(distributionBacklogSchema).safeParse(data ?? []);
    return parsed.success ? parsed.data : [];
  }
}

const distributionBacklogSchema = z.object({
  projectId: z.string(),
  distributionId: z.string(),
  versionLabel: z.string().nullable(),
});

export type DistributionBacklogItem = z.infer<typeof distributionBacklogSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Человеческая сторона: экран настроек проекта
// ─────────────────────────────────────────────────────────────────────────────

export const projectChannelStateSchema = z.object({
  provider: z.literal("telegram"),
  identityLinked: z.boolean(),
  canManage: z.boolean(),
  binding: z
    .object({
      status: z.enum(["pending", "notice_pending", "active", "suspended"]),
      // Приём — отдельный факт от статуса. Экран обязан различать «связь есть»
      // и «переписка сохраняется» так же, как их различает база: второе
      // касается участников чата, первое — нет.
      captureState: z.enum(["none", "full_after_notice"]),
      chatType: z.string().nullable(),
      activatedAt: z.string().nullable(),
      statusReason: z.string().nullable(),
      noticeVersion: z.string().nullable(),
      noticePostedAt: z.string().nullable(),
    })
    .nullable(),
});

export type ProjectChannelState = z.infer<typeof projectChannelStateSchema>;

export class TelegramHumanPort {
  constructor(private readonly client: PostgresRpcClient) {}

  async createIdentityLinkIntent(input: {
    readonly nonceDigest: PostgresBytea;
    readonly ttlSeconds: number;
  }): Promise<void> {
    await callChannelRpc(this.client, "create_identity_link_intent", {
      nonce_digest: input.nonceDigest,
      ttl_seconds: input.ttlSeconds,
    });
  }

  async createBindingIntent(input: {
    readonly projectId: string;
    readonly nonceDigest: PostgresBytea;
    readonly ttlSeconds: number;
  }): Promise<void> {
    await callChannelRpc(this.client, "create_binding_intent", {
      project_id: input.projectId,
      nonce_digest: input.nonceDigest,
      ttl_seconds: input.ttlSeconds,
    });
  }

  async getProjectChannelState(projectId: string): Promise<ProjectChannelState> {
    const data = await callChannelRpc(this.client, "get_project_channel_state", {
      project_id: projectId,
    });
    const parsed = projectChannelStateSchema.safeParse(data);
    if (!parsed.success) {
      throw new TelegramChannelRpcError("get_project_channel_state", "shape_invalid");
    }
    return parsed.data;
  }

  async disconnectProjectChannel(input: {
    readonly projectId: string;
    readonly reason: string;
  }): Promise<void> {
    await callChannelRpc(this.client, "disconnect_project_channel", {
      project_id: input.projectId,
      reason: input.reason,
    });
  }
}

export const inboxCandidateSchema = z.object({
  candidateId: z.string(),
  candidateKind: z.enum([
    "question",
    "decision_candidate",
    "change_request_candidate",
    "risk_candidate",
    "general_note",
    "ignored",
  ]),
  origin: z.enum(["ai", "rule", "human"]),
  summary: z.string(),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  status: z.enum(["pending", "confirmed", "rejected", "superseded"]),
  createdAt: z.string(),
  resultingEntityKind: z.string().nullable(),
  resultingEntityId: z.string().nullable(),
});

export const projectInboxSchema = z.object({
  canReview: z.boolean(),
  candidates: z.array(inboxCandidateSchema),
});

export type ProjectInbox = z.infer<typeof projectInboxSchema>;
export type InboxCandidate = z.infer<typeof inboxCandidateSchema>;

/**
 * Третий порт, а не метод в одном из двух прежних. Причина та же, по которой
 * системный и человеческий разведены: Inbox — человеческая поверхность, и
 * держать её рядом с приёмом сообщений значило бы однажды позвать её из
 * транспорта.
 */
export class TelegramInboxPort {
  constructor(private readonly client: PostgresRpcClient) {}

  async listProjectInbox(projectId: string): Promise<ProjectInbox> {
    const data = await callChannelRpc(this.client, "list_project_inbox", {
      project_id: projectId,
    });
    const parsed = projectInboxSchema.safeParse(data);
    if (!parsed.success) {
      throw new TelegramChannelRpcError("list_project_inbox", "shape_invalid");
    }
    return parsed.data;
  }

  async reviewInboxCandidate(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly decision: "confirm" | "reject";
    readonly resultingEntityKind: string | null;
    readonly resultingEntityId: string | null;
  }): Promise<{ readonly status: string }> {
    const data = await callChannelRpc(this.client, "review_inbox_candidate", {
      project_id: input.projectId,
      candidate_id: input.candidateId,
      decision: input.decision,
      resulting_entity_kind: input.resultingEntityKind,
      resulting_entity_id: input.resultingEntityId,
    });
    const parsed = z.object({ status: z.string() }).safeParse(data);
    if (!parsed.success) {
      throw new TelegramChannelRpcError("review_inbox_candidate", "shape_invalid");
    }
    return parsed.data;
  }
}
