import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  buildThreeScene,
  disposeThreeScene,
  isWebGLAvailable,
} from "@/lib/layout-studio/adapters/three/three-runtime";

describe("LS-AT-041/043/045: Three runtime", () => {
  it("builds a scene with source-addressable meshes, lights, and a toggleable ceiling", () => {
    const scene = buildThreeScene(
      {
        units: "m",
        objects: [
          {
            sourceId: "wall.room.north",
            kind: "wall",
            geometry: { type: "box", widthM: 4, heightM: 2.8, depthM: 0.2 },
            positionM: { x: 2, y: 1.4, z: 0 },
            rotationYRad: 0,
          },
        ],
      },
      {
        materials: {
          wall: { color: "#d8d2c8", roughness: 0.8, metalness: 0 },
        },
        lights: [
          {
            sourceId: "light.room.ambient",
            kind: "ambient",
            color: "#ffffff",
            intensity: 0.7,
          },
        ],
        ceiling: { sourceId: "ceiling.room.main", widthM: 4, depthM: 3, heightM: 2.8 },
      },
    );

    expect(scene).toBeInstanceOf(THREE.Scene);

    const wall = scene.getObjectByName("wall.room.north");
    expect(wall).toBeInstanceOf(THREE.Mesh);
    expect(wall?.userData.sourceId).toBe("wall.room.north");

    const light = scene.getObjectByName("light.room.ambient");
    expect(light).toBeInstanceOf(THREE.Light);
    expect(light?.userData.sourceId).toBe("light.room.ambient");

    const ceiling = scene.getObjectByName("ceiling.room.main");
    expect(ceiling).toBeInstanceOf(THREE.Mesh);
    expect(ceiling?.userData.sourceId).toBe("ceiling.room.main");
    ceiling!.visible = false;
    expect(ceiling?.visible).toBe(false);
  });

  it("disposes shared geometry and material exactly once, including repeated cleanup", () => {
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");

    scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));

    disposeThreeScene(scene);
    disposeThreeScene(scene);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});

describe("LS-AT-046: WebGL capability guard", () => {
  it("returns the injected probe result without touching a renderer or DOM", () => {
    const availableProbe = vi.fn(() => true);
    const unavailableProbe = vi.fn(() => false);

    expect(isWebGLAvailable(availableProbe)).toBe(true);
    expect(isWebGLAvailable(unavailableProbe)).toBe(false);
    expect(availableProbe).toHaveBeenCalledOnce();
    expect(unavailableProbe).toHaveBeenCalledOnce();
  });
});
