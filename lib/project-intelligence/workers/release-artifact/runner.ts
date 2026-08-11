/**
 * Прогон системного воркера артефактов выпуска (DEC-030, инкремент 1.5).
 *
 * Воркер делает ровно один шаг продукта: материализует артефакт для выпущенной
 * версии пакета. Без него `distribute_release` упирается в
 * `P1104 not_found {"entity":"releaseArtifact"}` — это находка гейта 2, и
 * A6 §1.1 её не предвидел.
 *
 * ЧТО ЗДЕСЬ ГАРАНТИРУЕТСЯ И ЧЕМ.
 *
 *   * **Только системная identity.** Очередь читает
 *     `list_release_artifact_backlog`, сборку делает `build_release_artifact` —
 *     обе выданы только `service_role`. Роль `authenticated` не достаёт ни до
 *     одной из них (`tests/db4/09_release_artifact_worker.sql`).
 *   * **Повтор не создаёт дубль.** Ключ идемпотентности и идентификатор
 *     артефакта выводятся из версии, а не из часов и не из случайности.
 *   * **Параллельный запуск даёт один артефакт.** Сама RPC берёт строку
 *     проекта `for update`, а дальше срабатывает одно из двух: тот же ключ →
 *     replay, либо тот же семантический кортеж → `existing_artifact`. Оба
 *     исхода для воркера — успех, а не ошибка.
 *   * **Потеря ответа безопасна.** Повтор с тем же ключом возвращает прежний
 *     результат; если состояние проекта успело сдвинуться, ключ тот же, а
 *     запрос другой — база отвечает `idempotency_conflict`, и это тоже не
 *     ошибка воркера: значит работу уже сделали, и следующий проход увидит
 *     пустую очередь.
 *   * **Пустая очередь — no-op.** Ни одного вызова записи.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Ни расчёта влияния, ни вех, ни фото, ни сборки передачи
 * (DEC-030). Ни одного HTTP-маршрута: воркер запускается процессом, а не
 * запросом, и человеческой поверхности не создаёт.
 */

import {
  ProjectBrainWorkerPostgresAdapter,
  ProjectIntelligenceAdapterError,
  type PostgresRpcClient,
} from "../../adapters/postgres";
import {
  planReleaseArtifactWork,
  releaseBacklogEnvelopeSchema,
  type ReleaseArtifactWorkItem,
} from "./planner";

export type ReleaseArtifactOutcome =
  /** Артефакт собран этим вызовом. */
  | "created"
  /** Артефакт уже существовал — его собрал прошлый прогон или сосед. */
  | "already_present"
  /** Состояние проекта сдвинулось между чтением очереди и сборкой. */
  | "stale_state";

export interface ReleaseArtifactRunResult {
  readonly scanned: number;
  readonly created: number;
  readonly alreadyPresent: number;
  readonly staleState: number;
  readonly items: readonly {
    readonly projectId: string;
    readonly productionPackageVersionId: string;
    readonly artifactId: string;
    readonly outcome: ReleaseArtifactOutcome;
  }[];
}

export interface ReleaseArtifactRunnerOptions {
  /** Клиент ОБЯЗАН быть системным (service role). */
  readonly client: PostgresRpcClient;
  /** Верхняя граница одного прохода; база сама ограничивает 1000. */
  readonly maxRows?: number;
}

async function readBacklog(
  worker: ProjectBrainWorkerPostgresAdapter,
  maxRows: number,
): Promise<ReturnType<typeof planReleaseArtifactWork>> {
  const envelope = releaseBacklogEnvelopeSchema.safeParse(
    await worker.listReleaseArtifactBacklog({ maxRows }),
  );
  if (!envelope.success) {
    // Очередь, которую нельзя прочитать по контракту, — это не пустая очередь.
    // Молча вернуть ноль заданий значило бы отчитаться «работы нет».
    throw new ProjectIntelligenceAdapterError("internal_error", null);
  }
  return planReleaseArtifactWork(envelope.data.data);
}

function outcomeFromError(error: unknown): ReleaseArtifactOutcome | null {
  if (!(error instanceof ProjectIntelligenceAdapterError)) return null;
  // Работу сделал сосед или прошлый прогон, чей ответ потерялся: ключ тот же,
  // запрос другой. Для очереди это «уже готово», и следующий проход это
  // подтвердит пустотой.
  if (error.code === "idempotency_conflict") return "already_present";
  // Состояние сдвинулось между чтением и записью — нормальный исход гонки.
  // Следующий проход прочитает очередь заново.
  if (error.code === "stale_state") return "stale_state";
  return null;
}

async function buildOne(
  worker: ProjectBrainWorkerPostgresAdapter,
  item: ReleaseArtifactWorkItem,
): Promise<ReleaseArtifactOutcome> {
  try {
    const mutation = await worker.buildReleaseArtifact({
      projectId: item.projectId,
      artifact: {
        id: item.artifactId,
        productionPackageVersionId: item.productionPackageVersionId,
        format: "logical_json",
        semanticHash: item.descriptor.semanticHash,
      },
      expectedStateRevision: item.expectedStateRevision,
      idempotencyKey: item.idempotencyKey,
    });
    // RPC отвечает `kind`: `created` — собрала сейчас, `existing_artifact` —
    // такой семантический кортеж уже был. Повтор по ключу приходит как
    // `replay`, и он тоже не создаёт второго артефакта.
    const kind = (mutation.result as { readonly kind?: unknown } | null)?.kind;
    if (mutation.replay || kind === "existing_artifact") return "already_present";
    return "created";
  } catch (error) {
    const outcome = outcomeFromError(error);
    if (outcome) return outcome;
    throw error;
  }
}

/**
 * Один проход по очереди. Возвращает отчёт, а не бросает на нормальных исходах
 * гонки: воркер, падающий от того, что сосед его опередил, не переживает
 * параллельного запуска.
 */
export async function runReleaseArtifactWorker(
  options: ReleaseArtifactRunnerOptions,
): Promise<ReleaseArtifactRunResult> {
  const maxRows = options.maxRows ?? 100;
  const worker = new ProjectBrainWorkerPostgresAdapter(options.client);
  const plan = await readBacklog(worker, maxRows);

  const items: ReleaseArtifactRunResult["items"][number][] = [];
  for (const item of plan) {
    const outcome = await buildOne(worker, item);
    items.push({
      projectId: item.projectId,
      productionPackageVersionId: item.productionPackageVersionId,
      artifactId: item.artifactId,
      outcome,
    });
  }

  return {
    scanned: plan.length,
    created: items.filter((entry) => entry.outcome === "created").length,
    alreadyPresent: items.filter((entry) => entry.outcome === "already_present").length,
    staleState: items.filter((entry) => entry.outcome === "stale_state").length,
    items,
  };
}
