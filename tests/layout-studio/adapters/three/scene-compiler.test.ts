import { describe, expect, it } from "vitest";

import { compileSceneDescriptor } from "@/lib/layout-studio/adapters/three/scene-compiler";
import { deriveLayout } from "@/lib/layout-studio/domain";

import { makeSimpleRoom } from "../../application/layout-test-fixture";

describe("LS-030: Three scene compiler", () => {
  it("compiles plain object descriptors with stable IDs and mm-to-meter transforms", () => {
    const derived = deriveLayout(makeSimpleRoom());
    const descriptor = compileSceneDescriptor(derived.sceneProjection);

    expect(descriptor.units).toBe("m");
    expect(descriptor.objects.map((object) => object.sourceId)).toEqual(
      expect.arrayContaining([
        "wall.simple-room.north",
        "opening.simple-room.door",
        "column.simple-room.center",
        "object.simple-room.table",
      ]),
    );
    expect(descriptor.objects).toContainEqual(
      expect.objectContaining({
        sourceId: "column.simple-room.center",
        kind: "column",
        geometry: { type: "box", widthM: 0.25, heightM: 2.8, depthM: 0.25 },
        positionM: { x: 2, y: 1.4, z: 1.5 },
      }),
    );
    expect(descriptor.objects).toContainEqual(
      expect.objectContaining({
        sourceId: "object.simple-room.table",
        kind: "equipment",
        geometry: { type: "box", widthM: 0.6, heightM: 0.9, depthM: 0.6 },
        positionM: { x: 1, y: 0.45, z: 1.5 },
      }),
    );
  });
});
