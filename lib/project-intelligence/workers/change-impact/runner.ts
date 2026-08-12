/**
 * Прогон воркера расчёта влияния (V1 Impact, W1).
 *
 * Воркер делает ровно один шаг продукта: считает влияние заявки на изменение,
 * чтобы у неё появился `impactRunId`. Без него `review_change_impact` нечего
 * рассматривать — команда ждёт прогон, а создать его человеческой дверью
 * нельзя: расчёт выдан только системной identity.
 *
 * ЧТО ЗДЕСЬ ГАРАНТИРУЕТСЯ И ЧЕМ.
 *
 *   * **Только системная identity.** Очередь читает
 *     `list_change_impact_backlog`, расчёт делает
 *     `calculate_change_impact_policy_bound` — обе выданы только
 *     `service_role`, и миграция `20260812010000` падает, если до них дотянется
 *     `anon` или `authenticated`.
 *   * **Повтор не создаёт дубль.** Ключ идемпотентности выводится из заявки, а
 *     не из часов и не из случайности.
 *   * **Параллельный запуск даёт один прогон.** Проигравший получит либо
 *     `IMPACT_ALREADY_CALCULATED`, либо `idempotency_conflict` — оба исхода для
 *     воркера успех, а не ошибка.
 *   * **Пустая очередь — no-op.** Ни одного вызова записи.
 *   * **Отказ не тонет.** Три исхода — усечение по глубине, превышение лимита и
 *     неразрешимый baseline — означают, что заявка НИКОГДА не получит прогон
 *     сама. Они считаются отдельно и поднимаются в отчёт: молча положить их
 *     рядом с «уже готово» значило бы отчитаться об успехе прохода, после
 *     которого рассматривать по-прежнему нечего.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Ни вех, ни фото, ни сборки передачи: V1 открывает один
 * воркер. Ни одного HTTP-маршрута — воркер запускается процессом, а не
 * запросом, и человеческой поверхности не создаёт. Ни выбора глубины обхода:
 * её держит серверная политика.
 */

import {
  ProjectCeoM4WorkerPostgresAdapter,
  ProjectIntelligenceAdapterError,
  type PostgresRpcClient,
} from "../../adapters/postgres";
import {
  changeImpactBacklogEnvelopeSchema,
  planChangeImpactWork,
  type ChangeImpactWorkItem,
  type ImpactPolicy,
} from "./planner";

export type ChangeImpactOutcome =
  /** Влияние посчитано этим вызовом. */
  | "calculated"
  /** Прогон уже существовал — его сделал прошлый проход или сосед. */
  | "already_present"
  /** Состояние проекта сдвинулось между чтением очереди и расчётом. */
  | "stale_state"
  /** Отказ: на глубину политики результат был бы усечён (нужен человек). */
  | "depth_truncated"
  /** Отказ: влияние шире лимита прогона (нужен человек). */
  | "limit_exceeded"
  /** Отказ: baseline заявки не разрешается (нужен человек). */
  | "unresolved";

/**
 * Исходы, после которых заявка остаётся без прогона и сама его не получит.
 * Перечислены явно, а не «всё, что не успех»: новый исход обязан попасть сюда
 * осознанно, а не унаследовать чужую трактовку.
 */
const NEEDS_ATTENTION: ReadonlySet<ChangeImpactOutcome> = new Set([
  "depth_truncated",
  "limit_exceeded",
  "unresolved",
]);

export interface ChangeImpactRunResult {
  /** Политика, которой считали. В отчёт — чтобы смена числа была видна в логе. */
  readonly policy: ImpactPolicy;
  readonly scanned: number;
  readonly calculated: number;
  readonly alreadyPresent: number;
  readonly staleState: number;
  readonly depthTruncated: number;
  readonly limitExceeded: number;
  readonly unresolved: number;
  /** Сумма трёх отказов — то, из-за чего проход нельзя назвать чистым. */
  readonly needsAttention: number;
  readonly items: readonly {
    readonly projectId: string;
    readonly changeRequestId: string;
    readonly rootCount: number;
    readonly outcome: ChangeImpactOutcome;
  }[];
}

