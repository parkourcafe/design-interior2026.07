/**
 * Флаг модуля 4 «Исполнение» — guardrail от 10.08.2026
 * (`docs/canonical/remhaos-v1/REMHAOS_GUARDRAIL_DECISION_M4_FLAG.md`).
 *
 * Выключен по умолчанию: отсутствие переменной означает «закрыто», а не
 * «неизвестно». Флаг серверный — в браузер он не передаётся, иначе его можно
 * было бы обойти из клиента.
 *
 * ВАЖНО про границы. Этот флаг закрывает ОДНУ из двух границ — приложение.
 * Вторая граница — база: схема `projectceo_m4_api` отдана Data API
 * (`supabase/config.toml`), а её командные RPC были выданы роли
 * `authenticated`, то есть их можно было позвать напрямую через PostgREST,
 * минуя приложение целиком. Эту дыру закрывает миграция
 * `20260810070000_projectceo_m4_execution_guardrail.sql`. Один флаг без неё
 * описывал бы запрет, а не создавал его — см. §3 guardrail.
 *
 * И этого оказалось мало. Отзыв по схеме `projectceo_m4_api` не касался
 * четырёх командных RPC модуля, живущих в ПРОДУКТОВОЙ схеме
 * (`distribute_release`, `acknowledge_release` и их request-bound версии):
 * выдача выпущенного пакета и подтверждение получения оставались доступны через
 * Data API при выключенном модуле. Закрывает `20260811020000`. Полный состав
 * поверхности — матрица `m4-surface.ts`, и она сверяется с базой тестами, а не
 * читается глазами.
 */

import type { ProjectCeoCommand } from "./command-contract";

export function isExecutionModuleEnabled(
  value = process.env.REMHAOS_EXECUTION_ENABLED,
): boolean {
  return value === "true";
}

/**
 * Инкремент 1 — открыт подписью A6 от 10.08.2026 (DEC-025). Человеческие
 * операции без воркерных предпосылок.
 */
export const EXECUTION_INCREMENT_1 = [
  "distribute_release",
  "acknowledge_release",
  "create_change",
] as const;

/**
 * Инкремент 2 — A6 НЕ открывает. Вход каждой из этих команд рождается в
 * воркерном контуре, которого нет; его построение требует отдельного решения.
 */
export const EXECUTION_INCREMENT_2 = [
  "review_change_impact",
  "upload_photo_evidence",
  "review_photo_evidence",
  "accept_milestone",
  "build_handover",
] as const;

/**
 * Все команды модуля 4. Флаг закрывает их целиком: при выключенном модуле
 * поверхности нет ни у одного инкремента.
 */
export const EXECUTION_MODULE: ReadonlySet<ProjectCeoCommand["kind"]> = new Set([
  ...EXECUTION_INCREMENT_1,
  ...EXECUTION_INCREMENT_2,
] as readonly ProjectCeoCommand["kind"][]);

/** Открыто подписью A6. Живёт только при включённом флаге. */
export const EXECUTION_INCREMENT_1_COMMANDS: ReadonlySet<ProjectCeoCommand["kind"]> =
  new Set(EXECUTION_INCREMENT_1 as readonly ProjectCeoCommand["kind"][]);

/**
 * Закрыто НЕЗАВИСИМО от флага.
 *
 * Флаг отвечает на вопрос «включён ли модуль», а инкремент 2 закрыт не этим:
 * его не авторизовал ни один подписанный документ (A6 §1.1), и до отдельного
 * решения о воркерном контуре он обязан оставаться закрытым даже там, где
 * модуль намеренно открыт. Поэтому проверка отдельная и стоит до флага: иначе
 * «включить M4» означало бы «включить и то, что никто не разрешал».
 */
export const EXECUTION_INCREMENT_2_COMMANDS: ReadonlySet<ProjectCeoCommand["kind"]> =
  new Set(EXECUTION_INCREMENT_2 as readonly ProjectCeoCommand["kind"][]);
