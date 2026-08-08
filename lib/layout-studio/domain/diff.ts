import { canonicalValue } from "./canonical";
import { ENTITY_COLLECTIONS, ENTITY_TYPES, entityArray, isRecord } from "./shared";
import type {
  LayoutDocument,
  LayoutDocumentDiff,
  LayoutEntity,
  LayoutEntityDiff,
  LayoutFieldDiff,
} from "./types";

function fieldDiffs(before: unknown, after: unknown, path = ""): LayoutFieldDiff[] {
  if (Object.is(before, after)) return [];
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => {
      const childPath = path ? `${path}.${key}` : key;
      return fieldDiffs(before[key], after[key], childPath);
    });
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (JSON.stringify(canonicalValue(before)) === JSON.stringify(canonicalValue(after))) return [];
  }
  return [{ path, before, after }];
}

export function diffLayoutDocuments(
  fromVersionId: string,
  before: LayoutDocument,
  toVersionId: string,
  after: LayoutDocument,
): LayoutDocumentDiff {
  const beforeEntities = new Map<string, { type: string; entity: LayoutEntity }>();
  const afterEntities = new Map<string, { type: string; entity: LayoutEntity }>();

  for (const collectionName of ENTITY_COLLECTIONS) {
    for (const entity of entityArray(before, collectionName)) {
      beforeEntities.set(entity.id, { type: ENTITY_TYPES[collectionName], entity });
    }
    for (const entity of entityArray(after, collectionName)) {
      afterEntities.set(entity.id, { type: ENTITY_TYPES[collectionName], entity });
    }
  }

  const addedEntityIds = [...afterEntities.keys()]
    .filter((id) => !beforeEntities.has(id))
    .sort();
  const removedEntityIds = [...beforeEntities.keys()]
    .filter((id) => !afterEntities.has(id))
    .sort();
  const changed: LayoutEntityDiff[] = [];

  for (const id of [...beforeEntities.keys()].sort()) {
    const previous = beforeEntities.get(id);
    const current = afterEntities.get(id);
    if (!previous || !current) continue;
    const fields = fieldDiffs(previous.entity, current.entity).filter((field) => field.path !== "id");
    if (fields.length > 0) {
      changed.push({ entityId: id, entityType: current.type, fields });
    }
  }

  return { fromVersionId, toVersionId, addedEntityIds, removedEntityIds, changed };
}
