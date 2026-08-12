/**
 * Матрица поверхности модуля 4: команда → инкремент → публичные RPC →
 * состояние при выключенном модуле и при включённом.
 *
 * Зачем таблица, а не комментарий — тот же урок, что и у M3
 * (`m3-surface.ts`). Guardrail модуля 4 (`20260810070000`) закрыл схему
 * `projectceo_m4_api` целиком и этим выглядел исчерпывающим. Он им не был:
 * четыре командные RPC модуля 4 живут в ЧУЖОЙ схеме
 * (`projectceo_product_api.distribute_release*`, `acknowledge_release*`), права
 * на них выданы `authenticated` ещё в `20260717101000` и `20260718124958`, и
 * сплошной `revoke` по схеме M4 их не касался. То есть выдача и подтверждение
 * получения были доступны через Data API при выключенном модуле. Закрывает это
 * `20260811020000`; здесь — таблица, по которой то же самое проверяется
 * тестами, а не глазами.
 *
 * ЧТО ЗНАЧИТ `closure`:
 *
 *   * `revoked_from_authenticated` — закрыто в базе навсегда для человеческой
 *     сессии. Ни одна среда этих прав не возвращает;
 *   * `enabled_by_environment_script` — закрыто по умолчанию тем же `revoke`, а
 *     возвращается ЯВНО и только там, где модуль намеренно открыт
 *     (`tests/ap1/environment/enable-m4-increment-1.sql`: локальный стенд,
 *     одноразовый стек AP5). Это не production feature flag — по решению
 *     владельца от 11.08 production-включение остаётся отдельным решением.
 *
 * ЧТО ЗНАЧИТ `onState` — состояние при ВКЛЮЧЁННОМ модуле:
 *
 *   * инкремент 1 открыт подписью A6 (DEC-025) и живёт обычной жизнью
 *     действия: доступно, когда есть предпосылки;
 *   * инкремент 2 A6 НЕ открывает, и флаг модуля тут ни при чём. Он закрыт
 *     отдельной проверкой в команде и отдельной причиной на поверхности —
 *     `increment_not_authorized`. Сказать здесь `module_disabled` значило бы
 *     соврать: модуль включён, не открыт именно инкремент.
 */

import type { ProjectCeoCommand } from "./command-contract";
import { EXECUTION_INCREMENT_1, EXECUTION_V1_IMPACT } from "./execution-flag";

export type M4RpcClosure = "revoked_from_authenticated" | "enabled_by_environment_script";

export interface M4PublicRpc {
  /** Схема и имя ровно так, как их видит PostgREST. */
  readonly schema: string;
  readonly name: string;
  /** Полная сигнатура — по ней проверяются права в базе. */
  readonly signature: string;
  /** Схема модуля или общая с продуктовым мозгом. */
  readonly sharing: "m4_only" | "shared_schema";
  readonly closure: M4RpcClosure;
}

export interface M4SurfaceRow {
  readonly command: ProjectCeoCommand["kind"];
  /** 1 — открыт A6; 2 — не открыт ничем. */
  readonly increment: 1 | 2;
  /**
   * Что отдаёт поверхность чтения при выключенном модуле. Значение одно на все
   * строки намеренно: причина обязана называть закрытый модуль, а не роль и не
   * предпосылки.
   */
  readonly offState: "module_disabled";
  /** Что отдаёт поверхность при включённом модуле. */
  readonly onState: "precondition_driven" | "increment_not_authorized";
  readonly rpcs: readonly M4PublicRpc[];
}

