/**
 * Порт шлюза: типизированная обёртка над RPC `projectceo_gateway_api`.
 *
 * Ровно одно место, где мост разговаривает с базой. Ни одна другая часть моста
 * не знает ни имён функций, ни формы конверта — и не должна: разойдись эти
 * знания по коду, следующая проверка прав окажется забытой именно там, где её
 * не видно.
 *
 * ДВА КЛИЕНТА, ДВА КОНТУРА. `TelegramSystemPort` работает системной identity
 * (service role) и умеет только записывать пришедшее, отдавать очередь и
 * отмечать обработку. `TelegramHumanPort` работает request-bound клиентом
 * человеческой сессии — там, где сервер обязан вывести actor и права заново.
 * Смешать их нельзя по построению: у них разные конструкторы и разные наборы
 * методов.
 */

import type { PostgresRpcClient } from "../../project-intelligence/adapters/postgres";
import { mapRpcError } from "../../project-intelligence/adapters/postgres/errors";
import type { NormalizedAttachment, NormalizedUpdate } from "./update-schema";

export const TELEGRAM_BRIDGE_CONTRACT_VERSION = "remhaos-telegram-bridge/0.1" as const;

interface Envelope<T> {
  readonly contractVersion: string;
  readonly requestId: string;
  readonly data: T;
  readonly error: null;
}

function unwrap<T>(value: unknown): T {
  const envelope = value as Envelope<T> | null;
  if (
    envelope === null || typeof envelope !== "object"
    || envelope.contractVersion !== TELEGRAM_BRIDGE_CONTRACT_VERSION
  ) {
    // Конверт, который нельзя прочитать по контракту, — это не пустой ответ.
    // Молча вернуть null значило бы отчитаться «ничего не нашлось».
    throw new Error("telegram_bridge_contract_mismatch");
  }
  return envelope.data;
}

