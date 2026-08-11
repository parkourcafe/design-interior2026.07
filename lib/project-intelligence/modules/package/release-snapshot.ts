/**
 * Выпуск версии пакета по решению A′ — состав выводит сервер, клиент
 * возвращает токен.
 *
 * Это вторая половина гейта 1 (A6 §6.1) и та же болезнь, которую A′ вылечил у
 * baseline на шаг раньше: контракт команды требовал от браузера полный
 * дескриптор с собственным `semanticHash`, а собрать его из браузера было
 * нечем. Лечение то же — здесь.
 *
 * ЧТО ЗЕРКАЛИТ ЭТОТ ФАЙЛ. Объект, который
 * `projectceo_product_api.publish_production_package_version` пересобирает у
 * себя и сравнивает с присланным хешем побайтово
 * (`20260717101000`, строки 2528–2551). Совпасть обязаны и состав, и порядок:
 * RPC прогоняет каждый массив через `_sorted_unique_text_array`, который
 * сортирует по кодовым точкам и отказывает на дублях, пустых строках,
 * необрезанных значениях и длине свыше 160.
 *
 * ЧЕГО В ХЕШЕ НЕТ, вопреки ожиданию: `versionNo`. Номер версии присваивает
 * сама RPC (`max(version_no) + 1`), и в семантическое содержимое он не входит.
 * Доменный сборщик `buildProductionPackageVersion` (`orchestration.ts`) свой
 * хеш считает ИНАЧЕ — с `versionNo` — и для этой команды не годится: его хеш
 * RPC отвергнет. Поэтому здесь отдельное зеркало, а не переиспользование.
 *
 * ПОЧЕМУ ТОКЕН И ХЕШ — РАЗНЫЕ ВЕЛИЧИНЫ. Семантический хеш складывает в себя
 * `organizationId` и `projectId`, а токен рождается в чтении рабочего
 * пространства, где организации нет и быть не должно: поверхность не обязана
 * знать арендатора, чтобы показать состав. Токен покрывает ровно показанное —
 * пакет, baseline, предыдущую версию и состав, — и этого достаточно: внутри
 * одного проекта organizationId измениться не может. Та же развязка, что у
 * baseline (`baseline-snapshot.ts`), и по той же причине — токен считается
 * там, где показывают, а хеш там, где публикуют.
 */

import { semanticSha256 } from "../../application/change-handoff/canonical";
import { compareCodePoints } from "../../ordering";

export const RELEASE_SCHEMA_VERSION = "project-ceo-production-package/0.1" as const;
export const RELEASE_SNAPSHOT_VERSION = "project-ceo-release-snapshot/0.1" as const;

/** Предел `projectceo_product._assert_text` для идентификаторов ревизий. */
const MAX_ID_LENGTH = 160;

/** Пять групп ссылок — ровно те, что RPC читает из `exactRevisionRefs`. */
export interface ReleaseRevisionRefs {
  readonly sources: readonly string[];
  readonly requirements: readonly string[];
  readonly assumptions: readonly string[];
  readonly decisions: readonly string[];
  readonly selections: readonly string[];
}

export interface ReleaseCompositionInput {
  readonly packageId: string;
  readonly baselineId: string;
  /** Последняя версия этого пакета; `null` — версий ещё не было. */
  readonly previousVersionId: string | null;
  /** Состав baseline как его отдаёт чтение v9 (`20260810090000`). */
  readonly baselineRefs: ReleaseRevisionRefs;
}

export interface ReleaseComposition {
  readonly packageId: string;
  readonly baselineId: string;
  readonly previousVersionId: string | null;
  readonly exactRevisionRefs: ReleaseRevisionRefs;
  /** Сколько ревизий войдёт в версию — для экрана подтверждения. */
  readonly revisionCount: number;
}

export class ReleaseCompositionError extends Error {
  constructor(readonly field: string, readonly reason: string) {
    super(`${field}: ${reason}`);
    this.name = "ReleaseCompositionError";
  }
}

/**
 * Зеркало `projectceo_product._sorted_unique_text_array`.
 *
 * Повторяет отказ, а не чинит вход: собрать хеш из значения, которое RPC
 * никогда не примет, — худший из возможных исходов, потому что ошибка всплывёт
 * на последнем шаге и будет выглядеть расхождением хешей.
 */
function sortedUniqueTextArray(
  values: readonly string[],
  field: string,
): readonly string[] {
  for (const value of values) {
    if (value === "" || value !== value.trim() || value.length > MAX_ID_LENGTH) {
      throw new ReleaseCompositionError(field, "invalid identifier");
    }
  }
  if (new Set(values).size !== values.length) {
    throw new ReleaseCompositionError(field, "duplicate identifier");
  }
  return [...values].sort(compareCodePoints);
}

/**
 * Состав версии — это ВЕСЬ состав baseline, а не выборка из него.
 *
 * Для корневого пакета RPC требует именно полноты
 * (`ROOT_PACKAGE_REQUIRES_FULL_BASELINE`, `20260717101000`, строки 2519–2526),
 * а других пакетов у браузерного контура сегодня нет: рабочие пакеты заводит
 * не он. Поэтому подмножество здесь не строится и не предлагается — версия
 * либо выражает замороженный baseline целиком, либо не выражает ничего.
 */
