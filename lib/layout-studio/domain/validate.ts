import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import schema from "./layout-document-v0.1.schema.json";
import type { LayoutDocument, PointMm, ValidationIssue } from "./types";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile<LayoutDocument>(schema);
const blocking = (code: string, entityIds: string[], details?: Record<string, unknown>): ValidationIssue => ({ code, severity: "blocking", entityIds, messageKey: `layout.validation.${code.toLowerCase()}`, details });
const warning = (code: string, entityIds: string[], details?: Record<string, unknown>): ValidationIssue => ({ code, severity: "warning", entityIds, messageKey: `layout.validation.${code.toLowerCase()}`, details });

function schemaIssue(error: ErrorObject): ValidationIssue {
  return blocking("SCHEMA_INVALID", [], { path: error.instancePath, keyword: error.keyword, message: error.message, params: error.params });
}

const orient = (a: PointMm, b: PointMm, c: PointMm) => Math.sign((b.yMm - a.yMm) * (c.xMm - b.xMm) - (b.xMm - a.xMm) * (c.yMm - b.yMm));
const intersects = (a: PointMm, b: PointMm, c: PointMm, d: PointMm) => orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b);

function aabb(entity: { xMm: number; yMm: number; widthMm: number; depthMm: number; rotationDeg?: number }) {
  const rotated = entity.rotationDeg === 90 || entity.rotationDeg === 270;
  const width = rotated ? entity.depthMm : entity.widthMm;
  const depth = rotated ? entity.widthMm : entity.depthMm;
  return { minX: entity.xMm - width / 2, maxX: entity.xMm + width / 2, minY: entity.yMm - depth / 2, maxY: entity.yMm + depth / 2 };
}

function overlap(a: ReturnType<typeof aabb>, b: ReturnType<typeof aabb>) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

export function validateLayoutDocument(input: unknown): { valid: boolean; schemaValid: boolean; issues: ValidationIssue[] } {
  if (!validateSchema(input)) {
    const issues = (validateSchema.errors ?? []).map(schemaIssue);
    return { valid: false, schemaValid: false, issues };
  }
  const document = input;
  const issues: ValidationIssue[] = [];
  const groups = [document.nodes, document.walls, document.openings, document.columns, document.objects, document.clearanceZones, document.materials, document.materialAssignments, document.lights];
  const ids = groups.flat().map((entity) => entity.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) issues.push(blocking("DUPLICATE_ID", duplicates));

  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const walls = new Map(document.walls.map((wall) => [wall.id, wall]));
  for (const wall of document.walls) {
    const start = nodes.get(wall.startNodeId); const end = nodes.get(wall.endNodeId);
    if (!start || !end) issues.push(blocking("MISSING_NODE", [wall.id, wall.startNodeId, wall.endNodeId]));
    else if (start.xMm === end.xMm && start.yMm === end.yMm) issues.push(blocking("ZERO_WALL", [wall.id]));
  }
  for (const opening of document.openings) {
    const wall = walls.get(opening.parentWallId);
    if (!wall) { issues.push(blocking("MISSING_OPENING_PARENT", [opening.id, opening.parentWallId])); continue; }
    const start = nodes.get(wall.startNodeId); const end = nodes.get(wall.endNodeId);
    if (!start || !end) continue;
    const wallLength = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
    if (opening.offsetMm + opening.widthMm > wallLength) issues.push(blocking("OPENING_OUTSIDE_WALL", [opening.id, wall.id], { wallLength }));
  }

  const segments = document.walls.flatMap((wall) => {
    const start = nodes.get(wall.startNodeId); const end = nodes.get(wall.endNodeId);
    return start && end ? [{ wall, start, end }] : [];
  });
  for (let i = 0; i < segments.length; i += 1) for (let j = i + 1; j < segments.length; j += 1) {
    const a = segments[i]; const b = segments[j];
    if ([a.wall.startNodeId, a.wall.endNodeId].some((id) => id === b.wall.startNodeId || id === b.wall.endNodeId)) continue;
    if (intersects(a.start, a.end, b.start, b.end)) issues.push(blocking("SELF_INTERSECTING_CONTOUR", [a.wall.id, b.wall.id]));
  }

  for (let i = 0; i < document.objects.length; i += 1) for (let j = i + 1; j < document.objects.length; j += 1) {
    if (overlap(aabb(document.objects[i]), aabb(document.objects[j]))) issues.push(warning("EQUIPMENT_COLLISION", [document.objects[i].id, document.objects[j].id]));
  }
  for (const zone of document.clearanceZones) {
    const xs = zone.polygon.map((point) => point.xMm); const ys = zone.polygon.map((point) => point.yMm);
    const zoneBox = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    for (const object of document.objects) if (!zone.relatedObjectIds.includes(object.id) && overlap(zoneBox, aabb(object))) issues.push({ ...warning("CLEARANCE_OVERLAP", [zone.id, object.id]), severity: zone.severity });
  }
  const assigned = new Set(document.materialAssignments.map((assignment) => assignment.targetId));
  for (const entity of [...document.walls, ...document.columns, ...document.objects]) if (!assigned.has(entity.id)) issues.push(warning("UNASSIGNED_MATERIAL", [entity.id]));
  return { valid: !issues.some((issue) => issue.severity === "blocking"), schemaValid: true, issues };
}
