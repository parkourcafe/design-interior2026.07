import frozenSchema from "./layout-document-v0.1.schema.json";
import type { LayoutIssue } from "./types";
import { validateAgainstDeclaredSchema } from "./schema-registry";

/**
 * Проверка документа против схемы.
 *
 * Раньше здесь был один жёстко вшитый валидатор версии 0.1. Теперь проверка
 * делегируется реестру и идёт против той версии, которую документ объявляет
 * сам: см. schema-registry.ts и требование A2 §5 — опубликованная версия
 * обязана открываться вечно в своей модели данных.
 *
 * Имя функции сохранено, чтобы не трогать десяток вызовов ради переименования.
 */
export function validateFrozenLayoutSchema(value: unknown): {
  valid: boolean;
  issues: LayoutIssue[];
} {
  const result = validateAgainstDeclaredSchema(value);
  return { valid: result.valid, issues: result.issues };
}

export { frozenSchema };
export {
  CURRENT_CONTRACT_VERSION,
  CONTRACT_VERSION_ORDER,
  isKnownContractVersion,
  knownContractVersions,
  schemaOf,
  validateAgainstDeclaredSchema,
} from "./schema-registry";
