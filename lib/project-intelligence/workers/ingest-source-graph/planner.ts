/**
 * Планировщик воркера ингеста источников (M3 backlog #5).
 *
 * Здесь нет ни сети, ни базы — только детерминированный вывод: из очереди
 * инвентаря-без-графа получаются задания со стабильными ключами
 * идемпотентности. Отделено намеренно: «повтор не создаёт дубль» и «два
 * параллельных прохода дают один граф» проверяются юнит-тестом без стека.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Содержимого источника. Воркер не строит ни узлов, ни
 * ревизий, ни метаданных: весь граф синтезирует системная дверь на сервере
 * из строки инвентаря (`20260824180000`). Если бы payload собирал воркер,
 * «одна форма графа» держалась бы на том, что TS и SQL не разошлись.
 */

import { z } from "zod";

/** Строка очереди — ровно то, что отдаёт `list_source_ingest_backlog`. */
export const sourceIngestBacklogRowSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  packageId: z.string().uuid(),
  logicalSourceId: z.string().min(1).max(160),
  sourceRevisionId: z.string().min(1).max(160),
  stateRevision: z.number().int().nonnegative(),
}).strict();

export const sourceIngestBacklogEnvelopeSchema = z.object({
  contractVersion: z.literal("project-ceo-ingest-worker/0.1"),
  requestId: z.string().min(1),
  data: z.array(sourceIngestBacklogRowSchema),
  error: z.null(),
}).strict();

export type SourceIngestBacklogRow = z.infer<typeof sourceIngestBacklogRowSchema>;

export interface SourceIngestWorkItem {
  readonly projectId: string;
  readonly logicalSourceId: string;
  readonly sourceRevisionId: string;
  /** Снимок ревизии состояния на момент чтения очереди. */
  readonly expectedStateRevision: number;
  readonly idempotencyKey: string;
}

export class SourceIngestPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceIngestPlanError";
  }
}

/**
 * Ключ идемпотентности. Детерминированный и НЕ включает ревизию состояния:
 * повтор после потери ответа обязан попасть в тот же ключ, даже если
 * состояние проекта успело сдвинуться.
 *
 * `logicalSourceId` выводится из checksum содержимого
 * (`source-sha256-<24hex>`, `register_source_inventory`), поэтому проект в
 * ключе НУЖЕН: один и тот же файл законно живёт в двух проектах, и это два
 * разных задания, а не дубль.
 */
export function sourceIngestIdempotencyKey(row: {
  readonly projectId: string;
  readonly logicalSourceId: string;
}): string {
  return `worker:ingest-source-graph:${row.projectId}:${row.logicalSourceId}`;
}

/** Очередь → задания. Порядок сохраняется тем, в котором её отдала база. */
export function planSourceIngestWork(
  rows: readonly SourceIngestBacklogRow[],
): readonly SourceIngestWorkItem[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const key = `${row.projectId}${row.logicalSourceId}`;
    if (seen.has(key)) {
      // Дубль в очереди означал бы, что чтение отдало одну строку инвентаря
      // дважды. Молча склеить — значит спрятать дефект источника.
      throw new SourceIngestPlanError(
        `source ingest backlog returned ${row.logicalSourceId} twice for one project`,
      );
    }
    seen.add(key);
    return {
      projectId: row.projectId,
      logicalSourceId: row.logicalSourceId,
      sourceRevisionId: row.sourceRevisionId,
      expectedStateRevision: row.stateRevision,
      idempotencyKey: sourceIngestIdempotencyKey(row),
    };
  });
}
