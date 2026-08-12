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
 * Инкремент 2 по классификации A6 — подписью A6 не открыт ни одной командой.
 * Вход каждой из них рождается в воркерном контуре, которого на момент A6 не
 * существовало.
 *
 * Это ИСТОРИЧЕСКИЙ состав, и он не меняется: он описывает, что именно A6 не
 * авторизовал. Что из него открыто сегодня — отдельный список ниже, а что
 * закрыто прямо сейчас — `EXECUTION_NOT_AUTHORIZED_COMMANDS`.
 */
export const EXECUTION_INCREMENT_2 = [
  "review_change_impact",
  "upload_photo_evidence",
  "review_photo_evidence",
  "accept_milestone",
  "build_handover",
] as const;

/**
 * Открыто отдельным **M4 IMPLEMENTATION GO** владельца на вертикаль V1 Impact
 * (12.08.2026, поверх DEC-032) — того самого решения, которого требовал
 * `REMHAOS_A6_CLARIFICATION_M4_EXECUTION_LAYER_2026-08-12.md` §5.
 *
 * Почему именно эта команда и почему только теперь. Её вход — `impactRunId` —
 * рождается в воркерном контуре, и до V1 контура не было: рассматривать было
 * нечего, а поверхность не имеет права обещать того, чего сервер не выполнит.
 * С появлением воркера расчёта (`workers/change-impact`) предпосылка
 * выполнена, и команда возвращается в обычный порядок: доступна, когда прогон
 * есть, и недоступна, когда его нет, — по предпосылке, а не по авторизации.
 *
 * V2 (фотодоказательства) и V3 (передача) этим GO НЕ открыты и остаются в
 * закрытом списке.
 */
export const EXECUTION_V1_IMPACT = [
  "review_change_impact",
] as const;

/**
 * DEC-034 (OWNER CONTINUE 12.08.2026, поверх DEC-033 LOCKED): закрыта
 * НАВСЕГДА, не «пока не авторизована». PR #94 открыл её тем же GO, что
 * `review_change_impact` — DEC-033 запрещает human override усечённого
 * прогона в V1: рассмотреть найденное не значит «анализ завершён», и
 * подтверждать это некому. Отдельный список, а не элемент
 * `EXECUTION_V1_IMPACT`: эта команда в принципе не тот же класс, что
 * `review_change_impact` — включение флага или GO её не касается никогда.
 */
export const EXECUTION_PERMANENTLY_CLOSED = [
  "acknowledge_impact_truncation",
] as const;

/**
 * Все команды модуля 4. Флаг закрывает их целиком: при выключенном модуле
 * поверхности нет ни у одного инкремента.
 */
export const EXECUTION_MODULE: ReadonlySet<ProjectCeoCommand["kind"]> = new Set([
  ...EXECUTION_INCREMENT_1,
  ...EXECUTION_INCREMENT_2,
  ...EXECUTION_V1_IMPACT,
  // Навсегда закрытая команда остаётся М4-командой ради флага: выключенный
  // модуль закрывает и её тоже, просто это не единственная причина закрытия.
  ...EXECUTION_PERMANENTLY_CLOSED,
] as readonly ProjectCeoCommand["kind"][]);

/** Открыто подписью A6. Живёт только при включённом флаге. */
export const EXECUTION_INCREMENT_1_COMMANDS: ReadonlySet<ProjectCeoCommand["kind"]> =
  new Set(EXECUTION_INCREMENT_1 as readonly ProjectCeoCommand["kind"][]);

/** Открыто GO на V1. Живёт только при включённом флаге — как инкремент 1. */
export const EXECUTION_V1_IMPACT_COMMANDS: ReadonlySet<ProjectCeoCommand["kind"]> =
  new Set(EXECUTION_V1_IMPACT as readonly ProjectCeoCommand["kind"][]);

/**
 * Закрыто НЕЗАВИСИМО от флага.
 *
 * Флаг отвечает на вопрос «включён ли модуль», а эти команды закрыты не этим:
 * их не авторизовал ни один подписанный документ (A6 §1.1) и ни один
 * последующий GO, и до отдельного решения о своих вертикалях они обязаны
 * оставаться закрытыми даже там, где модуль намеренно открыт. Поэтому проверка
 * отдельная и стоит до флага: иначе «включить M4» означало бы «включить и то,
 * что никто не разрешал». `acknowledge_impact_truncation` (DEC-034) входит
 * сюда же тем же списком, тем же кодом ответа: у неё нет отдельного статуса —
 * она так же навсегда недоступна, как V2/V3.
 *
 * Множество выводится вычитанием, а не переписывается руками: пока это был
 * второй список рядом с первым, открытие одной команды означало правку в двух
 * местах — и расхождение между ними никто бы не заметил.
 */
export const EXECUTION_NOT_AUTHORIZED_COMMANDS: ReadonlySet<ProjectCeoCommand["kind"]> =
  new Set([
    ...(EXECUTION_INCREMENT_2 as readonly ProjectCeoCommand["kind"][])
      .filter((kind) => !EXECUTION_V1_IMPACT_COMMANDS.has(kind)),
    ...EXECUTION_PERMANENTLY_CLOSED,
  ] as readonly ProjectCeoCommand["kind"][]);
