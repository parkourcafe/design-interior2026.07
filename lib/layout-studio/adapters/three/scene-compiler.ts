import type { DerivedLayout } from "@/lib/layout-studio/domain";

type SceneProjection = DerivedLayout["sceneProjection"];

export type SceneGeometryDescriptor =
  | { type: "box"; widthM: number; heightM: number; depthM: number }
  | { type: "point" };

export interface SceneObjectDescriptor {
  sourceId: string;
  kind: string;
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

export function compileSceneDescriptor(projection: SceneProjection): SceneDescriptor {
  const walls: SceneObjectDescriptor[] = projection.walls.map((wall) => ({
    sourceId: wall.id,
    kind: "wall",
    geometry: {
      type: "box",
      widthM: 0,
      heightM: meters(wall.heightMm),
      depthM: meters(wall.thicknessMm),
    },
    positionM: { x: 0, y: meters(wall.heightMm) / 2, z: 0 },
  }));

  const openings: SceneObjectDescriptor[] = projection.openings.map((opening) => ({
    sourceId: opening.id,
    kind: opening.kind,
    geometry: {
      type: "box",
      widthM: meters(opening.widthMm),
      heightM: meters(opening.heightMm),
      depthM: 0,
    },
    positionM: {
      x: meters(opening.offsetMm + opening.widthMm / 2),
      y: meters(opening.sillMm + opening.heightMm / 2),
      z: 0,
    },
  }));

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
      y: meters(column.baseZMm + column.heightMm / 2),
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
      y: meters(object.zMm + object.heightMm / 2),
      z: meters(object.yMm),
    },
    rotationYRad: rotationRadians(object.rotationDeg),
  }));

  const lights: SceneObjectDescriptor[] = projection.lights.map((light) => ({
    sourceId: light.id,
    kind: typeof light.kind === "string" ? light.kind : "light",
    geometry: { type: "point" },
    positionM: {
      x: meters(typeof light.xMm === "number" ? light.xMm : 0),
      y: meters(typeof light.zMm === "number" ? light.zMm : 0),
      z: meters(typeof light.yMm === "number" ? light.yMm : 0),
    },
  }));

  return { units: "m", objects: [...walls, ...openings, ...columns, ...objects, ...lights] };
}
