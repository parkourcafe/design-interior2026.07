/**
 * Матрица поверхности модуля 3: команда → приложение → публичная RPC →
 * состояние при выключенном модуле.
 *
 * Зачем таблица, а не комментарий. Guardrail от 11.08 закрыл публикацию и этим
 * показал, что «модуль закрыт» до тех пор проверялось на глаз: приём был под
 * флагом, выход — нет, и заметить это можно было только прочитав два файла
 * подряд. Таблица делает состав поверхности данными, а тесты рядом
 * (`m3-surface-matrix.test.ts`, `tests/db4/06_m3_surface_classification.sql`)
 * роняют CI, если появилась команда или RPC модуля, которую никто не
 * классифицировал.
 *
 * ЧТО ЗНАЧИТ `closure`. Границ у запрета две, и они закрывают разное:
 *
 *   * `revoked_from_authenticated` — закрыто ОБЕИМИ: приложение отказывает до
 *     RPC, и права в базе отозваны, поэтому прямой вызов через Data API мимо
 *     приложения тоже отказывает;
 *   * `app_gate_only` — закрыто ТОЛЬКО приложением. Прямой вызов через Data API
 *     аутентифицированной сессией сегодня пройдёт.
 *
 * `app_gate_only` — не недосмотр, а названный остаток, и вот почему он есть.
 * Отзывать права вслепую нельзя: `projectceo_api` — схема общая, в ней живут
 * операции, к модулю 3 отношения не имеющие. Закрыть такую RPC в базе можно
 * только одним из двух способов: завести M3-aware обёртку (как дверь
 * `projectceo_api.review_source`) либо серверный gate внутри самой RPC. Оба —
 * работа, а не строчка, и до неё остаток обязан быть виден здесь, а не жить
 * необнаруженным.
 *
 * Публикующие RPC в общей схеме отозваны, несмотря на общую схему, потому что
 * их семантика принадлежит модулю 3 целиком: baseline и производственная версия
 * — это выход M3, и другого потребителя у них нет.
 */

import type { ProjectCeoCommand } from "./command-contract";

export type M3RpcClosure = "revoked_from_authenticated" | "app_gate_only";

export interface M3PublicRpc {
  /** Схема и имя ровно так, как их видит PostgREST. */
  readonly schema: string;
  readonly name: string;
  /** Полная сигнатура — по ней проверяются права в базе. */
  readonly signature: string;
  /** Схема модуля или общая с M1/M2. */
  readonly sharing: "m3_only" | "shared_schema";
  readonly closure: M3RpcClosure;
}

export interface M3SurfaceRow {
  readonly command: ProjectCeoCommand["kind"];
  /** Группа поверхности — для отчёта, а не для логики. */
  readonly surface: "intake" | "review" | "documentation_sheets" | "baseline" | "release";
  /**
   * Что отдаёт поверхность чтения при выключенном модуле. Значение одно на все
   * строки намеренно: причина обязана называть закрытый модуль, а не роль и не
   * предпосылки.
   */
  readonly offState: "module_disabled";
  readonly rpcs: readonly M3PublicRpc[];
}

const PUBLISH_VERSION: M3PublicRpc = {
  schema: "projectceo_api",
  name: "publish_version",
  signature: "projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)",
  sharing: "shared_schema",
  closure: "revoked_from_authenticated",
};

export const M3_SURFACE: readonly M3SurfaceRow[] = [
  {
    command: "register_source",
    surface: "intake",
    offState: "module_disabled",
    rpcs: [{
      schema: "projectceo_api",
      name: "register_source_inventory",
      signature: "projectceo_api.register_source_inventory(uuid, jsonb, jsonb, bigint, text)",
      sharing: "shared_schema",
      // Единственный потребитель сегодня — intake модуля 3, но схема общая, и
      // права здесь снимаются вместе с правами на регистрацию источников
      // вообще. Закрытие второй границы требует обёртки — записано как остаток.
      closure: "app_gate_only",
    }],
  },
  {
    command: "review_source",
    surface: "review",
    offState: "module_disabled",
    rpcs: [{
      schema: "projectceo_api",
      name: "review_source",
      signature: "projectceo_api.review_source(uuid, text, text, bigint, text, text)",
      sharing: "m3_only",
      // Дверь заведена ради модуля 3 (`20260810050000`) и другого потребителя
      // не имеет; закрыть её в базе можно без риска для M1/M2 — остаток.
      closure: "app_gate_only",
    }],
  },
  {
    command: "register_documentation_sheet",
    surface: "documentation_sheets",
    offState: "module_disabled",
    rpcs: [{
      schema: "projectceo_m3_api",
      name: "register_documentation_sheet",
      signature: "projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)",
      sharing: "m3_only",
      closure: "app_gate_only",
    }],
  },
  {
    command: "attach_documentation_sheet_specifications",
    surface: "documentation_sheets",
    offState: "module_disabled",
    rpcs: [{
      schema: "projectceo_m3_api",
      name: "attach_documentation_sheet_specifications",
      signature: "projectceo_m3_api.attach_documentation_sheet_specifications(uuid, uuid, text, text, text, text[], text, bigint, text)",
      sharing: "m3_only",
      closure: "app_gate_only",
    }],
  },
  {
    command: "publish_baseline",
    surface: "baseline",
    offState: "module_disabled",
    rpcs: [
      PUBLISH_VERSION,
      {
        schema: "projectceo_product_api",
        name: "publish_project_baseline",
        signature: "projectceo_product_api.publish_project_baseline(uuid, jsonb, bigint, text)",
        sharing: "shared_schema",
        closure: "revoked_from_authenticated",
      },
    ],
  },
  {
    command: "publish_release",
    surface: "release",
    offState: "module_disabled",
    rpcs: [{
      schema: "projectceo_product_api",
      name: "publish_production_package_version",
      signature: "projectceo_product_api.publish_production_package_version(uuid, jsonb, bigint, text)",
      sharing: "shared_schema",
      closure: "revoked_from_authenticated",
    }],
  },
];

/** Команды модуля — производная от матрицы, а не второй список рядом с ней. */
export const M3_SURFACE_COMMANDS: ReadonlySet<ProjectCeoCommand["kind"]> = new Set(
  M3_SURFACE.map((row) => row.command),
);

/** Сигнатуры, которые обязаны быть отозваны у `authenticated`. */
export const M3_REVOKED_SIGNATURES: readonly string[] = M3_SURFACE
  .flatMap((row) => row.rpcs)
  .filter((rpc) => rpc.closure === "revoked_from_authenticated")
  .map((rpc) => rpc.signature)
  .filter((signature, index, all) => all.indexOf(signature) === index);

/**
 * Остаток: закрыто только приложением. Список существует, чтобы его было видно
 * в отчёте и чтобы он сокращался осознанно, а не забывался.
 */
export const M3_APP_GATE_ONLY_SIGNATURES: readonly string[] = M3_SURFACE
  .flatMap((row) => row.rpcs)
  .filter((rpc) => rpc.closure === "app_gate_only")
  .map((rpc) => rpc.signature)
  .filter((signature, index, all) => all.indexOf(signature) === index);
