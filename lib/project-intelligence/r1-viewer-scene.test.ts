import { describe, expect, it } from "vitest";
import {
  r1ViewerAxisPresetCamera,
  r1ViewerBoundsCenter,
  r1ViewerCameraPosition,
  r1ViewerCanRender3d,
  r1ViewerGeometryStatus,
  r1ViewerResolveSelection,
  r1ViewerSceneMatchesState,
  type R1ViewerBounds,
  type R1ViewerNode,
  type R1ViewerSceneSummary,
} from "./r1-viewer-scene";
import { validateR1ViewerState, type R1ViewerState } from "./r1-viewer-state";

const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;

const BOUNDS: R1ViewerBounds = { min: [-2, 0, -4], max: [2, 6, 4] };

function node(overrides: Partial<R1ViewerNode> = {}): R1ViewerNode {
  return { nodeKey: "node-a", displayName: "Wall", nodeIndex: 0, triangleCount: 12, ...overrides };
}

function summary(overrides: Partial<R1ViewerSceneSummary> = {}): R1ViewerSceneSummary {
  return {
    representationDigest: DIGEST,
    upAxis: "y_up",
    bounds: BOUNDS,
    nodes: [node()],
    ...overrides,
  };
}

function state(overrides: {
  readonly format?: "glb" | "pdf" | "png";
  readonly lifecycle?: "active" | "grace_read_only" | "archive_read_only" | "revoked";
  readonly digest?: string;
} = {}): R1ViewerState {
  return validateR1ViewerState({
    contractVersion: "r1-viewer-state/0.2",
    scope: {
      mode: "authenticated_review",
      projectId: "41111111-1111-4111-8111-111111111111",
      packageId: "41111111-1111-4111-8111-111111111112",
      submissionId: "41111111-1111-4111-8111-111111111113",
    },
    representation: {
      versionId: "41111111-1111-4111-8111-111111111114",
      digest: overrides.digest ?? DIGEST,
      format: overrides.format ?? "glb",
      status: "current",
      displayLabel: "Pejeng model",
    },
    access: {
      lifecycle: overrides.lifecycle ?? "active",
      evidenceId: "41111111-1111-4111-8111-111111111115",
      revision: 1,
    },
    camera:
      (overrides.format ?? "glb") === "glb"
        ? { kind: "3d", yaw: 0, pitch: 0, zoom: 1, target: [0, 0, 0] }
        : {
          kind: "2d",
          page: (overrides.format ?? "glb") === "pdf" ? 1 : null,
          rotation: 0,
          zoom: 1,
          pan: [0, 0],
        },
    selection: null,
  });
}

describe("R1 viewer camera", () => {
  it("places the camera on a different axis for a Z-up export than for a Y-up one", () => {
    const camera = { kind: "3d", yaw: 0, pitch: Math.PI / 2, zoom: 1, target: [0, 0, 0] } as const;

    const yUp = r1ViewerCameraPosition(camera, BOUNDS, "y_up");
    const zUp = r1ViewerCameraPosition(camera, BOUNDS, "z_up");

    // Looking from "above" must follow the axis the architect attested to, not a
    // fixed assumption: the same stored camera lands on Y for glTF and on Z for
    // a SketchUp-derived export.
    expect(yUp[1]).toBeGreaterThan(0);
    expect(Math.abs(yUp[2])).toBeLessThan(1e-9);
    expect(zUp[2]).toBeGreaterThan(0);
    expect(Math.abs(zUp[1])).toBeLessThan(1e-9);
  });

  it("moves the camera closer as zoom grows", () => {
    const near = r1ViewerCameraPosition(
      { kind: "3d", yaw: 0, pitch: 0, zoom: 4, target: [0, 0, 0] },
      BOUNDS,
      "y_up",
    );
    const far = r1ViewerCameraPosition(
      { kind: "3d", yaw: 0, pitch: 0, zoom: 1, target: [0, 0, 0] },
      BOUNDS,
      "y_up",
    );

    expect(Math.hypot(...near)).toBeLessThan(Math.hypot(...far));
  });

  it("refuses a camera that cannot describe a position", () => {
    for (const camera of [
      { kind: "3d", yaw: Number.NaN, pitch: 0, zoom: 1, target: [0, 0, 0] },
      { kind: "3d", yaw: 0, pitch: 0, zoom: 0, target: [0, 0, 0] },
      { kind: "3d", yaw: 0, pitch: 0, zoom: -1, target: [0, 0, 0] },
    ] as const) {
      expect(() => r1ViewerCameraPosition(camera, BOUNDS, "y_up")).toThrow("r1_viewer_camera_invalid");
    }
  });

  it("falls back to a usable distance when the representation has no bounds", () => {
    const position = r1ViewerCameraPosition(
      { kind: "3d", yaw: 0, pitch: 0, zoom: 1, target: [0, 0, 0] },
      null,
      "y_up",
    );
    expect(Number.isFinite(Math.hypot(...position))).toBe(true);
    expect(Math.hypot(...position)).toBeGreaterThan(0);
  });
});

