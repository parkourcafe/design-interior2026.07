/**
 * Правило полноты baseline — сборщик состава для варианта A′.
 *
 * Решение владельца 10.08.2026: «для M3 P0 baseline является полной
 * server-owned заморозкой актуального утверждённого состояния». Отсюда два
 * следствия, и оба важны:
 *
 *   * заморозка **полная**, а не дельта: в состав входит всё одобренное, а не
 *     только появившееся после прошлого baseline. Поэтому «уже замороженное»
 *     ниоткуда не вычитается и знать его не нужно;
 *   * состав **выводится**, а не выбирается: это правило, а не ввод.
 *
 * Почему правило живёт здесь, а не в базе. RPC
 * `projectceo_product_api.publish_project_baseline` проверяет ревизии только в
 * одну сторону: каждая переданная обязана принадлежать одобренному approval
 * package, иначе `BASELINE_REVISION_NOT_APPROVED` (`20260717101000`, строки
 * 2053–2084). Обратной проверки нет — **база не требует, чтобы вошло всё
 * одобренное**, и частичный baseline на её уровне легален. Значит полноту
 * обязан обеспечить сборщик, и если он ошибётся, никто не возразит.
 *
 * Отсюда главное решение этого модуля: **неизвестный `targetKind` — ошибка, а
 * не пропуск.** Молчаливо выброшенный элемент и есть тот самый неполный
 * baseline, который база пропустит. Ошибка на смешанном проекте, где воркер
 * завёл вид, которого сборщик не знает, лучше тихой потери.
 *
 * ОДНА СУЩНОСТЬ — ОДНА РЕВИЗИЯ (правка 11.08, найдена гейтом 2). Первая
 * редакция складывала ревизии всех одобренных пакетов в одно множество. Пока
 * baseline в проекте один, это незаметно. Как только решение пересматривают и
 * одобряют заново, в состав попадают ОБЕ ревизии одного узла — и старая, и
 * новая. База такой дескриптор отвергает: `publish_project_baseline` требует,
 * чтобы каждая ревизия входила в публикуемую версию графа
 * (`BASELINE_REVISION_NOT_IN_GRAPH_VERSION`), а версия содержит только текущие
 * ревизии узлов. То есть второй baseline, отличающийся от первого, не
 * публиковался вовсе — а без второго baseline невозможна заявка на изменение
 * (`NO_CHANGE_ROOTS`), то есть весь смысл модуля 4.
 *
 * Поэтому состав берёт по одной ревизии на сущность — из САМОГО ПОЗДНЕГО
 * одобрившего её пакета. Это не отступление от правила полноты, а его
 * уточнение: замораживается утверждённое состояние, а не история утверждений.
 *
 * ЧТО ЭТО НЕ ЧИНИТ. Если решение пересмотрели, но новую ревизию не одобрили,
 * последняя одобренная ревизия окажется устаревшей, и база откажет тем же
 * `BASELINE_REVISION_NOT_IN_GRAPH_VERSION` — уже честно, потому что
 * замораживать действительно нечего. Поверхность при этом всё ещё предложит
 * публикацию: сборщик не знает текущих ревизий графа. Названо в backlog, а не
 * починено здесь, — гейт 1 доказан на текущем поведении, и трогать его состав
 * ради несвязанного случая опаснее, чем оставить остаток названным.
 */

/** Виды, которые RPC принимает в дескрипторе (`20260717101000`, строки 2053–2062). */
const TARGET_KIND_TO_FIELD = {
  requirement_revision: "requirementRevisionIds",
  assumption_revision: "assumptionRevisionIds",
  decision_revision: "decisionRevisionIds",
  selection_revision: "selectionRevisionIds",
} as const;

type BaselineRevisionField = typeof TARGET_KIND_TO_FIELD[keyof typeof TARGET_KIND_TO_FIELD];

export class BaselineCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineCompositionError";
  }
}

export interface ApprovalPackageForBaseline {
  readonly id: string;
  readonly status: string;
  /**
   * Момент создания пакета — из проекции чтения (`approval.created_at`).
   * Нужен, чтобы решить, какое из двух одобрений одной сущности новее.
   * Обязателен: правило «побеждает последнее» без порядка не правило, а
   * случайность, а из состава считается хеш.
   */
  readonly createdAt: string;
  readonly items: readonly {
    readonly targetKind: string;
    /** Идентификатор сущности (узла), а не ревизии. */
    readonly entityId: string;
    readonly revisionId: string;
  }[];
}

