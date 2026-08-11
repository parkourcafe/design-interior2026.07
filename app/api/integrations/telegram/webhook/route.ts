import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isTelegramBridgeEnabled,
} from "@/lib/integration-gateway/telegram/bridge-flag";
import { readTelegramCredentials } from "@/lib/integration-gateway/telegram/config";
import {
  isAuthenticTelegramWebhook,
  TELEGRAM_WEBHOOK_SECRET_HEADER,
} from "@/lib/integration-gateway/telegram/webhook-auth";
import { digestChannelLinkNonce } from "@/lib/integration-gateway/telegram/link-nonce";
import {
  isGroupChat,
  normalizeTelegramUpdate,
  telegramUpdateSchema,
  type NormalizedChannelUpdate,
} from "@/lib/integration-gateway/telegram/update-contract";
import {
  TelegramChannelRpcError,
  TelegramSystemPort,
} from "@/lib/integration-gateway/telegram/channel-port";
import {
  isChatAdministrator,
  TelegramBotApi,
} from "@/lib/integration-gateway/telegram/bot-api";
import { GROUP_NOTICE_VERSION, renderGroupNotice } from "@/lib/integration-gateway/telegram/notification-template";
import {
  chatRef,
  logTelegramBridgeEvent,
  type TelegramBridgeOutcome,
} from "@/lib/integration-gateway/telegram/observability";

export const dynamic = "force-dynamic";

/**
 * Настоящая HTTP-граница моста.
 *
 * ПОРЯДОК ПРОВЕРОК ЗДЕСЬ — ЧАСТЬ КОНТРАКТА, а не стиль:
 *
 *   1. флаг моста. Выключенный мост не читает тело вовсе;
 *   2. секрет заголовка, сравнение постоянного времени. URL webhook'а знает
 *      всякий, кто его однажды видел, — секрет и есть единственное
 *      доказательство отправителя;
 *   3. размер тела. Иначе «дорогая» проверка выполняется на чужой байт;
 *   4. форма тела;
 *   5. и только теперь — смысл.
 *
 * ЧТО ЭТОТ МАРШРУТ НЕ ДЕЛАЕТ. Не пишет в таблицы модулей M1–M4 — он их не
 * видит. Не зовёт ни одной человеческой RPC: у него клиент `service_role`, а
 * человеческие функции требуют JWT человека. Не исполняет текст сообщения.
 * Единственное, что он в тексте читает, — одноразовый nonce рукопожатия, и
 * полномочия даёт не текст, а запись намерения, созданная владельцем в
 * интерфейсе.
 *
 * ПОЧЕМУ 200 НА ОШИБКАХ СМЫСЛА. Telegram повторяет доставку, пока не получит
 * 2xx. На «сообщение из неподключённого чата» повтор ничего не изменит, и
 * ответить не-2xx значит попросить Telegram долбиться вечно. Не-2xx здесь
 * означает ровно одно: «это не Telegram» или «мы сломались, приходи снова».
 */

const MAX_UPDATE_BYTES = 1024 * 1024;

function ack(
  outcome: TelegramBridgeOutcome,
  requestId: string,
  extra: { readonly updateId?: number; readonly chatId?: number } = {},
) {
  logTelegramBridgeEvent({
    outcome,
    requestId,
    updateId: extra.updateId,
    chatRef: extra.chatId === undefined ? undefined : chatRef(extra.chatId),
  });
  return NextResponse.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

async function readBoundedBody(request: Request): Promise<
  { readonly ok: true; readonly value: unknown } | { readonly ok: false }
> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_UPDATE_BYTES) {
    return { ok: false };
  }
  if (request.body === null) return { ok: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPDATE_BYTES) {
        await reader.cancel();
        return { ok: false };
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
    return { ok: false };
  } finally {
    reader.releaseLock();
  }
}

/**
 * Рукопожатие: `/start <nonce>`. Личный чат связывает Telegram-аккаунт с
 * человеком, групповой — подключает проект к чату.
 */
