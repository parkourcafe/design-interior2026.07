import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { TelegramBotApi } from "../../lib/integration-gateway/telegram/bot-api";
import { TelegramSystemPort, type ClaimedAttachment } from "../../lib/integration-gateway/telegram/channel-port";
import {
  attachmentFilename,
  runTelegramAttachmentBatch,
  type AttachmentQuarantinePort,
} from "../../lib/integration-gateway/telegram/attachment-runner";
import { runTelegramNotificationBatch } from "../../lib/integration-gateway/telegram/notification-runner";
import { NOTIFICATION_TEMPLATE_VERSION } from "../../lib/integration-gateway/telegram/notification-template";
import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres/contracts";

/**
 * TG2 (DEC-044 (b), DEC-041 §5): фоновые процессы моста против НАСТОЯЩЕГО
 * HTTP-сервера, изображающего Telegram. Bot API ходит по сети (localhost),
 * разбирает настоящие ответы и заголовки; подменён только адрес.
 * Реальный Telegram — NOT_VERIFIED: бота и credentials в этой работе нет.
 */

const TOKEN = `424242:${"A".repeat(35)}`;
const PDF = new TextEncoder().encode("%PDF-1.7\nsynthetic telegram attachment\n%%EOF\n");

interface FakeTelegram {
  files: Map<string, { path: string; bytes: Uint8Array; size?: number }>;
  getFileStatus: number;
  sent: { chatId: number; text: string }[];
  sendStatus: number;
  requests: string[];
}

const fake: FakeTelegram = {
  files: new Map(),
  getFileStatus: 200,
  sent: [],
  sendStatus: 200,
  requests: [],
};

let server: Server;
let base = "";

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = request.url ?? "";
    fake.requests.push(url.replace(TOKEN, "<token>"));
    if (url === `/bot${TOKEN}/getFile`) {
      const { file_id: fileId } = await body(request) as { file_id: string };
      const file = fake.files.get(fileId);
      if (fake.getFileStatus !== 200) {
        return json(response, fake.getFileStatus, { ok: false, description: "fail" });
      }
      if (!file) return json(response, 400, { ok: false, description: "file not found" });
      return json(response, 200, { ok: true, result: { file_id: fileId, file_path: file.path, file_size: file.size } });
    }
    if (url.startsWith(`/file/bot${TOKEN}/`)) {
      const path = url.slice(`/file/bot${TOKEN}/`.length);
      const file = [...fake.files.values()].find((entry) => entry.path === path);
      if (!file) {
        response.writeHead(404);
        return response.end();
      }
      response.writeHead(200, { "content-type": "application/octet-stream" });
      return response.end(Buffer.from(file.bytes));
    }
    if (url === `/bot${TOKEN}/sendMessage`) {
      const payload = await body(request) as { chat_id: number; text: string };
      if (fake.sendStatus !== 200) {
        return json(response, fake.sendStatus, { ok: false, parameters: { retry_after: 7 } });
      }
      fake.sent.push({ chatId: payload.chat_id, text: payload.text });
      return json(response, 200, { ok: true, result: { message_id: 900 + fake.sent.length } });
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  fake.files = new Map();
  fake.getFileStatus = 200;
  fake.sent = [];
  fake.sendStatus = 200;
  fake.requests = [];
});

/** Настоящий fetch, у которого подменён только хост Telegram. */
const localFetch: typeof fetch = (input, init) =>
  fetch(String(input).replace("https://api.telegram.org", base), init);

const bot = () => new TelegramBotApi(TOKEN, localFetch, 2_000);

/** База в памяти: те же RPC, те же конверты, что у remhaos_channel_api. */
function fakeDatabase() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const queue: Record<string, unknown>[] = [];
  const outbox: Record<string, unknown>[] = [];
  const envelope = (data: unknown) => ({
    data: { contractVersion: "remhaos-channel/0.1", requestId: "db:test", data, error: null },
    error: null,
  });
  const client = {
    schema: () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "claim_channel_attachments") return envelope(queue.splice(0));
        if (name === "complete_channel_attachment") {
          return envelope(args.lease_token === "lost-lease"
            ? { completed: false, reason: "lease_lost" }
            : { completed: true, outcome: args.outcome });
        }
        if (name === "claim_notification_batch") return envelope(outbox.splice(0));
        if (name === "mark_notification_sent" || name === "mark_notification_failed") {
          return envelope({ changed: true });
        }
        return { data: null, error: { code: "42883", message: `unexpected ${name}` } };
      },
    }),
  } as unknown as PostgresRpcClient;
  return { client, calls, queue, outbox };
}

