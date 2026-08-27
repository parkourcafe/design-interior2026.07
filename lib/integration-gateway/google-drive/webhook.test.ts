import { describe, expect, it, vi } from "vitest";
import {
  PostgresGoogleDriveWebhookResolver,
  GoogleDriveWebhookProcessor,
  GoogleDriveWebhookError,
  parseGoogleDriveWebhookHeaders,
} from "./webhook";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";

function headers(overrides: Record<string, string> = {}) {
  return new Headers({
    "x-goog-channel-id": "channel-provider-id",
    "x-goog-resource-id": "resource-provider-id",
    "x-goog-resource-state": "exists",
    "x-goog-message-number": "12",
    ...overrides,
  });
}

describe("Google Drive webhook boundary", () => {
  it("returns only hashes from provider headers", () => {
    const envelope = parseGoogleDriveWebhookHeaders(headers());
    expect(envelope.providerChannelIdHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(envelope.providerResourceIdHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(envelope.notificationIdHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(envelope.resourceStateHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(envelope)).not.toContain("channel-provider-id");
    expect(JSON.stringify(envelope)).not.toContain("resource-provider-id");
    expect(JSON.stringify(envelope)).not.toContain("exists");
  });

  it("rejects missing, unsafe and non-numeric message headers", () => {
    expect(() => parseGoogleDriveWebhookHeaders(headers({ "x-goog-channel-id": "" })))
      .toThrow(GoogleDriveWebhookError);
    expect(() => parseGoogleDriveWebhookHeaders(headers({ "x-goog-message-number": "12.5" })))
      .toThrow("message_number_invalid");
    expect(() => parseGoogleDriveWebhookHeaders(headers({ "x-goog-resource-state": "x".repeat(1025) })))
      .toThrow("headers_invalid");
  });

  it("resolves the internal channel server-side and forwards only hashes", async () => {
    const resolveChannel = vi.fn(async () => ({
      organizationId: "org-1",
      connectionId: "connection-1",
      channelId: "channel-1",
    }));
    const recordNotification = vi.fn(async () => ({ status: "enqueued" as const, jobsEnqueued: 1 }));
    const result = await new GoogleDriveWebhookProcessor({ resolveChannel, recordNotification })
      .process(headers());
    expect(result).toEqual({ status: "enqueued", jobsEnqueued: 1, duplicate: false });
    expect(resolveChannel).toHaveBeenCalledWith({
      providerChannelIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      providerResourceIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(recordNotification).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      connectionId: "connection-1",
      channelId: "channel-1",
      providerChannelIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      providerResourceIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      notificationIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      resourceStateHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      idempotencyKey: expect.stringMatching(/^google-drive-webhook-[a-f0-9]{64}-[a-f0-9]{64}$/u),
    }));
    expect(JSON.stringify(recordNotification.mock.calls[0])).not.toContain("channel-provider-id");
  });

  it("maps the resolver through worker-only RPCs", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      schema: () => ({
        rpc: async (name: string, args: Record<string, unknown> = {}) => {
          calls.push({ name, args });
          if (name === "resolve_google_drive_webhook_channel") {
            return {
              data: {
                organizationId: "11111111-1111-4111-8111-111111111111",
                connectionId: "22222222-2222-4222-8222-222222222222",
                channelId: "33333333-3333-4333-8333-333333333333",
              },
              error: null,
            };
          }
          return {
            data: {
              operation: "record_google_drive_notification",
              replay: false,
              result: { connectionId: "22222222-2222-4222-8222-222222222222", status: "duplicate", jobsEnqueued: 0 },
            },
            error: null,
          };
        },
      }),
    } as unknown as PostgresRpcClient;
    const resolver = new PostgresGoogleDriveWebhookResolver(client);
    const channel = await resolver.resolveChannel({
      providerChannelIdHash: "a".repeat(64),
      providerResourceIdHash: "b".repeat(64),
    });
    const result = await resolver.recordNotification({
      ...channel,
      providerChannelIdHash: "a".repeat(64),
      providerResourceIdHash: "b".repeat(64),
      notificationIdHash: "c".repeat(64),
      resourceStateHash: "d".repeat(64),
      idempotencyKey: "google-drive-webhook-c",
    });
    expect(result).toEqual({ connectionId: channel.connectionId, status: "duplicate", jobsEnqueued: 0 });
    expect(calls.map((call) => call.name)).toEqual([
      "resolve_google_drive_webhook_channel",
      "record_google_drive_notification",
    ]);
    expect(JSON.stringify(calls)).not.toContain("channel-provider-id");
  });
});
