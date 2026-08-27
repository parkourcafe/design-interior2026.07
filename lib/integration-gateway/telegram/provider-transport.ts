import { createHash } from "node:crypto";
import { z } from "zod";
import type { NormalizedTelegramUpdate } from "./contracts";
import type { TelegramWorkerAttachment } from "./worker";

const TELEGRAM_API_RESPONSE_MAX_BYTES = 64 * 1024;
const TELEGRAM_FILE_MAX_BYTES = 50 * 1024 * 1024;

const fileInfoSchema = z.object({
  ok: z.literal(true),
  result: z.object({ file_path: z.string().min(1).max(1024) }).strict(),
}).strict();

export class TelegramProviderError extends Error {
  constructor(readonly code: "credentials_required" | "provider_unavailable" | "response_invalid" | "file_too_large") {
    super(`telegram_provider_${code}`);
    this.name = "TelegramProviderError";
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedFilePath(value: string): string {
  if (
    value.length > 1024
    || /[\u0000-\u001f\u007f]/u.test(value)
    || value.includes("..")
    || !/^[A-Za-z0-9_./-]+$/u.test(value)
  ) throw new TelegramProviderError("response_invalid");
  return value;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length")?.trim();
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > TELEGRAM_API_RESPONSE_MAX_BYTES)) {
    throw new TelegramProviderError("response_invalid");
  }
  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > TELEGRAM_API_RESPONSE_MAX_BYTES) {
    throw new TelegramProviderError("response_invalid");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new TelegramProviderError("response_invalid");
  }
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  const declared = response.headers.get("content-length")?.trim();
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > TELEGRAM_FILE_MAX_BYTES)) {
    throw new TelegramProviderError("file_too_large");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > TELEGRAM_FILE_MAX_BYTES) throw new TelegramProviderError("file_too_large");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > TELEGRAM_FILE_MAX_BYTES) throw new TelegramProviderError("file_too_large");
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

interface TelegramFileDescriptor {
  readonly fileId: string;
  readonly displayName: string | null;
  readonly mediaType: string | null;
  readonly sizeBytes: number | null;
  readonly sourceRole: TelegramWorkerAttachment["sourceRole"];
}

function descriptors(raw: Record<string, unknown>): TelegramFileDescriptor[] {
  const message = record(raw.message) ?? record(raw.edited_message) ?? record(raw.channel_post);
  if (!message) return [];
  const result: TelegramFileDescriptor[] = [];
  const document = record(message.document);
  if (document && typeof document.file_id === "string") {
    result.push({
      fileId: document.file_id,
      displayName: typeof document.file_name === "string" ? document.file_name : null,
      mediaType: typeof document.mime_type === "string" ? document.mime_type : null,
      sizeBytes: typeof document.file_size === "number" && Number.isSafeInteger(document.file_size)
        ? document.file_size
        : null,
      sourceRole: "document",
    });
  }
  const photos = Array.isArray(message.photo) ? message.photo : [];
  const photo = record(photos.at(-1));
  if (photo && typeof photo.file_id === "string") {
    result.push({
      fileId: photo.file_id,
      displayName: null,
      mediaType: "image/jpeg",
      sizeBytes: typeof photo.file_size === "number" && Number.isSafeInteger(photo.file_size)
        ? photo.file_size
        : null,
      sourceRole: "photo-evidence",
    });
  }
  return result;
}

export class TelegramProviderTransport {
  private readonly token: string;

  constructor(
    tokenInput: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const token = tokenInput?.trim() ?? "";
    if (token.length < 16 || token.length > 256 || /[\u0000-\u001f\u007f]/u.test(token)) {
      throw new TelegramProviderError("credentials_required");
    }
    this.token = token;
  }

  async downloadAttachments(input: {
    readonly raw: Record<string, unknown>;
    readonly update: NormalizedTelegramUpdate;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<TelegramWorkerAttachment[]> {
    const entries = descriptors(input.raw);
    if (entries.length !== input.update.attachments.length) {
      throw new TelegramProviderError("response_invalid");
    }
    const attachments: TelegramWorkerAttachment[] = [];
    for (const entry of entries) {
      const infoUrl = `https://api.telegram.org/bot${this.token}/getFile?file_id=${encodeURIComponent(entry.fileId)}`;
      const infoResponse = await this.fetchImpl(infoUrl);
      if (!infoResponse.ok) throw new TelegramProviderError("provider_unavailable");
      const fileInfo = fileInfoSchema.safeParse(await boundedJson(infoResponse));
      if (!fileInfo.success) throw new TelegramProviderError("response_invalid");
      const path = boundedFilePath(fileInfo.data.result.file_path);
      const fileResponse = await this.fetchImpl(`https://api.telegram.org/file/bot${this.token}/${path}`);
      if (!fileResponse.ok) throw new TelegramProviderError("provider_unavailable");
      const bytes = await boundedBytes(fileResponse);
      if (entry.sizeBytes !== null && entry.sizeBytes !== bytes.byteLength) {
        throw new TelegramProviderError("response_invalid");
      }
      const checksumHex = digestBytes(bytes);
      attachments.push({
        providerFileIdDigest: digest(entry.fileId),
        displayName: entry.displayName,
        mediaType: entry.mediaType,
        sizeBytes: entry.sizeBytes ?? bytes.byteLength,
        bytes,
        checksumHex,
        quarantineObjectKey:
          `project-intelligence/ru/${input.organizationId}/${input.projectId}/quarantine/telegram/` +
          `${checksumHex}/${entry.sourceRole}`,
        sourceRole: entry.sourceRole,
      });
    }
    return attachments;
  }
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
