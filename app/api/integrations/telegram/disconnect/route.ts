/**
 * Отключение чата (A7 / DEC-031, гейт TG2).
 *
 * Отключение — человеческое действие владельца проекта, и выполняется оно
 * request-bound сессией: сервер выводит actor и права заново, как для любой
 * другой команды. Системная identity сюда не достаёт.
 *
 * Привязка НЕ удаляется — она отзывается. История подключения часть аудита:
 * стереть её значит потерять ответ на вопрос «кто и когда открыл канал».
 * Неотправленные уведомления при этом отменяются той же транзакцией: слать в
 * чат, который больше не наш, нельзя.
 *
 * ПЕРЕПРИВЯЗКА (rebind) — это отключение плюс новое подключение, а не отдельная
 * операция. Отдельная означала бы путь, на котором старая привязка живёт, пока
 * рождается новая, и INV-T1 держался бы на порядке вызовов.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTelegramBridgeConfig } from "@/lib/integration-gateway/telegram/bridge-flag";
import { consoleBridgeLogger } from "@/lib/integration-gateway/telegram/bridge-log";
import { TelegramHumanPort } from "@/lib/integration-gateway/telegram/gateway-port";
import { isSameOriginMutation } from "@/lib/project-intelligence/delivery/projectceo/csrf";
import { projectCeoHttpStatus } from "@/lib/project-intelligence/delivery/projectceo/http-status";
import {
  createProjectCeoRequestContext,
  ProjectCeoAuthenticationError,
} from "@/lib/project-intelligence/delivery/projectceo/request-context";
import { ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  projectId: z.string().uuid(),
  bindingId: z.string().uuid(),
}).strict();

function errorBody(code: string) {
  return {
    contractVersion: "remhaos-telegram-bridge/0.1",
    status: "error",
    error: { code, messageKey: `telegram_bridge.error.${code}` },
  } as const;
}

export async function POST(request: Request): Promise<NextResponse> {
  const headers = { "Cache-Control": "private, no-store" };
  const requestId = crypto.randomUUID();

  if (!isSameOriginMutation(request)) {
    return NextResponse.json(errorBody("forbidden"), { status: 403, headers });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(errorBody("validation_failed"), { status: 415, headers });
  }
  if (!resolveTelegramBridgeConfig().ok) {
    return NextResponse.json(errorBody("operation_unavailable"), { status: 404, headers });
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(errorBody("validation_failed"), { status: 400, headers });
  }

  try {
    const context = await createProjectCeoRequestContext();
    const port = new TelegramHumanPort(context.client);
    const result = await port.revokeBinding({
      projectId: parsed.projectId,
      bindingId: parsed.bindingId,
      reasonCode: "revoked_by_owner",
    });
    consoleBridgeLogger.emit({
      event: "binding_revoked",
      requestId,
      projectId: parsed.projectId,
      bindingId: parsed.bindingId,
    });
    return NextResponse.json({
      contractVersion: "remhaos-telegram-bridge/0.1",
      status: "completed",
      result,
    }, { status: 200, headers });
  } catch (error) {
    if (error instanceof ProjectCeoAuthenticationError
      || error instanceof ProjectIntelligenceAdapterError) {
      return NextResponse.json(errorBody(error.code), {
        status: projectCeoHttpStatus(error.code),
        headers,
      });
    }
    return NextResponse.json(errorBody("internal_error"), { status: 500, headers });
  }
}