export interface ChangeImpactRunnerOptions {
  /** Клиент ОБЯЗАН быть системным (service role). */
  readonly client: PostgresRpcClient;
  /** Верхняя граница одного прохода; база сама ограничивает 1000. */
  readonly maxRows?: number;
}

async function readBacklog(
  worker: ProjectCeoM4WorkerPostgresAdapter,
  maxRows: number,
): Promise<{
  readonly policy: ImpactPolicy;
  readonly plan: readonly ChangeImpactWorkItem[];
}> {
  const envelope = changeImpactBacklogEnvelopeSchema.safeParse(
    await worker.listChangeImpactBacklog({ maxRows }),
  );
  if (!envelope.success) {
    // Очередь, которую нельзя прочитать по контракту, — это не пустая очередь.
    // Молча вернуть ноль заданий значило бы отчитаться «работы нет».
    throw new ProjectIntelligenceAdapterError("internal_error", null);
  }
  return {
    policy: envelope.data.policy,
    plan: planChangeImpactWork(envelope.data.data),
  };
}

function outcomeFromError(error: unknown): ChangeImpactOutcome | null {
  if (!(error instanceof ProjectIntelligenceAdapterError)) return null;
  // Работу сделал сосед или прошлый проход, чей ответ потерялся: ключ тот же,
  // запрос другой. Для очереди это «уже готово».
  if (error.code === "idempotency_conflict") return "already_present";
  // Состояние сдвинулось между чтением и записью — нормальный исход гонки.
  if (error.code === "stale_state") return "stale_state";
  // Заявка есть, а её baseline не разрешается. Очередь такие строки намеренно
  // не фильтрует — иначе сломанная заявка не всплыла бы никогда.
  if (error.code === "not_found") return "unresolved";
  if (error.code === "validation_failed") {
    // Один `P1111` несёт три разных исхода, поэтому решает причина, а не код.
    if (error.reason === "IMPACT_ALREADY_CALCULATED") return "already_present";
    if (error.reason === "IMPACT_DEPTH_TRUNCATED") return "depth_truncated";
    if (error.reason === "IMPACT_RESULT_LIMIT_EXCEEDED") return "limit_exceeded";
    // Незнакомая причина отказа — не «нормальный исход». Пусть падает.
    return null;
  }
  return null;
}

async function calculateOne(
  worker: ProjectCeoM4WorkerPostgresAdapter,
  item: ChangeImpactWorkItem,
): Promise<ChangeImpactOutcome> {
  try {
    const mutation = await worker.calculateChangeImpactPolicyBound({
      projectId: item.projectId,
      changeRequestId: item.changeRequestId,
      expectedStateRevision: item.expectedStateRevision,
      idempotencyKey: item.idempotencyKey,
    });
    // Повтор по тому же ключу приходит как `replay` и второго прогона не
    // создаёт.
    return mutation.replay ? "already_present" : "calculated";
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
 *
 * Отказ по одной заявке не прекращает проход: остальные заявки к ней отношения
 * не имеют, и остановка означала бы, что одна сломанная строка держит очередь.
 */
export async function runChangeImpactWorker(
  options: ChangeImpactRunnerOptions,
): Promise<ChangeImpactRunResult> {
  const maxRows = options.maxRows ?? 100;
  const worker = new ProjectCeoM4WorkerPostgresAdapter(options.client);
  const { policy, plan } = await readBacklog(worker, maxRows);

  const items: ChangeImpactRunResult["items"][number][] = [];
  for (const item of plan) {
    const outcome = await calculateOne(worker, item);
    items.push({
      projectId: item.projectId,
      changeRequestId: item.changeRequestId,
      rootCount: item.rootCount,
      outcome,
    });
  }

  const count = (outcome: ChangeImpactOutcome): number =>
    items.filter((entry) => entry.outcome === outcome).length;

  return {
    policy,
    scanned: plan.length,
    calculated: count("calculated"),
    alreadyPresent: count("already_present"),
    staleState: count("stale_state"),
    depthTruncated: count("depth_truncated"),
    limitExceeded: count("limit_exceeded"),
    unresolved: count("unresolved"),
    needsAttention: items.filter((entry) => NEEDS_ATTENTION.has(entry.outcome)).length,
    items,
  };
}
