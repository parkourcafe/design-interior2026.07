import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import { googleDriveByteaHex } from "./oauth";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const commandResultSchema = z.object({
  operation: z.string().min(1),
  replay: z.boolean(),
  result: z.record(z.string(), z.unknown()),
});

const channelResultSchema = z.object({
  channelId: z.string().uuid(),
  connectionId: z.string().uuid(),
  status: z.enum(["active", "stopped", "expired"]),
});

const notificationResultSchema = z.object({
  connectionId: z.string().uuid(),
  status: z.enum(["enqueued", "duplicate"]),
  jobsEnqueued: z.number().int().nonnegative(),
});

const reauthResultSchema = z.object({
  connectionId: z.string().uuid(),
  providerCode: z.literal("google_drive"),
  status: z.literal("reauth_required"),
});
const channelListSchema = z.array(z.object({
  channelId: z.string().uuid(),
  status: z.literal("active"),
  expiresAt: z.string(),
}).strict());

export class GoogleDriveChannelWorker {
  constructor(private readonly client: PostgresRpcClient) {}

  async createChannel(input: {
    readonly organizationId: string;
    readonly connectionId: string;
    readonly providerChannelIdHash: string;
    readonly providerResourceIdHash: string;
    readonly expiresAt: string;
    readonly idempotencyKey: string;
  }) {
    digestSchema.parse(input.providerChannelIdHash);
    digestSchema.parse(input.providerResourceIdHash);
    const command = commandResultSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "create_google_drive_webhook_channel",
      {
        p_organization_id: input.organizationId,
        p_connection_id: input.connectionId,
        p_provider_channel_id_hash: googleDriveByteaHex(input.providerChannelIdHash),
        p_provider_resource_id_hash: googleDriveByteaHex(input.providerResourceIdHash),
        p_expires_at: input.expiresAt,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
    return {
      replay: command.replay,
      result: z.object({
        channelId: z.string().uuid(),
        connectionId: z.string().uuid(),
        status: z.literal("active"),
        expiresAt: z.string(),
      }).parse(command.result),
    };
  }

  async stopChannel(input: {
    readonly organizationId: string;
    readonly connectionId: string;
    readonly channelId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
  }) {
    const command = commandResultSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "stop_google_drive_webhook_channel",
      {
        p_organization_id: input.organizationId,
        p_connection_id: input.connectionId,
        p_channel_id: input.channelId,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
    return {
      replay: command.replay,
      result: channelResultSchema.parse(command.result),
    };
  }

  async listActiveChannels(connectionId: string) {
    return channelListSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "list_google_drive_webhook_channels",
      { p_connection_id: connectionId },
    ));
  }

  async expireChannels() {
    const result = z.object({
      operation: z.literal("expire_google_drive_webhook_channels"),
      replay: z.literal(false),
      result: z.object({ expiredCount: z.number().int().nonnegative() }),
    }).parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "expire_google_drive_webhook_channels",
    ));
    return result.result;
  }

  async markReauthRequired(input: {
    readonly organizationId: string;
    readonly connectionId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
  }) {
    const command = commandResultSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "mark_google_drive_reauth_required",
      {
        p_organization_id: input.organizationId,
        p_connection_id: input.connectionId,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
    return {
      replay: command.replay,
      result: reauthResultSchema.parse(command.result),
    };
  }

  async recordNotification(input: {
    readonly organizationId: string;
    readonly connectionId: string;
    readonly channelId: string;
    readonly providerChannelIdHash: string;
    readonly providerResourceIdHash: string;
    readonly notificationIdHash: string;
    readonly resourceStateHash: string;
    readonly idempotencyKey: string;
  }) {
    for (const digest of [
      input.providerChannelIdHash,
      input.providerResourceIdHash,
      input.notificationIdHash,
      input.resourceStateHash,
    ]) digestSchema.parse(digest);
    const command = commandResultSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "record_google_drive_notification",
      {
        p_organization_id: input.organizationId,
        p_connection_id: input.connectionId,
        p_channel_id: input.channelId,
        p_provider_channel_id_hash: googleDriveByteaHex(input.providerChannelIdHash),
        p_provider_resource_id_hash: googleDriveByteaHex(input.providerResourceIdHash),
        p_notification_id_hash: googleDriveByteaHex(input.notificationIdHash),
        p_resource_state_hash: googleDriveByteaHex(input.resourceStateHash),
        p_idempotency_key: input.idempotencyKey,
      },
    ));
    return {
      replay: command.replay,
      result: notificationResultSchema.parse(command.result),
    };
  }
}
