import { describe, expect, it, vi } from "vitest";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import { GoogleDriveChannelWorker } from "./channel-worker";

const organizationId = "64111111-1111-4111-8111-111111111111";
const connectionId = "65111111-1111-4111-8111-111111111111";
const channelId = "66111111-1111-4111-8111-111111111111";

function fakeClient(results: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    schema: () => ({
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: results[name], error: null };
      }),
    }),
  } as unknown as PostgresRpcClient;
  return { client, calls };
}

describe("Google Drive webhook channel worker", () => {
  it("sends only hashes to channel and notification RPCs", async () => {
    const { client, calls } = fakeClient({
      create_google_drive_webhook_channel: {
        operation: "create_google_drive_webhook_channel",
        replay: false,
        result: {
          channelId,
          connectionId,
          status: "active",
          expiresAt: "2026-08-27T00:00:00.000Z",
        },
      },
      record_google_drive_notification: {
        operation: "record_google_drive_notification",
        replay: false,
        result: { connectionId, status: "enqueued", jobsEnqueued: 1 },
      },
    });
    const worker = new GoogleDriveChannelWorker(client);
    await worker.createChannel({
      organizationId,
      connectionId,
      providerChannelIdHash: "a".repeat(64),
      providerResourceIdHash: "b".repeat(64),
      expiresAt: "2026-08-27T00:00:00.000Z",
      idempotencyKey: "channel-create-1",
    });
    await worker.recordNotification({
      organizationId,
      connectionId,
      channelId,
      providerChannelIdHash: "a".repeat(64),
      providerResourceIdHash: "b".repeat(64),
      notificationIdHash: "c".repeat(64),
      resourceStateHash: "d".repeat(64),
      idempotencyKey: "notification-1",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toMatchObject({
      p_provider_channel_id_hash: `\\x${"a".repeat(64)}`,
      p_provider_resource_id_hash: `\\x${"b".repeat(64)}`,
    });
    expect(JSON.stringify(calls)).not.toContain("webhook_body");
    expect(JSON.stringify(calls)).not.toContain("raw_provider");
  });

  it("rejects malformed hashes before calling the database", async () => {
    const { client, calls } = fakeClient({});
    const worker = new GoogleDriveChannelWorker(client);
    await expect(worker.recordNotification({
      organizationId,
      connectionId,
      channelId,
      providerChannelIdHash: "not-a-digest",
      providerResourceIdHash: "b".repeat(64),
      notificationIdHash: "c".repeat(64),
      resourceStateHash: "d".repeat(64),
      idempotencyKey: "notification-invalid",
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("parses expiry and stop terminal states without exposing provider identifiers", async () => {
    const { client } = fakeClient({
      expire_google_drive_webhook_channels: {
        operation: "expire_google_drive_webhook_channels",
        replay: false,
        result: { expiredCount: 2 },
      },
      stop_google_drive_webhook_channel: {
        operation: "stop_google_drive_webhook_channel",
        replay: false,
        result: { channelId, connectionId, status: "stopped" },
      },
      mark_google_drive_reauth_required: {
        operation: "mark_google_drive_reauth_required",
        replay: false,
        result: { connectionId, providerCode: "google_drive", status: "reauth_required" },
      },
    });
    const worker = new GoogleDriveChannelWorker(client);
    await expect(worker.expireChannels()).resolves.toEqual({ expiredCount: 2 });
    await expect(worker.stopChannel({
      organizationId,
      connectionId,
      channelId,
      reason: "staging stop",
      idempotencyKey: "channel-stop-1",
    })).resolves.toEqual({
      replay: false,
      result: { channelId, connectionId, status: "stopped" },
    });
    await expect(worker.markReauthRequired({
      organizationId,
      connectionId,
      reason: "invalid_grant",
      idempotencyKey: "connection-reauth-1",
    })).resolves.toEqual({
      replay: false,
      result: { connectionId, providerCode: "google_drive", status: "reauth_required" },
    });
  });
});