describe("R1 viewer axis presets", () => {
  it("gives front, back and top three distinct orientations centred on the model", () => {
    const front = r1ViewerAxisPresetCamera("front", BOUNDS);
    const back = r1ViewerAxisPresetCamera("back", BOUNDS);
    const top = r1ViewerAxisPresetCamera("top", BOUNDS);

    expect(new Set([front.yaw, back.yaw]).size).toBe(2);
    expect(top.pitch).not.toBe(front.pitch);
    for (const preset of [front, back, top]) {
      expect(preset.target).toEqual(r1ViewerBoundsCenter(BOUNDS));
    }
  });

  it("centres on the origin when there is nothing to frame", () => {
    expect(r1ViewerAxisPresetCamera("front", null).target).toEqual([0, 0, 0]);
  });
});

describe("R1 viewer geometry status", () => {
  it("reports a renderable scene with its totals", () => {
    expect(r1ViewerGeometryStatus(summary({ nodes: [node(), node({ nodeKey: "node-b" })] }))).toEqual({
      kind: "renderable",
      nodeCount: 2,
      triangleCount: 24,
    });
  });

  it("names why nothing can be shown instead of rendering an empty canvas", () => {
    expect(r1ViewerGeometryStatus(summary({ nodes: [] })))
      .toEqual({ kind: "empty", reason: "no_nodes" });
    expect(r1ViewerGeometryStatus(summary({ nodes: [node({ triangleCount: 0 })] })))
      .toEqual({ kind: "empty", reason: "no_triangles" });
    expect(r1ViewerGeometryStatus(summary({ bounds: null })))
      .toEqual({ kind: "empty", reason: "no_bounds" });
  });
});

describe("R1 viewer selection", () => {
  const registry = new Map([["node-a", "object-1"]]);

  it("resolves a registered node key to its object", () => {
    expect(r1ViewerResolveSelection("node-a", registry))
      .toEqual({ kind: "resolved", objectId: "object-1", nodeKey: "node-a" });
  });

  it("does not fall back to the display name or the node index", () => {
    // T14: a re-export can reuse both for different geometry. Anything but the
    // registered key must surface as unresolved so a human reconciles it.
    for (const candidate of ["Wall", "0", "node-b"]) {
      expect(r1ViewerResolveSelection(candidate, registry))
        .toEqual({ kind: "unregistered", nodeKey: candidate });
    }
  });
});

describe("R1 viewer render eligibility", () => {
  it("drives the 3D canvas only for a GLB representation", () => {
    expect(r1ViewerCanRender3d(state({ format: "glb" }))).toBe(true);
    expect(r1ViewerCanRender3d(state({ format: "pdf" }))).toBe(false);
    expect(r1ViewerCanRender3d(state({ format: "png" }))).toBe(false);
  });

  it("stops rendering once access is revoked but keeps reading during grace and archive", () => {
    expect(r1ViewerCanRender3d(state({ lifecycle: "revoked" }))).toBe(false);
    expect(r1ViewerCanRender3d(state({ lifecycle: "grace_read_only" }))).toBe(true);
    expect(r1ViewerCanRender3d(state({ lifecycle: "archive_read_only" }))).toBe(true);
  });

  it("refuses a scene whose digest is not the one the state approved", () => {
    expect(r1ViewerSceneMatchesState(state(), summary())).toBe(true);
    expect(r1ViewerSceneMatchesState(state(), summary({ representationDigest: OTHER_DIGEST })))
      .toBe(false);
  });
});
