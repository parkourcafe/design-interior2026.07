// @vitest-environment jsdom
// The loader runs in the browser, and the exporter used to build the fixture
// needs FileReader; both are closer to production under jsdom than under node.
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { describe, expect, it } from "vitest";
import { r1ViewerDisposeScene, r1ViewerLoadGlb } from "./r1-viewer-gltf";
import { r1ViewerGeometryStatus, r1ViewerResolveSelection } from "./r1-viewer-scene";

const DIGEST = `sha256:${"c".repeat(64)}`;

function mesh(name: string, userData: Record<string, unknown>, x: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 2, 3);
  const item = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  item.name = name;
  item.userData = userData;
  item.position.set(x, 0, 0);
  return item;
}

/** Produces real GLB bytes rather than a stand-in, so the loader parses an actual file. */
async function buildGlb(objects: readonly THREE.Object3D[]): Promise<ArrayBuffer> {
  const scene = new THREE.Scene();
  for (const object of objects) scene.add(object);

  return await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error("exporter_did_not_return_binary"));
      },
      reject,
      { binary: true },
    );
  });
}

describe("R1 viewer GLB loading", () => {
  it("reads registered nodes, their object bindings and the model bounds from real bytes", async () => {
    const bytes = await buildGlb([
      mesh("Bar counter", { r1NodeKey: "node-bar", r1ObjectId: "object-bar" }, 0),
      mesh("Wall", { r1NodeKey: "node-wall", r1ObjectId: "object-wall" }, 5),
    ]);

    const loaded = await r1ViewerLoadGlb({ bytes, representationDigest: DIGEST, upAxis: "y_up" });

    expect(loaded.summary.representationDigest).toBe(DIGEST);
    expect(loaded.summary.nodes.map((node) => node.nodeKey).sort())
      .toEqual(["node-bar", "node-wall"]);
    expect(loaded.summary.nodes.every((node) => node.triangleCount > 0)).toBe(true);
    expect(loaded.summary.bounds).not.toBeNull();
    expect(r1ViewerGeometryStatus(loaded.summary).kind).toBe("renderable");

    expect(r1ViewerResolveSelection("node-bar", loaded.registry))
      .toEqual({ kind: "resolved", objectId: "object-bar", nodeKey: "node-bar" });

    r1ViewerDisposeScene(loaded.scene);
  });

  it("renders geometry the architect never registered but refuses to call it a known object", async () => {
    const bytes = await buildGlb([
      mesh("Registered", { r1NodeKey: "node-a", r1ObjectId: "object-a" }, 0),
      mesh("Loose geometry", {}, 4),
    ]);

    const loaded = await r1ViewerLoadGlb({ bytes, representationDigest: DIGEST, upAxis: "y_up" });

    // The unregistered mesh is still part of the model — it simply never becomes
    // selectable, instead of being given an invented key.
    expect(loaded.summary.nodes).toHaveLength(1);
    expect(loaded.registry.size).toBe(1);
    expect(loaded.summary.bounds).not.toBeNull();

    r1ViewerDisposeScene(loaded.scene);
  });

  it("keeps a node key out of the registry when no object was bound to it", async () => {
    const bytes = await buildGlb([mesh("Pending", { r1NodeKey: "node-pending" }, 0)]);

    const loaded = await r1ViewerLoadGlb({ bytes, representationDigest: DIGEST, upAxis: "y_up" });

    expect(loaded.summary.nodes.map((node) => node.nodeKey)).toEqual(["node-pending"]);
    expect(r1ViewerResolveSelection("node-pending", loaded.registry))
      .toEqual({ kind: "unregistered", nodeKey: "node-pending" });

    r1ViewerDisposeScene(loaded.scene);
  });

  it("reports an empty model instead of pretending the canvas is ready", async () => {
    const bytes = await buildGlb([]);

    const loaded = await r1ViewerLoadGlb({ bytes, representationDigest: DIGEST, upAxis: "y_up" });

    expect(r1ViewerGeometryStatus(loaded.summary)).toEqual({ kind: "empty", reason: "no_nodes" });
  });

  it("refuses bytes that are not a parsable model", async () => {
    await expect(r1ViewerLoadGlb({
      bytes: new TextEncoder().encode("not a glb at all").buffer as ArrayBuffer,
      representationDigest: DIGEST,
      upAxis: "y_up",
    })).rejects.toThrow("r1_viewer_glb_parse_failed");
  });

  it("refuses an empty body before touching the parser", async () => {
    await expect(r1ViewerLoadGlb({
      bytes: new ArrayBuffer(0),
      representationDigest: DIGEST,
      upAxis: "y_up",
    })).rejects.toThrow("r1_viewer_glb_bytes_invalid");
  });
});
