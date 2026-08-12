/**
 * Прогон системного воркера расчёта влияния (DEC-033, V1 Impact,
 * OWNER GO 12.08.2026).
 *
 * Воркер делает ровно один шаг продукта: считает влияние для заявок на
 * изменение, у которых его ещё нет. Без него `review_change_impact` не имеет
 * что рассматривать — расчёт не человеческая команда, его делает система.
 *
 * ЧТО ЗДЕСЬ ГАРАНТИРУЕТСЯ И ЧЕМ.
 *
 *   * **Только системная identity.** Очередь читает
 *     `list_change_impact_backlog`, расчёт делает
 *     `calculate_change_impact_policy_bound` — обе выданы только
 *     `service_role` (`tests/db5/05_default_deny_before.sql`,
 *     `90_default_deny_after.sql`).
 *   * **Повтор не создаёт дубль.** Ключ идемпотентности выводится из заявки,
 *     а не из часов и не из случайности; один ChangeRequest — один прогон
 *     влияния (`m4_impact_runs_request_key`, DB constraint).
 *   * **Параллельный запуск даёт один исход.** `_worker_command_context`
 *     берёт строку проекта `for update`, а дальше срабатывает одно из двух:
 *     тот же ключ → replay, либо RPC уже видит `impact_runs`-строку и падает
 *     `unsupported_source` (P1110, «уже посчитано»). Оба исхода для воркера —
 *     успех, а не ошибка (`tests/db5/run-concurrency.zsh`).
 *   * **Одна испорченная заявка не блокирует остальную очередь.** Отказ на
 *     одном элементе ловится ВНУТРИ цикла по заданиям, а не пробрасывается —
 *     соседние задания того же прохода обрабатываются независимо
 *     (`tests/db5/27_impact_coverage_outcomes.sql`, §8).
 *   * **Bounded retry → durable dead-letter.** Постоянный отказ (`not_found`
 *     на сорванной ссылке на baseline, или любой другой неожиданный отказ)
 *     записывается через `record_change_impact_worker_failure`; после
 *     исчерпанных попыток (сервер: 5 по умолчанию) заявка уходит из очереди
 *     терминально — `list_change_impact_backlog` больше её не отдаёт. Вернуть
 *     может только оператор через `redrive_change_impact_worker_failure`
 *     (repo-скрипт, не часть цикла воркера). `stale_state` — НЕ отказ и не
 *     считается попыткой: это нормальный исход гонки, следующий проход
 *     перечитает очередь заново.
 *   * **Пустая очередь — no-op.** Ни одного вызова записи.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Ни вех, ни фото, ни сборки передачи — у V1 Impact один
 * воркер. Ни одного HTTP-маршрута: воркер запускается процессом, а не
 * запросом, и человеческой поверхности не создаёт.
 */

import {
  ProjectCeoM4WorkerPostgresAdapter,
  ProjectIntelligenceAdapterError,
  type PostgresRpcClient,
} from "../../adapters/postgres";
import {
  changeImpactIdempotencyKey,
  impactBacklogEnvelopeSchema,
  planChangeImpactWork,
  type ChangeImpactWorkItem,
} from "./planner";

export type ChangeImpactOutcome =
  /** Влияние посчитано этим вызовом — исход обязан быть в этом отчёте. */
  | "calculated"
  /** Уже посчитано — прошлым прогоном, соседом, либо повтором по ключу. */
  | "already_present"
  /** Состояние проекта сдвинулось между чтением очереди и расчётом. */
  | "stale_state"
  /** Отказ зафиксирован, попытки ещё не исчерпаны — очередь увидит снова. */
  | "failure_recorded"
  /** Отказ зафиксирован, попытки исчерпаны — заявка ушла в dead-letter. */
  | "dead_lettered";

export interface ChangeImpactRunResult {
  readonly scanned: number;
  readonly calculated: number;
  readonly alreadyPresent: number;
  readonly staleState: number;
  readonly failureRecorded: number;
  readonly deadLettered: number;
  readonly items: readonly {
    readonly projectId: string;
    readonly changeRequestId: string;
    readonly outcome: ChangeImpactOutcome;
    /** Есть только когда `outcome === "calculated"`. */
    readonly coverageStatus?: "complete" | "partial_depth" | "blocked_result_limit";
  }[];
}

export interface ChangeImpactRunnerOptions {
  /** Клиент ОБЯЗАН быть системным (service role). */
  readonly client: PostgresRpcClient;
  /** Верхняя граница одного прохода; база сама ограничивает 1000. */
  readonly maxRows?: number;
  /** Порог bounded retry перед dead-letter. Сервер по умолчанию — 5. */
  readonly maxAttempts?: number;
}

