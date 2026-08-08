import type { SceneDescriptor } from "@/lib/layout-studio/adapters/three/scene-compiler";

export interface GlbExportMetadata {
  versionId?: string;
  semanticHash?: string;
}

export interface GlbGeometryDimensions {
  widthM: number;
  heightM: number;
  depthM: number;
}

export interface GlbExportOptions {
  dimensionsMBySourceId?: Readonly<Record<string, GlbGeometryDimensions>>;
}

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

function paddedLength(length: number): number {
  return (length + 3) & ~3;
}

function unitBoxBinary(): Uint8Array<ArrayBuffer> {
  const positions = new Float32Array([
    -0.5, -0.5, -0.5,
     0.5, -0.5, -0.5,
     0.5,  0.5, -0.5,
    -0.5,  0.5, -0.5,
    -0.5, -0.5,  0.5,
     0.5, -0.5,  0.5,
     0.5,  0.5,  0.5,
    -0.5,  0.5,  0.5,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    3, 2, 6, 3, 6, 7,
    0, 3, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 2,
  ]);
  const bytes = new Uint8Array(positions.byteLength + indices.byteLength);
  bytes.set(new Uint8Array(positions.buffer), 0);
  bytes.set(new Uint8Array(indices.buffer), positions.byteLength);
  return bytes;
}

/**
 * Serializes a scene descriptor without WebGL or DOM dependencies. Geometry and
 * transforms use metres, matching the descriptor contract and glTF conventions.
 */
export function exportSceneDescriptorToGlb(
  descriptor: SceneDescriptor,
  metadata: GlbExportMetadata = {},
  options: GlbExportOptions = {},
): Uint8Array<ArrayBuffer> {
  const binary = unitBoxBinary();
  const positionByteLength = 8 * 3 * Float32Array.BYTES_PER_ELEMENT;
  const nodes = descriptor.objects.map((object) => {
    const node: Record<string, unknown> = {
      name: object.sourceId,
      extras: { sourceId: object.sourceId, kind: object.kind },
      translation: [object.positionM.x, object.positionM.y, object.positionM.z],
    };

    if (object.rotationYRad !== undefined && object.rotationYRad !== 0) {
      const halfAngle = object.rotationYRad / 2;
      node.rotation = [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)];
    }
    if (object.geometry.type !== "point") {
      const geometry = object.geometry as typeof object.geometry & { lengthM?: number };
      const dimensions = options.dimensionsMBySourceId?.[object.sourceId] ?? {
        widthM: geometry.widthM ?? geometry.lengthM ?? 0,
        heightM: geometry.heightM,
        depthM: geometry.depthM,
      };
      node.mesh = 0;
      node.scale = [dimensions.widthM, dimensions.heightM, dimensions.depthM];
    }
    return node;
  });

  const gltf = {
    asset: {
      version: "2.0",
      generator: "ArchiDom Layout Studio headless GLB exporter",
    },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionByteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positionByteLength,
        byteLength: binary.byteLength - positionByteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: "VEC3",
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 36,
        type: "SCALAR",
        min: [0],
        max: [7],
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    extras: metadata,
  };

  const encodedJson = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = paddedLength(encodedJson.byteLength);
  const binaryLength = paddedLength(binary.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
  const glb = new Uint8Array(totalLength);
  const view = new DataView(glb.buffer);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK_TYPE, true);
  glb.fill(0x20, 20, 20 + jsonLength);
  glb.set(encodedJson, 20);

  const binaryHeaderOffset = 20 + jsonLength;
  view.setUint32(binaryHeaderOffset, binaryLength, true);
  view.setUint32(binaryHeaderOffset + 4, BIN_CHUNK_TYPE, true);
  glb.set(binary, binaryHeaderOffset + 8);
  return glb;
}

export const serializeSceneDescriptorToGlb = exportSceneDescriptorToGlb;
