/**
 * Прогон воркера ингеста источников (M3 backlog #5).
 *
 * Воркер делает ровно один шаг продукта: доводит зарегистрированный
 * materialized-источник из инвентаря до графа утверждений, чтобы у него
 * появилась ревизия — без неё невозможно ревью источника
 * (`human_reviews` требует ревизию в графе, `20260810060000`), а
 * `sourceRevisionIds` в composition/token/hash остаются пустыми навсегда.
 *
 * ЧТО ЗДЕСЬ ГАРАНТИРУЕТСЯ И ЧЕМ.
 *
 *   * **Только системная identity.** Очередь читает
 *     `list_source_ingest_backlog`, ингест делает `ingest_source_graph_system`
 *     — обе выданы только `service_role`, и миграция `20260824180000` падает,
 *     если до них дотянется `anon` или `authenticated`.
 *   * **Ни байта содержимого из воркера.** Граф синтезирует сервер из строки
 *     инвентаря; воркер передаёт только идентификаторы.
 *   * **Повтор не создаёт дубль.** Ключ идемпотентности выводится из проекта
 *     и логического источника, а не из часов и не из случайности.
 *   * **Параллельный запуск даёт один граф.** Проигравший получит либо replay,
 *     либо `SOURCE_ALREADY_REGISTERED` (`scope_conflict`), либо
 *     `idempotency_conflict` — все исходы для воркера успех, а не ошибка.
 *   * **Несколько источников одного проекта проходят одним проходом.**
 *     Каждый успешный ингест двигает `state_revision`; воркер несёт свежую
 *     ревизию вперёд по строкам того же проекта, а не ждёт следующего прохода.
 *   * **Отказ по строке не роняет проход и не теряется молча** (DEC-036).
 *     `ingestOne` — тотальная функция: транзиентный отказ копит ограниченный
 *     бюджет попыток с растущей паузой, постоянный (`not_found`,
 *     `unsupported_source` — нераспознанное расширение, `forbidden` — автор
 *     больше не участник) уходит в durable dead-letter немедленно. Строка в
 *     dead-letter исчезает из активной очереди совсем.
 *   * **Единственный настоящий throw — до цикла.** `readBacklog` роняет весь
 *     проход, если конверт очереди не читается по контракту.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Ревью источника: подтверждение — человеческое действие
 * (`review_source`), воркер лишь делает его возможным. Ни редрайва — он
 * операторское SQL-действие (`redrive_source_ingest_worker_failure`).
 */

import { z } from "zod";

import {
  ProjectCeoIngestWorkerPostgresAdapter,
  ProjectIntelligenceAdapterError,
  type PostgresRpcClient,
} from "../../adapters/postgres";
import {
  sourceIngestBacklogEnvelopeSchema,
  planSourceIngestWork,
  type SourceIngestWorkItem,
} from "./planner";

export type SourceIngestOutcome =
  /** Источник доведён до графа этим вызовом. */
  | "ingested"
  /** Граф уже существовал — его довёл прошлый проход или сосед. */
  | "already_present"
  /** Состояние проекта сдвинулось между чтением очереди и ингестом. */
  | "stale_state"
  /**
   * Транзиентный отказ (DEC-036): попытка записана, бюджет не исчерпан,
   * строка временно скрыта из очереди по `next_attempt_at`.
   */
  | "failed_retrying"
  /**
   * Постоянный отказ или исчерпанный бюджет: строка ушла в durable
   * dead-letter и исчезла из активной очереди. Возврат — только через
   * операторский редрайв.
   */
  | "failed_dead_letter";

/** Исходы, после которых работа оператора всё ещё требуется. */
const NEEDS_ATTENTION: ReadonlySet<SourceIngestOutcome> = new Set([
  "failed_dead_letter",
]);

const recordedFailureSchema = z.object({
  status: z.enum(["retrying", "dead_letter"]),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: z.string().nullable(),
  deadLetteredAt: z.string().nullable(),
}).strict();

