import type { LayoutDocument } from "../../domain";

export interface SceneBox { id: string; parentSourceId?: string; kind: "wall" | "column" | "object" | "floor" | "ceiling"; xM: number; yM: number; zM: number; widthM: number; heightM: number; depthM: number; rotationYRad: number; materialId?: string }
export interface SceneLight { id: string; kind: string; xM: number; yM: number; zM: number; color: string; intensity: number }
export interface SceneProjection { revision: number; boxes: SceneBox[]; lights: SceneLight[] }
const m = (mm: number) => mm / 1000;

export function compileScene(document: LayoutDocument): SceneProjection {
  const nodes = new Map(document.nodes.map((node) => [node.id, node])); const assignment = new Map(document.materialAssignments.map((item) => [item.targetId, item.materialId])); const boxes: SceneBox[] = [];
  for (const wall of document.walls) {
    const a = nodes.get(wall.startNodeId); const b = nodes.get(wall.endNodeId); if (!a || !b) continue;
    const dx = b.xMm - a.xMm; const dy = b.yMm - a.yMm; const length = Math.hypot(dx, dy); const angle = -Math.atan2(dy, dx); const cuts = document.openings.filter((item) => item.parentWallId === wall.id).sort((x, y) => x.offsetMm - y.offsetMm);
    let cursor = 0; let segment = 0;
    const addSegment = (from: number, to: number, baseMm: number, heightMm: number) => { if (to <= from || heightMm <= 0) return; const center = (from + to) / 2; boxes.push({ id: `${wall.id}.segment.${segment++}`, parentSourceId: wall.id, kind: "wall", xM: m(a.xMm + dx * center / length), yM: m(baseMm + heightMm / 2), zM: m(a.yMm + dy * center / length), widthM: m(to - from), heightM: m(heightMm), depthM: m(wall.thicknessMm), rotationYRad: angle, materialId: assignment.get(wall.id) }); };
    for (const opening of cuts) { addSegment(cursor, opening.offsetMm, 0, wall.heightMm); if (opening.sillMm > 0) addSegment(opening.offsetMm, opening.offsetMm + opening.widthMm, 0, opening.sillMm); const top = opening.sillMm + opening.heightMm; if (top < wall.heightMm) addSegment(opening.offsetMm, opening.offsetMm + opening.widthMm, top, wall.heightMm - top); cursor = Math.max(cursor, opening.offsetMm + opening.widthMm); }
    addSegment(cursor, length, 0, wall.heightMm);
  }
  for (const item of document.columns) boxes.push({ id: item.id, kind: "column", xM: m(item.xMm), yM: m(item.baseZMm + item.heightMm / 2), zM: m(item.yMm), widthM: m(item.widthMm), heightM: m(item.heightMm), depthM: m(item.depthMm), rotationYRad: item.rotationDeg * Math.PI / 180, materialId: assignment.get(item.id) });
  for (const item of document.objects) boxes.push({ id: item.id, kind: "object", xM: m(item.xMm), yM: m(item.zMm + item.heightMm / 2), zM: m(item.yMm), widthM: m(item.widthMm), heightM: m(item.heightMm), depthM: m(item.depthMm), rotationYRad: item.rotationDeg * Math.PI / 180, materialId: assignment.get(item.id) });
  const xs = document.nodes.map((node) => node.xMm); const ys = document.nodes.map((node) => node.yMm); if (xs.length && ys.length) { const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys); boxes.push({ id: `${document.floor.id}.floor`, parentSourceId: document.floor.id, kind: "floor", xM: m((minX + maxX) / 2), yM: m(document.floor.elevationMm - 25), zM: m((minY + maxY) / 2), widthM: m(maxX - minX), heightM: .05, depthM: m(maxY - minY), rotationYRad: 0, materialId: assignment.get(document.floor.id) }); boxes.push({ id: `${document.floor.id}.ceiling`, parentSourceId: document.floor.id, kind: "ceiling", xM: m((minX + maxX) / 2), yM: m(document.floor.elevationMm + document.floor.clearHeightMm + 25), zM: m((minY + maxY) / 2), widthM: m(maxX - minX), heightM: .05, depthM: m(maxY - minY), rotationYRad: 0, materialId: assignment.get(document.floor.id) }); }
  return { revision: document.stateRevision, boxes, lights: document.lights.map((light) => ({ id: light.id, kind: light.kind, xM: m(light.xMm), yM: m(light.zMm), zM: m(light.yMm), color: light.color, intensity: light.intensity })) };
}
