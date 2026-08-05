import type { LayoutDocument, LayoutVersion } from "./types";

export interface ChangedField { path: string; before: unknown; after: unknown }
export interface ChangedEntity { entityId: string; entityType: string; fields: ChangedField[] }
export interface LayoutDiff { fromVersionId: string; toVersionId: string; addedEntityIds: string[]; removedEntityIds: string[]; changed: ChangedEntity[] }

function walk(before: unknown, after: unknown, path = ""): ChangedField[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) || Array.isArray(after)) return [{ path, before, after }];
  return [...new Set([...Object.keys(before as object), ...Object.keys(after as object)])].flatMap((key) => walk((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
}

export function diffLayoutVersions(from: LayoutVersion, to: LayoutVersion): LayoutDiff {
  const collections = ["nodes", "walls", "openings", "columns", "objects", "clearanceZones", "materials", "materialAssignments", "lights"] as const;
  const before = new Map<string, { type: string; value: unknown }>(); const after = new Map<string, { type: string; value: unknown }>();
  for (const key of collections) { for (const value of from.content[key]) before.set(value.id, { type: key, value }); for (const value of to.content[key]) after.set(value.id, { type: key, value }); }
  const addedEntityIds = [...after.keys()].filter((id) => !before.has(id)); const removedEntityIds = [...before.keys()].filter((id) => !after.has(id));
  const changed = [...before.keys()].filter((id) => after.has(id)).flatMap((id) => { const a = before.get(id)!; const fields = walk(a.value, after.get(id)!.value); return fields.length ? [{ entityId: id, entityType: a.type, fields }] : []; });
  const rootBefore: Partial<LayoutDocument> = structuredClone(from.content); const rootAfter: Partial<LayoutDocument> = structuredClone(to.content);
  for (const key of collections) { delete rootBefore[key]; delete rootAfter[key]; } delete rootBefore.stateRevision; delete rootAfter.stateRevision;
  const rootFields = walk(rootBefore, rootAfter);
  if (rootFields.length) changed.unshift({ entityId: from.content.documentId, entityType: "document", fields: rootFields });
  return { fromVersionId: from.versionId, toVersionId: to.versionId, addedEntityIds, removedEntityIds, changed };
}
