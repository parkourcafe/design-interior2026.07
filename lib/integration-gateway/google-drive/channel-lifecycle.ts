import { randomUUID } from "node:crypto";
import { sha256Hex } from "../core/oauth-intent";
import type { ConnectionRef, RequestActorContext } from "../core/connector";
import { GoogleDriveChannelWorker } from "./channel-worker";
import type { GoogleDriveSelectedObject } from "./policy";
import { SecretStoreGoogleDriveChannelStore } from "./secret-store-adapters";
import type { GoogleDriveProviderTransport } from "./provider-transport";

export class GoogleDriveWebhookChannelLifecycle {
  constructor(
    private readonly worker: GoogleDriveChannelWorker,
    private readonly provider: GoogleDriveProviderTransport,
    private readonly secrets: SecretStoreGoogleDriveChannelStore,
  ) {}

  async createSelectedFileChannel(input: {
    readonly actor: RequestActorContext;
    readonly connection: ConnectionRef;
    readonly selected: GoogleDriveSelectedObject;
    readonly notificationAddress: string;
    readonly expiresAt: string;
    readonly idempotencyKey: string;
  }) {
    const providerChannelId = randomUUID();
    const watched = await this.provider.watchSelectedFile({
      actor: input.actor,
      connection: input.connection,
      selected: input.selected,
      channelId: providerChannelId,
      notificationAddress: input.notificationAddress,
      expiresAt: input.expiresAt,
    });
    type CreatedChannel = Awaited<ReturnType<GoogleDriveChannelWorker["createChannel"]>>;
    let channel: CreatedChannel | null = null;
    try {
      channel = await this.worker.createChannel({
        organizationId: input.connection.organizationId,
        connectionId: input.connection.connectionId,
        providerChannelIdHash: sha256Hex(watched.channelId),
        providerResourceIdHash: sha256Hex(watched.resourceId),
        expiresAt: watched.expiresAt,
        idempotencyKey: input.idempotencyKey,
      });
      await this.secrets.put({
        channelId: channel.result.channelId,
        secret: {
          providerChannelId: watched.channelId,
          providerResourceId: watched.resourceId,
          expiresAt: watched.expiresAt,
        },
      });
    } catch (error) {
      await this.provider.stopWebhookChannel({
        actor: input.actor,
        connection: input.connection,
        channelId: watched.channelId,
        resourceId: watched.resourceId,
      }).catch(() => undefined);
      if (channel) {
        await this.worker.stopChannel({
          organizationId: input.connection.organizationId,
          connectionId: input.connection.connectionId,
          channelId: channel.result.channelId,
          reason: "channel_secret_persist_failed",
          idempotencyKey: `${input.idempotencyKey}:rollback`,
        }).catch(() => undefined);
      }
      throw error;
    }
    if (!channel) throw new Error("google_drive_channel_not_created");
    return {
      channelId: channel.result.channelId,
      status: channel.result.status,
      expiresAt: watched.expiresAt,
    } as const;
  }

  async stopChannel(input: {
    readonly actor: RequestActorContext;
    readonly connection: ConnectionRef;
    readonly channelId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
  }): Promise<void> {
    const secret = await this.secrets.get(input.channelId);
    if (!secret) throw new Error("google_drive_channel_secret_missing");
    await this.provider.stopWebhookChannel({
      actor: input.actor,
      connection: input.connection,
      channelId: secret.providerChannelId,
      resourceId: secret.providerResourceId,
    });
    await this.worker.stopChannel({
      organizationId: input.connection.organizationId,
      connectionId: input.connection.connectionId,
      channelId: input.channelId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
    await this.secrets.delete(input.channelId);
  }
}
