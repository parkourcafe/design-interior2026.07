import { blockingIssue, nodeMap } from "./shared";
import type {
  DerivedLayout,
  DerivedWallPolygon,
  LayoutDocument,
  LayoutNode,
} from "./types";
import { validateLayoutDocument } from "./validate";

function orderedContour(
  document: LayoutDocument,
  nodes: Map<string, LayoutNode>,
): LayoutNode[] {
  if (document.walls.length === 0) return [];
  const unused = new Set(document.walls.map((wall) => wall.id));
  const first = document.walls[0];
  if (!first) return [];
  const contour: LayoutNode[] = [];
  let currentNodeId = first.startNodeId;

  for (let index = 0; index < document.walls.length; index += 1) {
    const currentNode = nodes.get(currentNodeId);
    if (!currentNode) return [];
    contour.push(currentNode);
    const wall = document.walls.find(
      (candidate) =>
        unused.has(candidate.id) &&
        (candidate.startNodeId === currentNodeId || candidate.endNodeId === currentNodeId),
    );
    if (!wall) return [];
    unused.delete(wall.id);
    currentNodeId =
      wall.startNodeId === currentNodeId ? wall.endNodeId : wall.startNodeId;
  }
  return currentNodeId === first.startNodeId ? contour : [];
}

function polygonArea(points: LayoutNode[]): number {
  if (points.length < 3) return 0;
  let doubleArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) continue;
    doubleArea += current.xMm * next.yMm - next.xMm * current.yMm;
  }
  return Math.abs(doubleArea) / 2;
}

export function deriveLayout(document: LayoutDocument): DerivedLayout {
  const validation = validateLayoutDocument(document);
  const issues = [...validation.issues];
  const nodes = nodeMap(document);
  const wallPolygons: DerivedWallPolygon[] = [];

  for (const wall of document.walls) {
    const start = nodes.get(wall.startNodeId);
    const end = nodes.get(wall.endNodeId);
    if (!start || !end) continue;
    const dx = end.xMm - start.xMm;
    const dy = end.yMm - start.yMm;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      issues.push(
        blockingIssue("ZERO_LENGTH_WALL", "Стена не может иметь нулевую длину", {
          entityIds: [wall.id],
        }),
      );
      continue;
    }
    const offsetX = (-dy / length) * (wall.thicknessMm / 2);
    const offsetY = (dx / length) * (wall.thicknessMm / 2);
    wallPolygons.push({
      wallId: wall.id,
      polygon: [
        { xMm: start.xMm - offsetX, yMm: start.yMm - offsetY },
        { xMm: end.xMm - offsetX, yMm: end.yMm - offsetY },
        { xMm: end.xMm + offsetX, yMm: end.yMm + offsetY },
        { xMm: start.xMm + offsetX, yMm: start.yMm + offsetY },
      ],
    });
  }

  const points = wallPolygons.flatMap((wall) => wall.polygon);
  const bounds =
    points.length === 0
      ? null
      : {
          minXMm: Math.min(...points.map((point) => point.xMm)),
          minYMm: Math.min(...points.map((point) => point.yMm)),
          maxXMm: Math.max(...points.map((point) => point.xMm)),
          maxYMm: Math.max(...points.map((point) => point.yMm)),
        };

  return {
    valid: issues.every((issue) => issue.severity !== "blocking"),
    issues,
    wallPolygons,
    roomAreaMm2: polygonArea(orderedContour(document, nodes)),
    bounds,
    sceneProjection: {
      floor: structuredClone(document.floor),
      nodes: structuredClone(document.nodes),
      walls: structuredClone(document.walls),
      openings: structuredClone(document.openings),
      columns: structuredClone(document.columns),
      objects: structuredClone(document.objects),
      lights: structuredClone(document.lights),
    },
  };
}
