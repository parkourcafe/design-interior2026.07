/**
 * Планировщик системного воркера расчёта влияния (DEC-033, V1 Impact,
 * OWNER GO 12.08.2026).
 *
 * Тот же приём, что у планировщика артефактов выпуска
 * (`workers/release-artifact/planner.ts`): ни сети, ни базы — только
 * детерминированный вывод из очереди в задания со стабильными
 * идентификаторами идемпотентности. Всё, на чём держится «повтор не создаёт
 * второй прогон», проверяется юнит-тестом без стека.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Ни самого расчёта (он в `runner.ts`, за policy-bound RPC),
 * ни решения глубины/лимита — то и другое зафиксировано сервером
 * (`projectceo_m4._impact_policy()`, DEC-033 LOCKED) и планировщику
 * недоступно даже в принципе: очередь не отдаёт `maxDepth`/`maxImpacts`,
 * потому что вызывающий их не передаёт.
 */

import { z } from "zod";

/** Строка очереди — ровно то, что отдаёт `list_change_impact_backlog`. */
export const impactBacklogRowSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  packageId: z.string().uuid(),
  changeRequestId: z.string().uuid(),
  proposedBaselineId: z.string().min(1).max(160),
  rootCount: z.number().int().nonnegative(),
  stateRevision: z.number().int().nonnegative(),
}).strict();

export const impactPolicySchema = z.object({
  version: z.string().min(1),
  maxDepth: z.number().int().positive(),
  maxImpacts: z.number().int().positive(),
}).strict();

export const impactBacklogEnvelopeSchema = z.object({
  contractVersion: z.literal("project-ceo-impact-worker/0.1"),
  requestId: z.string().min(1),
  policy: impactPolicySchema,
  data: z.array(impactBacklogRowSchema),
  error: z.null(),
}).strict();

export type ImpactBacklogRow = z.infer<typeof impactBacklogRowSchema>;

export interface ChangeImpactWorkItem {
  readonly projectId: string;
  readonly changeRequestId: string;
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
 * повтор после потери ответа обязан попасть в тот же ключ, даже если
 * состояние проекта успело сдвинуться. `changeRequestId` уже глобально
 * уникален (UUID первичного ключа заявки), но `projectId` добавлен в ключ по
 * тому же защитному принципу, что и у воркера артефактов выпуска.
 */
export function changeImpactIdempotencyKey(row: {
  readonly projectId: string;
  readonly changeRequestId: string;
}): string {
  return `worker:change-impact:${row.projectId}:${row.changeRequestId}`;
}

/** Очередь → задания. Порядок сохраняется тем, в котором её отдала база. */
export function planChangeImpactWork(
  rows: readonly ImpactBacklogRow[],
): readonly ChangeImpactWorkItem[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const key = `${row.projectId}${row.changeRequestId}`;
    if (seen.has(key)) {
      // Дубль в очереди означал бы, что чтение отдало одну заявку дважды.
      // Молча его склеить — значит спрятать дефект источника.
      throw new ChangeImpactPlanError(
        `change impact backlog returned ${row.changeRequestId} twice`,
      );
    }
    seen.add(key);
    return {
      projectId: row.projectId,
      changeRequestId: row.changeRequestId,
      expectedStateRevision: row.stateRevision,
      idempotencyKey: changeImpactIdempotencyKey(row),
    };
  });
}
