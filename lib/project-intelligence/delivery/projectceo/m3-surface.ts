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
 * `app_gate_only` — не недосмотр, а названный остаток. Решением владельца 11.08
 * он сокращён до ОДНОЙ строки: `register_source_inventory`. RPC общая, и до
 * появления M3-aware обёртки отзывать её вслепую нельзя — обёртка записана в
 * backlog `M3 Production Hardening`. Всё остальное — три публикующие RPC и три
 * M3-only авторские — отозвано у `authenticated` и включается только явно
 * (`enable-m3-publication.sql`).
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

const PUBLISH_BASELINE_ATOMIC: M3PublicRpc = {
  schema: "projectceo_product_api",
  name: "publish_baseline_atomic",
  signature: "projectceo_product_api.publish_baseline_atomic(uuid, text, text, bigint, text, text)",
  sharing: "shared_schema",
  closure: "revoked_from_authenticated",
};

export const M3_SURFACE: readonly M3SurfaceRow[] = [
  {command:"bind_pdf_dwg_sheet_sidecar",surface:"review",offState:"module_disabled",
   rpcs:[{schema:"projectceo_api",name:"bind_pdf_dwg_sheet_sidecar",signature:"projectceo_api.bind_pdf_dwg_sheet_sidecar(uuid, uuid, uuid, text, text, bigint, jsonb, integer, text, jsonb, text, text)",sharing:"m3_only",closure:"revoked_from_authenticated"}]},
  {
    command: "confirm_pdf_dwg_source_pair", surface: "review", offState: "module_disabled",
    rpcs: [{ schema: "projectceo_api", name: "confirm_pdf_dwg_source_pair",
      signature: "projectceo_api.confirm_pdf_dwg_source_pair(uuid, uuid, uuid, uuid, text, text)",
      sharing: "m3_only", closure: "revoked_from_authenticated" }],
  },
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
      // не имеет — отозвана решением владельца 11.08.
      closure: "revoked_from_authenticated",
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
      closure: "revoked_from_authenticated",
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
      closure: "revoked_from_authenticated",
    }],
  },
  {
    command: "attach_external_release_refs",
    surface: "documentation_sheets",
    offState: "module_disabled",
    rpcs: [{
      schema: "projectceo_product_api",
      name: "attach_external_release_refs",
      signature: "projectceo_product_api.attach_external_release_refs(uuid, uuid, text, text, jsonb, bigint, text)",
      sharing: "shared_schema",
      closure: "revoked_from_authenticated",
    }],
  },
  {
    command: "publish_baseline",
    surface: "baseline",
    offState: "module_disabled",
    rpcs: [
      PUBLISH_BASELINE_ATOMIC,
    ],
  },
  {
    command: "publish_release",
    surface: "release",
    offState: "module_disabled",
    rpcs: [{
      schema: "projectceo_product_api",
      name: "publish_release_request_bound",
      signature: "projectceo_product_api.publish_release_request_bound(uuid, text, text, bigint, text, text)",
      sharing: "shared_schema",
      closure: "revoked_from_authenticated",
    }, { schema: "projectceo_product_api", name: "publish_work_package_release_request_bound", signature: "projectceo_product_api.publish_work_package_release_request_bound(uuid, uuid, text, text, bigint, text, text)", sharing: "shared_schema", closure: "revoked_from_authenticated" }, { schema: "projectceo_product_api", name: "publish_native_m3_release_request_bound", signature: "projectceo_product_api.publish_native_m3_release_request_bound(uuid, uuid, text, text, bigint, text, text, text)", sharing: "m3_only", closure: "revoked_from_authenticated" }],
  },
];

/** Read-only RPCs are separate from the mutation command registry. */
export const M3_READ_RPCS: readonly M3PublicRpc[] = [{
  schema: "projectceo_m3_api", name: "get_native_m3_release_context",
  signature: "projectceo_m3_api.get_native_m3_release_context(uuid, uuid)",
  sharing: "m3_only", closure: "revoked_from_authenticated",
}, {
  schema: "projectceo_read_api", name: "get_pdf_dwg_sheet_sidecar",
  signature: "projectceo_read_api.get_pdf_dwg_sheet_sidecar(uuid, uuid, uuid)", sharing: "m3_only", closure: "revoked_from_authenticated",
}, {
  schema: "projectceo_read_api", name: "get_pdf_dwg_source_pair_confirmation",
  signature: "projectceo_read_api.get_pdf_dwg_source_pair_confirmation(uuid, uuid, uuid)",
  sharing: "m3_only", closure: "revoked_from_authenticated",
}];

/** Команды модуля — производная от матрицы, а не второй список рядом с ней. */
export const M3_SURFACE_COMMANDS: ReadonlySet<ProjectCeoCommand["kind"]> = new Set(
  M3_SURFACE.map((row) => row.command),
);

/** Сигнатуры, которые обязаны быть отозваны у `authenticated`. */
const M3_RAW_PUBLICATION_SIGNATURES = [
  "projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)",
  "projectceo_product_api.publish_project_baseline(uuid, jsonb, bigint, text)",
  "projectceo_product_api.publish_production_package_version(uuid, jsonb, bigint, text)",
] as const;

export const M3_REVOKED_SIGNATURES: readonly string[] = [...M3_SURFACE
  .flatMap((row) => row.rpcs)
  .filter((rpc) => rpc.closure === "revoked_from_authenticated")
  .map((rpc) => rpc.signature)
  .filter((signature, index, all) => all.indexOf(signature) === index), ...M3_RAW_PUBLICATION_SIGNATURES, ...M3_READ_RPCS.map((rpc) => rpc.signature)]
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
