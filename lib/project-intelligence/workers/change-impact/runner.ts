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
 *   * **Неполнота не тонет.** С решением владельца от 12.08.2026 расчёт больше
 *     не отказывается при достижении границы: он сохраняет частичный результат
 *     и помечает его (`isTruncated`, `truncationReason`). Такой прогон
 *     рассматривать можно, но ЗАКРЫТЬ нельзя без подтверждения архитектора —
 *     значит человек всё равно нужен, и воркер обязан это назвать. Он и
 *     неразрешимый baseline считаются отдельно и поднимаются в отчёт: молча
 *     положить их рядом с «уже готово» значило бы отчитаться об успехе
 *     прохода, после которого работа человека всё ещё требуется.
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
  /** Влияние посчитано этим вызовом целиком. */
  | "calculated"
  /**
   * Влияние посчитано, но частично: обход упёрся в глубину политики или в
   * лимит результата. Прогон существует и рассматривается, однако закрыть его
   * без подтверждения архитектора нельзя.
   */
  | "calculated_truncated"
  /** Прогон уже существовал — его сделал прошлый проход или сосед. */
  | "already_present"
  /** Состояние проекта сдвинулось между чтением очереди и расчётом. */
  | "stale_state"
  /** Отказ: baseline заявки не разрешается (нужен человек). */
  | "unresolved";

/**
 * Исходы, после которых работа человека всё ещё требуется. Перечислены явно, а
 * не «всё, что не успех»: новый исход обязан попасть сюда осознанно, а не
 * унаследовать чужую трактовку.
 */
const NEEDS_ATTENTION: ReadonlySet<ChangeImpactOutcome> = new Set([
  "calculated_truncated",
  "unresolved",
]);

export interface ChangeImpactRunResult {
  /** Политика, которой считали. В отчёт — чтобы смена числа была видна в логе. */
  readonly policy: ImpactPolicy;
  readonly scanned: number;
  readonly calculated: number;
  readonly calculatedTruncated: number;
  readonly alreadyPresent: number;
  readonly staleState: number;
  readonly unresolved: number;
  /** То, из-за чего проход нельзя назвать закрывшим работу. */
  readonly needsAttention: number;
  readonly items: readonly {
    readonly projectId: string;
    readonly changeRequestId: string;
    readonly rootCount: number;
    readonly outcome: ChangeImpactOutcome;
    /** Причина неполноты, если прогон частичный. */
    readonly truncationReason: "depth_limit" | "result_limit" | null;
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
  // Сосед успел записать прогон между чтением очереди и расчётом. База поднимает
  // это как `P1110 invalid_transition`, а `mapRpcError` переводит `P1110` в
  // `unsupported_source` — историческое соответствие в `errors.ts`. Проверяется
  // фактический код, а не то, как отказ называется в SQL: разойдись они, тест
  // прошёл бы на выдуманном коде.
  if (error.code === "unsupported_source"
    && error.reason === "IMPACT_ALREADY_CALCULATED") {
    return "already_present";
  }
  // Незнакомый отказ — не «нормальный исход». Пусть падает: воркер, тихо
  // считающий незнакомую ошибку успехом, отчитается о работе, которой не было.
  return null;
}

interface OneResult {
  readonly outcome: ChangeImpactOutcome;
  readonly truncationReason: "depth_limit" | "result_limit" | null;
}

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
      return { outcome: "already_present", truncationReason };
    }
    return {
      outcome: mutation.result.isTruncated ? "calculated_truncated" : "calculated",
      truncationReason,
    };
  } catch (error) {
    const outcome = outcomeFromError(error);
    if (outcome) return { outcome, truncationReason: null };
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
    const one = await calculateOne(worker, item);
    items.push({
      projectId: item.projectId,
      changeRequestId: item.changeRequestId,
      rootCount: item.rootCount,
      outcome: one.outcome,
      truncationReason: one.truncationReason,
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
    needsAttention: items.filter((entry) => NEEDS_ATTENTION.has(entry.outcome)).length,
    items,
  };
}
