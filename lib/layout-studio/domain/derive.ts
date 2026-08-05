import type { LayoutDocument, PointMm, ValidationIssue } from "./types";
import { validateLayoutDocument } from "./validate";

export interface DerivedWall { id: string; start: PointMm; end: PointMm; thicknessMm: number; heightMm: number }
export interface DerivedLayout { valid: boolean; issues: ValidationIssue[]; walls: DerivedWall[]; roomPolygon: PointMm[]; roomAreaMm2?: number; bounds: { minX: number; minY: number; maxX: number; maxY: number } }

const polygonArea = (points: PointMm[]) => Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.xMm * next.yMm - next.xMm * point.yMm; }, 0) / 2);

function orderedContour(document: LayoutDocument): PointMm[] {
  if (!document.walls.length) return [];
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const unused = new Set(document.walls.map((wall) => wall.id));
  const first = document.walls[0];
  const order = [first.startNodeId, first.endNodeId]; unused.delete(first.id);
  while (unused.size) {
    const current = order[order.length - 1];
    const next = document.walls.find((wall) => unused.has(wall.id) && (wall.startNodeId === current || wall.endNodeId === current));
    if (!next) return [];
    order.push(next.startNodeId === current ? next.endNodeId : next.startNodeId); unused.delete(next.id);
  }
  if (order.at(-1) !== order[0]) return [];
  return order.slice(0, -1).flatMap((id) => { const node = nodeById.get(id); return node ? [{ xMm: node.xMm, yMm: node.yMm }] : []; });
}

export function deriveLayout(document: LayoutDocument): DerivedLayout {
  const validation = validateLayoutDocument(document);
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const walls = document.walls.flatMap((wall) => { const start = nodes.get(wall.startNodeId); const end = nodes.get(wall.endNodeId); return start && end ? [{ id: wall.id, start: { xMm: start.xMm, yMm: start.yMm }, end: { xMm: end.xMm, yMm: end.yMm }, thicknessMm: wall.thicknessMm, heightMm: wall.heightMm }] : []; });
  const roomPolygon = orderedContour(document);
  const allPoints = [...document.nodes, ...document.objects.map((item) => ({ xMm: item.xMm, yMm: item.yMm }))];
  const bounds = allPoints.length ? { minX: Math.min(...allPoints.map((p) => p.xMm)), minY: Math.min(...allPoints.map((p) => p.yMm)), maxX: Math.max(...allPoints.map((p) => p.xMm)), maxY: Math.max(...allPoints.map((p) => p.yMm)) } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const issues = [...validation.issues];
  if (!roomPolygon.length) issues.push({ code: "ROOM_CONTOUR_NOT_DETECTED", severity: "warning", entityIds: [], messageKey: "layout.validation.room_contour_not_detected" });
  return { valid: !issues.some((issue) => issue.severity === "blocking"), issues, walls, roomPolygon, roomAreaMm2: roomPolygon.length ? polygonArea(roomPolygon) : undefined, bounds };
}
