import { z } from "zod";

import type { ClaimedAttachment } from "./channel-port";
import type { TelegramCallOutcome } from "./bot-api";
import { FILE_INTAKE_MAX_BYTES, FileIntakePolicyError } from "../file-intake/policy";
import { validateUpload } from "../file-intake/service";
import type { ValidatedFileIntakeUpload } from "../file-intake/policy";

/**
 * Фоновая загрузка вложений Telegram (DEC-044 (b), TG2).
 *
 * Webhook записал только метаданные (file_id). Этот проход:
 *
 *   1. берёт вложения в аренду (`claim_channel_attachments`) — только у
 *      проектов с включённым флагом «файлы»;
 *   2. спрашивает у Telegram путь (`getFile`) и скачивает байты с жёстким
 *      лимитом размера;
 *   3. проверяет файл той же политикой, что и загрузку из интерфейса
 *      (расширение, сигнатура, размер), и считает sha256;
 *   4. кладёт его в карантин существующим file intake: запись `requested`,
 *      загрузка в карантинный префикс, `scan_pending`;
 *   5. сообщает итог базе (`complete_channel_attachment`) — `scan_pending`,
 *      `rejected` с кодом или `retry`.
 *
 * Дальше файл идёт обычным путём проверки (`complete_file_intake_scan`,
 * `review_file_intake`). Из Telegram появляется только кандидат: ни один
 * официальный объект проекта здесь не создаётся.
 */

export interface TelegramFileSource {
  getFile(fileId: string): Promise<TelegramCallOutcome>;
  downloadFile(filePath: string, maxBytes: number): Promise<
    | { readonly ok: true; readonly bytes: Uint8Array }
    | { readonly ok: false; readonly failureCode: string; readonly retryable: boolean }
  >;
}

export interface AttachmentQueuePort {
  claimChannelAttachments(input: {
    readonly maxRows: number;
    readonly leaseSeconds: number;
  }): Promise<readonly ClaimedAttachment[]>;
  completeChannelAttachment(input: {
    readonly attachmentId: string;
    readonly leaseToken: string;
    readonly outcome: "scan_pending" | "rejected" | "retry";
    readonly fileIntakeId?: string | null;
    readonly serverSha256Hex?: string | null;
    readonly storageLocator?: string | null;
    readonly rejectionCode?: string | null;
  }): Promise<{ readonly completed: boolean; readonly reason?: string }>;
}

/** Карантин file intake. Реализация — `FileIntakeWorkerService.createAndUpload`. */
export interface AttachmentQuarantinePort {
  createAndUpload(input: {
    readonly projectId: string;
    readonly upload: ValidatedFileIntakeUpload;
    readonly idempotencyKey: string;
  }): Promise<{ readonly result: Record<string, unknown> }>;
}

export interface AttachmentRunResult {
  readonly claimed: number;
  readonly quarantined: number;
  readonly rejected: number;
  readonly retried: number;
  readonly leaseLost: number;
}

const DEFAULT_MAX_ROWS = 5;
const DEFAULT_LEASE_SECONDS = 180;
/** Самый большой допустимый файл политики file intake. */
const MAX_DOWNLOAD_BYTES = Math.max(...Object.values(FILE_INTAKE_MAX_BYTES));

const fileSchema = z.object({ file_path: z.string().min(1), file_size: z.number().optional() });
const quarantineSchema = z.object({
  intakeId: z.string().uuid(),
  checksumHex: z.string().regex(/^[a-f0-9]{64}$/),
  objectKey: z.string().min(1).max(400),
  status: z.string().min(1),
});

type Outcome =
  | { readonly outcome: "scan_pending"; readonly intakeId: string; readonly sha256: string; readonly locator: string }
  | { readonly outcome: "rejected"; readonly code: string }
  | { readonly outcome: "retry" };

/** Имя файла — из нашего идентификатора, а не из присланного названия. */
export function attachmentFilename(attachment: ClaimedAttachment, filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  const safeId = attachment.fileUniqueId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "file";
  return `telegram-${safeId}.${extension || "bin"}`;
}

