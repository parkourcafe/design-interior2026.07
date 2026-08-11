/**
 * Нормализация входящего Telegram update (A7 / DEC-031, гейт TG2).
 *
 * Здесь нет ни сети, ни базы — только детерминированный разбор: из недоверенного
 * JSON получается `NormalizedUpdate` либо внятная причина отказа. Отделено
 * намеренно: всё, на чём держатся «повтор даёт один event», «правка даёт новую
 * ревизию» и «неподдерживаемое не роняет вебхук», проверяется юнит-тестом без
 * стека.
 *
 * ЧТО ЗДЕСЬ СЧИТАЕТСЯ НЕДОВЕРЕННЫМ: всё. Размер и MIME вложения приходят от
 * клиента отправителя; время сообщения ставит сервер Telegram, а не мы; текст
 * может быть чем угодно, включая попытку выдать себя за команду. Ни одно из этих
 * значений не становится решением — только записью.
 *
 * ЧЕГО ЗДЕСЬ НЕТ: LLM, скачивания файлов, бизнес-команд. Разбор обязан быть
 * дешёвым и синхронным — он выполняется внутри HTTP-запроса Telegram, у которого
 * есть таймаут.
 */

import { z } from "zod";

/** Схема извлечения: версия участвует в идемпотентности кандидата. */
export const TELEGRAM_EXTRACTION_SCHEMA_VERSION = "telegram-extract/0.1" as const;

/**
 * Bot API отдаёт файлы не больше 20 МБ через `getFile`. Это ограничение
 * Telegram, а не наше: файл крупнее не «медленно скачается», он не скачается
 * никогда. Поэтому для него сразу создаётся плейсхолдер.
 */
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Типы update, которые мост принимает. Всё остальное — не ошибка отправителя и
 * не наша: подлинный, но неподдерживаемый update обязан получить `2xx` и уйти в
 * dead letter, иначе Telegram будет повторять его вечно.
 */
export const SUPPORTED_UPDATE_KINDS = [
  "message",
  "edited_message",
  "my_chat_member",
  "chat_member",
  "callback_query",
] as const;

export type TelegramUpdateKind = (typeof SUPPORTED_UPDATE_KINDS)[number];

const chatSchema = z.object({
  id: z.number().int(),
  type: z.string().min(1).max(32),
}).passthrough();

const userSchema = z.object({
  id: z.number().int().positive(),
  is_bot: z.boolean().optional(),
}).passthrough();

const photoSizeSchema = z.object({
  file_id: z.string().min(1).max(400),
  file_unique_id: z.string().min(1).max(200),
  file_size: z.number().int().nonnegative().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
}).passthrough();

const documentSchema = z.object({
  file_id: z.string().min(1).max(400),
  file_unique_id: z.string().min(1).max(200),
  file_size: z.number().int().nonnegative().optional(),
  mime_type: z.string().max(200).optional(),
}).passthrough();

const voiceSchema = z.object({
  file_id: z.string().min(1).max(400),
  file_unique_id: z.string().min(1).max(200),
  file_size: z.number().int().nonnegative().optional(),
  mime_type: z.string().max(200).optional(),
  duration: z.number().int().nonnegative().optional(),
}).passthrough();

const messageSchema = z.object({
  message_id: z.number().int(),
  date: z.number().int().nonnegative(),
  chat: chatSchema,
  from: userSchema.optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  photo: z.array(photoSizeSchema).optional(),
  document: documentSchema.optional(),
  voice: voiceSchema.optional(),
  reply_to_message: z.object({ message_id: z.number().int() }).passthrough().optional(),
  forward_origin: z.object({ type: z.string().max(32), date: z.number().int().optional() })
    .passthrough().optional(),
}).passthrough();

const chatMemberUpdateSchema = z.object({
  chat: chatSchema,
  from: userSchema.optional(),
  date: z.number().int().nonnegative(),
  new_chat_member: z.object({ status: z.string().max(32) }).passthrough(),
  old_chat_member: z.object({ status: z.string().max(32) }).passthrough().optional(),
}).passthrough();

/**
 * Верхний уровень намеренно `strict()` в части, которую мы читаем, и
 * `passthrough()` внутри: Telegram добавляет поля без предупреждения, и падать
 * от нового поля значило бы перестать принимать переписку в день, когда его
 * добавят.
 */