export interface SourceIngestFailureReport {
  readonly failureKind: "transient" | "permanent";
  readonly status: "retrying" | "dead_letter";
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: string | null;
  readonly deadLetteredAt: string | null;
}

export interface SourceIngestRunResult {
  readonly scanned: number;
  readonly ingested: number;
  readonly alreadyPresent: number;
  readonly staleState: number;
  readonly failedRetrying: number;
  readonly failedDeadLetter: number;
  readonly needsAttention: number;
  readonly items: readonly {
    readonly projectId: string;
    readonly logicalSourceId: string;
    readonly outcome: SourceIngestOutcome;
    readonly failure: SourceIngestFailureReport | null;
  }[];
}

export interface SourceIngestRunnerOptions {
  /** Клиент ОБЯЗАН быть системным (service role). */
  readonly client: PostgresRpcClient;
  /** Верхняя граница одного прохода; база сама ограничивает 1000. */
  readonly maxRows?: number;
}

async function readBacklog(
  worker: ProjectCeoIngestWorkerPostgresAdapter,
  maxRows: number,
): Promise<readonly SourceIngestWorkItem[]> {
  const envelope = sourceIngestBacklogEnvelopeSchema.safeParse(
    await worker.listSourceIngestBacklog({ maxRows }),
  );
  if (!envelope.success) {
    // Очередь, которую нельзя прочитать по контракту, — это не пустая
    // очередь. Единственный throw во всём прогоне: process-level отказ.
    throw new ProjectIntelligenceAdapterError("internal_error", null);
  }
  return planSourceIngestWork(envelope.data.data);
}

/** Нормальный исход гонки — не отказ вовсе. */
function outcomeFromRace(error: unknown): "already_present" | "stale_state" | null {
  if (!(error instanceof ProjectIntelligenceAdapterError)) return null;
  // Работу сделал сосед или прошлый проход, чей ответ потерялся.
  if (error.code === "idempotency_conflict") return "already_present";
  // Источник уже в графе: `SOURCE_ALREADY_REGISTERED...` — P1109. Через RPC
  // путь этот случай виден как scope_conflict с этой причиной; любая другая
  // причина scope_conflict — настоящий отказ.
  if (error.code === "scope_conflict"
    && error.reason === "SOURCE_ALREADY_REGISTERED_USE_ORIGINAL_IDEMPOTENCY_KEY") {
    return "already_present";
  }
  if (error.code === "stale_state") return "stale_state";
  return null;
}

interface ErrorClassification {
  readonly failureKind: "transient" | "permanent";
  readonly errorCode: string;
  readonly errorDetail: Readonly<Record<string, unknown>> | null;
}

/**
 * Всё, что не нормальный исход гонки, — отказ. Постоянные: `not_found`
 * (строка инвентаря исчезла), `unsupported_source` (расширение не
 * расшифровать — P1110), `forbidden` (автор больше не активный участник с
 * register_source) и любой другой структурный код. Транзиентные:
 * `internal_error` и всё нетипизированное (сеть, таймаут).
 */
function classifyFailure(error: unknown): ErrorClassification {
  if (error instanceof ProjectIntelligenceAdapterError) {
    const errorDetail = error.reason ? { reason: error.reason } : null;
    if (error.code === "internal_error") {
      return { failureKind: "transient", errorCode: error.code, errorDetail };
    }
    return { failureKind: "permanent", errorCode: error.code, errorDetail };
  }
  return {
    failureKind: "transient",
    errorCode: "unknown_error",
    errorDetail: { message: error instanceof Error ? error.message : String(error) },
  };
}

interface OneResult {
  readonly outcome: SourceIngestOutcome;
  readonly failure: SourceIngestFailureReport | null;
  /** Ревизия состояния после успешного ингеста — для следующей строки проекта. */
  readonly nextStateRevision: number | null;
}

/** Никогда не бросает: если запись отказа сама недостижима, строка остаётся
 * `failed_retrying` без durable следа до следующего прохода. */
