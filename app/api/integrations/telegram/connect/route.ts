/**
 * Человеческая половина подключения (A7 / DEC-031, гейт TG2).
 *
 * Заводит одноразовый интент и отдаёт ссылку, которую открывает пользователь.
 * Больше ничего: ни одна официальная mutation отсюда не выполняется.
 *
 * ПОЧЕМУ СЕКРЕТ РОЖДАЕТСЯ ЗДЕСЬ И НЕ ВОЗВРАЩАЕТСЯ В ТЕЛЕ. Секрет — 32 случайных
 * байта в base64url (43 символа, помещается в лимит Telegram `start` /
 * `startgroup`). В базу уходит только его SHA-256, а наружу — целиком собранная
 * ссылка. Отдай мы секрет отдельным полем, он осел бы в истории браузера,
 * буфере обмена и логах фронтенда как самостоятельное значение.
 *
 * ДВА ШАГА, А НЕ ОДИН. Сначала владелец связывает свой Telegram-аккаунт
 * (`identity_link`, приватная ссылка бота), и только потом создаётся интент
 * подключения группы (`channel_binding`, `?startgroup=`). Порядок не
 * косметический: без верифицированной identity сервер не знает, кто нажмёт
 * кнопку в Telegram, и подключить группу к проекту было бы нечем.
 */

import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
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

const INTENT_TTL_SECONDS = 600;

const requestSchema = z.object({
  projectId: z.string().uuid(),
  purpose: z.enum(["identity_link", "channel_binding"]),
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

  const configured = resolveTelegramBridgeConfig();
  if (!configured.ok) {
    // Выключенный мост поверхности не даёт: ответ тот же, что у несуществующего
    // маршрута, чтобы состояние флага нельзя было выяснить снаружи.
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

    // Секрет живёт ровно столько, сколько нужно, чтобы собрать ссылку.
    const secret = randomBytes(32).toString("base64url");
    const digest = createHash("sha256").update(secret, "utf8").digest("hex");

    const intent = await port.createLinkIntent({
      projectId: parsed.projectId,
      purpose: parsed.purpose,
      botInstanceId: configured.config.botInstanceId,
      nonceDigestHex: digest,
      ttlSeconds: INTENT_TTL_SECONDS,
    });

    // `startgroup` — единственный честный жест: Telegram сам предложит СОЗДАТЬ
    // ИЛИ ВЫБРАТЬ группу и добавить бота. Создать группу за человека Bot API не
    // умеет, и обещать этого нельзя (A7 §5.1).
    const url = parsed.purpose === "channel_binding"
      ? `https://t.me/${configured.config.botUsername}?startgroup=${secret}`
      : `https://t.me/${configured.config.botUsername}?start=${secret}`;

    return NextResponse.json({
      contractVersion: "remhaos-telegram-bridge/0.1",
      status: "completed",
      result: {
        purpose: intent.purpose,
        expiresAt: intent.expiresAt,
        url,
      },
    }, { status: 200, headers });
  } catch (error) {
    if (error instanceof ProjectCeoAuthenticationError) {
      return NextResponse.json(errorBody(error.code), {
        status: projectCeoHttpStatus(error.code),
        headers,
      });
    }
    if (error instanceof ProjectIntelligenceAdapterError) {
      return NextResponse.json(errorBody(error.code), {
        status: projectCeoHttpStatus(error.code),
        headers,
      });
    }
    return NextResponse.json(errorBody("internal_error"), { status: 500, headers });
  }
}
