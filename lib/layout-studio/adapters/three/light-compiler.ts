import type { LayoutDocument } from "@/lib/layout-studio/domain";

export interface LightDescriptor {
  sourceId: string;
  kind: "ambient" | "directional" | "point" | "linear_proxy";
  color: string;
  intensity: number;
  positionM: { x: number; y: number; z: number };
  targetSourceId?: string;
}

export function compileLightDescriptors(document: LayoutDocument): LightDescriptor[] {
  return document.lights.map((light) => ({
    sourceId: light.id,
    kind: light.kind,
    color: light.color,
    intensity: light.intensity,
    positionM: {
      x: light.xMm / 1000,
      y: (document.floor.elevationMm + light.zMm) / 1000,
      z: light.yMm / 1000,
    },
    ...(light.targetId === undefined ? {} : { targetSourceId: light.targetId }),
  }));
}