function claimed(overrides: Partial<ClaimedAttachment> = {}): ClaimedAttachment {
  return {
    attachmentId: "11111111-1111-4111-8111-111111111111",
    projectId: "41111111-1111-4111-8111-111111111111",
    kind: "document",
    fileId: "FILE-1",
    fileUniqueId: "UNIQ-1",
    claimedSizeBytes: PDF.byteLength,
    claimedMediaType: "application/pdf",
    attemptCount: 1,
    leaseToken: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  };
}

function recordingQuarantine(): AttachmentQuarantinePort & {
  readonly calls: { projectId: string; filename: string; sha: string; key: string; role: string }[];
} {
  const calls: { projectId: string; filename: string; sha: string; key: string; role: string }[] = [];
  return {
    calls,
    async createAndUpload(input) {
      calls.push({
        projectId: input.projectId,
        filename: input.upload.filename,
        sha: input.upload.checksumHex,
        key: input.idempotencyKey,
        role: input.upload.sourceRole,
      });
      return {
        result: {
          intakeId: "33333333-3333-4333-8333-333333333333",
          checksumHex: input.upload.checksumHex,
          objectKey: `quarantine/${input.upload.checksumHex}`,
          status: "scan_pending",
        },
      };
    },
  };
}

describe("Telegram attachment runner (DEC-044 (b))", () => {
  it("downloads over HTTP, hashes, quarantines and reports scan_pending", async () => {
    fake.files.set("FILE-1", { path: "documents/file_1.pdf", bytes: PDF });
    const db = fakeDatabase();
    db.queue.push(claimed());
    const quarantine = recordingQuarantine();

    const result = await runTelegramAttachmentBatch(new TelegramSystemPort(db.client), bot(), quarantine);

    expect(result).toEqual({ claimed: 1, quarantined: 1, rejected: 0, retried: 0, released: 0, leaseLost: 0 });
    const sha = createHash("sha256").update(PDF).digest("hex");
    expect(quarantine.calls).toEqual([{
      projectId: "41111111-1111-4111-8111-111111111111",
      filename: "telegram-UNIQ-1.pdf",
      sha,
      key: "telegram-attachment:11111111-1111-4111-8111-111111111111",
      role: "correspondence",
    }]);
    const complete = db.calls.find((call) => call.name === "complete_channel_attachment");
    expect(complete?.args).toMatchObject({
      outcome: "scan_pending",
      file_intake_id: "33333333-3333-4333-8333-333333333333",
      server_sha256_hex: sha,
      storage_locator: `quarantine/${sha}`,
    });
    // Токен бота не попадает ни в аргументы базы, ни в итог.
    expect(JSON.stringify(db.calls)).not.toContain(TOKEN);
  });

  it("rejects a file the intake policy does not accept, without quarantining it", async () => {
    fake.files.set("VOICE", { path: "voice/file_2.oga", bytes: new Uint8Array([1, 2, 3]) });
    const db = fakeDatabase();
    db.queue.push(claimed({ fileId: "VOICE", kind: "voice", claimedMediaType: "audio/ogg" }));
    const quarantine = recordingQuarantine();

    const result = await runTelegramAttachmentBatch(new TelegramSystemPort(db.client), bot(), quarantine);

    expect(result.rejected).toBe(1);
    expect(quarantine.calls).toEqual([]);
    expect(db.calls.find((call) => call.name === "complete_channel_attachment")?.args)
      .toMatchObject({ outcome: "rejected", rejection_code: "unsupported_extension" });
  });

  it("rejects bytes that do not match the claimed extension", async () => {
    fake.files.set("FAKE-PDF", { path: "documents/file_3.pdf", bytes: new TextEncoder().encode("not a pdf") });
    const db = fakeDatabase();
    db.queue.push(claimed({ fileId: "FAKE-PDF" }));

    const result = await runTelegramAttachmentBatch(new TelegramSystemPort(db.client), bot(), recordingQuarantine());

    expect(result.rejected).toBe(1);
    expect(db.calls.find((call) => call.name === "complete_channel_attachment")?.args)
      .toMatchObject({ rejection_code: "mime_mismatch" });
  });

  it("refuses an oversized file before downloading it", async () => {
    fake.files.set("BIG", { path: "documents/big.pdf", bytes: PDF, size: 90_000_000 });
    const db = fakeDatabase();
    db.queue.push(claimed({ fileId: "BIG", claimedSizeBytes: null }));

    const result = await runTelegramAttachmentBatch(new TelegramSystemPort(db.client), bot(), recordingQuarantine());

    expect(result.rejected).toBe(1);
    expect(fake.requests.some((path) => path.startsWith("/file/"))).toBe(false);
  });

  it("returns a transient Telegram failure to the queue", async () => {
    fake.getFileStatus = 502;
    const db = fakeDatabase();
    db.queue.push(claimed());

    const result = await runTelegramAttachmentBatch(new TelegramSystemPort(db.client), bot(), recordingQuarantine());

    expect(result.retried).toBe(1);
    expect(db.calls.find((call) => call.name === "complete_channel_attachment")?.args)
      .toMatchObject({ outcome: "retry" });
  });

  it("counts a lost lease instead of claiming success", async () => {
    fake.files.set("FILE-1", { path: "documents/file_1.pdf", bytes: PDF });
    const db = fakeDatabase();
    db.queue.push(claimed({ leaseToken: "lost-lease" }));

    const result = await runTelegramAttachmentBatch(new TelegramSystemPort(db.client), bot(), recordingQuarantine());

    expect(result).toMatchObject({ quarantined: 0, leaseLost: 1 });
  });

  it("stops the pass and surfaces an infrastructure failure, returning the rest to the queue", async () => {
    fake.files.set("FILE-1", { path: "documents/file_1.pdf", bytes: PDF });
    const db = fakeDatabase();
    db.queue.push(claimed(), claimed({ attachmentId: "44444444-4444-4444-8444-444444444444" }));
    const broken: AttachmentQuarantinePort = {
      async createAndUpload() {
        throw new Error("permission denied for function create_file_intake_worker");
      },
    };

    await expect(runTelegramAttachmentBatch(new TelegramSystemPort(db.client), bot(), broken))
      .rejects.toThrow("permission denied");
    const outcomes = db.calls
      .filter((call) => call.name === "complete_channel_attachment")
      .map((call) => call.args.outcome);
    // Попытки не списываются: неверная настройка не отклоняет файлы.
    expect(outcomes).toEqual(["release", "release"]);
  });

  it("names the file from our identifier, never from what the sender typed", () => {
    expect(attachmentFilename(claimed({ fileUniqueId: "../../etc/passwd" }), "documents/x.PDF"))
      .toBe("telegram-etcpasswd.pdf");
  });
});

