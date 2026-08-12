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
 *   * **Неполнота не тонет.** Расчёт сохраняет частичный результат и помечает
 *     его (`isTruncated`, `truncationReason`, `coverageStatus`). Такой прогон
 *     рассматривать можно, но закрыть его человек не может без исчерпания
 *     обхода — DEC-033/034.
 *   * **Отказ по заявке НЕ роняет проход и не теряется молча** (DEC-036,
 *     OWNER REVIEW 12.08.2026). `calculateOne` — тотальная функция: она
 *     никогда не бросает исключение по причине, связанной с ОДНОЙ заявкой.
 *     Транзиентный отказ (сеть, `internal_error`) копит ограниченный бюджет
 *     попыток с растущей паузой и в итоге уходит в durable dead-letter;
 *     постоянный отказ (`not_found` — неразрешимый baseline, и любой другой
 *     структурный код) уходит в dead-letter немедленно. Оба живут в
 *     `projectceo_m4.impact_worker_failures`, не в памяти процесса — рестарт
 *     воркера ничего не сбрасывает, и заявка в dead-letter исчезает из
 *     активной очереди СОВСЕМ, а не крутится в ней вечно.
 *   * **Единственный настоящий throw — до цикла.** `readBacklog` роняет весь
 *     проход, если конверт очереди не читается по контракту: это
 *     process-level отказ (нечего даже перечислить), а не отказ одной
 *     заявки, и он обязан отличаться от них по конструкции, а не только по
 *     смыслу.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Ни вех, ни фото, ни сборки передачи: V1 открывает один
 * воркер. Ни одного HTTP-маршрута — воркер запускается процессом, а не
 * запросом, и человеческой поверхности не создаёт. Ни выбора глубины обхода:
 * её держит серверная политика. Ни редрайва — он операторское SQL-действие
 * (`projectceo_m4.redrive_change_impact_worker_failure`), не вызов этого
 * воркера.
 */

import { z } from "zod";

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
  /** Влияние посчитано этим вызовом целиком. */
  | "calculated"
  /**
   * Влияние посчитано, но частично: обход упёрся в глубину политики или в
   * лимит результата. Прогон существует и рассматривается, однако закрыть его
   * без исчерпания обхода нельзя.
   */
  | "calculated_truncated"
  /** Прогон уже существовал — его сделал прошлый проход или сосед. */
  | "already_present"
  /** Состояние проекта сдвинулось между чтением очереди и расчётом. */
  | "stale_state"
  /**
   * Постоянный отказ: baseline заявки не разрешается. Записан durable
   * (`impact_worker_failures`, `failureKind='permanent'`) и немедленно ушёл в
   * dead-letter — повтор ничего не изменит, нужен человек или оператор.
   */
  | "unresolved"
  /**
   * Транзиентный отказ (DEC-036): попытка записана, бюджет ещё не исчерпан,
   * следующая попытка наступит по `next_attempt_at` — заявка временно не
   * появится в активной очереди, пока пауза не пройдёт.
   */
  | "failed_retrying"
  /**
   * Транзиентный отказ исчерпал бюджет попыток (или запись отказа сама
   * оказалась недостижима) и ушёл в durable dead-letter — заявка исчезла из
   * активной очереди совсем. Возврат в работу — только через операторский
   * редрайв.
   */
  | "failed_dead_letter";

/**
 * Исходы, после которых работа человека или оператора всё ещё требуется.
 * Перечислены явно, а не «всё, что не успех»: новый исход обязан попасть
 * сюда осознанно, а не унаследовать чужую трактовку.
 *
 * `failed_retrying` СОЗНАТЕЛЬНО не входит: транзиентный отказ в пределах
 * бюджета попыток — ожидаемый, самовосстанавливающийся исход (тот же смысл,
 * что у `stale_state`), а не работа, оставленная человеку. Он станет
 * `failed_dead_letter` и попадёт сюда сам, если бюджет исчерпается.
 */
const NEEDS_ATTENTION: ReadonlySet<ChangeImpactOutcome> = new Set([
  "calculated_truncated",
  "unresolved",
  "failed_dead_letter",
]);

/** Ответ `record_change_impact_worker_failure` — снимок строки после upsert'а. */
const recordedFailureSchema = z.object({
  status: z.enum(["retrying", "dead_letter"]),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: z.string().nullable(),
  deadLetteredAt: z.string().nullable(),
}).strict();

export interface ChangeImpactFailureReport {
  readonly failureKind: "transient" | "permanent";
  readonly status: "retrying" | "dead_letter";
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: string | null;
  readonly deadLetteredAt: string | null;
}