async function processOne(
  attachment: ClaimedAttachment,
  files: TelegramFileSource,
  quarantine: AttachmentQuarantinePort,
): Promise<Outcome> {
  if (attachment.claimedSizeBytes !== null && attachment.claimedSizeBytes > MAX_DOWNLOAD_BYTES) {
    return { outcome: "rejected", code: "file_too_large" };
  }
  const located = await files.getFile(attachment.fileId);
  if (!located.ok) {
    return located.retryable ? { outcome: "retry" } : { outcome: "rejected", code: "file_unavailable" };
  }
  const file = fileSchema.safeParse(located.result);
  if (!file.success) return { outcome: "rejected", code: "file_unavailable" };
  if (file.data.file_size !== undefined && file.data.file_size > MAX_DOWNLOAD_BYTES) {
    return { outcome: "rejected", code: "file_too_large" };
  }

  const downloaded = await files.downloadFile(file.data.file_path, MAX_DOWNLOAD_BYTES);
  if (!downloaded.ok) {
    return downloaded.retryable
      ? { outcome: "retry" }
      : { outcome: "rejected", code: downloaded.failureCode.replace(/[^a-z0-9_]/g, "_").slice(0, 80) };
  }

  let upload: ValidatedFileIntakeUpload;
  try {
    upload = validateUpload({
      bytes: downloaded.bytes,
      filename: attachmentFilename(attachment, file.data.file_path),
      browserMediaType: attachment.claimedMediaType,
      sourceRole: "correspondence",
    });
  } catch (error) {
    if (error instanceof FileIntakePolicyError) return { outcome: "rejected", code: error.code };
    throw error;
  }

  // Ключ идемпотентности — вложение, а не попытка: повтор после сбоя между
  // карантином и итогом возвращает ту же запись file intake.
  const created = await quarantine.createAndUpload({
    projectId: attachment.projectId,
    upload,
    idempotencyKey: `telegram-attachment:${attachment.attachmentId}`,
  });
  const parsed = quarantineSchema.safeParse(created.result);
  if (!parsed.success) return { outcome: "retry" };
  return {
    outcome: "scan_pending",
    intakeId: parsed.data.intakeId,
    sha256: parsed.data.checksumHex,
    locator: parsed.data.objectKey,
  };
}

export async function runTelegramAttachmentBatch(
  queue: AttachmentQueuePort,
  files: TelegramFileSource,
  quarantine: AttachmentQuarantinePort,
  options: { readonly maxRows?: number; readonly leaseSeconds?: number } = {},
): Promise<AttachmentRunResult> {
  const claimed = await queue.claimChannelAttachments({
    maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
    leaseSeconds: options.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
  });
  let quarantined = 0;
  let rejected = 0;
  let retried = 0;
  let leaseLost = 0;

  let failure: unknown = null;
  for (const attachment of claimed) {
    let outcome: Outcome = { outcome: "retry" };
    if (failure === null) {
      try {
        outcome = await processOne(attachment, files, quarantine);
      } catch (error) {
        // Сбой хранилища или базы не делает файл плохим. Проход
        // останавливается: остальные вложения возвращаются в очередь, ошибка
        // уходит оператору — иначе неверная настройка тихо сжигала бы попытки.
        failure = error;
      }
    }
    const completed = await queue.completeChannelAttachment(
      outcome.outcome === "scan_pending"
        ? {
            attachmentId: attachment.attachmentId,
            leaseToken: attachment.leaseToken,
            outcome: "scan_pending",
            fileIntakeId: outcome.intakeId,
            serverSha256Hex: outcome.sha256,
            storageLocator: outcome.locator,
          }
        : outcome.outcome === "rejected"
          ? {
              attachmentId: attachment.attachmentId,
              leaseToken: attachment.leaseToken,
              outcome: "rejected",
              rejectionCode: outcome.code,
            }
          : { attachmentId: attachment.attachmentId, leaseToken: attachment.leaseToken, outcome: "retry" },
    );
    if (!completed.completed) leaseLost += 1;
    else if (outcome.outcome === "scan_pending") quarantined += 1;
    else if (outcome.outcome === "rejected") rejected += 1;
    else retried += 1;
  }

  if (failure !== null) throw failure;
  return { claimed: claimed.length, quarantined, rejected, retried, leaseLost };
}
