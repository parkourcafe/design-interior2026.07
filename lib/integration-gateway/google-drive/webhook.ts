import { createHash } from "node:crypto";
import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import { googleDriveByteaHex } from "./oauth";
import { GoogleDriveChannelWorker } from "./channel-worker";

export class GoogleDriveWebhookError extends Error {
  constructor(readonly code: "headers_invalid" | "message_number_invalid") {
    super(`google_drive_webhook_${code}`);
    this.name = "GoogleDriveWebhookError";
  }
}

export interface GoogleDriveWebhookEnvelope {
  readonly providerChannelIdHash: string;
  readonly providerResourceIdHash: string;
  readonly notificationIdHash: string;
  readonly resourceStateHash: string;
}

function header(headers: Headers, name: string): string {
  const value = headers.get(name)?.trim() ?? "";
  if (!value || value.length > 1024 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new GoogleDriveWebhookError("headers_invalid");
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parseGoogleDriveWebhookHeaders(headers: Headers): GoogleDriveWebhookEnvelope {
  const channelId = header(headers, "x-goog-channel-id");
  const resourceId = header(headers, "x-goog-resource-id");
  const resourceState = header(headers, "x-goog-resource-state");
  const messageNumber = header(headers, "x-goog-message-number");
  if (!/^[0-9]{1,32}$/u.test(messageNumber)) {
    throw new GoogleDriveWebhookError("message_number_invalid");
  }
  return {
    providerChannelIdHash: sha256(channelId),
    providerResourceIdHash: sha256(resourceId),
    notificationIdHash: sha256(`${channelId}\0${messageNumber}`),
    resourceStateHash: sha256(resourceState),
  };
}

export interface GoogleDriveWebhookChannelResolver {
  resolveChannel(input: {
    readonly providerChannelIdHash: string;
    readonly providerResourceIdHash: string;
  }): Promise<{
    readonly organizationId: string;
    readonly connectionId: string;
    readonly channelId: string;
  }>;
  recordNotification(input: GoogleDriveWebhookEnvelope & {
    readonly organizationId: string;
    readonly connectionId: string;
    readonly channelId: string;
    readonly idempotencyKey: string;
  }): Promise<{
    readonly status: "enqueued" | "duplicate";
    readonly jobsEnqueued: number;
  }>;
}

const channelResolutionSchema = z.object({
  organizationId: z.string().uuid(),
  connectionId: z.string().uuid(),
  channelId: z.string().uuid(),
});

export class PostgresGoogleDriveWebhookResolver implements GoogleDriveWebhookChannelResolver {
  private readonly channelWorker: GoogleDriveChannelWorker;

  constructor(private readonly client: PostgresRpcClient) {
    this.channelWorker = new GoogleDriveChannelWorker(client);
  }

  async resolveChannel(input: {
    readonly providerChannelIdHash: string;
    readonly providerResourceIdHash: string;
  }) {
    return channelResolutionSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "resolve_google_drive_webhook_channel",
      {
        p_provider_channel_id_hash: googleDriveByteaHex(input.providerChannelIdHash),
        p_provider_resource_id_hash: googleDriveByteaHex(input.providerResourceIdHash),
      },
    ));
  }

  async recordNotification(input: Parameters<GoogleDriveWebhookChannelResolver["recordNotification"]>[0]) {
    const result = await this.channelWorker.recordNotification({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      channelId: input.channelId,
      providerChannelIdHash: input.providerChannelIdHash,
      providerResourceIdHash: input.providerResourceIdHash,
      notificationIdHash: input.notificationIdHash,
      resourceStateHash: input.resourceStateHash,
      idempotencyKey: input.idempotencyKey,
    });
    return result.result;
  }
}

export class GoogleDriveWebhookProcessor {
  constructor(private readonly resolver: GoogleDriveWebhookChannelResolver) {}

  async process(headers: Headers) {
    const envelope = parseGoogleDriveWebhookHeaders(headers);
    const channel = await this.resolver.resolveChannel({
      providerChannelIdHash: envelope.providerChannelIdHash,
      providerResourceIdHash: envelope.providerResourceIdHash,
    });
    const result = await this.resolver.recordNotification({
      ...envelope,
      ...channel,
      idempotencyKey: `google-drive-webhook-${envelope.notificationIdHash}-${envelope.resourceStateHash}`,
    });
    return {
      ...result,
      duplicate: result.status === "duplicate",
    } as const;
  }
}
