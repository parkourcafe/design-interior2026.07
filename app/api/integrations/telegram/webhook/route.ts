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
  type PendingNoticeLookup,
} from "@/lib/integration-gateway/telegram/channel-port";
import {
  extractBotUserId,
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

/**
 * Наш сбой, а не отказ по смыслу: `503` просит Telegram доставить это же
 * обновление снова.
 *
 * Разница между этим ответом и `200` — не косметика. `200` означает «разобрались,
 * больше не приноси»; сказать так на упавшей базе или на 429 от Telegram значит
 * потерять событие молча и оставить связь висеть до следующего случайного
 * сообщения в чате. Именно так вело себя предыдущее поведение.
 */
function retryLater(
  failureCode: string,
  requestId: string,
  event: NormalizedChannelUpdate,
): Response {
  logTelegramBridgeEvent({
    outcome: "internal_error",
    requestId,
    updateId: event.updateId,
    chatRef: chatRef(event.chatId),
    failureCode,
  });
  return NextResponse.json(
    { ok: false },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
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
/**
 * Постоянный ли это отказ базы.
 *
 * Разделение существенное, а не косметическое. Постоянный отказ — решение:
 * права отозвали, чат занят, аргумент неверен. Транзиентный — наш сбой:
 * `rpc_failed`, `envelope_invalid`, `shape_invalid`, сеть. Выдать второе за
 * первое значит ответить Telegram «разобрались» на упавшей базе и потерять
 * событие молча — ровно то, что делала прежняя редакция.
 */
function isPermanentRpcFailure(error: unknown): boolean {
  if (!(error instanceof TelegramChannelRpcError)) return false;
  return ["P1103", "P1109", "P1111", "P1104"].includes(error.failureCode);
}

/** Связь, ожидающая публикации уведомления. */
interface PendingNotice {
  readonly bindingId: string;
  readonly noticeVersion: string;
  readonly initiatorExternalUserId: number | null;
}

/**
 * Опубликовать уведомление и довести КОНКРЕТНУЮ связь до `active`.
 *
 * Принимает связь аргументом, а не ищет её сам. На первой попытке передаётся
 * `bindingId`, вернувшийся из `activateProjectBinding`: искать «последнюю
 * pending» вместо точного идентификатора значит на ровном месте допустить
 * работу с чужой связью.
 *
 * ПОРЯДОК: оба администраторства проверяются ДО отправки. Иначе на каждом
 * обновлении в группу уходило бы уведомление, которое всё равно не будет
 * финализировано, — повтор без конца и без результата.
 */
async function publishNoticeAndFinalize(
  pending: PendingNotice,
  event: NormalizedChannelUpdate,
  port: TelegramSystemPort,
  bot: TelegramBotApi,
  requestId: string,
): Promise<Response> {
  const terminate = async (
    disposition: "suspended" | "revoked",
    reason: string,
  ): Promise<Response> => {
    // Постоянный отказ ЗАКАНЧИВАЕТ попытку. Без этого связь оставалась бы
    // `notice_pending` навсегда, а группа получала бы повтор уведомления на
    // каждом сообщении.
    //
    // Исход выбирается по природе причины: `suspended` — внешняя и поправимая
    // (понизили, выкинули), `revoked` — полномочий больше нет вовсе. Оба
    // освобождают чат и проект, но на экране это разные слова.
    try {
      const outcome = await port.terminatePendingBinding({
        bindingId: pending.bindingId,
        disposition,
        reason,
      });
      // `terminated: false` — НЕ успех. База говорит «закрывать было нечего»:
      // связь уже в другом состоянии, и наш вывод о ней устарел. Ответить
      // «разобрались» значило бы закрепить решение, принятое по прошлому
      // состоянию; 503 просит принести это же событие снова и перечитать.
      if (!outcome.terminated) {
        return retryLater("terminate_not_applied", requestId, event);
      }
    } catch {
      // Терминализация не удалась — это наш сбой, и связь ещё жива.
      return retryLater("terminate_failed", requestId, event);
    }
    return ack("binding_rejected", requestId, {
      updateId: event.updateId,
      chatId: event.chatId,
    });
  };

  if (pending.initiatorExternalUserId === null) {
    // Связь личности инициатора отозвана — восстановить нечем.
    return terminate("revoked", "initiator_identity_revoked");
  }

  const identity = await resolveBotUserId(bot);
  if (identity.kind === "transient") {
    return retryLater(`bot_identity_${identity.failureCode}`, requestId, event);
  }
  if (identity.kind === "permanent") {
    // Токен отозван или бот заблокирован. Связь ждёт того, чего уже не будет.
    return terminate("suspended", "bot_identity_refused");
  }
  const botUserId = identity.botUserId;

  const [initiatorMembership, botMembership] = await Promise.all([
    bot.getChatMember({ chatId: event.chatId, userId: pending.initiatorExternalUserId }),
    bot.getChatMember({ chatId: event.chatId, userId: botUserId }),
  ]);
  for (const outcome of [initiatorMembership, botMembership]) {
    if (!outcome.ok && outcome.retryable) {
      return retryLater("membership_lookup_failed", requestId, event);
    }
  }
  if (!initiatorMembership.ok || !isChatAdministrator(initiatorMembership.result)) {
    return terminate("suspended", "initiator_not_chat_admin");
  }
  if (!botMembership.ok || !isChatAdministrator(botMembership.result)) {
    return terminate("suspended", "bot_not_chat_admin");
  }

  // Юридическим закрытием 152-ФЗ это уведомление не является (A7 §1.11).
  const notice = await bot.sendMessage({ chatId: event.chatId, text: renderGroupNotice() });
  if (!notice.ok) {
    return notice.retryable
      ? retryLater("notice_send_failed", requestId, event)
      : terminate("suspended", "notice_delivery_refused");
  }

  try {
    await port.markChannelNoticePosted({
      bindingId: pending.bindingId,
      noticeVersion: pending.noticeVersion || GROUP_NOTICE_VERSION,
      initiatorIsChatAdmin: true,
      botIsChatAdmin: true,
    });
  } catch (error) {
    // Сообщение УЖЕ ушло. Транзиентный сбой обязан привести к повтору, иначе
    // связь останется мёртвой при опубликованном уведомлении.
    if (!isPermanentRpcFailure(error)) {
      return retryLater("notice_finalize_failed", requestId, event);
    }
    return terminate("revoked", "finalization_refused");
  }

  return ack("binding_activated", requestId, {
    updateId: event.updateId,
    chatId: event.chatId,
  });
}

/** Идентификатор бота в Telegram. Нужен, чтобы спросить о его собственных правах. */
/**
 * Кто сам бот — и ПОЧЕМУ не удалось узнать, если не удалось.
 *
 * Схлопывать оба вида отказа в `null` нельзя: `429` и `500` просят прийти
 * снова, а `401` (токен отозван) и `403` повтором не лечатся никогда. Один
 * ответ на оба означал бы либо вечный повтор на мёртвом токене, либо потерю
 * события на живом.
 */
type BotIdentity =
  | { readonly kind: "ok"; readonly botUserId: number }
  | { readonly kind: "transient"; readonly failureCode: string }
  | { readonly kind: "permanent"; readonly failureCode: string };

async function resolveBotUserId(bot: TelegramBotApi): Promise<BotIdentity> {
  const identity = await bot.getMe();
  if (!identity.ok) {
    return {
      kind: identity.retryable ? "transient" : "permanent",
      failureCode: identity.failureCode,
    };
  }
  const botUserId = extractBotUserId(identity.result);
  // Ответ принят, но формы не той: это наша поломка или изменившийся контракт,
  // и повтор здесь уместен.
  if (botUserId === null) {
    return { kind: "transient", failureCode: "bot_identity_malformed" };
  }
  return { kind: "ok", botUserId };
}

/**
 * Рукопожатие в ЛИЧНОМ чате: связывание Telegram-аккаунта с человеком.
 */
async function handlePrivateHandshake(
  event: NormalizedChannelUpdate,
  port: TelegramSystemPort,
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

  try {
    await port.consumeIdentityLinkIntent({
      nonceDigest: digest,
      externalUserId: event.senderId,
    });
    return ack("identity_linked", requestId, {
      updateId: event.updateId,
      chatId: event.chatId,
    });
  } catch (error) {
    // Просроченное, потраченное или чужое намерение — окончательный отказ.
    // Упавшая база — нет, и выдавать её за отказ нельзя.
    if (!isPermanentRpcFailure(error)) {
      return retryLater("identity_consume_failed", requestId, event);
    }
    return ack("identity_rejected", requestId, {
      updateId: event.updateId,
      chatId: event.chatId,
    });
  }
}

/**
 * Рукопожатие в ГРУППЕ: создание связи по одноразовому секрету.
 *
 * Зовётся ТОЛЬКО когда ожидающей связи у чата нет. Порядок задан в POST и
 * является контрактом: повтор того же `/start` после сбоя обязан попасть в
 * восстановление существующей связи, а не во второй `consume` уже потраченного
 * секрета. Прежняя редакция проверяла `/start` первой и отвечала на такой
 * повтор `200 binding_rejected` — связь оставалась мёртвой навсегда.
 */
async function handleGroupHandshake(
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

  const identity = await resolveBotUserId(bot);
  if (identity.kind === "transient") {
    return retryLater(`bot_identity_${identity.failureCode}`, requestId, event);
  }
  if (identity.kind === "permanent") {
    // Связи ещё нет — терминализировать нечего, и создавать её нельзя: иначе
    // остался бы осиротевший `notice_pending` под мёртвым токеном.
    return ack("binding_rejected", requestId, {
      updateId: event.updateId,
      chatId: event.chatId,
    });
  }
  const botUserId = identity.botUserId;

  const [initiatorMembership, botMembership] = await Promise.all([
    bot.getChatMember({ chatId: event.chatId, userId: event.senderId }),
    bot.getChatMember({ chatId: event.chatId, userId: botUserId }),
  ]);
  for (const outcome of [initiatorMembership, botMembership]) {
    if (!outcome.ok && outcome.retryable) {
      return retryLater("membership_lookup_failed", requestId, event);
    }
  }
  const initiatorIsChatAdmin =
    initiatorMembership.ok && isChatAdministrator(initiatorMembership.result);
  const botIsChatAdmin = botMembership.ok && isChatAdministrator(botMembership.result);
  if (!initiatorIsChatAdmin || !botIsChatAdmin) {
    // Связи ещё нет — терминализировать нечего, отказ окончательный.
    return ack("binding_rejected", requestId, {
      updateId: event.updateId,
      chatId: event.chatId,
    });
  }

  let bindingId: string;
  try {
    // Связь создаётся в состоянии `notice_pending`: приём ещё НЕ открыт.
    const activated = await port.activateProjectBinding({
      nonceDigest: digest,
      externalUserId: event.senderId,
      botInstanceId,
      chatId: event.chatId,
      chatType: event.chatType,
      noticeVersion: GROUP_NOTICE_VERSION,
      initiatorIsChatAdmin,
      botIsChatAdmin,
    });
    bindingId = activated.bindingId;
  } catch (error) {
    if (!isPermanentRpcFailure(error)) {
      return retryLater("activation_failed", requestId, event);
    }
    return ack("binding_rejected", requestId, {
      updateId: event.updateId,
      chatId: event.chatId,
    });
  }

  // ТОЧНЫЙ идентификатор, вернувшийся из активации. Не «последняя pending».
  return publishNoticeAndFinalize(
    {
      bindingId,
      noticeVersion: GROUP_NOTICE_VERSION,
      initiatorExternalUserId: event.senderId,
    },
    event,
    port,
    bot,
    requestId,
  );
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
      // В личном чате возможно только связывание аккаунта. Всё остальное —
      // не содержимое проекта: хранить его значило бы завести вторую истину
      // рядом с проектной.
      if (event.startPayload !== null) {
        return await handlePrivateHandshake(event, port, requestId);
      }
      return ack("ignored_not_group", requestId, {
        updateId: event.updateId,
        chatId: event.chatId,
      });
    }

    // ПОРЯДОК ДЛЯ ГРУППЫ — ЧАСТЬ КОНТРАКТА.
    //
    // 1. Есть ли у чата связь, ожидающая уведомления. 2. Только если нет —
    // новый `/start <nonce>`. 3. Только потом приём.
    //
    // Обратный порядок и был центральной поломкой: повтор ТОГО ЖЕ `/start`
    // после сбоя уходил во второй `consume` уже потраченного секрета, получал
    // отказ и отвечал `200 binding_rejected`. Связь оставалась `notice_pending`
    // навсегда, а восстановить её было нечем.
    //
    // Событие, потраченное на восстановление, НЕ сохраняется: участники группы
    // ещё не предупреждены (A7 §6).
    let lookup: PendingNoticeLookup;
    try {
      lookup = await port.findPendingNoticeBinding({
        botInstanceId,
        chatId: event.chatId,
      });
    } catch {
      return retryLater("notice_lookup_failed", requestId, event);
    }

    if (lookup.chatHeldByOtherBot) {
      // Чат занят ожидающей связью другого экземпляра бота. Ни доделывать, ни
      // заводить свою: и то и другое нарушило бы «одна живая связь на чат».
      return ack("binding_rejected", requestId, {
        updateId: event.updateId,
        chatId: event.chatId,
      });
    }

    if (lookup.binding !== null) {
      return await publishNoticeAndFinalize(lookup.binding, event, port, bot, requestId);
    }

    if (event.startPayload !== null) {
      return await handleGroupHandshake(event, port, bot, botInstanceId, requestId);
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
