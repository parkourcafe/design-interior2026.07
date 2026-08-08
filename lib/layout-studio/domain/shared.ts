import type {
  LayoutDocument,
  LayoutEntity,
  LayoutIssue,
  LayoutNode,
  LayoutWall,
} from "./types";

export const ENTITY_COLLECTIONS = [
  "nodes",
  "walls",
  "openings",
  "columns",
  "objects",
  "clearanceZones",
  "materials",
  "materialAssignments",
  "lights",
] as const;

export type EntityCollectionName = (typeof ENTITY_COLLECTIONS)[number];

export const ENTITY_TYPES: Record<EntityCollectionName, string> = {
  nodes: "node",
  walls: "wall",
  openings: "opening",
  columns: "column",
  objects: "object",
  clearanceZones: "clearanceZone",
  materials: "material",
  materialAssignments: "materialAssignment",
  lights: "light",
};

export function blockingIssue(
  code: string,
  message: string,
  details: Pick<LayoutIssue, "entityIds" | "path"> = {},
): LayoutIssue {
  return { code, severity: "blocking", message, ...details };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function entityArray(
  document: LayoutDocument,
  name: EntityCollectionName,
): LayoutEntity[] {
  return document[name] as LayoutEntity[];
}

export function visitValues(
  value: unknown,
  path: string,
  visitor: (value: unknown, path: string, key: string) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitValues(item, `${path}[${index}]`, visitor));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    visitor(child, childPath, key);
    visitValues(child, childPath, visitor);
  }
}

export function nodeMap(document: LayoutDocument): Map<string, LayoutNode> {
  return new Map(document.nodes.map((node) => [node.id, node]));
}

export function wallLength(
  wall: LayoutWall,
  nodes: Map<string, LayoutNode>,
): number | null {
  const start = nodes.get(wall.startNodeId);
  const end = nodes.get(wall.endNodeId);
  if (!start || !end) return null;
  return Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
}