export interface ChangeImpactRunResult {
  /** Политика, которой считали. В отчёт — чтобы смена числа была видна в логе. */
  readonly policy: ImpactPolicy;
  readonly scanned: number;
  readonly calculated: number;
  readonly calculatedTruncated: number;
  readonly alreadyPresent: number;
  readonly staleState: number;
  readonly unresolved: number;
  readonly failedRetrying: number;
  readonly failedDeadLetter: number;
  /** То, из-за чего проход нельзя назвать закрывшим работу. */
  readonly needsAttention: number;
  readonly items: readonly {
    readonly projectId: string;
    readonly changeRequestId: string;
    readonly rootCount: number;
    readonly outcome: ChangeImpactOutcome;
    /** Причина неполноты, если прогон частичный. */
    readonly truncationReason: "depth_limit" | "result_limit" | null;
    /** Заполнено ровно для `unresolved`/`failed_retrying`/`failed_dead_letter`. */
    readonly failure: ChangeImpactFailureReport | null;
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
    // Молча вернуть ноль заданий значило бы отчитаться «работы нет». Это
    // ЕДИНСТВЕННЫЙ throw во всём прогоне: он process-level (нечего даже
    // перечислить), а не отказ одной заявки, и обязан отличаться от них
    // конструкцией, а не только смыслом (DEC-036).
    throw new ProjectIntelligenceAdapterError("internal_error", null);
  }
  return {
    policy: envelope.data.policy,
    plan: planChangeImpactWork(envelope.data.data),
  };
}

/** Нормальный исход гонки — не отказ вовсе, записывать в durable отказ нечего. */
function outcomeFromRace(error: unknown): "already_present" | "stale_state" | null {
  if (!(error instanceof ProjectIntelligenceAdapterError)) return null;
  // Работу сделал сосед или прошлый проход, чей ответ потерялся: ключ тот же,
  // запрос другой. Для очереди это «уже готово».
  if (error.code === "idempotency_conflict") return "already_present";
  // Состояние сдвинулось между чтением и записью — нормальный исход гонки.
  if (error.code === "stale_state") return "stale_state";
  // Сосед успел записать прогон между чтением очереди и расчётом. База поднимает
  // это как `P1110 invalid_transition`, а `mapRpcError` переводит `P1110` в
  // `unsupported_source` — историческое соответствие в `errors.ts`. Проверяется
  // фактический код, а не то, как отказ называется в SQL: разойдись они, тест
  // прошёл бы на выдуманном коде.
  if (error.code === "unsupported_source"
    && error.reason === "IMPACT_ALREADY_CALCULATED") {
    return "already_present";
  }
  return null;
}

interface ErrorClassification {
  readonly isNotFound: boolean;
  readonly failureKind: "transient" | "permanent";
  readonly errorCode: string;
  readonly errorDetail: Readonly<Record<string, unknown>> | null;
}

/**
 * Всё, что не нормальный исход гонки, — отказ, и отказ обязан быть
 * классифицирован: транзиентный копит бюджет попыток, постоянный уходит в
 * dead-letter немедленно. Неизвестная ошибка (не наш типизированный отказ
 * вовсе — сеть, таймаут) СЧИТАЕТСЯ транзиентной: у неё нет оснований
 * считаться окончательной, а окончательный вердикт по неизвестной причине
 * значил бы «сдаться раньше времени».
 */
function classifyFailure(error: unknown): ErrorClassification {
  if (error instanceof ProjectIntelligenceAdapterError) {
    const errorDetail = error.reason ? { reason: error.reason } : null;
    // Заявка есть, а её baseline не разрешается. Очередь такие строки
    // намеренно не фильтрует — иначе сломанная заявка не всплыла бы никогда;
    // теперь она уходит в durable dead-letter вместо того, чтобы возвращаться
    // в очередь на каждый проход бесконечно.
    if (error.code === "not_found") {
      return { isNotFound: true, failureKind: "permanent", errorCode: error.code, errorDetail };
    }
    // Единственный код, который эта дверь может отдать без структурной
    // причины — внутренняя ошибка сервера. Достойна повтора.
    if (error.code === "internal_error") {
      return { isNotFound: false, failureKind: "transient", errorCode: error.code, errorDetail };
    }
    // Любой другой признанный код (validation_failed и т.п.) — структурный:
    // повтор с теми же входными данными не изменит исход.
    return { isNotFound: false, failureKind: "permanent", errorCode: error.code, errorDetail };
  }
  return {
    isNotFound: false,
    failureKind: "transient",
    errorCode: "unknown_error",
    errorDetail: { message: error instanceof Error ? error.message : String(error) },
  };
}