async function call<T>(
  client: PostgresRpcClient,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<T> {
  const { data, error } = await client.schema("projectceo_gateway_api").rpc(name, args);
  if (error) throw mapRpcError(error);
  return unwrap<T>(data);
}

export interface ResolvedBinding {
  readonly bindingId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly status: "active" | "suspended";
  readonly captureMode: "none" | "notice_pending" | "full_after_notice";
}

export interface RecordedEvent {
  readonly eventId: string | null;
  readonly duplicate: boolean;
  readonly projectId: string;
}

export interface ClaimedChannelEvent {
  readonly eventId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly bindingId: string;
  readonly eventKind: string;
  readonly sourceRevision: number;
  readonly senderUserId: string | null;
  readonly textContent: string | null;
  readonly attempts: number;
}

export interface ClaimedNotification {
  readonly notificationId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly bindingId: string;
  readonly externalChatId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly recipientUserId: string | null;
  readonly attempts: number;
}

export interface ConsumedIntent {
  readonly intentId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly purpose: "identity_link" | "channel_binding";
  readonly actorUserId: string;
}

/** Системный контур. Только `service_role`. */
export class TelegramSystemPort {
  constructor(private readonly client: PostgresRpcClient) {}

  resolveBinding(input: {
    readonly botInstanceId: string;
    readonly externalChatId: string;
  }): Promise<ResolvedBinding | null> {
    return call<ResolvedBinding | null>(this.client, "resolve_channel_binding", {
      bot_instance_id: input.botInstanceId,
      external_chat_id: input.externalChatId,
    });
  }

  recordEvent(input: {
    readonly bindingId: string;
    readonly update: NormalizedUpdate;
  }): Promise<RecordedEvent> {
    return call<RecordedEvent>(this.client, "record_channel_event", {
      binding_id: input.bindingId,
      external_update_id: input.update.updateId,
      external_chat_id: input.update.externalChatId,
      external_message_id: input.update.externalMessageId,
      external_actor_id: input.update.externalActorId,
      event_kind: input.update.kind,
      source_revision: input.update.sourceRevision,
      external_event_at: input.update.externalEventAt,
      reply_to_message_id: input.update.replyToMessageId,
      forward_origin_kind: input.update.forwardOriginKind,
      forward_origin_at: input.update.forwardOriginAt,
      text_content: input.update.textContent,
    });
  }

  recordAttachment(input: {
    readonly eventId: string;
    readonly attachment: NormalizedAttachment;
    /**
     * Общий карантинный конвейер для этого источника ещё не доказан, поэтому
     * байты не скачиваются, а вложение получает `materialization_blocked`.
     * Заводить рядом отдельное небезопасное телеграм-хранилище — худшее из
     * возможных решений: оно выглядело бы работающим.
     */
    readonly scanStatus: "pending" | "materialization_blocked" | "too_large" | "rejected";
    readonly scanReason: string | null;
  }): Promise<{ readonly attachmentId: string | null; readonly duplicate: boolean }> {
    return call(this.client, "record_channel_attachment", {
      event_id: input.eventId,
      attachment_kind: input.attachment.kind,
      external_file_id: input.attachment.externalFileId,
      external_file_unique_id: input.attachment.externalFileUniqueId,
      declared_size_bytes: input.attachment.declaredSizeBytes,
      declared_media_type: input.attachment.declaredMediaType,
      scan_status: input.scanStatus,
      scan_reason: input.scanReason,
    });
  }

  suspendBinding(input: {
    readonly bindingId: string;
    readonly reasonCode: string;
  }): Promise<{ readonly bindingId: string; readonly status: string }> {
    return call(this.client, "suspend_channel_binding", {
      binding_id: input.bindingId,
      reason_code: input.reasonCode,
    });
  }

  consumeIntent(input: {
    readonly nonceDigestHex: string;
    readonly purpose: "identity_link" | "channel_binding";
    readonly botInstanceId: string;
    readonly externalActorId: string;
  }): Promise<ConsumedIntent> {
    return call<ConsumedIntent>(this.client, "consume_channel_link_intent", {
      nonce_digest_hex: input.nonceDigestHex,
      purpose: input.purpose,
      bot_instance_id: input.botInstanceId,
      external_actor_id: input.externalActorId,
    });
  }

  completeIdentityLink(input: {
    readonly intentId: string;
    readonly externalActorId: string;
  }): Promise<{ readonly organizationId: string; readonly userId: string }> {
    return call(this.client, "complete_identity_link", {
      intent_id: input.intentId,
      external_actor_id: input.externalActorId,
    });
  }

  completeChannelBinding(input: {
    readonly intentId: string;
    readonly externalActorId: string;
    readonly externalChatId: string;
    readonly chatType: "group" | "supergroup";
    /**
     * Утверждение ПРОВЕРЕННОГО транспортом факта: база не умеет спросить
     * Telegram, администратор ли этот человек в этой группе. Названо честно,
     * и отказ при `false` живёт в самой RPC — забыть о нём нельзя.
     */
    readonly initiatorIsChatAdmin: boolean;
    readonly noticeVersion: string;
  }): Promise<{
    readonly bindingId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly captureMode: string;
  }> {
    return call(this.client, "complete_channel_binding", {
      intent_id: input.intentId,
      external_actor_id: input.externalActorId,
      external_chat_id: input.externalChatId,
      chat_type: input.chatType,
      initiator_is_chat_admin: input.initiatorIsChatAdmin,
      notice_version: input.noticeVersion,
    });
  }

  markNoticePosted(input: {
    readonly bindingId: string;
    readonly noticeVersion: string;
  }): Promise<{ readonly bindingId: string; readonly captureMode: string }> {
    return call(this.client, "mark_channel_notice_posted", {
      binding_id: input.bindingId,
      notice_version: input.noticeVersion,
    });
  }

  claimChannelEvents(input: {
    readonly maxRows: number;
    readonly leaseSeconds: number;
  }): Promise<readonly ClaimedChannelEvent[]> {
    return call<readonly ClaimedChannelEvent[]>(this.client, "claim_channel_events", {
      max_rows: input.maxRows,
      lease_seconds: input.leaseSeconds,
    });
  }

  completeChannelEvent(input: {
    readonly eventId: string;
    readonly outcome: "processed" | "skipped" | "retry" | "dead_letter";
    readonly failureCode?: string | null;
    readonly retryAfterSeconds?: number | null;
  }): Promise<{ readonly eventId: string; readonly outcome: string }> {
    return call(this.client, "complete_channel_event", {
      event_id: input.eventId,
      outcome: input.outcome,
      failure_code: input.failureCode ?? null,
      retry_after_seconds: input.retryAfterSeconds ?? null,
    });
  }

  recordInboxCandidate(input: {
    readonly eventId: string;
    readonly candidateType: string;
    readonly extractionSchemaVersion: string;
    readonly extractionProvider: string | null;
    readonly extractionModel: string | null;
    readonly confidence: "low" | "medium" | "high" | null;
    readonly rationale: string | null;
    readonly proposedText: string | null;
  }): Promise<{ readonly candidateId: string | null; readonly duplicate: boolean }> {
    return call(this.client, "record_inbox_candidate", {
      event_id: input.eventId,
      candidate_type: input.candidateType,
      extraction_schema_version: input.extractionSchemaVersion,
      extraction_provider: input.extractionProvider,
      extraction_model: input.extractionModel,
      confidence: input.confidence,
      rationale: input.rationale,
      proposed_text: input.proposedText,
    });
  }

  projectReleaseNotifications(maxRows: number): Promise<{ readonly created: number }> {
    return call(this.client, "project_release_notifications", { max_rows: maxRows });
  }

  claimNotifications(input: {
    readonly maxRows: number;
    readonly leaseSeconds: number;
  }): Promise<readonly ClaimedNotification[]> {
    return call<readonly ClaimedNotification[]>(this.client, "claim_notifications", {
      max_rows: input.maxRows,
      lease_seconds: input.leaseSeconds,
    });
  }

  completeNotification(input: {
    readonly notificationId: string;
    readonly outcome: "sent" | "retry" | "failed" | "cancelled";
    readonly externalMessageId?: number | null;
    readonly failureCode?: string | null;
    readonly retryAfterSeconds?: number | null;
  }): Promise<{ readonly notificationId: string; readonly outcome: string }> {
    return call(this.client, "complete_notification", {
      notification_id: input.notificationId,
      outcome: input.outcome,
      external_message_id: input.externalMessageId ?? null,
      failure_code: input.failureCode ?? null,
      retry_after_seconds: input.retryAfterSeconds ?? null,
    });
  }
}

export interface ProjectChannelState {
  readonly binding: {
    readonly bindingId: string;
    readonly provider: string;
    readonly chatType: string;
    readonly status: "pending" | "active" | "suspended";
    readonly captureMode: string;
    readonly noticeVersion: string;
    readonly noticePostedAt: string | null;
    readonly createdAt: string;
    readonly activatedAt: string | null;
    readonly statusReason: string | null;
  } | null;
  readonly identity: { readonly linked: boolean; readonly linkedAt?: string };
}

export interface ProjectInboxCandidateView {
  readonly candidateId: string;
  readonly candidateType: string;
  readonly status: "pending" | "confirmed" | "rejected" | "superseded";
  readonly confidence: "low" | "medium" | "high" | null;
  readonly rationale: string | null;
  readonly proposedText: string | null;
  readonly extractionSchemaVersion: string;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
  readonly source: {
    readonly channel: "telegram";
    readonly eventId: string;
    readonly externalMessageId: number | null;
    readonly sourceRevision: number;
    readonly receivedAt: string;
    readonly externalEventAt: string | null;
    readonly senderUserId: string | null;
    readonly identity: "verified" | "unverified";
    readonly text: string | null;
  };
  readonly attachments: readonly {
    readonly attachmentId: string;
    readonly kind: string;
    readonly scanStatus: string;
    readonly storageObjectKey: string | null;
  }[];
}

/** Человеческий контур. Только request-bound клиент сессии. */
export class TelegramHumanPort {
  constructor(private readonly client: PostgresRpcClient) {}

  createLinkIntent(input: {
    readonly projectId: string;
    readonly purpose: "identity_link" | "channel_binding";
    readonly botInstanceId: string;
    readonly nonceDigestHex: string;
    readonly ttlSeconds: number;
  }): Promise<{
    readonly intentId: string;
    readonly purpose: string;
    readonly expiresAt: string;
  }> {
    return call(this.client, "create_channel_link_intent", {
      project_id: input.projectId,
      purpose: input.purpose,
      bot_instance_id: input.botInstanceId,
      nonce_digest_hex: input.nonceDigestHex,
      ttl_seconds: input.ttlSeconds,
    });
  }

  getChannelState(projectId: string): Promise<ProjectChannelState> {
    return call<ProjectChannelState>(this.client, "get_project_channel_state", {
      project_id: projectId,
    });
  }

  revokeBinding(input: {
    readonly projectId: string;
    readonly bindingId: string;
    readonly reasonCode: string;
  }): Promise<{ readonly bindingId: string; readonly status: string }> {
    return call(this.client, "revoke_channel_binding", {
      project_id: input.projectId,
      binding_id: input.bindingId,
      reason_code: input.reasonCode,
    });
  }

  listInboxCandidates(input: {
    readonly projectId: string;
    readonly maxRows: number;
  }): Promise<readonly ProjectInboxCandidateView[]> {
    return call<readonly ProjectInboxCandidateView[]>(
      this.client,
      "list_project_inbox_candidates",
      { project_id: input.projectId, max_rows: input.maxRows },
    );
  }

  resolveCandidate(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly decision: "confirmed" | "rejected";
  }): Promise<{ readonly candidateId: string; readonly status: string }> {
    return call(this.client, "resolve_project_inbox_candidate", {
      project_id: input.projectId,
      candidate_id: input.candidateId,
      decision: input.decision,
    });
  }
}
