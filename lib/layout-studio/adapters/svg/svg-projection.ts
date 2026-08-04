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

export function serializeSvgProjection(projection: SvgProjection): string {
  const { viewBox } = projection;
  const versionAttribute = projection.versionId
    ? ` data-version-id="${escapeXml(projection.versionId)}"`
    : "";
  const walls = projection.walls
    .map(
      (wall) =>
        `<polygon data-source-id="${escapeXml(wall.sourceId)}" points="${wall.points
          .map((point) => `${point.xMm},${point.yMm}`)
          .join(" ")}"/>`,
    )
    .join("");
  const openings = projection.openings
    .map(
      (opening) =>
        `<g data-source-id="${escapeXml(opening.sourceId)}" data-parent-wall-id="${escapeXml(
          opening.parentWallId,
        )}" data-offset-mm="${opening.offsetMm}" data-width-mm="${opening.widthMm}"/>`,
    )
    .join("");
  const boxes = projection.boxes
    .map(
      (box) =>
        `<rect data-source-id="${escapeXml(box.sourceId)}" data-kind="${escapeXml(box.kind)}" x="${
          box.xMm - box.widthMm / 2
        }" y="${box.yMm - box.depthMm / 2}" width="${box.widthMm}" height="${
          box.depthMm
        }" transform="rotate(${box.rotationDeg} ${box.xMm} ${box.yMm})"/>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.x} ${viewBox.y} ${
    viewBox.width
  } ${viewBox.height}" data-units="mm"${versionAttribute}>${walls}${openings}${boxes}</svg>`;
}
