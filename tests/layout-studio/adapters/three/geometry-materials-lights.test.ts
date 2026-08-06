import { describe, expect, it } from "vitest";

import syntheticFixture from "@/fixtures/layout-studio/liquid-station.synthetic.v0.1.json";
import { compileLightDescriptors } from "@/lib/layout-studio/adapters/three/light-compiler";
import { compileMaterialDescriptors } from "@/lib/layout-studio/adapters/three/material-compiler";
import { compileSceneDescriptor } from "@/lib/layout-studio/adapters/three/scene-compiler";
import { deriveLayout, type LayoutDocument } from "@/lib/layout-studio/domain";

function makeDocument(): LayoutDocument {
  return structuredClone(syntheticFixture) as unknown as LayoutDocument;
}

describe("LS-030: canonical geometry to Three descriptors", () => {
  it("compiles exact wall centers, lengths, rotations, floor, ceiling, and parent-relative openings", () => {
    const document = makeDocument();
    const derived = deriveLayout(document);
    const descriptor = compileSceneDescriptor(document, derived.sceneProjection);

    expect(descriptor.units).toBe("m");
    expect(descriptor.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "wall.synthetic-liquid-station.north",
          kind: "wall",
          geometry: { type: "box", widthM: 7.2, heightM: 3, depthM: 0.2 },
          positionM: { x: 3.6, y: 1.5, z: 0 },
          rotationYRad: 0,
        }),
        expect.objectContaining({
          sourceId: "wall.synthetic-liquid-station.east",
          kind: "wall",
          geometry: { type: "box", widthM: 2.75, heightM: 3, depthM: 0.2 },
          positionM: { x: 7.2, y: 1.5, z: 1.375 },
          rotationYRad: -Math.PI / 2,
        }),
        expect.objectContaining({
          sourceId: "opening.synthetic-liquid-station.service-door",
          kind: "opening",
          parentSourceId: "wall.synthetic-liquid-station.east",
          geometry: { type: "point" },
          positionM: { x: 7.2, y: 1.05, z: 3.2 },
          rotationYRad: -Math.PI / 2,
        }),
      ]),
    );

    const south = descriptor.objects.find(
      ({ sourceId }) => sourceId === "wall.synthetic-liquid-station.south",
    );
    expect(south?.geometry).toEqual({ type: "box", widthM: 0.65, heightM: 3, depthM: 0.2 });
    expect(south?.positionM).toEqual({ x: 6.875, y: 1.5, z: 4.6 });
    expect(Math.abs(south?.rotationYRad ?? 0)).toBeCloseTo(Math.PI);
    expect(descriptor.objects.filter(({ parentSourceId }) =>
      parentSourceId === "wall.synthetic-liquid-station.east")).toHaveLength(4);

    expect(descriptor.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: document.floor.id, kind: "floor" }),
        expect.objectContaining({ kind: "ceiling" }),
      ]),
    );
    for (const object of descriptor.objects) {
      if (object.geometry.type === "box") {
        expect(object.geometry.widthM, `${object.sourceId} width`).toBeGreaterThan(0);
        expect(object.geometry.heightM, `${object.sourceId} height`).toBeGreaterThan(0);
        expect(object.geometry.depthM, `${object.sourceId} depth`).toBeGreaterThan(0);
      }
    }
  });
});

describe("LS-031: material compiler", () => {
  it("resolves assignments by target stable ID without flattening distinct PBR values", () => {
    const compiled = compileMaterialDescriptors(makeDocument());
    const byTargetId = (targetId: string) =>
      compiled.find((descriptor: { targetId: string }) => descriptor.targetId === targetId);

    expect(byTargetId("wall.synthetic-liquid-station.north")).toMatchObject({
      assignmentId: "assignment.synthetic-liquid-station.walls",
      materialId: "material.synthetic-liquid-station.matte-concrete",
      color: "#8A8A82",
      roughness: 0.9,
      metalness: 0,
    });
    expect(byTargetId("object.synthetic-liquid-station.central-double-sink")).toMatchObject({
      assignmentId: "assignment.synthetic-liquid-station.sink",
      materialId: "material.synthetic-liquid-station.stainless-steel",
      color: "#B8BDC0",
      roughness: 0.35,
      metalness: 0.9,
    });
    expect(byTargetId("object.synthetic-liquid-station.front-counter")).toMatchObject({
      assignmentId: "assignment.synthetic-liquid-station.counter",
      materialId: "material.synthetic-liquid-station.copper-patina",
      color: "#9A5D3C",
      roughness: 0.7,
      metalness: 0.55,
    });
  });
});

describe("LS-031: light compiler", () => {
  it("preserves canonical neutral task and warm decorative sources", () => {
    const compiled = compileLightDescriptors(makeDocument());

    expect(compiled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "light.synthetic-liquid-station.neutral-task",
          kind: "point",
          color: "#FFFDF5",
          intensity: 1200,
          positionM: { x: 3.5, y: 2.5, z: 1.5 },
        }),
        expect.objectContaining({
          sourceId: "light.synthetic-liquid-station.warm-decorative",
          kind: "point",
          color: "#FFB15A",
          intensity: 650,
          positionM: { x: 3.5, y: 2.35, z: 3.4 },
        }),
      ]),
    );
  });
});
