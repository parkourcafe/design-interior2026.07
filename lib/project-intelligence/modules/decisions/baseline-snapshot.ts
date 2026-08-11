/**
 * Снапшот-токен baseline — защита от гонки между preview и подтверждением.
 *
 * Решение владельца (A′): «сервер возвращает санитизированный preview и
 * snapshot token. При подтверждении сервер атомарно пересчитывает состояние:
 * публикует ровно показанный состав либо отвечает `STATE_STALE`».
 *
 * Почему не хватило `expectedGraphVersionId`, который предлагался в варианте A:
 * `packages`, `approvals`, `decisions` и `selections` меняются, не трогая
 * версию графа. Токен обязан покрывать то, что показано человеку, а показан
 * ему состав.
 *
 * Почему токен считается по составу, а не по семантическому хешу baseline.
 * Семантический хеш включает `graphVersionId`, а версии графа в момент preview
 * ещё нет: она рождается при подтверждении, когда сборщик зовёт
 * `projectceo_api.publish_version` (дверь `20260810080000`). Токен должен
 * покрывать ровно то, что уже определено на экране, и ничего сверх — иначе он
 * либо не вычисляется, либо срабатывает там, где показанное не менялось.
 *
 * Чувствительность самого механизма проверена отдельно: все четырнадцать
 * элементов семантического хеша меняют его (`baseline-semantic-hash.test.ts`),
 * а состав здесь — подмножество тех же данных.
 */

import { semanticSha256 } from "../../application/change-handoff/canonical";
import {
  composeBaseline,
  type BaselineComposition,
  type BaselineCompositionInput,
} from "./baseline-composition";

export const BASELINE_SNAPSHOT_VERSION = "project-ceo-baseline-snapshot/0.1" as const;

export interface BaselineSnapshot {
  readonly composition: BaselineComposition;
  /** Непрозрачный для клиента токен: возвращается в preview и приходит назад. */
  readonly token: `sha256:${string}`;
}

/**
 * Канонический объект токена.
 *
 * `graphVersionId` сюда НЕ входит намеренно — см. заголовок файла. Всё
 * остальное, что уходит в дескриптор, входит: изменение любого из этих полей
 * между показом и подтверждением обязано быть замечено.
 */
function snapshotContent(composition: BaselineComposition): Readonly<Record<string, unknown>> {
  return {
    approvalPackageIds: composition.approvalPackageIds,
    assumptionRevisionIds: composition.assumptionRevisionIds,
    decisionRevisionIds: composition.decisionRevisionIds,
    packageIds: composition.packageIds,
    previousBaselineId: composition.previousBaselineId,
    requirementRevisionIds: composition.requirementRevisionIds,
    schemaVersion: BASELINE_SNAPSHOT_VERSION,
    selectionRevisionIds: composition.selectionRevisionIds,
    sourceRevisionIds: composition.sourceRevisionIds,
  };
}

/** Собирает состав и токен для экрана подтверждения. */
export function buildBaselineSnapshot(input: BaselineCompositionInput): BaselineSnapshot {
  const composition = composeBaseline(input);
  return { composition, token: semanticSha256(snapshotContent(composition)) };
}

export type BaselineConfirmation =
  | { readonly ok: true; readonly composition: BaselineComposition }
  | { readonly ok: false; readonly reason: "state_stale" };

/**
 * Пересчёт при подтверждении.
 *
 * Возвращает состав только если он побайтово тот же, что был показан. Иначе —
 * `state_stale`, и публиковать нельзя: между экраном и кнопкой состояние
 * проекта изменилось, а человек подтверждал не его.
 *
 * Отказ здесь мягкий (значение, не исключение) сознательно: это не ошибка
 * пользователя и не сбой, а нормальный исход гонки, который поверхность должна
 * показать как «состояние изменилось, посмотрите заново».
 */
export function confirmBaselineSnapshot(
  input: BaselineCompositionInput,
  expectedToken: string,
): BaselineConfirmation {
  const snapshot = buildBaselineSnapshot(input);
  if (snapshot.token !== expectedToken) return { ok: false, reason: "state_stale" };
  return { ok: true, composition: snapshot.composition };
}
