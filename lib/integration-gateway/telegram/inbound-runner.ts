/**
 * Прогон входящей очереди: событие канала → кандидат Project Inbox
 * (A7 / DEC-031, гейт TG3).
 *
 * Форма та же, что у исходящей очереди и у Release Artifact Worker — намеренно:
 * новый универсальный worker framework в P0 не строится (A7 §12).
 *
 * ЧТО ЗДЕСЬ ГАРАНТИРУЕТСЯ:
 *
 *   * **Только системная identity.** Очередь и запись кандидата выданы
 *     `service_role`; человеческая сессия не достаёт ни до одной из них;
 *   * **Повтор не создаёт второго кандидата.** Уникальность
 *     `(событие, версия схемы извлечения)` — в базе, а не в памяти воркера;
 *   * **Кандидат рождается только `pending`.** Системный путь не умеет создать
 *     подтверждённого: ограничение таблицы требует человека и серверного
 *     времени, а у системной identity человека нет;
 *   * **Сбой модели не рождает кандидата.** Событие уходит в retry, человек не
 *     видит ничего. Показать «не удалось разобрать» как кандидата значило бы
 *     засорить очередь работой, которой не было;
 *   * **Пустая очередь — no-op.** Ни одного вызова записи и ни одного вызова
 *     модели.
 *
 * ЧЕГО ЗДЕСЬ НЕТ: ни одной доменной команды. Воркер не создаёт ChangeRequest, не
 * подтверждает выдачу и не принимает работы — он готовит предложение человеку, и
 * на этом его полномочия кончаются.
 */

import {
  consoleBridgeLogger,
  sanitizeFailureCode,
  type TelegramBridgeLogger,
} from "./bridge-log";
import { extractInboxCandidate } from "./extraction";
import type { ClaimedChannelEvent, TelegramSystemPort } from "./gateway-port";

export interface InboundRunResult {
  readonly claimed: number;
  readonly candidates: number;
  readonly ignored: number;
  readonly skipped: number;
  readonly retried: number;
}

export interface InboundRunnerOptions {
  readonly port: TelegramSystemPort;
  readonly maxRows?: number;
  readonly leaseSeconds?: number;
  readonly logger?: TelegramBridgeLogger;
  /** Подменяется в тестах; в рантайме — настоящий вызов провайдера по env. */
  readonly extract?: typeof extractInboxCandidate;
}

async function processOne(
  event: ClaimedChannelEvent,
  options: InboundRunnerOptions,
): Promise<"candidate" | "ignored" | "skipped" | "retry"> {
  const logger = options.logger ?? consoleBridgeLogger;
  const extract = options.extract ?? extractInboxCandidate;

  // Сообщение без текста разбирать нечем. Голосовые в P0 не расшифровываются
  // (A7 §12), фото само по себе ничего не утверждает — и то и другое остаётся
  // событием с вложением, но кандидата не порождает.
  if (!event.textContent || event.textContent.trim() === "") {
    await options.port.completeChannelEvent({ eventId: event.eventId, outcome: "skipped" });
    return "skipped";
  }

  const extraction = await extract(event.textContent);
  if (!extraction.ok) {
    await options.port.completeChannelEvent({
      eventId: event.eventId,
      outcome: "retry",
      failureCode: sanitizeFailureCode(extraction.failure.code, "extraction_failed"),
      retryAfterSeconds: 120,
    });
    return "retry";
  }

  const { result, schemaVersion, provider, model } = extraction.outcome;

  const recorded = await options.port.recordInboxCandidate({
    eventId: event.eventId,
    candidateType: result.type,
    extractionSchemaVersion: schemaVersion,
    extractionProvider: provider,
    extractionModel: model,
    confidence: result.confidence,
    rationale: result.rationale,
    // `ignored` не несёт предложения: показывать нечего, и придумывать текст
    // ради полноты строки незачем.
    proposedText: result.type === "ignored" ? null : result.proposedText,
  });

  await options.port.completeChannelEvent({ eventId: event.eventId, outcome: "processed" });

  if (result.type === "ignored") {
    logger.emit({
      event: "event_processed",
      eventId: event.eventId,
      projectId: event.projectId,
      candidateType: "ignored",
    });
    return "ignored";
  }

  logger.emit({
    event: "candidate_recorded",
    eventId: event.eventId,
    projectId: event.projectId,
    candidateId: recorded.candidateId ?? undefined,
    candidateType: result.type,
  });
  return "candidate";
}

/** Один проход по очереди. Не бросает на нормальных исходах гонки и модели. */
export async function runTelegramInboundWorker(
  options: InboundRunnerOptions,
): Promise<InboundRunResult> {
  const claimed = await options.port.claimChannelEvents({
    maxRows: options.maxRows ?? 20,
    leaseSeconds: options.leaseSeconds ?? 120,
  });

  let candidates = 0;
  let ignored = 0;
  let skipped = 0;
  let retried = 0;

  for (const event of claimed) {
    const outcome = await processOne(event, options);
    if (outcome === "candidate") candidates += 1;
    else if (outcome === "ignored") ignored += 1;
    else if (outcome === "skipped") skipped += 1;
    else retried += 1;
  }

  return { claimed: claimed.length, candidates, ignored, skipped, retried };
}
