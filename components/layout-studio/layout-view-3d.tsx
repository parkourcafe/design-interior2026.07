"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { LayoutDocument } from "@/lib/layout-studio/domain";
import { compileScene } from "@/lib/layout-studio/adapters/three/scene-compiler";
import { ru } from "@/lib/i18n/ru";

export function LayoutView3D({ document, selectedId, showCeiling }: { document: LayoutDocument; selectedId?: string; showCeiling: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return; const element = host.current; const width = Math.max(320, element.clientWidth); const height = Math.max(420, element.clientHeight); const scene = new THREE.Scene(); scene.background = new THREE.Color("#eee9df");
    const camera = new THREE.PerspectiveCamera(42, width / height, .01, 100); camera.position.set(9, 7, 8); camera.lookAt(4, 1, 1.5);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { const fallback = window.document.createElement("div"); fallback.setAttribute("role", "status"); fallback.style.cssText = "padding:32px;color:#6b6258"; fallback.textContent = ru.layoutStudio.webglUnavailable; element.replaceChildren(fallback); return; }
    renderer.setSize(width, height); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace; element.replaceChildren(renderer.domElement);
    const materials = new Map(document.materials.map((item) => [item.id, item])); const meshes: THREE.Mesh[] = [];
    for (const box of compileScene(document).boxes) { if (box.kind === "ceiling" && !showCeiling) continue; const source = box.parentSourceId ?? box.id; const definition = box.materialId ? materials.get(box.materialId) : undefined; const material = new THREE.MeshStandardMaterial({ color: definition?.baseColor ?? (box.kind === "wall" ? "#8b8780" : "#b9aa91"), roughness: definition?.roughness ?? .75, metalness: definition?.metalness ?? 0, emissive: source === selectedId ? "#ff5a36" : definition?.emissive ?? "#000000", emissiveIntensity: source === selectedId ? .7 : definition?.emissiveIntensity ?? 0 }); const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.widthM, box.heightM, box.depthM), material); mesh.position.set(box.xM, box.yM, box.zM); mesh.rotation.y = box.rotationYRad; mesh.userData.sourceId = source; mesh.castShadow = box.kind !== "ceiling"; mesh.receiveShadow = true; meshes.push(mesh); scene.add(mesh); }
    scene.add(new THREE.HemisphereLight("#fff8e8", "#444a55", 2.2)); const directional = new THREE.DirectionalLight("#ffffff", 3.4); directional.position.set(5, 9, 4); directional.castShadow = true; scene.add(directional); const warm = new THREE.PointLight("#ffd5a3", 36, 12); warm.position.set(4, 2.4, 1); scene.add(warm);
    const grid = new THREE.GridHelper(12, 24, "#8d877e", "#d2cbc0"); scene.add(grid); let frame = 0; const render = () => { renderer.render(scene, camera); frame = requestAnimationFrame(render); }; render();
    const onResize = () => { const nextWidth = Math.max(320, element.clientWidth); const nextHeight = Math.max(420, element.clientHeight); camera.aspect = nextWidth / nextHeight; camera.updateProjectionMatrix(); renderer.setSize(nextWidth, nextHeight); }; window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", onResize); meshes.forEach((mesh) => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }); renderer.dispose(); renderer.forceContextLoss(); element.replaceChildren(); };
  }, [document, selectedId, showCeiling]);
  return <div ref={host} style={{ minHeight: 520, width: "100%", overflow: "hidden", borderRadius: 16, background: "#eee9df" }} aria-label="3D-сцена Layout Studio" />;
}
