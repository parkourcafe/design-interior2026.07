/**
 * Решение человека по кандидату Project Inbox (A7 / DEC-031, гейт TG3).
 *
 * ЭТОТ МАРШРУТ НЕ СОЗДАЁТ ДОМЕННЫХ ОБЪЕКТОВ. Он ставит на кандидата отметку
 * «проверено» или «отклонено» — и всё. Официальное изменение создаёт
 * существующая команда `create_change` через `/api/projectceo/commands`, тем же
 * человеком, отдельным явным действием и с собственной идемпотентностью.
 *
 * Разделение намеренное. Слей мы их в один вызов, одно нажатие делало бы и
 * проверку, и изменение — и «человек проверил» перестало бы означать, что
 * человек видел, что именно уходит в проект.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTelegramBridgeConfig } from "@/lib/integration-gateway/telegram/bridge-flag";
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
  candidateId: z.string().uuid(),
  decision: z.enum(["confirmed", "rejected"]),
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
    const result = await port.resolveCandidate(parsed);
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