async function handleHandshake(
  event: NormalizedChannelUpdate,
  port: TelegramSystemPort,
  bot: TelegramBotApi,
  botInstanceId: string,
  requestId: string,
): Promise<Response> {
  const digest = event.startPayload === null
    ? null
    : digestChannelLinkNonce(event.startPayload);
  if (digest === null || event.senderId === null) {
    return ack("identity_rejected", requestId, {
      updateId: event.updateId,
      chatId: event.chatId,
    });
  }

  if (!isGroupChat(event.chatType)) {
    try {
      await port.consumeIdentityLinkIntent({
        nonceDigest: digest,
        externalUserId: event.senderId,
      });
      return ack("identity_linked", requestId, {
        updateId: event.updateId,
        chatId: event.chatId,
      });
    } catch {
      // Отказ базы на просроченном, потраченном или чужом намерении — не
      // авария моста. Причину человеку сообщает экран RemHaOS, а не бот:
      // подсказывать в чате, чем именно плох токен, значит помогать подбирать.
      return ack("identity_rejected", requestId, {
        updateId: event.updateId,
        chatId: event.chatId,
      });
    }
  }

  // Группа. Право подключить чат проверяется в Telegram: обычный участник не
  // должен уметь привязать рабочий чат к своему проекту. База этого знать не
  // может — это работа транспорта.
  const membership = await bot.getChatMember({
    chatId: event.chatId,
    userId: event.senderId,
  });
  if (!membership.ok || !isChatAdministrator(membership.result)) {
    return ack("binding_rejected", requestId, {
      updateId: event.updateId,
      chatId: event.chatId,
    });
  }

  try {
    await port.activateProjectBinding({
      nonceDigest: digest,
      externalUserId: event.senderId,
      botInstanceId,
      chatId: event.chatId,
      chatType: event.chatType,
      noticeVersion: GROUP_NOTICE_VERSION,
    });
  } catch {
    return ack("binding_rejected", requestId, {
      updateId: event.updateId,
      chatId: event.chatId,
    });
  }

  // Уведомление о сборе данных публикуется сразу и не блокирует подключение:
  // связь уже создана, а неотправленное сообщение — повод повторить, не повод
  // откатить. Юридическим закрытием 152-ФЗ это уведомление не является (A7
  // §1.11), и обещать обратное здесь нечем.
  await bot.sendMessage({ chatId: event.chatId, text: renderGroupNotice() });

  return ack("binding_activated", requestId, {
    updateId: event.updateId,
    chatId: event.chatId,
  });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  if (!isTelegramBridgeEnabled()) {
    // Выключенный мост не существует для внешнего мира. 404, а не 403: «здесь
    // ничего нет» честнее, чем «здесь что-то есть, но вам нельзя».
    logTelegramBridgeEvent({ outcome: "ignored_bridge_disabled", requestId });
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const credentials = readTelegramCredentials();
  if (!credentials.ok) {
    logTelegramBridgeEvent({ outcome: "ignored_bridge_disabled", requestId });
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (
    !isAuthenticTelegramWebhook(
      request.headers.get(TELEGRAM_WEBHOOK_SECRET_HEADER),
      credentials.credentials.webhookSecret,
    )
  ) {
    logTelegramBridgeEvent({ outcome: "ignored_bad_secret", requestId });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await readBoundedBody(request);
  if (!body.ok) {
    logTelegramBridgeEvent({ outcome: "ignored_oversized", requestId });
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = telegramUpdateSchema.safeParse(body.value);
  if (!parsed.success) {
    // Форма не наша — но это Telegram (секрет сошёлся). Отвечаем 200, иначе
    // он будет повторять её вечно.
    return ack("ignored_malformed", requestId);
  }

  const event = normalizeTelegramUpdate(parsed.data);
  if (event === null) {
    return ack("ignored_unknown_update", requestId, { updateId: parsed.data.update_id });
  }

  const port = new TelegramSystemPort(createAdminClient());
  const bot = new TelegramBotApi(credentials.credentials.botToken);
  const botInstanceId = credentials.credentials.botInstanceId;

  try {
    if (event.startPayload !== null) {
      return await handleHandshake(event, port, bot, botInstanceId, requestId);
    }

    if (event.kind === "my_chat_member" && event.botRemoved) {
      // Бота выкинули из группы. Связь приостанавливается, невыполненные
      // уведомления отменяются: слать в чат, где бота нет, — это очередь,
      // которая никогда не разберётся.
      await port.suspendProjectBinding({
        botInstanceId,
        chatId: event.chatId,
        reason: "bot_removed_from_chat",
      });
      return ack("binding_suspended", requestId, {
        updateId: event.updateId,
        chatId: event.chatId,
      });
    }

    if (!isGroupChat(event.chatType)) {
      // Личная переписка с ботом содержимым проекта не является. Хранить её
      // значило бы завести вторую истину рядом с проектной.
      return ack("ignored_not_group", requestId, {
        updateId: event.updateId,
        chatId: event.chatId,
      });
    }

    const result = await port.ingestChannelUpdate({
      botInstanceId,
      updateId: event.updateId,
      chatId: event.chatId,
      messageId: event.messageId,
      eventKind: event.kind,
      senderId: event.senderId,
      sentAt: event.sentAt,
      replyToMessageId: event.replyToMessageId,
      forwardOriginKind: event.forwardOriginKind,
      payload: event.payload,
    });

    if (!result.stored) {
      return ack("ignored_chat_not_bound", requestId, {
        updateId: event.updateId,
        chatId: event.chatId,
      });
    }
    return ack(result.duplicate === true ? "duplicate" : "stored", requestId, {
      updateId: event.updateId,
      chatId: event.chatId,
    });
  } catch (error) {
    logTelegramBridgeEvent({
      outcome: "internal_error",
      requestId,
      updateId: event.updateId,
      chatRef: chatRef(event.chatId),
      failureCode: error instanceof TelegramChannelRpcError ? error.failureCode : "unexpected",
    });
    // Единственный случай, когда повтор Telegram желателен: сломались мы.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
