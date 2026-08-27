import { createHash } from "node:crypto";
import { digestTelegramOpaque } from "./security";

export interface TelegramAttachmentEnvelope {
  readonly providerFileIdDigest: string;
  readonly displayName: string | null;
  readonly mediaType: string | null;
  readonly sizeBytes: number | null;
}

export interface NormalizedTelegramUpdate {
  readonly updateId: string;
  readonly chatId: string;
  readonly messageId: string | null;
  readonly senderId: string | null;
  readonly textDigest: string | null;
  readonly attachments: readonly TelegramAttachmentEnvelope[];
}

function integerString(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^-?[0-9]{1,20}$/u.test(value)) return value;
  return null;
}

function digestText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0
    ? createHash("sha256").update(value, "utf8").digest("hex")
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeTelegramUpdate(input: Record<string, unknown>): NormalizedTelegramUpdate {
  const updateId = integerString(input.update_id);
  const message = asRecord(input.message) ?? asRecord(input.edited_message) ?? asRecord(input.channel_post);
  const chat = asRecord(message?.chat);
  const sender = asRecord(message?.from);
  const chatId = integerString(chat?.id);
  if (!updateId || !message || !chatId) throw new Error("telegram_update_shape_invalid");

  const attachments: TelegramAttachmentEnvelope[] = [];
  const document = asRecord(message.document);
  if (document) {
    const fileId = typeof document.file_id === "string" ? document.file_id : null;
    if (fileId) {
      attachments.push({
        providerFileIdDigest: digestTelegramOpaque(fileId),
        displayName: typeof document.file_name === "string" ? document.file_name : null,
        mediaType: typeof document.mime_type === "string" ? document.mime_type : null,
        sizeBytes: typeof document.file_size === "number" && Number.isSafeInteger(document.file_size)
          ? document.file_size
          : null,
      });
    }
  }
  const photos = Array.isArray(message.photo) ? message.photo : [];
  const photo = asRecord(photos.at(-1));
  const photoFileId = typeof photo?.file_id === "string" ? photo.file_id : null;
  if (photoFileId) {
    attachments.push({
      providerFileIdDigest: digestTelegramOpaque(photoFileId),
      displayName: null,
      mediaType: "image/jpeg",
      sizeBytes: typeof photo?.file_size === "number" && Number.isSafeInteger(photo.file_size)
        ? photo.file_size
        : null,
    });
  }

  return {
    updateId,
    chatId,
    messageId: integerString(message.message_id),
    senderId: integerString(sender?.id),
    textDigest: digestText(message.text ?? message.caption),
    attachments,
  };
}
