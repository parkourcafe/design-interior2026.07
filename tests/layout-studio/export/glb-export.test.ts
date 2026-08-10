import { describe, expect, it } from "vitest";

import { LayoutExportService } from "@/lib/layout-studio/application/export-service";
import { MemoryLayoutRepository } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import { applyLayoutCommand } from "@/lib/layout-studio/domain";

import {
  makeSimpleRoom,
  moveTableCommand,
} from "../application/layout-test-fixture";

interface GltfAccessor {
  min?: number[];
  max?: number[];
}

interface GltfMesh {
  primitives?: Array<{ attributes?: { POSITION?: number } }>;
}

interface GltfNode {
  extras?: { sourceId?: string };
  mesh?: number;
  scale?: number[];
}

interface GltfJson {
  asset?: { version?: string };
  accessors?: GltfAccessor[];
  meshes?: GltfMesh[];
  nodes?: GltfNode[];
}

function asBytes(artifact: unknown): Uint8Array {
  expect(artifact).toBeInstanceOf(Uint8Array);
  return artifact as Uint8Array;
}

function parseGlb(artifact: unknown): { bytes: Uint8Array; json: GltfJson } {
  const bytes = asBytes(artifact);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  expect(view.getUint32(0, true)).toBe(0x46546c67); // ASCII "glTF"
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a); // JSON chunk

  const jsonLength = view.getUint32(12, true);
  const jsonBytes = bytes.subarray(20, 20 + jsonLength);
  const json = JSON.parse(new TextDecoder().decode(jsonBytes).trim()) as GltfJson;
  expect(json.asset?.version).toBe("2.0");
  return { bytes, json };
}

function metricMeshDimensions(json: GltfJson, sourceId: string): number[] {
  const node = json.nodes?.find((candidate) => candidate.extras?.sourceId === sourceId);
  expect(node, `GLB node for stable ID ${sourceId}`).toBeDefined();
  expect(node?.mesh, `GLB mesh for stable ID ${sourceId}`).toEqual(expect.any(Number));

  const mesh = json.meshes?.[node!.mesh!];
  const positionAccessorIndex = mesh?.primitives?.[0]?.attributes?.POSITION;
  expect(positionAccessorIndex, `POSITION accessor for ${sourceId}`).toEqual(expect.any(Number));
  const accessor = json.accessors?.[positionAccessorIndex!];
  expect(accessor?.min, `POSITION min for ${sourceId}`).toHaveLength(3);
  expect(accessor?.max, `POSITION max for ${sourceId}`).toHaveLength(3);

  const scale = node?.scale ?? [1, 1, 1];
  return accessor!.max!.map((maximum, axis) =>
    Math.abs((maximum - accessor!.min![axis]!) * (scale[axis] ?? 1)),
  ).sort((left, right) => left - right);
}

describe("LS-AT-073/077: headless exact-version GLB export", () => {
  it("exports Version A after B exists as a valid GLB 2.0 with meter-scale stable entities", async () => {
    const repository = new MemoryLayoutRepository();
    const documentA = makeSimpleRoom();
    const versionA = await repository.publishVersion(documentA, {
      versionId: "version.simple-room.glb-a",
      authorType: "human",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "GLB Version A",
      createdAt: "2026-08-04T10:00:00.000Z",
      warnings: [],
    });
    const moved = applyLayoutCommand(documentA, moveTableCommand(documentA, 2200));
    expect(moved.ok).toBe(true);
    const versionB = await repository.publishVersion(moved.document, {
      versionId: "version.simple-room.glb-b",
      parentVersionId: versionA.versionId,
      authorType: "human",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "GLB Version B",
      createdAt: "2026-08-04T11:00:00.000Z",
      warnings: [],
    });

    const exported = await new LayoutExportService({
      repository,
      generatorVersion: "archidom-layout-studio/test",
      now: () => "2026-08-04T12:00:00.000Z",
    }).exportVersion(versionA.versionId, "glb");
    const { bytes, json } = parseGlb(exported.artifact);

    expect(bytes.byteLength).toBeGreaterThan(20);
    expect(exported.manifest).toMatchObject({
      format: "glb",
      versionId: versionA.versionId,
      semanticHash: versionA.semanticHash,
    });
    expect(JSON.stringify(json)).not.toContain(versionB.versionId);
    expect(metricMeshDimensions(json, "wall.simple-room.south")).toEqual([0.2, 2.8, 4]);
    expect(metricMeshDimensions(json, "column.simple-room.center")).toEqual([0.25, 0.25, 2.8]);
    expect(metricMeshDimensions(json, "object.simple-room.table")).toEqual([0.6, 0.6, 0.9]);
  });
});
