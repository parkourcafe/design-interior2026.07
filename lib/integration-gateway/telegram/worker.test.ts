import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import type { PrivateStorageClient } from "@/lib/project-intelligence/adapters/storage";
import { TelegramWorker } from "./worker";

const projectId = "71111111-1111-4111-8111-111111111111";
const organizationId = "70111111-1111-4111-8111-111111111111";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fakeClient(rpcResult: unknown): PostgresRpcClient & { readonly args: Record<string, unknown> | null } {
  const holder = { args: null as Record<string, unknown> | null };
  return {
    get args() {
      return holder.args;
    },
    schema() {
      return {
        rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
          holder.args = args;
          return { data: rpcResult, error: null };
        }),
      };
    },
  } as PostgresRpcClient & { readonly args: Record<string, unknown> | null };
}

describe("Telegram worker writer path", () => {
  it("uploads verified bytes to quarantine before calling the worker RPC", async () => {
    const bytes = new TextEncoder().encode("telegram-file-bytes");
    const uploads: Array<{ path: string; body: Uint8Array }> = [];
    const storage: PrivateStorageClient = {
      from() {
        return {
          upload: async (path, body) => {
            uploads.push({ path, body });
            return { data: null, error: null };
          },
          remove: async () => ({ data: null, error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: "unused" }, error: null }),
        };
      },
    };
    const client = fakeClient({
      operation: "ingest_telegram_update",
      replay: false,
      result: { updateId: "9002", status: "candidate_created" },
    });
    const worker = new TelegramWorker(client, storage);

    await worker.ingestUpdate({
      organizationId,
      projectId,
      update: {
        updateId: "9002",
        chatId: "987654322",
        messageId: "42",
        senderId: "43",
        textDigest: "c".repeat(64),
        attachments: [],
      },
      payloadSha256: "b".repeat(64),
      attachments: [{
        providerFileIdDigest: "a".repeat(64),
        displayName: "plan.pdf",
        mediaType: "application/pdf",
        sizeBytes: bytes.byteLength,
        bytes,
        checksumHex: sha256(bytes),
        quarantineObjectKey: `project-intelligence/ru/${organizationId}/${projectId}/quarantine/telegram/${sha256(bytes)}/document`,
        sourceRole: "document",
      }],
      idempotencyKey: "telegram-worker-9002",
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.path).toContain(`/quarantine/telegram/`);
    expect(client.args).toMatchObject({
      p_project_id: projectId,
      p_update_id: "9002",
      p_chat_id: "987654322",
      p_payload_sha256_hex: "b".repeat(64),
    });
    expect(JSON.stringify(client.args)).not.toContain("telegram-file-bytes");
    expect(JSON.stringify(client.args)).not.toContain("message_body");
  });

  it("rejects checksum mismatch before storage or RPC mutation", async () => {
    const upload = vi.fn(async () => ({ data: null, error: null }));
    const storage: PrivateStorageClient = {
      from: () => ({
        upload,
        remove: async () => ({ data: null, error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: "unused" }, error: null }),
      }),
    };
    const client = fakeClient({ operation: "unused", replay: false, result: {} });
    const worker = new TelegramWorker(client, storage);
    const bytes = new TextEncoder().encode("not-the-declared-checksum");

    await expect(worker.ingestUpdate({
      organizationId,
      projectId,
      update: {
        updateId: "9003",
        chatId: "987654322",
        messageId: null,
        senderId: null,
        textDigest: null,
        attachments: [],
      },
      payloadSha256: "b".repeat(64),
      attachments: [{
        providerFileIdDigest: "a".repeat(64),
        displayName: null,
        mediaType: "application/pdf",
        sizeBytes: bytes.byteLength,
        bytes,
        checksumHex: "d".repeat(64),
        quarantineObjectKey: `project-intelligence/ru/${organizationId}/${projectId}/quarantine/telegram/${"d".repeat(64)}/document`,
        sourceRole: "document",
      }],
      idempotencyKey: "telegram-worker-9003",
    })).rejects.toThrow("checksum_mismatch");
    expect(upload).not.toHaveBeenCalled();
    expect(client.args).toBeNull();
  });

  it("rejects a quarantine key outside the authorized organization and project", async () => {
    const upload = vi.fn(async () => ({ data: null, error: null }));
    const storage: PrivateStorageClient = {
      from: () => ({
        upload,
        remove: async () => ({ data: null, error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: "unused" }, error: null }),
      }),
    };
    const client = fakeClient({ operation: "unused", replay: false, result: {} });
    const worker = new TelegramWorker(client, storage);
    const bytes = new TextEncoder().encode("telegram-scope-guard");
    const checksumHex = sha256(bytes);

    await expect(worker.ingestUpdate({
      organizationId,
      projectId,
      update: {
        updateId: "9004",
        chatId: "987654322",
        messageId: null,
        senderId: null,
        textDigest: null,
        attachments: [],
      },
      payloadSha256: "b".repeat(64),
      attachments: [{
        providerFileIdDigest: "a".repeat(64),
        displayName: "plan.pdf",
        mediaType: "application/pdf",
        sizeBytes: bytes.byteLength,
        bytes,
        checksumHex,
        quarantineObjectKey: `project-intelligence/ru/${organizationId}/81111111-1111-4111-8111-111111111111/quarantine/telegram/${checksumHex}/document`,
        sourceRole: "document",
      }],
      idempotencyKey: "telegram-worker-9004",
    })).rejects.toThrow("quarantine_authorization_invalid");
    expect(upload).not.toHaveBeenCalled();
    expect(client.args).toBeNull();
  });
});