export function composeRelease(input: ReleaseCompositionInput): ReleaseComposition {
  if (input.baselineId.trim() === "") {
    throw new ReleaseCompositionError("baselineId", "must not be empty");
  }
  const exactRevisionRefs: ReleaseRevisionRefs = {
    sources: sortedUniqueTextArray(input.baselineRefs.sources, "exactRevisionRefs.sources"),
    requirements: sortedUniqueTextArray(
      input.baselineRefs.requirements,
      "exactRevisionRefs.requirements",
    ),
    assumptions: sortedUniqueTextArray(
      input.baselineRefs.assumptions,
      "exactRevisionRefs.assumptions",
    ),
    decisions: sortedUniqueTextArray(input.baselineRefs.decisions, "exactRevisionRefs.decisions"),
    selections: sortedUniqueTextArray(
      input.baselineRefs.selections,
      "exactRevisionRefs.selections",
    ),
  };
  const revisionCount = Object.values(exactRevisionRefs)
    .reduce((total, ids) => total + ids.length, 0);
  // RPC отвечает `PACKAGE_VERSION_REFS_REQUIRED` на пустой состав. Ловим до
  // сети: пустой baseline — это состояние проекта, а не ошибка пользователя.
  if (revisionCount === 0) {
    throw new ReleaseCompositionError("exactRevisionRefs", "baseline carries no revisions");
  }
  return {
    packageId: input.packageId,
    baselineId: input.baselineId,
    previousVersionId: input.previousVersionId,
    exactRevisionRefs,
    revisionCount,
  };
}

export interface ReleaseSemanticContentInput {
  readonly organizationId: string;
  readonly projectId: string;
  readonly composition: ReleaseComposition;
}

/**
 * Пересобирает объект, который хеширует RPC. Порядок ключей роли не играет —
 * `canonicalJson` сортирует их по кодовым точкам, — а порядок внутри массивов
 * играет: он задан `composeRelease`, а не унаследован от входа.
 */
export function buildReleaseSemanticContent(
  input: ReleaseSemanticContentInput,
): Readonly<Record<string, unknown>> {
  const composition = input.composition;
  return {
    baselineId: composition.baselineId,
    exactRevisionRefs: {
      assumptions: composition.exactRevisionRefs.assumptions,
      decisions: composition.exactRevisionRefs.decisions,
      requirements: composition.exactRevisionRefs.requirements,
      selections: composition.exactRevisionRefs.selections,
      sources: composition.exactRevisionRefs.sources,
    },
    organizationId: input.organizationId,
    packageId: composition.packageId,
    previousVersionId: composition.previousVersionId,
    projectId: input.projectId,
    schemaVersion: RELEASE_SCHEMA_VERSION,
  };
}

/** Хеш, который RPC примет для этой версии, либо отказ, если вход негоден. */
export function computeReleaseSemanticHash(
  input: ReleaseSemanticContentInput,
): `sha256:${string}` {
  return semanticSha256(buildReleaseSemanticContent(input));
}

export interface ReleaseSnapshot {
  readonly composition: ReleaseComposition;
  /** Непрозрачный для клиента токен: уходит в preview и приходит назад. */
  readonly token: `sha256:${string}`;
}

/** Канонический объект токена — всё, что показано человеку, и ничего сверх. */
function snapshotContent(composition: ReleaseComposition): Readonly<Record<string, unknown>> {
  return {
    baselineId: composition.baselineId,
    exactRevisionRefs: {
      assumptions: composition.exactRevisionRefs.assumptions,
      decisions: composition.exactRevisionRefs.decisions,
      requirements: composition.exactRevisionRefs.requirements,
      selections: composition.exactRevisionRefs.selections,
      sources: composition.exactRevisionRefs.sources,
    },
    packageId: composition.packageId,
    previousVersionId: composition.previousVersionId,
    schemaVersion: RELEASE_SNAPSHOT_VERSION,
  };
}

/** Собирает состав и токен для экрана подтверждения. */
export function buildReleaseSnapshot(input: ReleaseCompositionInput): ReleaseSnapshot {
  const composition = composeRelease(input);
  return { composition, token: semanticSha256(snapshotContent(composition)) };
}

export type ReleaseConfirmation =
  | { readonly ok: true; readonly composition: ReleaseComposition }
  | { readonly ok: false; readonly reason: "state_stale" };

/**
 * Пересчёт при подтверждении: публикуем ровно показанное либо не публикуем.
 *
 * Отказ мягкий (значение, не исключение) — это не сбой, а нормальный исход
 * гонки: между экраном и кнопкой опубликовали новый baseline или чужую версию,
 * и человек подтверждал не то состояние.
 */
export function confirmReleaseSnapshot(
  input: ReleaseCompositionInput,
  expectedToken: string,
): ReleaseConfirmation {
  const snapshot = buildReleaseSnapshot(input);
  if (snapshot.token !== expectedToken) return { ok: false, reason: "state_stale" };
  return { ok: true, composition: snapshot.composition };
}
