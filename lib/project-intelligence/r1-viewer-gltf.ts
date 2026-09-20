import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import type {
  R1ViewerBounds,
  R1ViewerNode,
  R1ViewerSceneSummary,
  R1ViewerUpAxis,
} from "./r1-viewer-scene";

/**
 * Bytes are handed in, never fetched here.
 *
 * Authorising a read, re-checking the grant per range and refusing a raw storage
 * locator are the delivery broker's job (§11.2). Keeping the loader byte-only
 * means the canvas cannot accidentally become a second, unauthorised way to
 * reach storage.
 */
export interface R1ViewerLoadInput {
  readonly bytes: ArrayBuffer;
  readonly representationDigest: string;
  readonly upAxis: R1ViewerUpAxis;
}

export interface R1ViewerLoadResult {
  readonly summary: R1ViewerSceneSummary;
  readonly scene: THREE.Group;
  readonly registry: ReadonlyMap<string, string>;
}

const NODE_KEY = /^[A-Za-z0-9:_-]{1,128}$/;

/**
 * `instanceof` is unreliable here: bytes can arrive from another realm (a worker,
 * an iframe, jsdom under test) and then fail the check while being a perfectly
 * good buffer. The brand check holds across realms.
 */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function triangleCount(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) return 0;
  if (geometry.index !== null) return Math.floor(geometry.index.count / 3);
  const position = geometry.getAttribute("position");
  return position === undefined ? 0 : Math.floor(position.count / 3);
}

function readBounds(root: THREE.Object3D): R1ViewerBounds | null {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const { min, max } = box;
  if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) return null;
  return { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] };
}

/**
 * Parses one already-validated GLB into the summary the viewer reasons about.
 *
 * The stable node key travels in glTF `extras` (surfaced by GLTFLoader as
 * `userData`), because that is what the architect registered. Nodes without one
 * still render — they simply cannot be selected as a known object, which is the
 * honest outcome rather than inventing a key from the node's position or name.
 */
export async function r1ViewerLoadGlb(input: R1ViewerLoadInput): Promise<R1ViewerLoadResult> {
  if (!isArrayBuffer(input.bytes) || input.bytes.byteLength === 0) {
    throw new Error("r1_viewer_glb_bytes_invalid");
  }

  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    try {
      loader.parse(input.bytes, "", (parsed) => resolve(parsed as { scene: THREE.Group }), reject);
    } catch (cause) {
      reject(cause instanceof Error ? cause : new Error("r1_viewer_glb_parse_failed"));
    }
  }).catch(() => {
    throw new Error("r1_viewer_glb_parse_failed");
  });

  const nodes: R1ViewerNode[] = [];
  const registry = new Map<string, string>();
  let nodeIndex = 0;

  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const index = nodeIndex;
    nodeIndex += 1;

    const rawKey = (object.userData as { r1NodeKey?: unknown }).r1NodeKey;
    const rawObjectId = (object.userData as { r1ObjectId?: unknown }).r1ObjectId;
    const nodeKey = typeof rawKey === "string" && NODE_KEY.test(rawKey) ? rawKey : null;
    if (nodeKey === null) return;

    nodes.push({
      nodeKey,
      displayName: typeof object.name === "string" ? object.name : "",
      nodeIndex: index,
      triangleCount: triangleCount(object),
    });

    if (typeof rawObjectId === "string" && NODE_KEY.test(rawObjectId)) {
      registry.set(nodeKey, rawObjectId);
    }
  });

  return {
    summary: {
      representationDigest: input.representationDigest,
      upAxis: input.upAxis,
      bounds: readBounds(gltf.scene),
      nodes,
    },
    scene: gltf.scene,
    registry,
  };
}

export function r1ViewerDisposeScene(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const material = object.material;
    for (const entry of Array.isArray(material) ? material : [material]) {
      entry.dispose();
    }
  });
}
