import { z } from "zod";

import type {
  PostgresBytea,
  PostgresRpcClient,
} from "@/lib/project-intelligence/adapters/postgres";

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
  payload: z.record(z.unknown()),
  externalChatId: z.number(),
  botInstanceId: z.string(),
});

export type ClaimedNotification = z.infer<typeof claimedNotificationSchema>;

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

  async activateProjectBinding(input: {
    readonly nonceDigest: PostgresBytea;
    readonly externalUserId: number;
    readonly botInstanceId: string;
    readonly chatId: number;
    readonly chatType: string;
    readonly noticeVersion: string;
  }): Promise<{ readonly projectId: string }> {
    const data = await callChannelRpc(this.client, "activate_project_binding", {
      nonce_digest: input.nonceDigest,
      external_user_id: input.externalUserId,
      bot_instance_id: input.botInstanceId,
      external_chat_id: input.chatId,
      external_chat_type: input.chatType,
      notice_version: input.noticeVersion,
    });
    const parsed = z.object({ projectId: z.string() }).safeParse(data);
    if (!parsed.success) {
      throw new TelegramChannelRpcError("activate_project_binding", "shape_invalid");
    }
    return parsed.data;
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
  }): Promise<{ readonly queued: boolean }> {
    const data = await callChannelRpc(this.client, "enqueue_notification", {
      project_id: input.projectId,
      source_kind: input.sourceKind,
      source_id: input.sourceId,
      template_version: input.templateVersion,
      payload: input.payload,
      idempotency_key: input.idempotencyKey,
    });
    const parsed = z.object({ queued: z.boolean() }).safeParse(data);
    return { queued: parsed.success ? parsed.data.queued : false };
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

  async markNotificationSent(input: {
    readonly notificationId: string;
    readonly externalMessageId: number | null;
  }): Promise<void> {
    await callChannelRpc(this.client, "mark_notification_sent", {
      notification_id: input.notificationId,
      external_message_id: input.externalMessageId,
    });
  }

  async markNotificationFailed(input: {
    readonly notificationId: string;
    readonly failureCode: string;
    readonly retryAfterSeconds: number;
  }): Promise<void> {
    await callChannelRpc(this.client, "mark_notification_failed", {
      notification_id: input.notificationId,
      failure_code: input.failureCode,
      retry_after_seconds: input.retryAfterSeconds,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Человеческая сторона: экран настроек проекта
// ─────────────────────────────────────────────────────────────────────────────

export const projectChannelStateSchema = z.object({
  provider: z.literal("telegram"),
  identityLinked: z.boolean(),
  canManage: z.boolean(),
  binding: z
    .object({
      status: z.enum(["pending", "active", "suspended"]),
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