async function readBacklog(
  worker: ProjectCeoM4WorkerPostgresAdapter,
  maxRows: number,
): Promise<ReturnType<typeof planChangeImpactWork>> {
  const envelope = impactBacklogEnvelopeSchema.safeParse(
    await worker.listChangeImpactBacklog({ maxRows }),
  );
  if (!envelope.success) {
    // Очередь, которую нельзя прочитать по контракту, — это не пустая
    // очередь. Молча вернуть ноль заданий значило бы отчитаться «работы нет».
    throw new ProjectIntelligenceAdapterError("internal_error", null);
  }
  return planChangeImpactWork(envelope.data.data);
}

interface ItemOutcome {
  readonly outcome: ChangeImpactOutcome;
  readonly coverageStatus?: "complete" | "partial_depth" | "blocked_result_limit";
}

async function calculateOne(
  worker: ProjectCeoM4WorkerPostgresAdapter,
  item: ChangeImpactWorkItem,
  maxAttempts: number | undefined,
): Promise<ItemOutcome> {
  try {
    const mutation = await worker.calculateChangeImpactPolicyBound({
      projectId: item.projectId,
      changeRequestId: item.changeRequestId,
      expectedStateRevision: item.expectedStateRevision,
      idempotencyKey: item.idempotencyKey,
    });
    const coverageStatus = (
      mutation.result as { readonly coverageStatus?: unknown } | null
    )?.coverageStatus;
    const status = coverageStatus === "complete"
      || coverageStatus === "partial_depth"
      || coverageStatus === "blocked_result_limit"
      ? coverageStatus
      : undefined;
    return { outcome: "calculated", coverageStatus: status };
  } catch (error) {
    if (error instanceof ProjectIntelligenceAdapterError) {
      // Работу сделал сосед или прошлый прогон, чей ответ потерялся: ключ тот
      // же, запрос другой — `idempotency_conflict`. Или расчёт уже случился
      // под другим ключом — RPC отвечает `unsupported_source` (P1110,
      // «уже посчитано», один ChangeRequest — один прогон). Для очереди оба
      // исхода — «уже готово», не отказ.
      if (error.code === "idempotency_conflict") return { outcome: "already_present" };
      if (error.sqlstate === "P1110") return { outcome: "already_present" };
      // Состояние сдвинулось между чтением очереди и расчётом — нормальный
      // исход гонки. НЕ считается попыткой: следующий проход перечитает
      // очередь заново без записи durable-отказа.
      if (error.code === "stale_state") return { outcome: "stale_state" };
      // Всё остальное — включая `not_found` на сорванной ссылке на
      // baseline — постоянный или неожиданный отказ. Bounded retry решает
      // сервер (`record_change_impact_worker_failure`), не этот код.
      const failure = await worker.recordChangeImpactWorkerFailure({
        projectId: item.projectId,
        changeRequestId: item.changeRequestId,
        failureCode: error.code,
        ...(maxAttempts === undefined ? {} : { maxAttempts }),
      });
      return { outcome: failure.deadLettered ? "dead_lettered" : "failure_recorded" };
    }
    throw error;
  }
}

/**
 * Один проход по очереди. Возвращает отчёт, а не бросает на нормальных
 * исходах гонки или на отказе одного задания: воркер, падающий от того, что
 * сосед его опередил или что одна заявка сломана, не переживает ни
 * параллельного запуска, ни одного испорченного элемента очереди.
 */
export async function runChangeImpactWorker(
  options: ChangeImpactRunnerOptions,
): Promise<ChangeImpactRunResult> {
  const maxRows = options.maxRows ?? 100;
  const worker = new ProjectCeoM4WorkerPostgresAdapter(options.client);
  const plan = await readBacklog(worker, maxRows);

  const items: ChangeImpactRunResult["items"][number][] = [];
  for (const item of plan) {
    const result = await calculateOne(worker, item, options.maxAttempts);
    items.push({
      projectId: item.projectId,
      changeRequestId: item.changeRequestId,
      outcome: result.outcome,
      ...(result.coverageStatus === undefined ? {} : { coverageStatus: result.coverageStatus }),
    });
  }

  return {
    scanned: plan.length,
    calculated: items.filter((entry) => entry.outcome === "calculated").length,
    alreadyPresent: items.filter((entry) => entry.outcome === "already_present").length,
    staleState: items.filter((entry) => entry.outcome === "stale_state").length,
    failureRecorded: items.filter((entry) => entry.outcome === "failure_recorded").length,
    deadLettered: items.filter((entry) => entry.outcome === "dead_lettered").length,
    items,
  };
}

export { changeImpactIdempotencyKey };