export const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: messageSchema.optional(),
  edited_message: messageSchema.optional(),
  my_chat_member: chatMemberUpdateSchema.optional(),
  chat_member: chatMemberUpdateSchema.optional(),
  callback_query: z.object({
    id: z.string().min(1).max(200),
    from: userSchema,
    data: z.string().max(200).optional(),
    message: z.object({
      message_id: z.number().int(),
      chat: chatSchema,
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface NormalizedAttachment {
  readonly kind: "photo" | "document" | "voice";
  readonly externalFileId: string;
  readonly externalFileUniqueId: string;
  /** Недоверенные метаданные: их присылает клиент отправителя. */
  readonly declaredSizeBytes: number | null;
  readonly declaredMediaType: string | null;
  /**
   * Начальный статус. Не «чистый» и не «в карантине» — статус до того, как
   * сервер вообще увидел байты. `too_large` ставится здесь, потому что решение
   * принимается по объявленному размеру ДО попытки скачивания.
   */
  readonly initialScanStatus: "pending" | "too_large";
  readonly initialScanReason: string | null;
}

export interface NormalizedUpdate {
  readonly updateId: number;
  readonly kind: TelegramUpdateKind;
  readonly externalChatId: string;
  readonly chatType: string;
  readonly externalMessageId: number | null;
  readonly externalActorId: string | null;
  /** Правка приходит отдельным `update_id`, но ревизией источника — второй. */
  readonly sourceRevision: number;
  readonly externalEventAt: string | null;
  readonly replyToMessageId: number | null;
  readonly forwardOriginKind: "user" | "hidden_user" | "chat" | "channel" | null;
  readonly forwardOriginAt: string | null;
  readonly textContent: string | null;
  readonly attachments: readonly NormalizedAttachment[];
  /**
   * Для `my_chat_member` / `chat_member`: во что превратились права бота. Ради
   * этого поля мы вообще принимаем эти два типа — по нему привязка уходит в
   * `suspended`.
   */
  readonly botMembershipStatus: string | null;
}

export type NormalizationResult =
  | { readonly ok: true; readonly update: NormalizedUpdate }
  /**
   * `malformed` — тело не похоже на update Telegram вовсе. `unsupported` —
   * подлинный update, которого мост не понимает. Разные исходы намеренно: первый
   * заслуживает отказа, второй — тихого `2xx` и dead letter, иначе Telegram
   * будет повторять его до скончания времён.
   */
  | { readonly ok: false; readonly reason: "malformed" | "unsupported"; readonly code: string };

function toIso(unixSeconds: number | undefined): string | null {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) return null;
  // Секунды Telegram → миллисекунды. Отрицательное и абсурдно большое время
  // отбрасывается: это метаданные, а не источник истины.
  if (unixSeconds < 0 || unixSeconds > 4_102_444_800) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

function forwardKind(value: string | undefined): NormalizedUpdate["forwardOriginKind"] {
  if (value === "user" || value === "hidden_user" || value === "chat" || value === "channel") {
    return value;
  }
  return null;
}

function attachmentsOf(message: z.infer<typeof messageSchema>): readonly NormalizedAttachment[] {
  const result: NormalizedAttachment[] = [];

  const push = (
    kind: NormalizedAttachment["kind"],
    file: { file_id: string; file_unique_id: string; file_size?: number; mime_type?: string },
  ): void => {
    const declaredSize = typeof file.file_size === "number" ? file.file_size : null;
    // Решение по ОБЪЯВЛЕННОМУ размеру принимается до скачивания намеренно: файл
    // больше лимита Bot API не скачается никогда, и пытаться — значит тратить
    // время на заведомо невозможное. Это не проверка подлинности размера:
    // фактический размер сервер всё равно считает сам, когда файл приходит.
    const tooLarge = declaredSize !== null && declaredSize > TELEGRAM_MAX_DOWNLOAD_BYTES;
    result.push({
      kind,
      externalFileId: file.file_id,
      externalFileUniqueId: file.file_unique_id,
      declaredSizeBytes: declaredSize,
      declaredMediaType: typeof file.mime_type === "string" ? file.mime_type : null,
      initialScanStatus: tooLarge ? "too_large" : "pending",
      initialScanReason: tooLarge ? "exceeds_bot_api_limit" : null,
    });
  };

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    // Telegram отдаёт лестницу размеров одного изображения. Берём самый крупный:
    // остальные — то же фото хуже качеством, и заводить под них отдельные
    // вложения значило бы размножать один файл.
    const largest = [...message.photo].sort(
      (left, right) => (right.file_size ?? 0) - (left.file_size ?? 0),
    )[0]!;
    push("photo", largest);
  }
  if (message.document) push("document", message.document);
  // Голосовое принимается ТОЛЬКО метаданными: транскрипция не входит в P0
  // (A7 §12), и текста у такого события не будет.
  if (message.voice) push("voice", message.voice);

  return result;
}

function normalizeMessage(
  update: TelegramUpdate,
  message: z.infer<typeof messageSchema>,
  kind: "message" | "edited_message",
): NormalizationResult {
  const text = message.text ?? message.caption ?? null;
  return {
    ok: true,
    update: {
      updateId: update.update_id,
      kind,
      externalChatId: String(message.chat.id),
      chatType: message.chat.type,
      externalMessageId: message.message_id,
      // Сообщение может прийти без автора (например, от имени канала). Это не
      // повод отказать: событие сохраняется, а кандидат по нему будет
      // `unverified`.
      externalActorId: message.from ? String(message.from.id) : null,
      // Правка — вторая ревизия ТОГО ЖЕ источника. Номер ревизии не растёт
      // дальше двух намеренно: Telegram не нумерует правки, и выдумывать
      // порядковый номер значило бы выдавать догадку за факт. Уникальность
      // `(binding, chat, message, revision)` при повторной правке отобьёт
      // запись, и это честнее, чем накапливать ревизии из воздуха.
      sourceRevision: kind === "edited_message" ? 2 : 1,
      externalEventAt: toIso(message.date),
      replyToMessageId: message.reply_to_message?.message_id ?? null,
      forwardOriginKind: forwardKind(message.forward_origin?.type),
      forwardOriginAt: toIso(message.forward_origin?.date),
      textContent: text !== null && text.trim() !== "" ? text.slice(0, 16_384) : null,
      attachments: attachmentsOf(message),
      botMembershipStatus: null,
    },
  };
}

export function normalizeTelegramUpdate(body: unknown): NormalizationResult {
  const parsed = telegramUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, reason: "malformed", code: "update_schema_invalid" };
  }
  const update = parsed.data;

  if (update.message) return normalizeMessage(update, update.message, "message");
  if (update.edited_message) {
    return normalizeMessage(update, update.edited_message, "edited_message");
  }

  const membership = update.my_chat_member ?? update.chat_member;
  if (membership) {
    return {
      ok: true,
      update: {
        updateId: update.update_id,
        kind: update.my_chat_member ? "my_chat_member" : "chat_member",
        externalChatId: String(membership.chat.id),
        chatType: membership.chat.type,
        externalMessageId: null,
        externalActorId: membership.from ? String(membership.from.id) : null,
        sourceRevision: 1,
        externalEventAt: toIso(membership.date),
        replyToMessageId: null,
        forwardOriginKind: null,
        forwardOriginAt: null,
        textContent: null,
        attachments: [],
        botMembershipStatus: membership.new_chat_member.status,
      },
    };
  }

  if (update.callback_query) {
    const chat = update.callback_query.message?.chat;
    return {
      ok: true,
      update: {
        updateId: update.update_id,
        kind: "callback_query",
        externalChatId: chat ? String(chat.id) : "",
        chatType: chat?.type ?? "unknown",
        externalMessageId: update.callback_query.message?.message_id ?? null,
        externalActorId: String(update.callback_query.from.id),
        sourceRevision: 1,
        externalEventAt: null,
        replyToMessageId: null,
        forwardOriginKind: null,
        forwardOriginAt: null,
        // Содержимое callback НЕ сохраняется как текст сообщения: оно ничего не
        // говорит о проекте, а официального действия не выполняет никогда
        // (A7 §3). Событие принимается только чтобы ответить кнопке.
        textContent: null,
        attachments: [],
        botMembershipStatus: null,
      },
    };
  }

  return { ok: false, reason: "unsupported", code: "update_kind_unsupported" };
}

/**
 * Статусы, при которых бот перестаёт быть полноправным участником группы. Любой
 * из них переводит привязку в `suspended`: удалили, ограничили, понизили — во
 * всех трёх случаях полный приём больше невозможен, и делать вид, что он
 * работает, нельзя.
 */
export function suspendsBinding(status: string | null): boolean {
  return status === "left" || status === "kicked" || status === "restricted"
    || status === "member";
}

/**
 * Токен `/start` и `/startgroup`. Telegram кладёт его первым аргументом команды.
 * Алфавит ограничен ровно тем, что разрешает Telegram (A-Z a-z 0-9 _ -), а
 * длина — тем, что помещается в 64 символа его лимита.
 */
export function extractStartToken(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/^\/start(?:group)?(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{16,64})\s*$/);
  return match?.[1] ?? null;
}
