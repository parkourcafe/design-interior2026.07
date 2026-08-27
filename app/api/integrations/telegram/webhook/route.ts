import { NextResponse } from "next/server";
import {
  normalizeTelegramUpdate,
} from "@/lib/integration-gateway/telegram/contracts";
import {
  parseTelegramBody,
  readTelegramBody,
  TelegramWebhookError,
  verifyTelegramWebhookSecret,
} from "@/lib/integration-gateway/telegram/security";

export const dynamic = "force-dynamic";

function enabled(): boolean {
  return process.env.REMHAOS_TELEGRAM_BRIDGE_ENABLED === "true";
}

export async function POST(request: Request) {
  if (!enabled()) {
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
    const update = normalizeTelegramUpdate(parseTelegramBody(await readTelegramBody(request)));
    if (process.env.REMHAOS_TELEGRAM_WORKER_ENABLED !== "true") {
      throw new TelegramWebhookError("worker_unavailable");
    }
    return NextResponse.json(
      { accepted: false, updateId: update.updateId },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const code = error instanceof TelegramWebhookError
      ? error.code
      : "invalid_body";
    const status = code === "credentials_required" || code === "worker_unavailable" ? 503 : 400;
    return NextResponse.json(
      { error: { code, messageKey: `telegram.errors.${code}` } },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