async function recordFailureAndReport(
  worker: ProjectCeoIngestWorkerPostgresAdapter,
  item: SourceIngestWorkItem,
  error: unknown,
): Promise<OneResult> {
  const classification = classifyFailure(error);
  let recorded: z.infer<typeof recordedFailureSchema> | null = null;
  try {
    recorded = recordedFailureSchema.parse(
      await worker.recordSourceIngestWorkerFailure({
        projectId: item.projectId,
        logicalSourceId: item.logicalSourceId,
        failureKind: classification.failureKind,
        errorCode: classification.errorCode,
        errorDetail: classification.errorDetail,
      }),
    );
  } catch {
    // Запись отказа сама недостижима — не повод остановить проход.
  }

  const outcome: SourceIngestOutcome = recorded?.status === "dead_letter"
    ? "failed_dead_letter"
    : "failed_retrying";

  return {
    outcome,
    nextStateRevision: null,
    failure: recorded && {
      failureKind: classification.failureKind,
      status: recorded.status,
      attemptCount: recorded.attemptCount,
      maxAttempts: recorded.maxAttempts,
      nextAttemptAt: recorded.nextAttemptAt,
      deadLetteredAt: recorded.deadLetteredAt,
    },
  };
}

/** Тотальная функция: для любой строки возвращает исход, никогда не бросает. */
async function ingestOne(
  worker: ProjectCeoIngestWorkerPostgresAdapter,
  item: SourceIngestWorkItem,
  expectedStateRevision: number,
): Promise<OneResult> {
  try {
    const mutation = await worker.ingestSourceGraphSystem({
      projectId: item.projectId,
      logicalSourceId: item.logicalSourceId,
      expectedStateRevision,
      idempotencyKey: item.idempotencyKey,
    });
    if (mutation.replay) {
      return {
        outcome: "already_present",
        failure: null,
        nextStateRevision: mutation.stateRevision,
      };
    }
    return {
      outcome: "ingested",
      failure: null,
      nextStateRevision: mutation.stateRevision,
    };
  } catch (error) {
    const raceOutcome = outcomeFromRace(error);
    if (raceOutcome) {
      return { outcome: raceOutcome, failure: null, nextStateRevision: null };
    }
    return recordFailureAndReport(worker, item, error);
  }
}

/**
 * Один проход по очереди. Отказ по одной строке не прекращает проход;
 * успешный ингест двигает `state_revision`, и следующая строка того же
 * проекта получает свежую ревизию, а не `stale_state` на ровном месте.
 */
export async function runSourceIngestWorker(
  options: SourceIngestRunnerOptions,
): Promise<SourceIngestRunResult> {
  const maxRows = options.maxRows ?? 100;
  const worker = new ProjectCeoIngestWorkerPostgresAdapter(options.client);
  const plan = await readBacklog(worker, maxRows);

  const carriedState = new Map<string, number>();
  const items: SourceIngestRunResult["items"][number][] = [];
  for (const item of plan) {
    const expected = carriedState.get(item.projectId) ?? item.expectedStateRevision;
    const one = await ingestOne(worker, item, expected);
    if (one.nextStateRevision !== null) {
      carriedState.set(item.projectId, one.nextStateRevision);
    }
    items.push({
      projectId: item.projectId,
      logicalSourceId: item.logicalSourceId,
      outcome: one.outcome,
      failure: one.failure,
    });
  }

  const count = (outcome: SourceIngestOutcome): number =>
    items.filter((entry) => entry.outcome === outcome).length;

  return {
    scanned: plan.length,
    ingested: count("ingested"),
    alreadyPresent: count("already_present"),
    staleState: count("stale_state"),
    failedRetrying: count("failed_retrying"),
    failedDeadLetter: count("failed_dead_letter"),
    needsAttention: items.filter((entry) => NEEDS_ATTENTION.has(entry.outcome)).length,
    items,
  };
}