describe("Telegram notification sender over HTTP (TG2 proof)", () => {
  it("delivers a claimed notification and records the Telegram message id", async () => {
    const db = fakeDatabase();
    db.outbox.push({
      notificationId: "n-1",
      bindingId: "b-1",
      templateVersion: NOTIFICATION_TEMPLATE_VERSION,
      attemptCount: 1,
      leaseToken: "lease-1",
      payload: { kind: "release_distributed", projectId: "p-1", versionLabel: "v2" },
      externalChatId: -1008500,
      botInstanceId: "424242",
    });

    const result = await runTelegramNotificationBatch(new TelegramSystemPort(db.client), bot(), {
      appBaseUrl: "https://app.example",
    });

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0 });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.chatId).toBe(-1008500);
    expect(fake.sent[0]?.text).toContain("https://app.example/dashboard/projectceo/projects/p-1");
    expect(db.calls.find((call) => call.name === "mark_notification_sent")?.args)
      .toMatchObject({ lease_token: "lease-1", external_message_id: 901 });
  });

  it("hands a 429 back to the queue with Telegram's retry_after", async () => {
    fake.sendStatus = 429;
    const db = fakeDatabase();
    db.outbox.push({
      notificationId: "n-2",
      bindingId: "b-1",
      templateVersion: NOTIFICATION_TEMPLATE_VERSION,
      attemptCount: 1,
      leaseToken: "lease-2",
      payload: { kind: "release_distributed", projectId: "p-1" },
      externalChatId: -1008500,
      botInstanceId: "424242",
    });

    const result = await runTelegramNotificationBatch(new TelegramSystemPort(db.client), bot(), {
      appBaseUrl: "https://app.example",
    });

    expect(result.failed).toBe(1);
    expect(db.calls.find((call) => call.name === "mark_notification_failed")?.args)
      .toMatchObject({ lease_token: "lease-2", failure_code: "tg_429", retry_after_seconds: 7 });
  });
});
