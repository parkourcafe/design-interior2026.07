import { z } from "zod";

import { classifyMessage, EXTRACTION_SCHEMA_VERSION } from "./classifier";

/**
 * Разборщик канальных событий: сообщение → кандидат Project Inbox.
 *
 * Тот же приём, что у отправителя очереди: захват лизой, а не удаление. Упавший
 * на середине прогон не уносит работу — следующий подберёт её, когда лиза
 * истечёт, а параллельные прогоны разводит `skip locked` в базе.
 *
 * Повторный разбор того же события НЕ создаёт второго кандидата: пара
 * (событие, вид) уникальна в базе. Это важнее, чем кажется — иначе перезапуск
 * разборщика заливал бы Inbox копиями, человек переставал бы его читать, и
 * граница «предложено ≠ утверждено» рухнула бы не от запрета, а от усталости.
 */

const claimedEventSchema = z.object({
  eventId: z.string(),
  projectId: z.string(),
  eventKind: z.string(),
  attemptCount: z.number().int().nonnegative(),
  externalMessageId: z.number().int(),
  externalSenderId: z.number().nullable(),
  payload: z.record(z.unknown()),
});

export type ClaimedChannelEvent = z.infer<typeof claimedEventSchema>;

/**
 * Порт разбора. Отдельный интерфейс, а не расширение `TelegramSystemPort`:
 * разборщику не нужны ни отправка, ни активация связи, и давать ему их
 * значило бы раздать права «на всякий случай».
 */
export interface ChannelExtractionPort {
  claimChannelEvents(input: {
    readonly maxRows: number;
    readonly leaseSeconds: number;
  }): Promise<readonly ClaimedChannelEvent[]>;
  recordInboxCandidate(input: {
    readonly eventId: string;
    readonly candidateKind: string;
    readonly origin: "rule" | "ai";
    readonly extractionSchemaVersion: string;
    readonly summary: string;
    readonly confidence: string | null;
  }): Promise<{ readonly created: boolean }>;
  completeChannelEvent(input: {
    readonly eventId: string;
    readonly outcome: "processed" | "ignored" | "failed";
    readonly failureCode: string | null;
  }): Promise<void>;
}

export interface ExtractionRunResult {
  readonly claimed: number;
  readonly candidates: number;
  readonly ignored: number;
  readonly failed: number;
}

const payloadSchema = z.object({
  text: z.string().optional(),
  attachmentCount: z.number().int().nonnegative().optional(),
});

export async function runChannelExtractionBatch(
  port: ChannelExtractionPort,
  options: { readonly maxRows?: number; readonly leaseSeconds?: number } = {},
): Promise<ExtractionRunResult> {
  const claimed = await port.claimChannelEvents({
    maxRows: options.maxRows ?? 20,
    leaseSeconds: options.leaseSeconds ?? 60,
  });

  let candidates = 0;
  let ignored = 0;
  let failed = 0;

  for (const event of claimed) {
    try {
      const payload = payloadSchema.parse(event.payload);
      const extracted = classifyMessage({
        text: payload.text,
        attachmentCount: payload.attachmentCount ?? 0,
      });

      if (extracted === null) {
        // «Ок» и стикеры — не предложение проекту. `ignored` честнее, чем
        // карточка-пустышка: событие разобрано, предлагать нечего.
        await port.completeChannelEvent({
          eventId: event.eventId,
          outcome: "ignored",
          failureCode: null,
        });
        ignored += 1;
        continue;
      }

      await port.recordInboxCandidate({
        eventId: event.eventId,
        candidateKind: extracted.kind,
        origin: "rule",
        extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
        summary: extracted.summary,
        confidence: extracted.confidence,
      });
      await port.completeChannelEvent({
        eventId: event.eventId,
        outcome: "processed",
        failureCode: null,
      });
      candidates += 1;
    } catch {
      // Отказ на одном событии не роняет партию: остальные обязаны
      // разобраться. База сама решит по счётчику попыток, когда отправить
      // событие в dead_letter — здесь этого решения нет.
      await port.completeChannelEvent({
        eventId: event.eventId,
        outcome: "failed",
        failureCode: "extraction_failed",
      });
      failed += 1;
    }
  }

  return { claimed: claimed.length, candidates, ignored, failed };
}

export { claimedEventSchema };
