import type { LayoutDocument } from "../../domain";
import { compileScene } from "./scene-compiler";

const vertices = new Float32Array([-0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,0.5,-0.5, -0.5,0.5,-0.5, -0.5,-0.5,0.5, 0.5,-0.5,0.5, 0.5,0.5,0.5, -0.5,0.5,0.5]);
const indices = new Uint16Array([0,1,2,0,2,3, 4,6,5,4,7,6, 0,4,5,0,5,1, 3,2,6,3,6,7, 1,5,6,1,6,2, 0,3,7,0,7,4]);
const pad4 = (length: number) => (4 - length % 4) % 4;

export function exportLayoutGlb(document: LayoutDocument): Uint8Array {
  const scene = compileScene(document); const positionBytes = new Uint8Array(vertices.buffer); const indexBytes = new Uint8Array(indices.buffer); const binaryLength = positionBytes.length + indexBytes.length + pad4(positionBytes.length + indexBytes.length); const binary = new Uint8Array(binaryLength); binary.set(positionBytes); binary.set(indexBytes, positionBytes.length);
  const nodes = scene.boxes.map((box) => ({ name: box.id, mesh: 0, translation: [box.xM, box.yM, box.zM], scale: [box.widthM, box.heightM, box.depthM], rotation: [0, Math.sin(box.rotationYRad / 2), 0, Math.cos(box.rotationYRad / 2)], extras: { sourceId: box.parentSourceId ?? box.id, kind: box.kind } }));
  const gltf = { asset: { version: "2.0", generator: "ArchiDom Layout Studio" }, scene: 0, scenes: [{ nodes: nodes.map((_, index) => index) }], nodes, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-.5,-.5,-.5], max: [.5,.5,.5] }, { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 }, { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length, target: 34963 }], buffers: [{ byteLength: binary.length }] };
  const jsonRaw = new TextEncoder().encode(JSON.stringify(gltf)); const json = new Uint8Array(jsonRaw.length + pad4(jsonRaw.length)); json.fill(0x20); json.set(jsonRaw); const total = 12 + 8 + json.length + 8 + binary.length; const out = new Uint8Array(total); const view = new DataView(out.buffer); view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true); view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(json, 20); const binaryHeader = 20 + json.length; view.setUint32(binaryHeader, binary.length, true); view.setUint32(binaryHeader + 4, 0x004e4942, true); out.set(binary, binaryHeader + 8); return out;
}

export class GlbExportAdapter { async render(document: LayoutDocument) { return exportLayoutGlb(document); } }
