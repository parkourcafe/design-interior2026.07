import type { TelegramSystemPort } from "./channel-port";
import { NOTIFICATION_TEMPLATE_VERSION } from "./notification-template";

/**
 * Проектор: выдача пакета производства (M4) → запись в очереди уведомлений.
 *
 * ПОЧЕМУ ЧТЕНИЕ, А НЕ ВРЕЗКА В КОМАНДУ. A7 §2.1 запрещает писать Telegram-код
 * внутрь модулей M1–M4. `distribute_release` о существовании моста не знает и
 * знать не должен: сегодня канал Telegram, завтра — другой, и команда домена
 * не обязана меняться от этого ни строкой. Проектор читает УЖЕ СОХРАНЁННОЕ
 * состояние и догоняет очередь.
 *
 * Побочное следствие — устойчивость. Врезка в команду теряет уведомление,
 * если процесс упал между записью выдачи и постановкой в очередь. Проектор,
 * который спрашивает «каких выдач ещё нет в очереди», такого окна не имеет
 * вовсе: он просто увидит их в следующий проход.
 *
 * Ключ идемпотентности детерминирован — `release_distributed:<id выдачи>`.
 * Повторный проход по той же выдаче не создаёт второй записи (дедупликация в
 * базе по паре связь + ключ), сколько бы раз проектор ни запускался.
 */

export interface DistributionProjectionResult {
  readonly scanned: number;
  readonly queued: number;
  readonly alreadyQueued: number;
  /** Проекты без активной связи в хвост не попадают — уведомлять некуда. */
  readonly skippedNoBinding: number;
}

export function releaseNotificationIdempotencyKey(distributionId: string): string {
  return `release_distributed:${distributionId}`;
}

export async function runDistributionProjection(
  port: TelegramSystemPort,
  options: { readonly maxRows?: number } = {},
): Promise<DistributionProjectionResult> {
  const backlog = await port.listDistributionNotificationBacklog({
    maxRows: options.maxRows ?? 50,
  });

  let queued = 0;
  let alreadyQueued = 0;
  let skippedNoBinding = 0;

  for (const item of backlog) {
    const result = await port.enqueueNotification({
      projectId: item.projectId,
      sourceKind: "release_distributed",
      sourceId: item.distributionId,
      templateVersion: NOTIFICATION_TEMPLATE_VERSION,
      payload: {
        kind: "release_distributed",
        projectId: item.projectId,
        ...(item.versionLabel === null ? {} : { versionLabel: item.versionLabel }),
      },
      idempotencyKey: releaseNotificationIdempotencyKey(item.distributionId),
    });

    if (result.queued) queued += 1;
    // Связь могла быть отозвана между построением хвоста и постановкой в
    // очередь: база отвечает `no_active_binding`, и записи не появляется. Это
    // не то же самое, что «уже стояло», и в отчёте различается.
    else if (result.reason === "no_active_binding") skippedNoBinding += 1;
    else alreadyQueued += 1;
  }

  return {
    scanned: backlog.length,
    queued,
    alreadyQueued,
    skippedNoBinding,
  };
}
