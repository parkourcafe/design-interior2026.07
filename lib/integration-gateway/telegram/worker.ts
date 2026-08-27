import { createHash } from "node:crypto";
import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import type { PrivateStorageClient } from "@/lib/project-intelligence/adapters/storage";
import type { NormalizedTelegramUpdate } from "./contracts";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceRoleSchema = z.enum([
  "document",
  "drawing-preview",
  "reference",
  "photo-evidence",
  "correspondence",
  "schedule",
]);
const commandResultSchema = z.object({
  operation: z.string().min(1),
  replay: z.boolean(),
  result: z.record(z.string(), z.unknown()),
});
const claimedJobSchema = z.object({
  jobId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  updateId: z.union([z.string(), z.number()]).transform(String),
  attemptCount: z.number().int().positive(),
  leaseToken: z.string().uuid(),
  leaseExpiresAt: z.string(),
});

export interface TelegramWorkerAttachment {
  readonly providerFileIdDigest: string;
  readonly displayName: string | null;
  readonly mediaType: string | null;
  readonly sizeBytes: number | null;
  readonly bytes: Uint8Array;
  readonly checksumHex: string;
  readonly quarantineObjectKey: string;
  readonly sourceRole: string;
}

function assertQuarantineObjectKey(input: {
  readonly key: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly checksumHex: string;
  readonly sourceRole: string;
}): void {
  const expectedKey =
    `project-intelligence/ru/${input.organizationId}/${input.projectId}/quarantine/telegram/` +
    `${input.checksumHex}/${input.sourceRole}`;
  if (
    input.key !== expectedKey ||
    input.key.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(input.key) ||
    input.key.includes("..") ||
    /(^|[/?_])(token|secret|password|authorization)([/?_=]|$)/iu.test(input.key) ||
    !digestSchema.safeParse(input.checksumHex).success ||
    !sourceRoleSchema.safeParse(input.sourceRole).success
  ) {
    throw new Error("telegram_quarantine_authorization_invalid");
  }
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class TelegramWorker {
  constructor(
    private readonly client: PostgresRpcClient,
    private readonly storage: PrivateStorageClient,
  ) {}

  async ingestUpdate(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly update: NormalizedTelegramUpdate;
    readonly payloadSha256: string;
    readonly attachments: readonly TelegramWorkerAttachment[];
    readonly idempotencyKey: string;
  }) {
    const organizationId = z.string().uuid().parse(input.organizationId);
    const projectId = z.string().uuid().parse(input.projectId);
    digestSchema.parse(input.payloadSha256);
    if (input.attachments.length > 10) throw new Error("telegram_attachment_limit_exceeded");
    const attachmentRows: Array<Record<string, unknown>> = [];
    for (const attachment of input.attachments) {
      digestSchema.parse(attachment.providerFileIdDigest);
      digestSchema.parse(attachment.checksumHex);
      if (checksum(attachment.bytes) !== attachment.checksumHex) {
        throw new Error("telegram_attachment_checksum_mismatch");
      }
      if (attachment.sizeBytes !== null && attachment.sizeBytes !== attachment.bytes.byteLength) {
        throw new Error("telegram_attachment_size_mismatch");
      }
      assertQuarantineObjectKey({
        key: attachment.quarantineObjectKey,
        organizationId,
        projectId,
        checksumHex: attachment.checksumHex,
        sourceRole: attachment.sourceRole,
      });
      const { error } = await this.storage.from("client-uploads").upload(
        attachment.quarantineObjectKey,
        attachment.bytes,
        {
          contentType: attachment.mediaType ?? "application/octet-stream",
          upsert: false,
        },
      );
      if (error && error.statusCode !== "409") throw new Error("telegram_quarantine_upload_failed");
      attachmentRows.push({
        fileIdDigest: attachment.providerFileIdDigest,
        displayName: attachment.displayName,
        mediaType: attachment.mediaType,
        sizeBytes: attachment.sizeBytes,
        checksumHex: attachment.checksumHex,
        quarantineObjectKey: attachment.quarantineObjectKey,
        sourceRole: attachment.sourceRole,
      });
    }
    return commandResultSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "ingest_telegram_update",
      {
        p_project_id: projectId,
        p_update_id: input.update.updateId,
        p_chat_id: input.update.chatId,
        p_message_id: input.update.messageId,
        p_sender_id: input.update.senderId,
        p_payload_sha256_hex: input.payloadSha256,
        p_text_sha256_hex: input.update.textDigest,
        p_attachments: attachmentRows,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
  }

  async claimJobs(input: { readonly limit: number; readonly leaseSeconds: number }) {
    return z.array(claimedJobSchema).parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "claim_telegram_ingestion_jobs",
      { p_limit: input.limit, p_lease_seconds: input.leaseSeconds },
    ));
  }

  async completeJob(input: {
    readonly jobId: string;
    readonly leaseToken: string;
    readonly resultRef: Record<string, unknown>;
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "complete_telegram_ingestion_job",
      {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_result_ref: input.resultRef,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
  }

  async failJob(input: {
    readonly jobId: string;
    readonly leaseToken: string;
    readonly errorCode: string;
    readonly retryable: boolean;
    readonly maxAttempts: number;
    readonly retryAfterSeconds: number;
    readonly idempotencyKey: string;
  }) {
    return commandResultSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "fail_telegram_ingestion_job",
      {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_error_code: input.errorCode,
        p_retryable: input.retryable,
        p_max_attempts: input.maxAttempts,
        p_retry_after_seconds: input.retryAfterSeconds,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
  }
}
