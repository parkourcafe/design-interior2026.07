import { NextResponse } from "next/server";
import { createTelegramWebhookIngress } from "./runtime";
import { normalizeTelegramUpdate } from "./contracts";
import {
  parseTelegramBody,
  readTelegramBody,
  TelegramWebhookError,
  verifyTelegramWebhookSecret,
} from "./security";
import { TelegramProviderError } from "./provider-transport";

export function telegramIntegrationEnabled(): boolean {
  return process.env.REMHAOS_TELEGRAM_BRIDGE_ENABLED === "true";
}

function responseCode(error: unknown): string {
  if (error instanceof TelegramWebhookError) return error.code;
  if (error instanceof TelegramProviderError) {
    return error.code === "response_invalid" ? "provider_response_invalid" : error.code;
  }
  if (error instanceof Error && error.name === "SecretStoreUnavailableError") {
    return "worker_unavailable";
  }
  return "invalid_body";
}

function responseStatus(code: string): number {
  return [
    "credentials_required",
    "provider_unavailable",
    "worker_unavailable",
  ].includes(code) ? 503 : 400;
}

export async function postTelegramIntegrationWebhook(request: Request): Promise<Response> {
  if (!telegramIntegrationEnabled()) {
    return NextResponse.json(
      { error: { code: "not_found", messageKey: "telegram.errors.notFound" } },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    verifyTelegramWebhookSecret(
      request.headers.get("x-telegram-bot-api-secret-token"),
      process.env.TELEGRAM_WEBHOOK_SECRET,
    );
    const rawBody = await readTelegramBody(request);
    const raw = parseTelegramBody(rawBody);
    const update = normalizeTelegramUpdate(raw);
    if (process.env.REMHAOS_TELEGRAM_WORKER_ENABLED !== "true") {
      throw new TelegramWebhookError("worker_unavailable");
    }
    await createTelegramWebhookIngress().ingest({ rawBody, raw });
    return NextResponse.json(
      { accepted: true, updateId: update.updateId },
      { status: 202, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const code = responseCode(error);
    return NextResponse.json(
      { error: { code, messageKey: `telegram.errors.${code}` } },
      { status: responseStatus(code), headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
