import type { DerivedLayout, LayoutDocument, LayoutNode } from "@/lib/layout-studio/domain";

type SceneProjection = DerivedLayout["sceneProjection"];

export type SceneGeometryDescriptor =
  | { type: "box"; widthM: number; heightM: number; depthM: number }
  | { type: "point" };

export interface SceneObjectDescriptor {
  sourceId: string;
  kind: string;
  parentSourceId?: string;
  geometry: SceneGeometryDescriptor;
  positionM: { x: number; y: number; z: number };
  rotationYRad?: number;
}

export interface SceneDescriptor {
  units: "m";
  objects: SceneObjectDescriptor[];
}

function meters(millimeters: number): number {
  return millimeters / 1000;
}

function rotationRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function wallRotation(start: LayoutNode, end: LayoutNode): number {
  const radians = -Math.atan2(end.yMm - start.yMm, end.xMm - start.xMm);
  return Object.is(radians, -0) ? 0 : radians;
}

function ceilingId(floorId: string): string {
  return floorId.startsWith("floor.")
    ? `ceiling.${floorId.slice("floor.".length)}`
    : `${floorId}.ceiling`;
}

export function compileSceneDescriptor(projection: SceneProjection): SceneDescriptor;
export function compileSceneDescriptor(
  document: LayoutDocument,
  projection: SceneProjection,
): SceneDescriptor;
export function compileSceneDescriptor(
  documentOrProjection: LayoutDocument | SceneProjection,
  suppliedProjection?: SceneProjection,
): SceneDescriptor {
  const projection = suppliedProjection ?? (documentOrProjection as SceneProjection);
  const document = suppliedProjection ? (documentOrProjection as LayoutDocument) : null;
  const nodes = new Map(
    (document?.nodes ?? projection.nodes ?? []).map((node) => [node.id, node]),
  );
  const floor = document?.floor ?? projection.floor;
  const elevationMm = floor?.elevationMm ?? 0;

  const walls: SceneObjectDescriptor[] = projection.walls.flatMap((wall) => {
    const start = nodes.get(wall.startNodeId);
    const end = nodes.get(wall.endNodeId);
    if (!start || !end) return [];
    const lengthMm = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
    return [{
      sourceId: wall.id,
      kind: "wall",
      geometry: {
        type: "box",
        widthM: meters(lengthMm),
        heightM: meters(wall.heightMm),
        depthM: meters(wall.thicknessMm),
      },
      positionM: {
        x: meters((start.xMm + end.xMm) / 2),
        y: meters(elevationMm + wall.heightMm / 2),
        z: meters((start.yMm + end.yMm) / 2),
      },
      rotationYRad: wallRotation(start, end),
    }];
  });

  const wallById = new Map(projection.walls.map((wall) => [wall.id, wall]));
  const openings: SceneObjectDescriptor[] = projection.openings.flatMap((opening) => {
    const parent = wallById.get(opening.parentWallId);
    if (!parent) return [];
    const start = nodes.get(parent.startNodeId);
    const end = nodes.get(parent.endNodeId);
    if (!start || !end) return [];
    const dx = end.xMm - start.xMm;
    const dy = end.yMm - start.yMm;
    const lengthMm = Math.hypot(dx, dy);
    if (lengthMm === 0) return [];
    const centerOffsetMm = opening.offsetMm + opening.widthMm / 2;
    return [{
      sourceId: opening.id,
      parentSourceId: parent.id,
      kind: "opening",
      geometry: {
        type: "box",
        widthM: meters(opening.widthMm),
        heightM: meters(opening.heightMm),
        depthM: meters(parent.thicknessMm),
      },
      positionM: {
        x: meters(start.xMm + (dx / lengthMm) * centerOffsetMm),
        y: meters(elevationMm + opening.sillMm + opening.heightMm / 2),
        z: meters(start.yMm + (dy / lengthMm) * centerOffsetMm),
      },
      rotationYRad: wallRotation(start, end),
    }];
  });

  const columns: SceneObjectDescriptor[] = projection.columns.map((column) => ({
    sourceId: column.id,
    kind: "column",
    geometry: {
      type: "box",
      widthM: meters(column.widthMm),
      heightM: meters(column.heightMm),
      depthM: meters(column.depthMm),
    },
    positionM: {
      x: meters(column.xMm),
      y: meters(elevationMm + column.baseZMm + column.heightMm / 2),
      z: meters(column.yMm),
    },
    rotationYRad: rotationRadians(column.rotationDeg),
  }));

  const objects: SceneObjectDescriptor[] = projection.objects.map((object) => ({
    sourceId: object.id,
    kind: object.kind,
    geometry: {
      type: "box",
      widthM: meters(object.widthMm),
      heightM: meters(object.heightMm),
      depthM: meters(object.depthMm),
    },
    positionM: {
      x: meters(object.xMm),
      y: meters(elevationMm + object.zMm + object.heightMm / 2),
      z: meters(object.yMm),
    },
    rotationYRad: rotationRadians(object.rotationDeg),
  }));

  const lights: SceneObjectDescriptor[] = projection.lights.map((light) => ({
    sourceId: light.id,
    kind: light.kind,
    geometry: { type: "point" },
    positionM: {
      x: meters(light.xMm),
      y: meters(elevationMm + light.zMm),
      z: meters(light.yMm),
    },
  }));

  const planNodes = document?.nodes ?? projection.nodes ?? [];
  const xs = planNodes.map(({ xMm }) => xMm);
  const ys = planNodes.map(({ yMm }) => yMm);
  const slabs: SceneObjectDescriptor[] = [];
  if (floor && xs.length > 0 && ys.length > 0) {
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const slabThicknessMm = 50;
    const slabGeometry = {
      type: "box" as const,
      widthM: meters(maxX - minX),
      heightM: meters(slabThicknessMm),
      depthM: meters(maxY - minY),
    };
    if (slabGeometry.widthM > 0 && slabGeometry.depthM > 0) {
      slabs.push(
        {
          sourceId: floor.id,
          kind: "floor",
          geometry: slabGeometry,
          positionM: {
            x: meters((minX + maxX) / 2),
            y: meters(elevationMm - slabThicknessMm / 2),
            z: meters((minY + maxY) / 2),
          },
          rotationYRad: 0,
        },
        {
          sourceId: ceilingId(floor.id),
          kind: "ceiling",
          geometry: slabGeometry,
          positionM: {
            x: meters((minX + maxX) / 2),
            y: meters(elevationMm + floor.clearHeightMm + slabThicknessMm / 2),
            z: meters((minY + maxY) / 2),
          },
          rotationYRad: 0,
        },
      );
    }
  }

  return {
    units: "m",
    objects: [...walls, ...openings, ...columns, ...objects, ...slabs, ...lights],
  };
}
