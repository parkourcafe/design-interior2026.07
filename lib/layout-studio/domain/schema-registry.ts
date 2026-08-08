import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

import schemaV01 from "./layout-document-v0.1.schema.json";
import type { LayoutIssue } from "./types";

/**
 * Реестр версий модели документа.
 *
 * Существует ради одного требования, зафиксированного в аддендуме A4:
 *
 *   Любая опубликованная версия должна открываться и выгружаться вечно, ровно
 *   в той модели данных, в которой была опубликована.
 *
 * Причина не в аккуратности, а в устройстве продукта. Опубликованная версия
 * неизменяема — это гарантируется триггером в базе, и на неё ссылается
 * семантический хеш в выгруженных файлах. Мигрировать её нельзя: миграция
 * сделала бы подпись ложной. Значит, единственный способ развивать модель —
 * добавлять версии, никогда не удаляя читателей старых.
 *
 * Практическое правило для того, кто придёт после: **строку из SCHEMAS нельзя
 * удалить никогда**, даже если кажется, что «этой версией никто не
 * пользуется». Где-то лежит опубликованная версия, экспорт которой обязан
 * открыться. Тест schema-registry.test.ts падает при попытке удалить.
 */

/** Версия, в которой создаются новые документы. */
export const CURRENT_CONTRACT_VERSION = "archidom.layout-document/0.1";

/**
 * Все версии, которые когда-либо публиковались. Только добавление.
 *
 * При добавлении версии: положить рядом файл схемы, добавить строку сюда,
 * добавить версию в список в тесте. Ничего не удалять.
 */
const SCHEMAS: Readonly<Record<string, object>> = {
  "archidom.layout-document/0.1": schemaV01,
};

/** Порядок версий от старой к новой. Нужен миграциям черновиков. */
export const CONTRACT_VERSION_ORDER: readonly string[] = [
  "archidom.layout-document/0.1",
];

export function isKnownContractVersion(version: unknown): version is string {
  return typeof version === "string" && version in SCHEMAS;
}

export function knownContractVersions(): readonly string[] {
  return Object.keys(SCHEMAS);
}

// Компиляция AJV дорогая, поэтому валидаторы собираются один раз по требованию.
// Отдельный экземпляр Ajv на версию: у схем разных версий совпадают $id
// внутренних определений, и один общий экземпляр отказался бы их регистрировать.
const compiled = new Map<string, ValidateFunction>();

function validatorFor(version: string): ValidateFunction {
  const cached = compiled.get(version);
  if (cached) return cached;
  const schema = SCHEMAS[version];
  if (!schema) throw new Error(`Неизвестная версия модели документа: ${version}`);
  const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  compiled.set(version, validator);
  return validator;
}

function issueFrom(error: ErrorObject): LayoutIssue {
  return {
    code:
      error.keyword === "type" && error.params.type === "integer"
        ? "NON_INTEGER_DIMENSION"
        : "FROZEN_SCHEMA_INVALID",
    severity: "blocking",
    message: error.message ?? "Документ не соответствует объявленной схеме",
    path: error.instancePath || "/",
  };
}

export interface SchemaCheck {
  valid: boolean;
  issues: LayoutIssue[];
  /** Версия, против которой фактически проверяли. */
  version: string | null;
}

/**
 * Проверить документ против схемы, которую он САМ объявляет.
 *
 * Именно «сам объявляет», а не «текущей»: документ версии 0.1 обязан
 * оставаться валидным после появления 0.2, иначе старая опубликованная версия
 * перестала бы открываться — ровно то, что запрещено.
 *
 * Отсутствующая или незнакомая версия — блокирующая ошибка, а не молчаливый
 * откат к текущей схеме. Молчаливый откат означал бы, что документ из будущего
 * читается сегодняшними правилами и «почти работает».
 */
export function validateAgainstDeclaredSchema(value: unknown): SchemaCheck {
  const declared =
    typeof value === "object" && value !== null
      ? (value as { contractVersion?: unknown }).contractVersion
      : undefined;

  if (declared === undefined) {
    return {
      valid: false,
      version: null,
      issues: [
        {
          code: "CONTRACT_VERSION_MISSING",
          severity: "blocking",
          message: "Документ не объявляет версию модели данных",
          path: "/contractVersion",
        },
      ],
    };
  }

  if (!isKnownContractVersion(declared)) {
    return {
      valid: false,
      version: null,
      issues: [
        {
          code: "CONTRACT_VERSION_UNKNOWN",
          severity: "blocking",
          message: `Неизвестная версия модели данных: ${String(declared)}`,
          path: "/contractVersion",
        },
      ],
    };
  }

  const validator = validatorFor(declared);
  const valid = validator(value);
  return {
    valid: Boolean(valid),
    version: declared,
    issues: valid ? [] : (validator.errors ?? []).map(issueFrom),
  };
}

/** Схема конкретной версии — для экспорта и отладки. */
export function schemaOf(version: string): object {
  const schema = SCHEMAS[version];
  if (!schema) throw new Error(`Неизвестная версия модели документа: ${version}`);
  return schema;
}