interface OneResult {
  readonly outcome: ChangeImpactOutcome;
  readonly truncationReason: "depth_limit" | "result_limit" | null;
  readonly failure: ChangeImpactFailureReport | null;
}

/**
 * Записывает отказ durable и решает итоговый исход этой заявки. Сама эта
 * функция НИКОГДА не бросает: если запись отказа тоже недостижима (сеть
 * упала дважды подряд), заявка остаётся не более чем `failed_retrying` без
 * снятого следа в базе — следующий проход попробует записать снова, а
 * остальные заявки прохода это не остановит.
 */
async function recordFailureAndReport(
  worker: ProjectCeoM4WorkerPostgresAdapter,
  item: ChangeImpactWorkItem,
  error: unknown,
): Promise<OneResult> {
  const classification = classifyFailure(error);
  let recorded: z.infer<typeof recordedFailureSchema> | null = null;
  try {
    recorded = recordedFailureSchema.parse(
      await worker.recordChangeImpactWorkerFailure({
        projectId: item.projectId,
        changeRequestId: item.changeRequestId,
        failureKind: classification.failureKind,
        errorCode: classification.errorCode,
        errorDetail: classification.errorDetail,
      }),
    );
  } catch {
    // Запись отказа сама недостижима — не повод остановить проход по
    // остальным заявкам. Эта заявка просто останется без durable следа до
    // следующей попытки.
  }

  const outcome: ChangeImpactOutcome = classification.isNotFound
    ? "unresolved"
    : recorded?.status === "dead_letter"
      ? "failed_dead_letter"
      : "failed_retrying";

  return {
    outcome,
    truncationReason: null,
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

/** Тотальная функция: для любой заявки возвращает исход, никогда не бросает. */
async function calculateOne(
  worker: ProjectCeoM4WorkerPostgresAdapter,
  item: ChangeImpactWorkItem,
): Promise<OneResult> {
  try {
    const mutation = await worker.calculateChangeImpactPolicyBound({
      projectId: item.projectId,
      changeRequestId: item.changeRequestId,
      expectedStateRevision: item.expectedStateRevision,
      idempotencyKey: item.idempotencyKey,
    });
    // Повтор по тому же ключу приходит как `replay` и второго прогона не
    // создаёт. Признаки неполноты в повторе те же — они входят в логический
    // результат команды, а не приписываются к строке после.
    const truncationReason = mutation.result.isTruncated
      ? mutation.result.truncationReason
      : null;
    if (mutation.replay) {
      return { outcome: "already_present", truncationReason, failure: null };
    }
    return {
      outcome: mutation.result.isTruncated ? "calculated_truncated" : "calculated",
      truncationReason,
      failure: null,
    };
  } catch (error) {
    const raceOutcome = outcomeFromRace(error);
    if (raceOutcome) return { outcome: raceOutcome, truncationReason: null, failure: null };
    return recordFailureAndReport(worker, item, error);
  }
}

/**
 * Один проход по очереди. Возвращает отчёт, а не бросает на нормальных исходах
 * гонки: воркер, падающий от того, что сосед его опередил, не переживает
 * параллельного запуска.
 *
 * Отказ по одной заявке не прекращает проход: `calculateOne` тотальна и
 * никогда не бросает по причине, связанной с одной заявкой (DEC-036) —
 * остальные заявки к ней отношения не имеют, и остановка означала бы, что
 * одна сломанная строка держит очередь.
 */
export async function runChangeImpactWorker(
  options: ChangeImpactRunnerOptions,
): Promise<ChangeImpactRunResult> {
  const maxRows = options.maxRows ?? 100;
  const worker = new ProjectCeoM4WorkerPostgresAdapter(options.client);
  const { policy, plan } = await readBacklog(worker, maxRows);

  const items: ChangeImpactRunResult["items"][number][] = [];
  for (const item of plan) {
    const one = await calculateOne(worker, item);
    items.push({
      projectId: item.projectId,
      changeRequestId: item.changeRequestId,
      rootCount: item.rootCount,
      outcome: one.outcome,
      truncationReason: one.truncationReason,
      failure: one.failure,
    });
  }

  const count = (outcome: ChangeImpactOutcome): number =>
    items.filter((entry) => entry.outcome === outcome).length;

  return {
    policy,
    scanned: plan.length,
    calculated: count("calculated"),
    calculatedTruncated: count("calculated_truncated"),
    alreadyPresent: count("already_present"),
    staleState: count("stale_state"),
    unresolved: count("unresolved"),
    failedRetrying: count("failed_retrying"),
    failedDeadLetter: count("failed_dead_letter"),
    needsAttention: items.filter((entry) => NEEDS_ATTENTION.has(entry.outcome)).length,
    items,
  };
}
