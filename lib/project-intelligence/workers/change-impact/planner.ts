/**
 * Планировщик воркера расчёта влияния (V1 Impact, W1).
 *
 * Здесь нет ни сети, ни базы — только детерминированный вывод: из очереди
 * заявок без прогона получаются задания со стабильными ключами идемпотентности.
 * Отделено намеренно: всё, на чём держатся «повтор не создаёт дубль» и «два
 * параллельных прохода дают один прогон», проверяется юнит-тестом без стека.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Глубины обхода. Она не аргумент вызова и не поле задания: её
 * держит versioned server-side константа (`_impact_policy`), и воркер её только
 * читает из конверта очереди — чтобы напечатать в отчёте, каким правилом
 * считали. Если бы глубину выбирал воркер, «детерминированный расчёт» держался
 * бы на том, что два запуска договорились об одном числе.
 */

import { z } from "zod";

/** Строка очереди — ровно то, что отдаёт `list_change_impact_backlog`. */
export const changeImpactBacklogRowSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  packageId: z.string().uuid(),
  changeRequestId: z.string().uuid(),
  proposedBaselineId: z.string().min(1).max(160),
  /**
   * Сколько корневых узлов у заявки. Воркеру для вызова не нужен — нужен
   * человеку в логе: прогон с нулём корней даёт пустое влияние законно, и без
   * этого числа «влияния нет» и «считать было нечего» выглядят одинаково.
   */
  rootCount: z.number().int().nonnegative(),
  stateRevision: z.number().int().nonnegative(),
}).strict();

/** Политика обхода — снимок серверной константы на момент чтения очереди. */
export const impactPolicySchema = z.object({
  version: z.string().min(1),
  maxDepth: z.number().int().positive(),
  maxImpacts: z.number().int().positive(),
}).strict();

export const changeImpactBacklogEnvelopeSchema = z.object({
  contractVersion: z.literal("project-ceo-impact-worker/0.1"),
  requestId: z.string().min(1),
  policy: impactPolicySchema,
  data: z.array(changeImpactBacklogRowSchema),
  error: z.null(),
}).strict();

export type ChangeImpactBacklogRow = z.infer<typeof changeImpactBacklogRowSchema>;
export type ImpactPolicy = z.infer<typeof impactPolicySchema>;

export interface ChangeImpactWorkItem {
  readonly projectId: string;
  readonly changeRequestId: string;
  readonly rootCount: number;
  /** Снимок ревизии состояния на момент чтения очереди. */
  readonly expectedStateRevision: number;
  readonly idempotencyKey: string;
}

export class ChangeImpactPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeImpactPlanError";
  }
}

/**
 * Ключ идемпотентности. Детерминированный и НЕ включает ревизию состояния:
 * повтор после потери ответа обязан попасть в тот же ключ, даже если состояние
 * проекта успело сдвинуться.
 *
 * Идентификатор заявки уникален глобально (uuid), поэтому ни организации, ни
 * проекта в ключе нет: они ничего не различают, а длину бы съели.
 */
export function changeImpactIdempotencyKey(row: {
  readonly changeRequestId: string;
}): string {
  return `worker:change-impact:${row.changeRequestId}`;
}

/** Очередь → задания. Порядок сохраняется тем, в котором её отдала база. */
export function planChangeImpactWork(
  rows: readonly ChangeImpactBacklogRow[],
): readonly ChangeImpactWorkItem[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (seen.has(row.changeRequestId)) {
      // Дубль в очереди означал бы, что чтение отдало одну заявку дважды.
      // Молча его склеить — значит спрятать дефект источника.
      throw new ChangeImpactPlanError(
        `change impact backlog returned ${row.changeRequestId} twice`,
      );
    }
    seen.add(row.changeRequestId);
    return {
      projectId: row.projectId,
      changeRequestId: row.changeRequestId,
      rootCount: row.rootCount,
      expectedStateRevision: row.stateRevision,
      idempotencyKey: changeImpactIdempotencyKey(row),
    };
  });
}