export const M4_SURFACE: readonly M4SurfaceRow[] = [
  {
    command: "distribute_release",
    increment: 1,
    offState: "module_disabled",
    onState: "precondition_driven",
    rpcs: [
      {
        schema: "projectceo_product_api",
        name: "distribute_release_request_bound",
        signature: "projectceo_product_api.distribute_release_request_bound(uuid, text, uuid, bigint, text)",
        sharing: "shared_schema",
        closure: "enabled_by_environment_script",
      },
      {
        // Дверь до request-bound версии. Приложение её не зовёт, но делает она
        // ровно то же самое, и оставить её открытой значило бы закрыть команду
        // на одной двери из двух. Её семантику (чужой получатель, чужой хеш)
        // проверяет `tests/db4/20_product_operations.sql`, поэтому дверь не
        // отзывается насмерть, а живёт по тому же правилу, что и остальной
        // инкремент 1: закрыта по умолчанию, открыта там, где модуль открыт.
        // Свести две двери к одной — пункт backlog `M4 Production Hardening`.
        schema: "projectceo_product_api",
        name: "distribute_release",
        signature: "projectceo_product_api.distribute_release(uuid, text, uuid, bigint, text)",
        sharing: "shared_schema",
        closure: "enabled_by_environment_script",
      },
    ],
  },
  {
    command: "acknowledge_release",
    increment: 1,
    offState: "module_disabled",
    onState: "precondition_driven",
    rpcs: [
      {
        schema: "projectceo_product_api",
        name: "acknowledge_release_request_bound",
        signature: "projectceo_product_api.acknowledge_release_request_bound(uuid, uuid, text, bigint, text)",
        sharing: "shared_schema",
        closure: "enabled_by_environment_script",
      },
      {
        // См. комментарий у `distribute_release`: вторая дверь той же команды.
        schema: "projectceo_product_api",
        name: "acknowledge_release",
        signature: "projectceo_product_api.acknowledge_release(uuid, uuid, text, bigint, text)",
        sharing: "shared_schema",
        closure: "enabled_by_environment_script",
      },
    ],
  },
  {
    command: "create_change",
    increment: 1,
    offState: "module_disabled",
    onState: "precondition_driven",
    rpcs: [
      {
        schema: "projectceo_m4_api",
        name: "submit_change_request",
        signature: "projectceo_m4_api.submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, bigint, text)",
        sharing: "m4_only",
        closure: "enabled_by_environment_script",
      },
      {
        // Повтор той же команды обязан отвечать прежним результатом, а не
        // вторым изменением: без этой обёртки идемпотентность инкремента 1
        // существовала бы только на бумаге.
        schema: "projectceo_m4_api",
        name: "replay_submit_change_request",
        signature: "projectceo_m4_api.replay_submit_change_request(uuid, uuid, text, text, text, text, bigint, integer, text)",
        sharing: "m4_only",
        closure: "enabled_by_environment_script",
      },
    ],
  },
  {
    // Классификация A6 не меняется — команда как была во втором инкременте,
    // так и осталась. Изменилось разрешение: GO на V1 от 12.08.2026 открыл её
    // отдельно, после того как появился воркер, рождающий её вход.
    command: "review_change_impact",
    increment: 2,
    offState: "module_disabled",
    onState: "precondition_driven",
    rpcs: [
      {
        schema: "projectceo_m4_api",
        name: "review_change_impact",
        signature: "projectceo_m4_api.review_change_impact(uuid, uuid, text, text, text, bigint, text)",
        sharing: "m4_only",
        closure: "enabled_by_environment_script",
      },
      {
        schema: "projectceo_m4_api",
        name: "replay_review_change_impact",
        signature: "projectceo_m4_api.replay_review_change_impact(uuid, uuid, text, text, text, text)",
        sharing: "m4_only",
        closure: "enabled_by_environment_script",
      },
    ],
  },
  {
    // DEC-034 (OWNER CONTINUE 12.08.2026, поверх DEC-033 LOCKED): PR #94
    // открыла эту дверь тем же GO, что `review_change_impact` — DEC-033
    // запрещает human override усечённого прогона в V1, поэтому дверь
    // закрыта НАВСЕГДА, не «пока не открыта окружением». `closure` отражает
    // фактическое состояние базы: `revoke` стоит в постоянной миграции
    // (`20260813010000`) и не снимается ни одним GO и ни одним переключателем
    // production — `onState` использует то же значение, что и закрытые V2/V3,
    // потому что для вызывающего эта дверь неотличима от них.
    command: "acknowledge_impact_truncation",
    increment: 2,
    offState: "module_disabled",
    onState: "increment_not_authorized",
    rpcs: [
      {
        schema: "projectceo_m4_api",
        name: "acknowledge_impact_truncation",
        signature: "projectceo_m4_api.acknowledge_impact_truncation(uuid, uuid, text, bigint, text)",
        sharing: "m4_only",
        closure: "revoked_from_authenticated",
      },
    ],
  },
  {
    command: "upload_photo_evidence",
    increment: 2,
    offState: "module_disabled",
    onState: "increment_not_authorized",
    rpcs: [
      {
        schema: "projectceo_m4_api",
        name: "register_photo_evidence",
        signature: "projectceo_m4_api.register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, bigint, text)",
        sharing: "m4_only",
        closure: "revoked_from_authenticated",
      },
      {
        schema: "projectceo_m4_api",
        name: "replay_register_photo_evidence",
        signature: "projectceo_m4_api.replay_register_photo_evidence(uuid, uuid, text, text, text, timestamptz, text, text)",
        sharing: "m4_only",
        closure: "revoked_from_authenticated",
      },
    ],
  },
  {
    command: "review_photo_evidence",
    increment: 2,
    offState: "module_disabled",
    onState: "increment_not_authorized",
    rpcs: [
      {
        schema: "projectceo_m4_api",
        name: "review_photo_evidence",
        signature: "projectceo_m4_api.review_photo_evidence(uuid, uuid, text, text, bigint, text)",
        sharing: "m4_only",
        closure: "revoked_from_authenticated",
      },
      {
        schema: "projectceo_m4_api",
        name: "replay_review_photo_evidence",
        signature: "projectceo_m4_api.replay_review_photo_evidence(uuid, uuid, text, text, text)",
        sharing: "m4_only",
        closure: "revoked_from_authenticated",
      },
    ],
  },
  {
    command: "accept_milestone",
    increment: 2,
    offState: "module_disabled",
    onState: "increment_not_authorized",
    rpcs: [
      {
        schema: "projectceo_m4_api",
        name: "accept_milestone",
        signature: "projectceo_m4_api.accept_milestone(uuid, uuid, bigint, text)",
        sharing: "m4_only",
        closure: "revoked_from_authenticated",
      },
      {
        schema: "projectceo_m4_api",
        name: "replay_accept_milestone",
        signature: "projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)",
        sharing: "m4_only",
        closure: "revoked_from_authenticated",
      },
    ],
  },
  {
    command: "build_handover",
    increment: 2,
    offState: "module_disabled",
    onState: "increment_not_authorized",
    rpcs: [
      {
        // Воркерный путь с отдельным allowlist (AP3 §10): человеческой команды
        // нет и не будет, поэтому права `authenticated` здесь не появляются ни
        // в одной среде.
        schema: "projectceo_m4_api",
        name: "build_construction_handover",
        signature: "projectceo_m4_api.build_construction_handover(uuid, uuid, text, bigint, text)",
        sharing: "m4_only",
        closure: "revoked_from_authenticated",
      },
    ],
  },
];

