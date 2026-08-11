import { NextResponse } from "next/server";
import { z } from "zod";

import { appUrl } from "@/lib/env";
import { isSameOriginMutation } from "@/lib/project-intelligence/delivery/projectceo/csrf";
import {
  createProjectCeoRequestContext,
  ProjectCeoAuthenticationError,
} from "@/lib/project-intelligence/delivery/projectceo/request-context";
import {
  isTelegramBridgeEnabled,
  TELEGRAM_BRIDGE_DISABLED_REASON,
} from "@/lib/integration-gateway/telegram/bridge-flag";
import { readTelegramCredentials } from "@/lib/integration-gateway/telegram/config";
import {
  TelegramChannelRpcError,
  TelegramHumanPort,
} from "@/lib/integration-gateway/telegram/channel-port";
import { createChannelLinkNonce } from "@/lib/integration-gateway/telegram/link-nonce";
import {
  groupBindingUrl,
  identityLinkUrl,
  manualStartCommand,
} from "@/lib/integration-gateway/telegram/deep-link";

export const dynamic = "force-dynamic";

/**
 * Человеческая сторона моста: экран настроек проекта.
 *
 * Здесь — и только здесь — работает клиент с JWT человека. Порт называется
 * `TelegramHumanPort` и системных методов не имеет: вызвать приём сообщений
 * или очередь отсюда нельзя, потому что таких методов у него нет, а у роли
 * `authenticated` нет прав на эти функции в базе. Обратное — звать
 * человеческую RPC через `service_role` — запрещено A7 §2.1 и невозможно по
 * той же причине с другой стороны.
 *
 * Ссылка с одноразовым секретом возвращается ОДИН РАЗ, в ответе на действие
 * человека. Она не сохраняется ни в базе (там только sha256), ни в состоянии
 * экрана: перезагрузка страницы ссылку не покажет, и это правильно — иначе
 * одноразовый секрет стал бы постоянным свойством проекта.
 */

const TTL_SECONDS = 600;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link_identity") }),
  z.object({ action: z.literal("connect"), projectId: z.string().uuid() }),
  z.object({
    action: z.literal("disconnect"),
    projectId: z.string().uuid(),
    reason: z.string().min(1).max(200).default("disconnected_by_owner"),
  }),
]);

type ErrorCode =
  | "bridge_disabled"
  | "unauthenticated"
  | "forbidden"
  | "validation_failed"
  | "conflict"
  | "internal_error";

const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  bridge_disabled: 404,
  unauthenticated: 401,
  forbidden: 403,
  validation_failed: 400,
  conflict: 409,
  internal_error: 500,
};

function fail(code: ErrorCode) {
  return NextResponse.json(
    { ok: false, error: { code } },
    { status: HTTP_STATUS[code], headers: { "Cache-Control": "private, no-store" } },
  );
}

function ok(data: Readonly<Record<string, unknown>>) {
  return NextResponse.json(
    { ok: true, ...data },
    { status: 200, headers: { "Cache-Control": "private, no-store" } },
  );
}

/** SQLSTATE базы → код ответа. Текст ошибки провайдера наружу не идёт. */
function codeFromRpcError(error: unknown): ErrorCode {
  if (!(error instanceof TelegramChannelRpcError)) return "internal_error";
  if (error.failureCode === "P1101") return "unauthenticated";
  if (error.failureCode === "P1103") return "forbidden";
  if (error.failureCode === "P1109") return "conflict";
  if (error.failureCode === "P1111") return "validation_failed";
  return "internal_error";
}

export async function GET(request: Request) {
  if (!isTelegramBridgeEnabled()) return fail(TELEGRAM_BRIDGE_DISABLED_REASON);

  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  if (!z.string().uuid().safeParse(projectId).success) return fail("validation_failed");

  try {
    const context = await createProjectCeoRequestContext();
    const port = new TelegramHumanPort(context.client);
    return ok({ state: await port.getProjectChannelState(projectId) });
  } catch (error) {
    if (error instanceof ProjectCeoAuthenticationError) return fail("unauthenticated");
    return fail(codeFromRpcError(error));
  }
}

export async function POST(request: Request) {
  if (!isTelegramBridgeEnabled()) return fail(TELEGRAM_BRIDGE_DISABLED_REASON);
  if (!isSameOriginMutation(request)) return fail("forbidden");

  const credentials = readTelegramCredentials();
  if (!credentials.ok) {
    // Без учётных данных ссылка была бы недействующей. Показать её значило бы
    // отправить человека кликать по заведомо мёртвому адресу.
    return fail("bridge_disabled");
  }

  let parsedBody: z.infer<typeof actionSchema>;
  try {
    parsedBody = actionSchema.parse(await request.json());
  } catch {
    return fail("validation_failed");
  }

  try {
    const context = await createProjectCeoRequestContext();
    const port = new TelegramHumanPort(context.client);
    const { botUsername } = credentials.credentials;

    if (parsedBody.action === "link_identity") {
      const nonce = createChannelLinkNonce();
      await port.createIdentityLinkIntent({
        nonceDigest: nonce.digest,
        ttlSeconds: TTL_SECONDS,
      });
      return ok({
        url: identityLinkUrl(botUsername, nonce.nonce),
        expiresInSeconds: TTL_SECONDS,
      });
    }

    if (parsedBody.action === "connect") {
      const nonce = createChannelLinkNonce();
      await port.createBindingIntent({
        projectId: parsedBody.projectId,
        nonceDigest: nonce.digest,
        ttlSeconds: TTL_SECONDS,
      });
      return ok({
        url: groupBindingUrl(botUsername, nonce.nonce),
        // Запасной путь на случай, если Telegram не доставит `/start` в группу
        // сам. См. `deep-link.ts`: это поведение подтверждает только TG4.
        manualCommand: manualStartCommand(nonce.nonce),
        expiresInSeconds: TTL_SECONDS,
        appUrl: appUrl(),
      });
    }

    await port.disconnectProjectChannel({
      projectId: parsedBody.projectId,
      reason: parsedBody.reason,
    });
    return ok({ disconnected: true });
  } catch (error) {
    if (error instanceof ProjectCeoAuthenticationError) return fail("unauthenticated");
    return fail(codeFromRpcError(error));
  }
}
