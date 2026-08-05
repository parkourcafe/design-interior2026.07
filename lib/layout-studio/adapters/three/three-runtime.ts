import * as THREE from "three";

import type {
  SceneDescriptor,
  SceneObjectDescriptor,
} from "@/lib/layout-studio/adapters/three/scene-compiler";

export interface ThreeLightDescriptor {
  sourceId: string;
  kind: "ambient" | "directional" | "point" | "linear_proxy";
  color?: THREE.ColorRepresentation;
  intensity?: number;
  positionM?: { x: number; y: number; z: number };
  distanceM?: number;
  decay?: number;
}

export interface ThreeCeilingDescriptor {
  sourceId: string;
  widthM: number;
  depthM: number;
  heightM: number;
  thicknessM?: number;
  material?: THREE.MeshStandardMaterialParameters;
  visible?: boolean;
}

export interface ThreeSceneOptions {
  materials?: Record<string, THREE.MeshStandardMaterialParameters>;
  lights?: ThreeLightDescriptor[];
  ceiling?: ThreeCeilingDescriptor;
}

function identify(object: THREE.Object3D, sourceId: string, kind: string): void {
  object.name = sourceId;
  object.userData.sourceId = sourceId;
  object.userData.kind = kind;
}

function positionObject(object: THREE.Object3D, descriptor: SceneObjectDescriptor): void {
  const { x, y, z } = descriptor.positionM;
  object.position.set(x, y, z);
  object.rotation.y = descriptor.rotationYRad ?? 0;
}

function buildSceneObject(
  descriptor: SceneObjectDescriptor,
  materialForObject: (descriptor: SceneObjectDescriptor) => THREE.MeshStandardMaterial,
): THREE.Object3D {
  if (descriptor.geometry.type === "point") {
    const point = new THREE.Object3D();
    identify(point, descriptor.sourceId, descriptor.kind);
    positionObject(point, descriptor);
    return point;
  }

  const geometry = new THREE.BoxGeometry(
    descriptor.geometry.widthM,
    descriptor.geometry.heightM,
    descriptor.geometry.depthM,
  );
  const mesh = new THREE.Mesh(geometry, materialForObject(descriptor));
  identify(mesh, descriptor.sourceId, descriptor.kind);
  positionObject(mesh, descriptor);
  return mesh;
}

function buildLight(descriptor: ThreeLightDescriptor): THREE.Light {
  const color = descriptor.color ?? 0xffffff;
  const intensity = descriptor.intensity ?? 1;
  let light: THREE.Light;

  switch (descriptor.kind) {
    case "directional":
      light = new THREE.DirectionalLight(color, intensity);
      break;
    case "point":
    case "linear_proxy":
      light = new THREE.PointLight(
        color,
        intensity,
        descriptor.distanceM ?? 0,
        descriptor.decay ?? 2,
      );
      break;
    case "ambient":
      light = new THREE.AmbientLight(color, intensity);
      break;
  }

  identify(light, descriptor.sourceId, descriptor.kind);
  if (descriptor.positionM) {
    light.position.set(
      descriptor.positionM.x,
      descriptor.positionM.y,
      descriptor.positionM.z,
    );
  }
  return light;
}

function buildCeiling(descriptor: ThreeCeilingDescriptor): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(
    descriptor.widthM,
    descriptor.thicknessM ?? 0.05,
    descriptor.depthM,
  );
  const material = new THREE.MeshStandardMaterial(
    descriptor.material ?? { color: 0xffffff, roughness: 1, metalness: 0 },
  );
  const ceiling = new THREE.Mesh(geometry, material);
  ceiling.position.y = descriptor.heightM;
  ceiling.visible = descriptor.visible ?? true;
  identify(ceiling, descriptor.sourceId, "ceiling");
  return ceiling;
}

export function buildThreeScene(
  descriptor: SceneDescriptor,
  options: ThreeSceneOptions = {},
): THREE.Scene {
  const scene = new THREE.Scene();
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const materialForObject = (descriptor: SceneObjectDescriptor): THREE.MeshStandardMaterial => {
    const materialKey = options.materials?.[descriptor.sourceId] ? descriptor.sourceId : descriptor.kind;
    const existing = materials.get(materialKey);
    if (existing) return existing;

    const material = new THREE.MeshStandardMaterial(options.materials?.[materialKey]);
    materials.set(materialKey, material);
    return material;
  };

  for (const object of descriptor.objects) {
    scene.add(buildSceneObject(object, materialForObject));
  }
  for (const light of options.lights ?? []) {
    scene.add(buildLight(light));
  }
  if (options.ceiling) {
    scene.add(buildCeiling(options.ceiling));
  }

  return scene;
}

const disposedGeometries = new WeakSet<THREE.BufferGeometry>();
const disposedMaterials = new WeakSet<THREE.Material>();

export function disposeThreeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    if (!disposedGeometries.has(object.geometry)) {
      disposedGeometries.add(object.geometry);
      object.geometry.dispose();
    }

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (disposedMaterials.has(material)) continue;
      disposedMaterials.add(material);
      material.dispose();
    }
  });
  scene.clear();
}

export function isWebGLAvailable(
  probe: () => boolean = () => typeof globalThis.WebGLRenderingContext !== "undefined",
): boolean {
  return probe();
}