/**
 * Функции схемы модуля, у которых человеческой команды нет вовсе: воркерный
 * расчёт, воркерный план вех, регистрация документа передачи и читающая RPC
 * рабочего пространства. Список существует, чтобы сценарий классификации
 * (`tests/db4/08_m4_surface_classification.sql`) отличал «не команда» от
 * «команда, которую забыли внести в матрицу».
 */
export const M4_NON_COMMAND_FUNCTIONS: readonly string[] = [
  "calculate_change_impact",
  "define_milestone",
  "register_handover_document",
  // Единственная функция схемы, доступная человеческой сессии: без неё
  // рабочее пространство перестанет читаться (см. `20260810070000`).
  "get_execution_delivery",
  // V1 Impact: воркерные двери расчёта (`20260812010000`). Человеческой
  // команды у них нет и не будет — влияние считает система, а человек
  // рассматривает готовый прогон командой `review_change_impact`. Права
  // выданы только `service_role`.
  "calculate_change_impact_policy_bound",
  "list_change_impact_backlog",
  // OWNER REVIEW (поверх DEC-034/035): дверь воркера, записывающая durable
  // отказ (DEC-036). Та же системная identity, тот же принцип — человеческой
  // команды нет и не будет.
  "record_change_impact_worker_failure",
];

/** Команды модуля — производная от матрицы, а не второй список рядом с ней. */
export const M4_SURFACE_COMMANDS: ReadonlySet<ProjectCeoCommand["kind"]> = new Set(
  M4_SURFACE.map((row) => row.command),
);

function signatures(predicate: (rpc: M4PublicRpc) => boolean): readonly string[] {
  return M4_SURFACE
    .flatMap((row) => row.rpcs)
    .filter(predicate)
    .map((rpc) => rpc.signature)
    .filter((signature, index, all) => all.indexOf(signature) === index);
}

/** Отозвано у `authenticated` навсегда — ни одна среда не возвращает. */
export const M4_REVOKED_SIGNATURES: readonly string[] = signatures(
  (rpc) => rpc.closure === "revoked_from_authenticated",
);

/**
 * Открываемые сигнатуры конкретного набора команд.
 *
 * Разделение по наборам появилось с открытием V1: пока открываемым был ровно
 * инкремент 1, хватало одного списка и одного скрипта среды. Теперь скриптов
 * два, и каждый обязан сверяться со своим списком — иначе тест «скрипт
 * открывает ровно то, что положено» проходил бы, открывай он что угодно из
 * общей кучи.
 */
function openableSignatures(commands: readonly string[]): readonly string[] {
  const scope = new Set(commands);
  return M4_SURFACE
    .filter((row) => scope.has(row.command))
    .flatMap((row) => row.rpcs)
    .filter((rpc) => rpc.closure === "enabled_by_environment_script")
    .map((rpc) => rpc.signature)
    .filter((signature, index, all) => all.indexOf(signature) === index);
}

/** Закрыто по умолчанию, открывается явно там, где модуль намеренно включён. */
export const M4_INCREMENT_1_SIGNATURES: readonly string[] =
  openableSignatures(EXECUTION_INCREMENT_1);

/** То же для вертикали V1 Impact — открывается своим скриптом среды. */
export const M4_V1_IMPACT_SIGNATURES: readonly string[] =
  openableSignatures(EXECUTION_V1_IMPACT);
