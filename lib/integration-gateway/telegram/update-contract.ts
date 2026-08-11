import { z } from "zod";

/**
 * Разбор входящего Telegram Update.
 *
 * Тело webhook'а — текст из интернета. Заголовок-секрет доказывает, что запрос
 * пришёл от Telegram, и ничего не доказывает про форму: поля приходят от
 * отправителя сообщения. Поэтому схема описывает не «весь Bot API», а ровно то,
 * что мост умеет объяснить, а всё прочее пропускается как неизвестный вид.
 *
 * ЧТО МОСТ НЕ ДЕЛАЕТ С ТЕКСТОМ. Он его не исполняет. A7 §2.1 запрещает
 * выполнять команды из текста сообщения, и единственное исключение —
 * `/start <nonce>` рукопожатия подключения. Это не команда домена: nonce
 * создан авторизованным владельцем в интерфейсе RemHaOS, живёт 10 минут и
 * одноразов, а полномочия даёт не текст, а запись `channel_link_intents`.
 * Любой другой текст — кандидат и ничего больше.
 */

const chatSchema = z.object({
  id: z.number().int(),
  type: z.string().min(1).max(40),
});

const userSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
});

const messageSchema = z.object({
  message_id: z.number().int(),
  // Время источника намеренно принимается любым целым, а отбраковывается
  // ниже, в `toIso`. Запрет на уровне схемы отверг бы ВЕСЬ update из-за
  // странной даты — то есть выбросил бы настоящее сообщение проекта ради поля,
  // которому мы и так не доверяем.
  date: z.number().int().optional(),
  chat: chatSchema,
  from: userSchema.optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  reply_to_message: z.object({ message_id: z.number().int() }).optional(),
  // Форма источника пересылки нам нужна, содержимое — нет.
  forward_origin: z.object({ type: z.string().min(1).max(40) }).optional(),
  photo: z.array(z.object({
    file_id: z.string().min(1),
    file_unique_id: z.string().min(1),
    file_size: z.number().int().nonnegative().optional(),
  })).optional(),
  document: z.object({
    file_id: z.string().min(1),
    file_unique_id: z.string().min(1),
    file_size: z.number().int().nonnegative().optional(),
    mime_type: z.string().max(200).optional(),
  }).optional(),
  voice: z.object({
    file_id: z.string().min(1),
    file_unique_id: z.string().min(1),
    file_size: z.number().int().nonnegative().optional(),
    mime_type: z.string().max(200).optional(),
  }).optional(),
  video: z.object({
    file_id: z.string().min(1),
    file_unique_id: z.string().min(1),
    file_size: z.number().int().nonnegative().optional(),
    mime_type: z.string().max(200).optional(),
  }).optional(),
});

const chatMemberUpdateSchema = z.object({
  chat: chatSchema,
  from: userSchema.optional(),
  date: z.number().int().optional(),
  new_chat_member: z.object({
    status: z.string().min(1).max(40),
    user: userSchema.optional(),
  }),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: messageSchema.optional(),
  edited_message: messageSchema.optional(),
  channel_post: messageSchema.optional(),
  my_chat_member: chatMemberUpdateSchema.optional(),
}).passthrough();

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export type TelegramEventKind =
  | "message"
  | "edited_message"
  | "my_chat_member";

export interface TelegramAttachmentRef {
  readonly kind: "photo" | "document" | "voice" | "video";
  readonly fileId: string;
  readonly fileUniqueId: string;
  readonly claimedSizeBytes: number | null;
  readonly claimedMediaType: string | null;
}

/**
 * Нормализованное событие. Ровно то, что принимает `ingest_channel_update`,
 * плюс то, что нужно транспорту для решения — и ни поля больше.
 */
export interface NormalizedChannelUpdate {
  readonly updateId: number;
  readonly kind: TelegramEventKind;
  readonly chatId: number;
  readonly chatType: string;
  readonly messageId: number;
  readonly senderId: number | null;
  /** ISO-8601 или null. Время источника, доверия не заслуживает. */
  readonly sentAt: string | null;
  readonly replyToMessageId: number | null;
  readonly forwardOriginKind: string | null;
  /** Полезная нагрузка для БД. Текст сюда попадает, в логи — никогда. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attachments: readonly TelegramAttachmentRef[];
  /** `/start <nonce>` рукопожатия, если это именно оно. */
  readonly startPayload: string | null;
  /** Для `my_chat_member`: бот больше не участник. */
  readonly botRemoved: boolean;
}