export interface BaselineCompositionInput {
  /** Из `data.approvalPackages` живого чтения — там уже есть `items`. */
  readonly approvalPackages: readonly ApprovalPackageForBaseline[];
  /** Из `data.packages`. */
  readonly packageIds: readonly string[];
  /** `data.latestBaseline.id`; null для первого baseline проекта. */
  readonly previousBaselineId: string | null;
  /**
   * Ревизии источников. В approval packages их нет: RPC не сверяет их с
   * одобрением, они приходят из графа. У браузерного проекта список пуст —
   * узлы графа создаёт воркерный ingest (см. чтение v8, `20260810060000`).
   */
  readonly sourceRevisionIds?: readonly string[];
}

export interface BaselineComposition {
  readonly approvalPackageIds: readonly string[];
  readonly requirementRevisionIds: readonly string[];
  readonly assumptionRevisionIds: readonly string[];
  readonly decisionRevisionIds: readonly string[];
  readonly selectionRevisionIds: readonly string[];
  readonly sourceRevisionIds: readonly string[];
  readonly packageIds: readonly string[];
  readonly previousBaselineId: string | null;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  // Порядок и дедупликация — как у хеша: по кодовым точкам. Расхождение здесь
  // дало бы `BASELINE_SEMANTIC_HASH_MISMATCH` уже после отправки.
  return [...new Set(values)].sort(compareCodePoints);
}

/**
 * Выводит состав baseline из одобренного состояния проекта.
 *
 * Бросает `BaselineCompositionError`, если состав вывести нельзя: замораживать
 * нечего либо встретился вид ревизии, которого правило не знает.
 */
export function composeBaseline(input: BaselineCompositionInput): BaselineComposition {
  const approved = input.approvalPackages.filter((pkg) => pkg.status === "approved");
  if (approved.length === 0) {
    throw new BaselineCompositionError(
      "baseline composition: no approved approval package, nothing to freeze",
    );
  }

  const buckets: Record<BaselineRevisionField, Set<string>> = {
    requirementRevisionIds: new Set(),
    assumptionRevisionIds: new Set(),
    decisionRevisionIds: new Set(),
    selectionRevisionIds: new Set(),
  };

  // Порядок одобрения: старые сначала, поздние перезаписывают. Тай-брейк по
  // идентификатору пакета — два одобрения одной миллисекунды не имеют права
  // давать два разных состава, из состава считается хеш.
  const ordered = [...approved].sort((left, right) => (
    left.createdAt === right.createdAt
      ? compareCodePoints(left.id, right.id)
      : compareCodePoints(left.createdAt, right.createdAt)
  ));

  // Одна сущность — одна ревизия. Ключ составной: один и тот же узел не может
  // быть одновременно решением и выбором, но склеивать их в один ключ значило
  // бы решать это молча.
  const latest = new Map<string, { field: BaselineRevisionField; revisionId: string }>();
  for (const pkg of ordered) {
    if (!pkg.createdAt) {
      throw new BaselineCompositionError(
        `baseline composition: approval package ${pkg.id} carries no createdAt; `
        + "the winner between two approvals of one entity would be undefined",
      );
    }
    for (const item of pkg.items) {
      const field = TARGET_KIND_TO_FIELD[item.targetKind as keyof typeof TARGET_KIND_TO_FIELD];
      if (!field) {
        // Ровно тот случай, ради которого правило живёт в коде: пропустить
        // элемент здесь — значит выпустить неполную заморозку, которую база
        // примет молча.
        throw new BaselineCompositionError(
          `baseline composition: unknown targetKind "${item.targetKind}" `
          + `in approval package ${pkg.id}; refusing to publish an incomplete baseline`,
        );
      }
      if (!item.revisionId) {
        throw new BaselineCompositionError(
          `baseline composition: empty revisionId in approval package ${pkg.id}`,
        );
      }
      if (!item.entityId) {
        throw new BaselineCompositionError(
          `baseline composition: empty entityId in approval package ${pkg.id}; `
          + "without it a re-approved entity would be frozen twice",
        );
      }
      latest.set(`${item.targetKind} ${item.entityId}`, {
        field,
        revisionId: item.revisionId,
      });
    }
  }
  for (const { field, revisionId } of latest.values()) buckets[field].add(revisionId);

  const totalRevisions = Object.values(buckets)
    .reduce((sum, bucket) => sum + bucket.size, 0);
  if (totalRevisions === 0) {
    throw new BaselineCompositionError(
      "baseline composition: approved packages carry no revisions, nothing to freeze",
    );
  }

  return {
    approvalPackageIds: sortedUnique(approved.map((pkg) => pkg.id)),
    requirementRevisionIds: sortedUnique(buckets.requirementRevisionIds),
    assumptionRevisionIds: sortedUnique(buckets.assumptionRevisionIds),
    decisionRevisionIds: sortedUnique(buckets.decisionRevisionIds),
    selectionRevisionIds: sortedUnique(buckets.selectionRevisionIds),
    sourceRevisionIds: sortedUnique(input.sourceRevisionIds ?? []),
    packageIds: sortedUnique(input.packageIds),
    previousBaselineId: input.previousBaselineId,
  };
}
