/**
 * Вебхук Telegram — единственная точка входа моста снаружи (A7 / DEC-031).
 *
 * ПОРЯДОК ПРОВЕРОК ВЫБРАН ТАК, ЧТОБЫ ДОРОГОЕ СТОЯЛО ПОСЛЕ ДЕШЁВОГО И
 * НЕДОВЕРЕННОЕ — ПОСЛЕ ПОДЛИННОГО:
 *
 *   1. мост включён? Выключенный не принимает вовсе — и это происходит до
 *      единственного чтения проекта;
 *   2. секрет заголовка — сравнение за постоянное время;
 *   3. content-type и размер тела;
 *   4. частота;
 *   5. строгая схема, allowlist типов, нормализация;
 *   6. durable-запись;
 *   7. быстрый ответ.
 *
 * КОДЫ ОТВЕТА ЗАГРУЖЕНЫ СМЫСЛОМ, а не выбраны для красоты. `2xx` означает
 * «больше не повторяй», `5xx` — «повтори, мы не записали». Ошибиться здесь
 * дорого в обе стороны: `2xx` вместо `5xx` теряет сообщение молча, `5xx` вместо
 * `2xx` заставляет Telegram повторять мусор вечно.
 *
 * ЧЕГО ЗДЕСЬ НЕТ: LLM, скачивания файлов, бизнес-команд. И ни строки переписки в
 * логах.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres";
import { resolveTelegramBridgeConfig } from "@/lib/integration-gateway/telegram/bridge-flag";
import { consoleBridgeLogger } from "@/lib/integration-gateway/telegram/bridge-log";
import { TelegramSystemPort } from "@/lib/integration-gateway/telegram/gateway-port";
import { TelegramApi } from "@/lib/integration-gateway/telegram/telegram-api";
import {
  handleTelegramUpdate,
  secretMatches,
} from "@/lib/integration-gateway/telegram/webhook-service";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Частота. Окно грубое и память процесса — этого достаточно: настоящий предел
 * ставит Telegram, а здесь мы защищаемся от того, кто узнал URL и секретом не
 * владеет. Такой поток отсекается ещё проверкой секрета; лимит нужен, чтобы он
 * не стоил нам чтений.
 */
const RATE_WINDOW_MS = 1_000;
const RATE_LIMIT = 60;
let windowStartedAt = 0;
let windowCount = 0;

function withinRateLimit(now: number): boolean {
  if (now - windowStartedAt > RATE_WINDOW_MS) {
    windowStartedAt = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= RATE_LIMIT;
}

async function readBoundedBody(request: Request): Promise<
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly tooLarge: boolean }
> {
  if (request.body === null) return { ok: false, tooLarge: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}

/**
 * Тело ответа намеренно пустое. Telegram читает только код, а всё, что мы могли
 * бы туда написать, — подсказка тому, кто зондирует URL.
 */
function reply(status: number): NextResponse {
  return new NextResponse(null, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // Первым делом — выключен ли мост. До любых чтений: выключенный мост не
  // принимает, не классифицирует и не отправляет (A7 §7).
  const configured = resolveTelegramBridgeConfig();
  if (!configured.ok) {
    consoleBridgeLogger.emit({
      event: "webhook_rejected",
      requestId,
      code: configured.reason === "disabled" ? "bridge_disabled" : "bridge_misconfigured",
    });
    // 404, а не 403: выключенного моста для внешнего мира не существует.
    return reply(404);
  }

  if (!secretMatches(configured.config.webhookSecret, request.headers.get(SECRET_HEADER))) {
    consoleBridgeLogger.emit({ event: "webhook_rejected", requestId, code: "secret_mismatch" });
    return reply(401);
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reply(415);
  }
  if (!withinRateLimit(Date.now())) {
    consoleBridgeLogger.emit({ event: "webhook_rejected", requestId, code: "rate_limited" });
    return reply(429);
  }

  const body = await readBoundedBody(request);
  if (!body.ok) {
    consoleBridgeLogger.emit({
      event: "webhook_rejected",
      requestId,
      code: body.tooLarge ? "body_too_large" : "body_unreadable",
    });
    return reply(body.tooLarge ? 413 : 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    consoleBridgeLogger.emit({ event: "webhook_rejected", requestId, code: "system_client_missing" });
    // Записать некуда — значит просим повторить, а не делаем вид, что приняли.
    return reply(503);
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as PostgresRpcClient;

  const outcome = await handleTelegramUpdate(body.value, {
    port: new TelegramSystemPort(client),
    api: new TelegramApi({ botToken: configured.config.botToken }),
    botInstanceId: configured.config.botInstanceId,
    webhookSecret: configured.config.webhookSecret,
    noticeText: ru.telegramBridge.notice.groupAnnouncement,
    unboundChatText: ru.telegramBridge.notice.unboundChat,
  }, requestId);

  if (outcome.status === "rejected") return reply(400);
  // Временный сбой записи → non-2xx, и Telegram повторит. Это единственное, что
  // спасает сообщение, которое мы не успели записать.
  if (outcome.status === "retry") return reply(503);
  return reply(200);
}

/**
 * Telegram ходит только POST. GET существует, чтобы зонд получил тот же ответ,
 * что и при выключенном мосте, — и ничего не узнал.
 */
export async function GET(): Promise<NextResponse> {
  return reply(404);
}