const REMOVED_STATUSES = new Set(["left", "kicked", "banned"]);

function startPayloadOf(text: string | undefined): string | null {
  if (typeof text !== "string") return null;
  // `/start payload` и `/start@botname payload` — обе формы приходят из групп.
  const match = /^\/start(?:@[A-Za-z0-9_]{5,32})?\s+(\S{1,64})\s*$/.exec(text.trim());
  return match === null ? null : (match[1] ?? null);
}

function attachmentsOf(message: z.infer<typeof messageSchema>): TelegramAttachmentRef[] {
  const found: TelegramAttachmentRef[] = [];
  // Из набора размеров фотографии берётся последний — Telegram отдаёт их по
  // возрастанию, и наибольший ближе всего к оригиналу.
  const largestPhoto = message.photo?.[message.photo.length - 1];
  if (largestPhoto) {
    found.push({
      kind: "photo",
      fileId: largestPhoto.file_id,
      fileUniqueId: largestPhoto.file_unique_id,
      claimedSizeBytes: largestPhoto.file_size ?? null,
      claimedMediaType: null,
    });
  }
  for (const [kind, value] of [
    ["document", message.document],
    ["voice", message.voice],
    ["video", message.video],
  ] as const) {
    if (!value) continue;
    found.push({
      kind,
      fileId: value.file_id,
      fileUniqueId: value.file_unique_id,
      claimedSizeBytes: value.file_size ?? null,
      claimedMediaType: value.mime_type ?? null,
    });
  }
  return found;
}

function toIso(seconds: number | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isSafeInteger(seconds)) return null;
  const millis = seconds * 1000;
  // Отрицательное и запредельное время источника не сохраняется: Telegram
  // такого не шлёт, а `new Date` на нём молча выдаёт Invalid Date.
  if (millis < 0 || millis > 4102444800000) return null;
  return new Date(millis).toISOString();
}

function fromMessage(
  update: TelegramUpdate,
  message: z.infer<typeof messageSchema>,
  kind: "message" | "edited_message",
): NormalizedChannelUpdate {
  const text = message.text ?? message.caption;
  return {
    updateId: update.update_id,
    kind,
    chatId: message.chat.id,
    chatType: message.chat.type,
    messageId: message.message_id,
    senderId: message.from?.id ?? null,
    sentAt: toIso(message.date),
    replyToMessageId: message.reply_to_message?.message_id ?? null,
    forwardOriginKind: message.forward_origin?.type ?? null,
    payload: {
      kind,
      ...(typeof text === "string" ? { text } : {}),
      attachmentCount: attachmentsOf(message).length,
    },
    attachments: attachmentsOf(message),
    startPayload: startPayloadOf(text),
    botRemoved: false,
  };
}

/**
 * Возвращает null для всего, чего мост не понимает. Непонятое — не ошибка:
 * Telegram расширяет Update новыми полями, и падать на них значило бы
 * заставить Telegram повторять доставку до бесконечности.
 */
export function normalizeTelegramUpdate(
  update: TelegramUpdate,
): NormalizedChannelUpdate | null {
  if (update.message) return fromMessage(update, update.message, "message");
  if (update.edited_message) {
    return fromMessage(update, update.edited_message, "edited_message");
  }

  const membership = update.my_chat_member;
  if (membership) {
    const status = membership.new_chat_member.status;
    return {
      updateId: update.update_id,
      kind: "my_chat_member",
      chatId: membership.chat.id,
      chatType: membership.chat.type,
      // У членства нет сообщения. 0 — не идентификатор, а отметка «не
      // сообщение»: колонка обязательная, а выдумывать номер нельзя.
      messageId: 0,
      senderId: membership.from?.id ?? null,
      sentAt: toIso(membership.date),
      replyToMessageId: null,
      forwardOriginKind: null,
      payload: { kind: "my_chat_member", status },
      attachments: [],
      startPayload: null,
      botRemoved: REMOVED_STATUSES.has(status),
    };
  }

  return null;
}

/** Групповой чат — единственное место, где живёт рабочая переписка проекта. */
export function isGroupChat(chatType: string): boolean {
  return chatType === "group" || chatType === "supergroup";
}
