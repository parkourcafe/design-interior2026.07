import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import type { PrivateStorageClient } from "@/lib/project-intelligence/adapters/storage";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import { createIntegrationWorkerResources } from "../runtime/worker-client";
import { normalizeTelegramUpdate } from "./contracts";
import { TelegramProviderTransport } from "./provider-transport";
import { TelegramWorker } from "./worker";

const bindingSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  bindingId: z.string().uuid(),
});

const commandResultSchema = z.object({
  operation: z.string().min(1),
  replay: z.boolean(),
  result: z.record(z.string(), z.unknown()),
});

function payloadDigest(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export class PostgresTelegramWebhookIngress {
  private readonly worker: TelegramWorker;

  constructor(
    private readonly client: PostgresRpcClient,
    private readonly provider: TelegramProviderTransport,
    private readonly storage: PrivateStorageClient,
  ) {
    this.worker = new TelegramWorker(client, storage);
  }

  async ingest(input: { readonly rawBody: string; readonly raw: Record<string, unknown> }) {
    const update = normalizeTelegramUpdate(input.raw);
    const binding = bindingSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "resolve_telegram_webhook_binding",
      { p_chat_id: Number(update.chatId) },
    ));
    const attachments = await this.provider.downloadAttachments({
      raw: input.raw,
      update,
      organizationId: binding.organizationId,
      projectId: binding.projectId,
    });
    const result = commandResultSchema.parse(await this.worker.ingestUpdate({
      organizationId: binding.organizationId,
      projectId: binding.projectId,
      update,
      payloadSha256: payloadDigest(input.rawBody),
      attachments,
      idempotencyKey: `telegram-webhook-${payloadDigest(input.rawBody)}`,
    }));
    return { update, result: result.result };
  }
}

export function createTelegramWebhookIngress(input?: {
  readonly client?: PostgresRpcClient;
  readonly storage?: PrivateStorageClient;
  readonly fetchImpl?: typeof fetch;
}): PostgresTelegramWebhookIngress {
  const resources = input?.client
    ? null
    : createIntegrationWorkerResources();
  const storage = input?.storage ?? resources?.storage;
  if (!storage) throw new Error("telegram_worker_storage_required");
  return new PostgresTelegramWebhookIngress(
    input?.client ?? resources!.client,
    new TelegramProviderTransport(process.env.TELEGRAM_BOT_TOKEN, input?.fetchImpl ?? fetch),
    storage,
  );
}
