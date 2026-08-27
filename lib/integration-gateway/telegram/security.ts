import { createHash, timingSafeEqual } from "node:crypto";

export const TELEGRAM_WEBHOOK_MAX_BYTES = 256 * 1024;

export class TelegramWebhookError extends Error {
  constructor(
    readonly code:
      | "invalid_secret"
      | "body_too_large"
      | "invalid_body"
      | "credentials_required"
      | "worker_unavailable"
      | "provider_unavailable"
      | "provider_response_invalid",
  ) {
    super(`telegram_webhook_${code}`);
    this.name = "TelegramWebhookError";
  }
}

export function verifyTelegramWebhookSecret(
  received: string | null,
  expected: string | undefined,
): void {
  if (!expected || expected.length < 16) throw new TelegramWebhookError("credentials_required");
  if (!received) throw new TelegramWebhookError("invalid_secret");
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (
    receivedBytes.byteLength !== expectedBytes.byteLength ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    throw new TelegramWebhookError("invalid_secret");
  }
}

export function parseTelegramBody(body: string): Record<string, unknown> {
  if (Buffer.byteLength(body, "utf8") > TELEGRAM_WEBHOOK_MAX_BYTES) {
    throw new TelegramWebhookError("body_too_large");
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new TelegramWebhookError("invalid_body");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TelegramWebhookError("invalid_body");
  }
  return value as Record<string, unknown>;
}

export async function readTelegramBody(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (declaredLength) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > TELEGRAM_WEBHOOK_MAX_BYTES) {
      throw new TelegramWebhookError("body_too_large");
    }
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > TELEGRAM_WEBHOOK_MAX_BYTES) {
        throw new TelegramWebhookError("body_too_large");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TelegramWebhookError("invalid_body");
  }
}

export function digestTelegramOpaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
