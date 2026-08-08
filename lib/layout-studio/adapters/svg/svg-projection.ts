import type { DerivedLayout } from "@/lib/layout-studio/domain";

export interface SvgPoint {
  xMm: number;
  yMm: number;
}

export interface SvgWallProjection {
  sourceId: string;
  points: SvgPoint[];
}

export interface SvgOpeningProjection {
  sourceId: string;
  parentWallId: string;
  offsetMm: number;
  widthMm: number;
  heightMm: number;
  sillMm: number;
  kind: string;
  /** Opening span resolved onto the parent wall axis, so the export is drawable. */
  startPoint: SvgPoint;
  endPoint: SvgPoint;
}

export interface SvgBoxProjection {
  sourceId: string;
  kind: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
  rotationDeg: number;
}

export interface SvgProjection {
  units: "mm";
  viewBox: { x: number; y: number; width: number; height: number };
  walls: SvgWallProjection[];
  openings: SvgOpeningProjection[];
  boxes: SvgBoxProjection[];
  versionId?: string;
}

export function createSvgProjection(
  derived: DerivedLayout,
  options: { versionId?: string } = {},
): SvgProjection {
  const bounds = derived.bounds ?? { minXMm: 0, minYMm: 0, maxXMm: 0, maxYMm: 0 };
  const nodeById = new Map(derived.sceneProjection.nodes.map((node) => [node.id, node]));
  const wallById = new Map(derived.sceneProjection.walls.map((wall) => [wall.id, wall]));
  const openingSpan = (opening: { parentWallId: string; offsetMm: number; widthMm: number }): {
    startPoint: SvgPoint;
    endPoint: SvgPoint;
  } => {
    const wall = wallById.get(opening.parentWallId);
    const start = wall ? nodeById.get(wall.startNodeId) : undefined;
    const end = wall ? nodeById.get(wall.endNodeId) : undefined;
    if (!start || !end) {
      return { startPoint: { xMm: 0, yMm: 0 }, endPoint: { xMm: 0, yMm: 0 } };
    }
    const dx = end.xMm - start.xMm;
    const dy = end.yMm - start.yMm;
    const length = Math.hypot(dx, dy) || 1;
    const at = (distanceMm: number): SvgPoint => ({
      xMm: start.xMm + (dx / length) * distanceMm,
      yMm: start.yMm + (dy / length) * distanceMm,
    });
    return { startPoint: at(opening.offsetMm), endPoint: at(opening.offsetMm + opening.widthMm) };
  };

  return {
    units: "mm",
    viewBox: {
      x: bounds.minXMm,
      y: bounds.minYMm,
      width: bounds.maxXMm - bounds.minXMm,
      height: bounds.maxYMm - bounds.minYMm,
    },
    walls: derived.wallPolygons.map((wall) => ({
      sourceId: wall.wallId,
      points: wall.polygon.map((point) => ({ ...point })),
    })),
    openings: derived.sceneProjection.openings.map((opening) => ({
      sourceId: opening.id,
      parentWallId: opening.parentWallId,
      offsetMm: opening.offsetMm,
      widthMm: opening.widthMm,
      heightMm: opening.heightMm,
      sillMm: opening.sillMm,
      kind: opening.kind,
      ...openingSpan(opening),
    })),
    boxes: [
      ...derived.sceneProjection.columns.map((column) => ({
        sourceId: column.id,
        kind: "column",
        xMm: column.xMm,
        yMm: column.yMm,
        widthMm: column.widthMm,
        depthMm: column.depthMm,
        rotationDeg: column.rotationDeg,
      })),
      ...derived.sceneProjection.objects.map((object) => ({
        sourceId: object.id,
        kind: object.kind,
        xMm: object.xMm,
        yMm: object.yMm,
        widthMm: object.widthMm,
        depthMm: object.depthMm,
        rotationDeg: object.rotationDeg,
      })),
    ],
    ...(options.versionId ? { versionId: options.versionId } : {}),
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Presentation palette of the exported plan. Kept literal so an artifact stays self-contained. */
const SVG_PAPER = "#F5F2EB";
const SVG_INK = "#17201B";
const SVG_GREEN = "#244E3B";

export function serializeSvgProjection(projection: SvgProjection): string {
  const { viewBox } = projection;
  const versionAttribute = projection.versionId
    ? ` data-version-id="${escapeXml(projection.versionId)}"`
    : "";
  const background =
    `<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="${SVG_PAPER}"/>`;
  const walls = projection.walls
    .map(
      (wall) =>
        `<polygon data-source-id="${escapeXml(wall.sourceId)}" fill="${SVG_INK}" points="${wall.points
          .map((point) => `${point.xMm},${point.yMm}`)
          .join(" ")}"/>`,
    )
    .join("");
  // Openings are drawn as an explicit stroked span on the wall axis: an exported
  // plan has to *show* where the wall is interrupted, not only carry the numbers.
  const openings = projection.openings
    .map(
      (opening) =>
        `<g data-source-id="${escapeXml(opening.sourceId)}" data-parent-wall-id="${escapeXml(
          opening.parentWallId,
        )}" data-kind="${escapeXml(opening.kind)}" data-offset-mm="${opening.offsetMm}" data-width-mm="${
          opening.widthMm
        }" data-height-mm="${opening.heightMm}" data-sill-mm="${opening.sillMm}">` +
        `<line x1="${opening.startPoint.xMm}" y1="${opening.startPoint.yMm}" x2="${
          opening.endPoint.xMm
        }" y2="${opening.endPoint.yMm}" stroke="${SVG_PAPER}" stroke-width="140" stroke-linecap="butt"/>` +
        `<line x1="${opening.startPoint.xMm}" y1="${opening.startPoint.yMm}" x2="${
          opening.endPoint.xMm
        }" y2="${opening.endPoint.yMm}" stroke="${SVG_GREEN}" stroke-width="40" stroke-linecap="butt"/>` +
        `</g>`,
    )
    .join("");
  const boxes = projection.boxes
    .map(
      (box) =>
        `<rect data-source-id="${escapeXml(box.sourceId)}" data-kind="${escapeXml(box.kind)}" x="${
          box.xMm - box.widthMm / 2
        }" y="${box.yMm - box.depthMm / 2}" width="${box.widthMm}" height="${
          box.depthMm
        }" transform="rotate(${box.rotationDeg} ${box.xMm} ${box.yMm})" fill="none" stroke="${SVG_INK}" stroke-width="30"/>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.x} ${viewBox.y} ${
    viewBox.width
  } ${viewBox.height}" data-units="mm"${versionAttribute}>${background}${walls}${openings}${boxes}</svg>`;
}
