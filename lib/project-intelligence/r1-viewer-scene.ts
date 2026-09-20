import type { R1ViewerCamera3d, R1ViewerState } from "./r1-viewer-state";

/** Declared by the architect's export attestation (§6.1), never inferred from the file. */
export type R1ViewerUpAxis = "y_up" | "z_up";

export type R1ViewerAxisPreset = "front" | "back" | "top";

export interface R1ViewerBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/**
 * One renderable node of the loaded representation.
 *
 * `nodeKey` is the stable key the architect registered for this node. glTF node
 * order and display names are deliberately kept separate from it: both survive a
 * re-export that moved the geometry somewhere else.
 */
export interface R1ViewerNode {
  readonly nodeKey: string;
  readonly displayName: string;
  readonly nodeIndex: number;
  readonly triangleCount: number;
}

export interface R1ViewerSceneSummary {
  readonly representationDigest: string;
  readonly upAxis: R1ViewerUpAxis;
  readonly bounds: R1ViewerBounds | null;
  readonly nodes: readonly R1ViewerNode[];
}

export type R1ViewerGeometryStatus =
  | { readonly kind: "renderable"; readonly nodeCount: number; readonly triangleCount: number }
  | { readonly kind: "empty"; readonly reason: "no_nodes" | "no_triangles" | "no_bounds" };

export type R1ViewerSelectionOutcome =
  | { readonly kind: "resolved"; readonly objectId: string; readonly nodeKey: string }
  | { readonly kind: "unregistered"; readonly nodeKey: string };

const PRESET_ORIENTATION: Record<R1ViewerAxisPreset, { readonly yaw: number; readonly pitch: number }> = {
  front: { yaw: 0, pitch: 0 },
  back: { yaw: Math.PI, pitch: 0 },
  top: { yaw: 0, pitch: Math.PI / 2 },
};

function assertFinite(value: number, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(code);
  return value;
}

function boundsSpan(bounds: R1ViewerBounds): number {
  let largest = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const min = assertFinite(bounds.min[axis]!, "r1_viewer_bounds_invalid");
    const max = assertFinite(bounds.max[axis]!, "r1_viewer_bounds_invalid");
    if (max < min) throw new Error("r1_viewer_bounds_invalid");
    largest = Math.max(largest, max - min);
  }
  return largest;
}

export function r1ViewerBoundsCenter(bounds: R1ViewerBounds): readonly [number, number, number] {
  boundsSpan(bounds);
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

/**
 * Camera placement for the stored orbit state.
 *
 * Y-up is the glTF convention; SketchUp exports are Z-up. Which one applies is
 * taken from the attestation, so the same stored yaw/pitch keeps pointing at the
 * same side of the building instead of silently tipping over between formats.
 */
export function r1ViewerCameraPosition(
  camera: R1ViewerCamera3d,
  bounds: R1ViewerBounds | null,
  upAxis: R1ViewerUpAxis,
): readonly [number, number, number] {
  assertFinite(camera.yaw, "r1_viewer_camera_invalid");
  assertFinite(camera.pitch, "r1_viewer_camera_invalid");
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) throw new Error("r1_viewer_camera_invalid");

  const span = bounds === null ? 2 : Math.max(boundsSpan(bounds), Number.EPSILON);
  const distance = (span * 1.5) / camera.zoom;
  const horizontal = Math.cos(camera.pitch) * distance;
  const vertical = Math.sin(camera.pitch) * distance;
  const [tx, ty, tz] = camera.target;

  return upAxis === "y_up"
    ? [tx + Math.sin(camera.yaw) * horizontal, ty + vertical, tz + Math.cos(camera.yaw) * horizontal]
    : [tx + Math.sin(camera.yaw) * horizontal, ty + Math.cos(camera.yaw) * horizontal, tz + vertical];
}

export function r1ViewerAxisPresetCamera(
  preset: R1ViewerAxisPreset,
  bounds: R1ViewerBounds | null,
): R1ViewerCamera3d {
  const orientation = PRESET_ORIENTATION[preset];
  if (orientation === undefined) throw new Error("r1_viewer_axis_preset_invalid");

  return {
    kind: "3d",
    yaw: orientation.yaw,
    pitch: orientation.pitch,
    zoom: 1,
    target: bounds === null ? [0, 0, 0] : r1ViewerBoundsCenter(bounds),
  };
}

export function r1ViewerGeometryStatus(summary: R1ViewerSceneSummary): R1ViewerGeometryStatus {
  if (summary.nodes.length === 0) return { kind: "empty", reason: "no_nodes" };

  const triangleCount = summary.nodes.reduce((total, node) => total + node.triangleCount, 0);
  if (triangleCount === 0) return { kind: "empty", reason: "no_triangles" };
  if (summary.bounds === null) return { kind: "empty", reason: "no_bounds" };

  return { kind: "renderable", nodeCount: summary.nodes.length, triangleCount };
}

/**
 * Picking result → registered object.
 *
 * Only the registered node key resolves. Display name and glTF node index are
 * deliberately not accepted as fallbacks: a re-export can reuse both for a
 * different piece of geometry, and T14 requires that case to end up as manual
 * reconciliation rather than a silently moved binding.
 */
export function r1ViewerResolveSelection(
  nodeKey: string,
  registry: ReadonlyMap<string, string>,
): R1ViewerSelectionOutcome {
  const objectId = registry.get(nodeKey);
  return objectId === undefined
    ? { kind: "unregistered", nodeKey }
    : { kind: "resolved", objectId, nodeKey };
}

/**
 * Whether this state may drive the 3D canvas at all.
 *
 * The viewer never opens a source file: only a representation that already
 * passed validation, in the one format the canvas can render, and only while the
 * access lifecycle still permits reading (§6.1, §11.2).
 */
export function r1ViewerCanRender3d(state: R1ViewerState): boolean {
  return state.representation.format === "glb" && state.access.lifecycle !== "revoked";
}

export function r1ViewerSceneMatchesState(
  state: R1ViewerState,
  summary: R1ViewerSceneSummary,
): boolean {
  return summary.representationDigest === state.representation.digest;
}
