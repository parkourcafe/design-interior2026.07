"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OrbitControls as OrbitControlsInstance } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  Material,
  Mesh,
  PerspectiveCamera as PerspectiveCameraInstance,
  Scene,
  WebGLRenderer,
} from "three";

import {
  BrowserLayoutRepository,
  BrowserLayoutRepositoryError,
} from "@/lib/layout-studio/adapters/local/browser-layout-repository";
import { HttpLayoutRepository } from "@/lib/layout-studio/adapters/http/http-layout-repository";
import type { LayoutRepositoryPort } from "@/lib/layout-studio/application/layout-repository-port";
import {
  createSvgProjection,
  serializeSvgProjection,
  type SvgProjection,
} from "@/lib/layout-studio/adapters/svg/svg-projection";
import { compileLightDescriptors } from "@/lib/layout-studio/adapters/three/light-compiler";
import { compileMaterialDescriptors } from "@/lib/layout-studio/adapters/three/material-compiler";
import {
  compileSceneDescriptor,
  type SceneDescriptor,
} from "@/lib/layout-studio/adapters/three/scene-compiler";
import { EditorSession, type EditorSessionState } from "@/lib/layout-studio/application/editor-session";
import { LayoutExportService } from "@/lib/layout-studio/application/export-service";
import {
  deriveLayout,
  diffLayoutDocuments,
  validateLayoutDocument,
  type LayoutDocument,
  type LayoutDocumentDiff,
  type LayoutEntity,
  type LayoutIssue,
} from "@/lib/layout-studio/domain";
import { ru } from "@/lib/i18n/ru";

import styles from "./layout-studio-shell.module.css";

const copy = ru.layoutStudio;

type ViewMode = "2d" | "3d";
type LayerKey = "walls" | "openings" | "columns" | "objects" | "lights";

interface LocalSnapshot {
  id: string;
  createdAt: string;
  document: LayoutDocument;
  semanticHash?: string;
}

interface InspectorDraft {
  xMm: string;
  yMm: string;
  zMm: string;
  widthMm: string;
  depthMm: string;
  heightMm: string;
  rotationDeg: string;
}

interface PanState {
  xMm: number;
  yMm: number;
}

interface CameraPose {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

interface HighlightedMesh {
  mesh: Mesh;
  original: Material | Material[];
}

const SELECTION_EMISSIVE = 0x5ee6a8;
const SELECTION_EMISSIVE_INTENSITY = 0.55;

const EMPTY_DRAFT: InspectorDraft = {
  xMm: "",
  yMm: "",
  zMm: "",
  widthMm: "",
  depthMm: "",
  heightMm: "",
  rotationDeg: "",
};

function cloneDocument(document: LayoutDocument): LayoutDocument {
  return structuredClone(document);
}

function storageErrorMessage(error: unknown): string {
  if (
    error instanceof BrowserLayoutRepositoryError &&
    error.code === "STORAGE_QUOTA_EXCEEDED"
  ) {
    return copy.history.storageQuota;
  }
  return copy.history.storageError;
}

function entityLabel(entity: LayoutEntity): string {
  return typeof entity.label === "string" ? entity.label : entity.id;
}

function findEntity(document: LayoutDocument, entityId: string | null): LayoutEntity | null {
  if (!entityId) return null;
  const collections: LayoutEntity[][] = [
    document.walls,
    document.openings,
    document.columns,
    document.objects,
    document.lights,
  ];
  return collections.flat().find((entity) => entity.id === entityId) ?? null;
}

function draftForEntity(entity: LayoutEntity | null): InspectorDraft {
  if (!entity) return EMPTY_DRAFT;
  const value = (key: keyof InspectorDraft): string =>
    typeof entity[key] === "number" ? String(entity[key]) : "";
  return {
    xMm: value("xMm"),
    yMm: value("yMm"),
    zMm: value("zMm"),
    widthMm: value("widthMm"),
    depthMm: value("depthMm"),
    heightMm: value("heightMm"),
    rotationDeg: value("rotationDeg"),
  };
}

function downloadArtifact(content: BlobPart, mime: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function artifactChecksum(content: string | ArrayBuffer | Blob): Promise<string> {
  const bytes = typeof content === "string"
    ? new TextEncoder().encode(content)
    : content instanceof Blob
      ? new Uint8Array(await content.arrayBuffer())
      : new Uint8Array(content);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeFilePart(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "-");
}

function entityKind(document: LayoutDocument, id: string): string {
  if (document.walls.some((item) => item.id === id)) return copy.entities.wall;
  if (document.openings.some((item) => item.id === id)) return copy.entities.opening;
  if (document.columns.some((item) => item.id === id)) return copy.entities.column;
  if (document.objects.some((item) => item.id === id)) return copy.entities.object;
  return copy.entities.light;
}

function compileThreeMaterialOptions(
  document: LayoutDocument,
  descriptor: SceneDescriptor,
): Record<string, {
  color: string;
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
}> {
  const sceneObjects = new Map(descriptor.objects.map((item) => [item.sourceId, item]));
  return Object.fromEntries(
    compileMaterialDescriptors(document).flatMap((material) => {
      const sceneObject = sceneObjects.get(material.targetId);
      if (!sceneObject) return [];
      return [[sceneObject.sourceId, {
        color: material.color,
        roughness: material.roughness,
        metalness: material.metalness,
        emissive: material.emissive,
        emissiveIntensity: material.emissiveIntensity,
      }]];
    }),
  );
}

function finiteEntityNumber(entity: LayoutEntity, key: string): number | null {
  const value = entity[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function OpeningMark({
  document,
  openingId,
  selected,
  onSelect,
}: {
  readonly document: LayoutDocument;
  readonly openingId: string;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}) {
  const opening = document.openings.find((item) => item.id === openingId);
  const wall = document.walls.find((item) => item.id === opening?.parentWallId);
  const start = document.nodes.find((item) => item.id === wall?.startNodeId);
  const end = document.nodes.find((item) => item.id === wall?.endNodeId);
  if (!opening || !start || !end) return null;

  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const length = Math.hypot(dx, dy) || 1;
  const startRatio = opening.offsetMm / length;
  const endRatio = (opening.offsetMm + opening.widthMm) / length;
  return (
    <line
      x1={start.xMm + dx * startRatio}
      y1={start.yMm + dy * startRatio}
      x2={start.xMm + dx * endRatio}
      y2={start.yMm + dy * endRatio}
      className={selected ? styles.openingSelected : styles.opening}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(opening.id);
      }}
    />
  );
}

function PlanCanvas({
  projection,
  document,
  layers,
  zoom,
  panState,
  showClearance,
  selection,
  onSelect,
  onPan,
}: {
  readonly projection: SvgProjection;
  readonly document: LayoutDocument;
  readonly layers: Record<LayerKey, boolean>;
  readonly zoom: number;
  readonly panState: PanState;
  readonly showClearance: boolean;
  readonly selection: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onPan: (pan: PanState) => void;
}) {
  const base = projection.viewBox;
  const padding = Math.max(base.width, base.height) * 0.07;
  const width = (base.width + padding * 2) / zoom;
  const height = (base.height + padding * 2) / zoom;
  const centerX = base.x + base.width / 2 + panState.xMm;
  const centerY = base.y + base.height / 2 + panState.yMm;
  const columnIds = new Set(document.columns.map((item) => item.id));
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));

  const panByKeyboard = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const step = Math.max(width, height) * 0.08;
    const offsets: Partial<Record<string, PanState>> = {
      ArrowLeft: { xMm: -step, yMm: 0 },
      ArrowRight: { xMm: step, yMm: 0 },
      ArrowUp: { xMm: 0, yMm: -step },
      ArrowDown: { xMm: 0, yMm: step },
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    onPan({ xMm: panState.xMm + offset.xMm, yMm: panState.yMm + offset.yMm });
  };

  return (
    <svg
      className={styles.plan}
      viewBox={`${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`}
      role="img"
      aria-label={copy.canvas.title2d}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
      tabIndex={0}
      onKeyDown={panByKeyboard}
      onClick={() => onSelect(null)}
    >
      <defs>
        <pattern id="layout-grid-small" width="100" height="100" patternUnits="userSpaceOnUse">
          <path d="M 100 0 L 0 0 0 100" className={styles.gridSmall} />
        </pattern>
        <pattern id="layout-grid" width="500" height="500" patternUnits="userSpaceOnUse">
          <rect width="500" height="500" fill="url(#layout-grid-small)" />
          <path d="M 500 0 L 0 0 0 500" className={styles.gridLarge} />
        </pattern>
      </defs>
      <rect
        x={centerX - width / 2}
        y={centerY - height / 2}
        width={width}
        height={height}
        fill="url(#layout-grid)"
      />
      {showClearance && document.clearanceZones.map((zone) => {
        const xMm = finiteEntityNumber(zone, "xMm");
        const yMm = finiteEntityNumber(zone, "yMm");
        const widthMm = finiteEntityNumber(zone, "widthMm");
        const depthMm = finiteEntityNumber(zone, "depthMm");
        if (xMm === null || yMm === null || widthMm === null || depthMm === null) return null;
        const rotationDeg = finiteEntityNumber(zone, "rotationDeg") ?? 0;
        return (
          <rect
            key={zone.id}
            x={xMm - widthMm / 2}
            y={yMm - depthMm / 2}
            width={widthMm}
            height={depthMm}
            transform={`rotate(${rotationDeg} ${xMm} ${yMm})`}
            className={styles.clearanceZone}
            aria-label={typeof zone.label === "string" ? zone.label : copy.layers.clearance}
          />
        );
      })}
      {layers.walls && projection.walls.map((wall) => (
        <polygon
          key={wall.sourceId}
          points={wall.points.map((point) => `${point.xMm},${point.yMm}`).join(" ")}
          className={selection === wall.sourceId ? styles.wallSelected : styles.wall}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(wall.sourceId);
          }}
        />
      ))}
      {layers.openings && projection.openings.map((opening) => (
        <OpeningMark
          key={opening.sourceId}
          document={document}
          openingId={opening.sourceId}
          selected={selection === opening.sourceId}
          onSelect={onSelect}
        />
      ))}
      {projection.boxes.map((box) => {
        const isColumn = columnIds.has(box.sourceId);
        if ((isColumn && !layers.columns) || (!isColumn && !layers.objects)) return null;
        return (
          <rect
            key={box.sourceId}
            x={box.xMm - box.widthMm / 2}
            y={box.yMm - box.depthMm / 2}
            width={box.widthMm}
            height={box.depthMm}
            rx={isColumn ? 0 : 40}
            transform={`rotate(${box.rotationDeg} ${box.xMm} ${box.yMm})`}
            className={selection === box.sourceId
              ? styles.boxSelected
              : isColumn ? styles.column : styles.object}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(box.sourceId);
            }}
          />
        );
      })}
      {layers.objects && document.objects.map((object) => (
        <text
          key={`${object.id}.label`}
          x={object.xMm}
          y={object.yMm}
          className={styles.objectLabel}
          textAnchor="middle"
          aria-hidden="true"
        >
          {object.label ?? object.id}
        </text>
      ))}
      {layers.walls && document.walls.map((wall) => {
        const start = nodeById.get(wall.startNodeId);
        const end = nodeById.get(wall.endNodeId);
        if (!start || !end) return null;
        const dimensionMm = Math.round(Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm));
        return (
          <g key={`${wall.id}.dimension`} className={styles.dimension} aria-hidden="true">
            <line x1={start.xMm} y1={start.yMm} x2={end.xMm} y2={end.yMm} />
            <text x={(start.xMm + end.xMm) / 2} y={(start.yMm + end.yMm) / 2 - 70} textAnchor="middle">
              {dimensionMm} мм
            </text>
          </g>
        );
      })}
      {layers.lights && document.lights.map((light) => (
        <circle
          key={light.id}
          cx={typeof light.xMm === "number" ? light.xMm : 0}
          cy={typeof light.yMm === "number" ? light.yMm : 0}
          r={selection === light.id ? 115 : 80}
          className={selection === light.id ? styles.lightSelected : styles.light}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(light.id);
          }}
        />
      ))}
    </svg>
  );
}

function SceneCanvas({
  document: sessionDocument,
  layers,
  selection,
  onSelect,
}: {
  readonly document: LayoutDocument;
  readonly layers: Record<LayerKey, boolean>;
  readonly selection: string | null;
  readonly onSelect: (id: string | null) => void;
}) {
  // EditorSession.getState() hands out a fresh deep clone on every refresh, so
  // the raw prop changes identity on a bare selection click. Pinning it to the
  // monotonic revision keeps the WebGL scene alive across non-mutating updates.
  const documentKey = `${sessionDocument.documentId}#${sessionDocument.stateRevision}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const document = useMemo(() => sessionDocument, [documentKey]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  // Camera reset restores the deterministic home pose in place: rebuilding the
  // whole scene to move a camera would drop the WebGL context on every click.
  const cameraRef = useRef<PerspectiveCameraInstance | null>(null);
  const controlsRef = useRef<OrbitControlsInstance | null>(null);
  const homePoseRef = useRef<CameraPose | null>(null);
  // Selection highlight swaps materials on the live scene. Rebuilding the scene
  // per selection would drop the WebGL context and cancel an in-flight orbit.
  const sceneRef = useRef<Scene | null>(null);
  const highlightRef = useRef<HighlightedMesh[]>([]);
  const selectionRef = useRef<string | null>(selection);
  const [webglState, setWebglState] = useState<"loading" | "ready" | "fallback">("loading");
  const [ceilingVisible, setCeilingVisible] = useState(true);
  const descriptor = useMemo(
    () => compileSceneDescriptor(document, deriveLayout(document).sceneProjection),
    [document],
  );
  const materialOptions = useMemo(
    () => compileThreeMaterialOptions(document, descriptor),
    [descriptor, document],
  );
  const lightOptions = useMemo(() => {
    const compiled = compileLightDescriptors(document);
    return compiled.length > 0
      ? compiled
      : [{ sourceId: "preview.ambient-fallback", kind: "ambient" as const, color: "#FFFFFF", intensity: 1 }];
  }, [document]);
  const visible = useMemo(() => descriptor.objects.filter((item) => {
    if (item.kind === "ceiling") return layers.lights && ceilingVisible;
    const canonicalId = item.parentSourceId ?? item.sourceId;
    if (document.walls.some((entity) => entity.id === canonicalId)) return layers.walls;
    if (document.openings.some((entity) => entity.id === item.sourceId)) return layers.openings;
    if (document.columns.some((entity) => entity.id === item.sourceId)) return layers.columns;
    if (document.objects.some((entity) => entity.id === item.sourceId)) return layers.objects;
    return layers.lights;
  }), [ceilingVisible, descriptor.objects, document, layers]);
  const visibleDescriptor = useMemo(
    () => ({ ...descriptor, objects: visible }),
    [descriptor, visible],
  );
  const positions = visible.map((item) => item.positionM);
  const minX = Math.min(0, ...positions.map((item) => item.x));
  const maxX = Math.max(1, ...positions.map((item) => item.x));
  const minZ = Math.min(0, ...positions.map((item) => item.z));
  const maxZ = Math.max(1, ...positions.map((item) => item.z));

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // Restores the meshes swapped by the last highlight and disposes the clones.
  const clearHighlight = () => {
    for (const entry of highlightRef.current) {
      const applied = Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material];
      entry.mesh.material = entry.original;
      for (const material of applied) material.dispose();
    }
    highlightRef.current = [];
  };

  const applyHighlight = (
    THREE: typeof import("three"),
    scene: Scene,
    entityId: string | null,
  ): void => {
    clearHighlight();
    if (!entityId) return;
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const canonicalId = String(object.userData.parentSourceId ?? object.userData.sourceId ?? "");
      if (canonicalId !== entityId) return;

      const original = object.material as Material | Material[];
      const sources = Array.isArray(original) ? original : [original];
      const highlighted = sources.map((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return material.clone();
        const clone = material.clone();
        clone.emissive.set(SELECTION_EMISSIVE);
        clone.emissiveIntensity = SELECTION_EMISSIVE_INTENSITY;
        return clone;
      });
      highlightRef.current.push({ mesh: object, original });
      object.material = Array.isArray(original) ? highlighted : highlighted[0];
    });
  };

  // Selection changes repaint the existing scene; they never rebuild it.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || webglState !== "ready") return;
    let cancelled = false;
    void import("three").then((THREE) => {
      if (cancelled || sceneRef.current !== scene) return;
      applyHighlight(THREE, scene, selection);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, webglState]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let animationFrame = 0;
    let renderer: WebGLRenderer | null = null;
    let scene: Scene | null = null;
    let controls: OrbitControlsInstance | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let detachPointer: (() => void) | null = null;
    let disposeScene: ((sceneToDispose: Scene) => void) | null = null;

    const start = async () => {
      try {
        const [THREE, { OrbitControls }, runtime] = await Promise.all([
          import("three"),
          import("three/examples/jsm/controls/OrbitControls.js"),
          import("@/lib/layout-studio/adapters/three/three-runtime"),
        ]);
        if (cancelled) return;
        const available = runtime.isWebGLAvailable(() => {
          const probe = window.document.createElement("canvas");
          return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
        });
        if (!available) {
          setWebglState("fallback");
          return;
        }

        scene = runtime.buildThreeScene(visibleDescriptor, {
          materials: materialOptions,
          lights: lightOptions,
        });
        disposeScene = runtime.disposeThreeScene;
        scene.background = new THREE.Color(0x26302a);
        sceneRef.current = scene;
        applyHighlight(THREE, scene, selectionRef.current);

        const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 250);
        const bounds = new THREE.Box3().setFromObject(scene);
        const center = bounds.isEmpty() ? new THREE.Vector3(3.6, 1.2, 2.3) : bounds.getCenter(new THREE.Vector3());
        const size = bounds.isEmpty() ? new THREE.Vector3(7.2, 3, 4.6) : bounds.getSize(new THREE.Vector3());
        const distance = Math.max(size.x, size.y, size.z, 2) * 1.65;
        camera.position.set(center.x + distance, center.y + distance * 0.72, center.z + distance);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.className = styles.webglCanvas ?? "";
        renderer.domElement.setAttribute("aria-label", copy.canvas.webglLabel);
        container.appendChild(renderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.copy(center);
        controls.update();

        cameraRef.current = camera;
        controlsRef.current = controls;
        homePoseRef.current = {
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          target: { x: center.x, y: center.y, z: center.z },
        };

        const resize = () => {
          if (!renderer) return;
          const width = Math.max(container.clientWidth, 1);
          const height = Math.max(container.clientHeight, 1);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
        };
        resize();
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        const handlePointer = (event: PointerEvent) => {
          if (!renderer || !scene) return;
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObjects(scene.children, true)
            .find((candidate) => typeof candidate.object.userData.sourceId === "string");
          onSelectRef.current(hit
            ? String(hit.object.userData.parentSourceId ?? hit.object.userData.sourceId)
            : null);
        };
        renderer.domElement.addEventListener("pointerdown", handlePointer);
        detachPointer = () => renderer?.domElement.removeEventListener("pointerdown", handlePointer);

        const animate = () => {
          if (cancelled || !renderer || !scene || !controls) return;
          controls.update();
          renderer.render(scene, camera);
          animationFrame = window.requestAnimationFrame(animate);
        };
        setWebglState("ready");
        animate();
      } catch {
        if (!cancelled) setWebglState("fallback");
      }
    };

    void start();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      detachPointer?.();
      clearHighlight();
      cameraRef.current = null;
      controlsRef.current = null;
      homePoseRef.current = null;
      sceneRef.current = null;
      controls?.dispose();
      if (scene && disposeScene) disposeScene(scene);
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
    };
    // Selection is handled by the highlight effect above so that picking an
    // object never tears down the renderer, the controls or the camera pose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceilingVisible, lightOptions, materialOptions, visibleDescriptor]);

  const resetCamera = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const home = homePoseRef.current;
    if (!camera || !controls || !home) return;
    camera.position.set(home.position.x, home.position.y, home.position.z);
    controls.target.set(home.target.x, home.target.y, home.target.z);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    controls.update();
  };

  return (
    <div className={styles.scene} role="img" aria-label={copy.canvas.title3d}>
      <div className={styles.sceneGrid} />
      {visible.map((item) => {
        const geometry = item.geometry;
        const left = 10 + ((item.positionM.x - minX) / (maxX - minX || 1)) * 80;
        const top = 12 + ((item.positionM.z - minZ) / (maxZ - minZ || 1)) * 66;
        const height = geometry.type === "box" ? Math.max(14, geometry.heightM * 24) : 16;
        const width = geometry.type === "box" ? Math.max(12, geometry.widthM * 15) : 16;
        const itemStyle = {
          left: `${left}%`,
          top: `${top}%`,
          width: `${Math.min(width, 150)}px`,
          height: `${Math.min(height, 120)}px`,
          "--scene-rotation": `${item.rotationYRad ?? 0}rad`,
        } as CSSProperties;
        return (
          <button
            type="button"
            key={item.sourceId}
            className={`${styles.sceneObject} ${selection === item.sourceId ? styles.sceneObjectSelected : ""}`}
            style={itemStyle}
            title={item.sourceId}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(item.sourceId);
            }}
          >
            <span>{entityKind(document, item.sourceId)}</span>
          </button>
        );
      })}
      <div ref={containerRef} className={styles.webglHost} />
      <div className={styles.sceneControls}>
        <button type="button" disabled={webglState !== "ready"} onClick={resetCamera}>
          {copy.canvas.resetCamera}
        </button>
        <button type="button" aria-pressed={ceilingVisible} onClick={() => setCeilingVisible((value) => !value)}>
          {ceilingVisible ? copy.canvas.hideCeiling : copy.canvas.showCeiling}
        </button>
      </div>
      <span className={styles.sceneFallback}>
        {webglState === "ready" ? copy.canvas.webglActive : copy.canvas.descriptorFallback}
      </span>
    </div>
  );
}

function LayerPanel({
  document,
  layers,
  selection,
  onLayer,
  onSelect,
}: {
  readonly document: LayoutDocument;
  readonly layers: Record<LayerKey, boolean>;
  readonly selection: string | null;
  readonly onLayer: (key: LayerKey, visible: boolean) => void;
  readonly onSelect: (id: string) => void;
}) {
  const groups: Array<{ key: LayerKey; label: string; entities: LayoutEntity[] }> = [
    { key: "walls", label: copy.layers.walls, entities: document.walls },
    { key: "openings", label: copy.layers.openings, entities: document.openings },
    { key: "columns", label: copy.layers.columns, entities: document.columns },
    { key: "objects", label: copy.layers.objects, entities: document.objects },
    { key: "lights", label: copy.layers.lights, entities: document.lights },
  ];
  // Disclosure is user state: a controlled `open` prop would re-collapse the
  // group the designer just opened on every unrelated re-render (autosave, …).
  const [expanded, setExpanded] = useState<Record<LayerKey, boolean>>({
    walls: true,
    openings: false,
    columns: false,
    objects: true,
    lights: false,
  });
  return (
    <aside className={styles.panel}>
      <h2>{copy.layers.title}</h2>
      <div className={styles.layerGroups}>
        {groups.map((group) => (
          <details
            key={group.key}
            open={expanded[group.key]}
            onToggle={(event) => {
              // Read before the updater runs: React clears currentTarget after dispatch.
              const isOpen = (event.currentTarget as HTMLDetailsElement).open;
              setExpanded((current) => ({ ...current, [group.key]: isOpen }));
            }}
          >
            <summary>
              <label>
                <input
                  type="checkbox"
                  checked={layers[group.key]}
                  onChange={(event) => onLayer(group.key, event.target.checked)}
                />
                <span>{group.label}</span>
                <b>{group.entities.length}</b>
              </label>
            </summary>
            <div className={styles.entityList}>
              {group.entities.length === 0 && <p>{copy.canvas.emptyLayer}</p>}
              {group.entities.map((entity) => (
                <button
                  type="button"
                  key={entity.id}
                  className={selection === entity.id ? styles.entitySelected : ""}
                  onClick={() => onSelect(entity.id)}
                >
                  <span>{entityLabel(entity)}</span>
                  {entity.locked === true && <span aria-label={copy.inspector.locked}>⌁</span>}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
    </aside>
  );
}

function Inspector({
  entity,
  draft,
  error,
  onDraft,
  onApply,
  onReset,
}: {
  readonly entity: LayoutEntity | null;
  readonly draft: InspectorDraft;
  readonly error: string | null;
  readonly onDraft: (key: keyof InspectorDraft, value: string) => void;
  readonly onApply: () => void;
  readonly onReset: () => void;
}) {
  const isColumn = entity ? "baseZMm" in entity : false;
  const isObject = entity ? "zMm" in entity && !isColumn : false;
  const editable = Boolean(entity && (isObject || isColumn) && entity.locked !== true);
  const fields: Array<{ key: keyof InspectorDraft; label: string; enabled: boolean }> = [
    { key: "xMm", label: copy.inspector.x, enabled: editable },
    { key: "yMm", label: copy.inspector.y, enabled: editable },
    { key: "zMm", label: copy.inspector.z, enabled: editable && isObject },
    { key: "widthMm", label: copy.inspector.width, enabled: editable && (isColumn || isObject) },
    { key: "depthMm", label: copy.inspector.depth, enabled: editable && (isColumn || isObject) },
    { key: "heightMm", label: copy.inspector.height, enabled: editable && (isColumn || isObject) },
    { key: "rotationDeg", label: copy.inspector.rotation, enabled: editable && (isColumn || isObject) },
  ];

  return (
    <section className={styles.inspector}>
      <h2>{copy.inspector.title}</h2>
      {!entity ? (
        <p className={styles.muted}>{copy.inspector.empty}</p>
      ) : (
        <>
          <dl className={styles.entityMeta}>
            <div><dt>{copy.inspector.kind}</dt><dd>{entityKindForInspector(entity)}</dd></div>
            <div><dt>{copy.inspector.identifier}</dt><dd>{entity.id}</dd></div>
          </dl>
          {entity.locked === true && <p className={styles.locked}>{copy.inspector.locked}</p>}
          <div className={styles.fieldGrid}>
            {fields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <input
                  type="number"
                  step="1"
                  value={draft[field.key]}
                  disabled={!field.enabled}
                  onChange={(event) => onDraft(field.key, event.target.value)}
                />
              </label>
            ))}
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.inspectorActions}>
            <button type="button" disabled={!editable} onClick={onApply}>{copy.inspector.apply}</button>
            <button type="button" disabled={!editable} onClick={onReset}>{copy.inspector.reset}</button>
          </div>
        </>
      )}
    </section>
  );
}

function entityKindForInspector(entity: LayoutEntity): string {
  const id = String(entity.id);
  if (id.startsWith("wall.")) return copy.entities.wall;
  if (id.startsWith("opening.")) return copy.entities.opening;
  if (id.startsWith("column.")) return copy.entities.column;
  if (id.startsWith("light.")) return copy.entities.light;
  return copy.entities.object;
}

function ValidationPanel({ issues }: { readonly issues: LayoutIssue[] }) {
  return (
    <section className={styles.sideSection}>
      <div className={styles.sectionTitleRow}>
        <h2>{copy.validation.title}</h2>
        <span className={issues.length === 0 ? styles.validPill : styles.warningPill}>
          {issues.length === 0 ? copy.validation.valid : copy.validation.issueCount(issues.length)}
        </span>
      </div>
      {issues.map((issue) => (
        <div className={styles.issue} key={`${issue.code}-${issue.path ?? ""}`}>
          <b>{issue.severity === "blocking" ? copy.validation.blocking : copy.validation.warning}</b>
          <span>{issue.message}</span>
        </div>
      ))}
    </section>
  );
}

function HistoryPanel({
  checkpoints,
  versions,
  diffSummary,
  status,
  onCheckpoint,
  onPublish,
  onCompare,
  onRestore,
}: {
  readonly checkpoints: LocalSnapshot[];
  readonly versions: LocalSnapshot[];
  readonly diffSummary: LayoutDocumentDiff | null;
  readonly status: string | null;
  readonly onCheckpoint: () => void;
  readonly onPublish: () => void;
  readonly onCompare: () => void;
  readonly onRestore: (checkpointId: string) => void;
}) {
  return (
    <section className={styles.sideSection}>
      <h2>{copy.history.title}</h2>
      <div className={styles.historyActions}>
        <button type="button" onClick={onCheckpoint}>{copy.history.checkpoint}</button>
        <button type="button" onClick={onPublish}>{copy.history.publish}</button>
        <button type="button" disabled={versions.length < 2} onClick={onCompare}>{copy.history.compare}</button>
      </div>
      {status && <p className={styles.status}>{status}</p>}
      <div className={styles.snapshotGrid}>
        <div>
          <b>{copy.history.checkpointsLabel}</b>
          {checkpoints.length === 0 ? <p>{copy.history.noCheckpoints}</p> : checkpoints.map((item) => (
            <span key={item.id}>
              {item.id}
              <button type="button" onClick={() => onRestore(item.id)}>{copy.history.restore}</button>
            </span>
          ))}
        </div>
        <div>
          <b>{copy.history.versionsLabel}</b>
          {versions.length === 0 ? <p>{copy.history.noVersions}</p> : versions.map((item) => (
            <span key={item.id}>{item.id}</span>
          ))}
        </div>
      </div>
      {diffSummary && (
        <div className={styles.diff}>
          <p>
            {copy.history.diffSummary(
              diffSummary.addedEntityIds.length,
              diffSummary.removedEntityIds.length,
              diffSummary.changed.length,
            )}
          </p>
          {diffSummary.changed.length === 0 ? (
            <p>{copy.history.diffEmpty}</p>
          ) : (
            <ul className={styles.diffFields}>
              {diffSummary.changed.map((change) => change.fields.map((field) => (
                <li key={`${change.entityType}.${change.entityId}.${field.path}`}>
                  <b>{change.entityType} · {change.entityId} · {field.path}</b>
                  <span>{String(field.before)} → {String(field.after)}</span>
                </li>
              )))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ExportPanel({
  onExport,
}: {
  readonly onExport: (format: "json" | "svg" | "png" | "glb" | "print") => void;
}) {
  const controls = [
    ["json", copy.export.json],
    ["svg", copy.export.svg],
    ["png", copy.export.png],
    ["glb", copy.export.glb],
    ["print", copy.export.print],
  ] as const;
  return (
    <section className={styles.sideSection}>
      <h2>{copy.export.title}</h2>
      <div className={styles.exportGrid}>
        {controls.map(([format, label]) => (
          <button key={format} type="button" onClick={() => onExport(format)} aria-label={copy.export.download(label)}>
            {label}
          </button>
        ))}
      </div>
      <p className={styles.muted}>{copy.export.glbDescriptorNote}</p>
    </section>
  );
}

/**
 * Где редактор хранит документ.
 *
 * Значение сериализуемое, а не фабрика: страница-владелец — серверный
 * компонент, функцию через границу не передать. Поэтому режим приезжает
 * данными, а хранилище создаётся уже здесь, на клиенте.
 */
export type LayoutStorageMode = "browser" | "server";

export function LayoutStudioShell({
  initialDocument,
  storage = "browser",
}: {
  readonly initialDocument: LayoutDocument;
  readonly storage?: LayoutStorageMode;
}) {
  const [session, setSession] = useState(() => new EditorSession(initialDocument));
  const lastSavedRevisionRef = useRef<number | null>(null);
  const [sessionState, setSessionState] = useState<EditorSessionState>(() => session.getState());
  const [repository, setRepository] = useState<LayoutRepositoryPort | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [zoom, setZoom] = useState(1);
  const [panState, setPanState] = useState<PanState>({ xMm: 0, yMm: 0 });
  const [showClearance, setShowClearance] = useState(true);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    walls: true,
    openings: true,
    columns: true,
    objects: true,
    lights: true,
  });
  const [draft, setDraft] = useState<InspectorDraft>(EMPTY_DRAFT);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [commandIssues, setCommandIssues] = useState<LayoutIssue[]>([]);
  const [checkpoints, setCheckpoints] = useState<LocalSnapshot[]>([]);
  const [versions, setVersions] = useState<LocalSnapshot[]>([]);
  const [historyStatus, setHistoryStatus] = useState<string | null>(null);
  const [diffSummary, setDiffSummary] = useState<LayoutDocumentDiff | null>(null);
  const revision = sessionState.document.stateRevision;

  const document = sessionState.document;
  const derived = useMemo(() => deriveLayout(document), [document]);
  const projection = useMemo(() => createSvgProjection(derived), [derived]);
  const validation = useMemo(() => validateLayoutDocument(document), [document]);
  const selectedEntity = useMemo(
    () => findEntity(document, sessionState.selection),
    [document, sessionState.selection],
  );
  const allIssues = useMemo(
    () => [...validation.issues, ...commandIssues],
    [validation.issues, commandIssues],
  );
  const latestPublished = useMemo(
    () => [...versions].reverse().find((version) => version.semanticHash !== undefined) ?? null,
    [versions],
  );

  useEffect(() => {
    setDraft(draftForEntity(selectedEntity));
    setInspectorError(null);
  }, [selectedEntity]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const nextRepository: LayoutRepositoryPort =
          storage === "server"
            ? new HttpLayoutRepository(initialDocument.documentId)
            : // Namespaced per document: version ids ("V1", "V2", …) are numbered per
              // document, so a shared namespace would collide across preview routes
              // and the immutability guard would reject the second document's V1.
              new BrowserLayoutRepository({
                storage: window.localStorage,
                namespace: `preview-v1:${initialDocument.documentId}`,
              });
        const [draftDocument, persistedVersions, persistedCheckpoints] = await Promise.all([
          nextRepository.loadDraft(initialDocument.documentId),
          nextRepository.listVersions(initialDocument.documentId),
          nextRepository.listCheckpoints(initialDocument.documentId),
        ]);
        if (cancelled) return;

        if (draftDocument) {
          lastSavedRevisionRef.current = draftDocument.stateRevision;
          const nextSession = new EditorSession(draftDocument);
          setSession(nextSession);
          setSessionState(nextSession.getState());
          setHistoryStatus(copy.history.draftLoaded);
        }
        if (persistedVersions.length > 0) {
          setVersions(persistedVersions.map((version) => ({
              id: version.versionId,
              createdAt: version.createdAt,
              document: cloneDocument(version.content),
              semanticHash: version.semanticHash,
            })));
        }
        setCheckpoints(persistedCheckpoints.map((checkpoint) => ({
          id: checkpoint.checkpointId,
          createdAt: checkpoint.createdAt,
          document: cloneDocument(checkpoint.document),
        })));
        setRepository(nextRepository);
        setLoadState("ready");
      } catch (error) {
        if (!cancelled) {
          setHistoryStatus(storageErrorMessage(error));
          setLoadState("error");
        }
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [initialDocument.documentId, storage]);

  useEffect(() => {
    if (!repository) return;
    const currentDocument = session.getState().document;
    const expectedRevision = lastSavedRevisionRef.current;
    void repository
      .saveDraft(currentDocument, expectedRevision)
      .then(() => {
        lastSavedRevisionRef.current = currentDocument.stateRevision;
        setHistoryStatus(copy.history.draftSaved);
      })
      .catch((error: unknown) => setHistoryStatus(storageErrorMessage(error)));
  }, [repository, revision, session]);

  const refresh = () => setSessionState(session.getState());
  const fitToView = () => {
    setZoom(1);
    setPanState({ xMm: 0, yMm: 0 });
  };
  const select = (entityId: string | null) => {
    session.select(entityId);
    refresh();
  };
  const runHistory = (direction: "undo" | "redo") => {
    const result = direction === "undo" ? session.undo() : session.redo();
    setCommandIssues(result.issues);
    refresh();
  };

  const applyInspector = () => {
    if (!selectedEntity) return;
    const parse = (key: keyof InspectorDraft): number | undefined => {
      if (draft[key] === "") return undefined;
      const number = Number(draft[key]);
      return Number.isInteger(number) ? number : Number.NaN;
    };
    const parsed = Object.fromEntries(
      (Object.keys(draft) as Array<keyof InspectorDraft>).map((key) => [key, parse(key)]),
    ) as Record<keyof InspectorDraft, number | undefined>;
    if (Object.values(parsed).some((value) => Number.isNaN(value))) {
      setInspectorError(copy.inspector.invalidNumber);
      return;
    }

    const sequence = `${Date.now()}-${document.stateRevision}`;
    const common = {
      commandId: `command.local.${sequence}`,
      idempotencyKey: `layout-studio:${sequence}`,
      documentId: document.documentId,
      expectedStateRevision: document.stateRevision,
      reasonCode: "LOCAL_NUMERIC_EDIT",
      reason: copy.versions.userReason,
    };
    const isSelectedColumn = document.columns.some((column) => column.id === selectedEntity.id);
    const isSelectedObject = document.objects.some((object) => object.id === selectedEntity.id);
    const result = isSelectedColumn
      ? session.dispatch({
          ...common,
          type: "UPDATE_COLUMN",
          payload: {
            columnId: selectedEntity.id,
            xMm: parsed.xMm,
            yMm: parsed.yMm,
            widthMm: parsed.widthMm,
            depthMm: parsed.depthMm,
            heightMm: parsed.heightMm,
            rotationDeg: parsed.rotationDeg,
          },
        })
      : isSelectedObject ? session.dispatch({
          ...common,
          type: "UPDATE_OBJECT",
          payload: {
            objectId: selectedEntity.id,
            xMm: parsed.xMm,
            yMm: parsed.yMm,
            zMm: parsed.zMm,
            rotationDeg: parsed.rotationDeg,
            widthMm: parsed.widthMm,
            depthMm: parsed.depthMm,
            heightMm: parsed.heightMm,
          },
        }) : session.dispatch({
          ...common,
          type: "MOVE_OBJECT",
          payload: { objectId: selectedEntity.id },
        });
    setCommandIssues(result.issues);
    setInspectorError(result.ok ? null : result.issues[0]?.message ?? copy.inspector.commandFailed);
    refresh();
  };

  const createCheckpoint = async () => {
    if (!repository) {
      setHistoryStatus(copy.history.storageUnavailable);
      return;
    }
    const createdAt = new Date().toISOString();
    const id = `CP-${Date.now().toString(36).toUpperCase()}`;
    try {
      const checkpoint = await repository.createCheckpoint(document, {
        checkpointId: id,
        reasonCode: "LOCAL_CHECKPOINT",
        reason: copy.versions.userReason,
        createdAt,
      });
      setCheckpoints((current) => [...current, {
        id: checkpoint.checkpointId,
        createdAt: checkpoint.createdAt,
        document: cloneDocument(checkpoint.document),
      }]);
      setHistoryStatus(copy.history.checkpointCreated);
    } catch (error) {
      setHistoryStatus(storageErrorMessage(error));
    }
  };
  const publishVersion = async () => {
    if (!repository) {
      setHistoryStatus(copy.history.storageUnavailable);
      return;
    }
    const parent = versions.at(-1);
    const id = `V${versions.length + 1}`;
    const createdAt = new Date().toISOString();
    try {
      const version = await repository.publishVersion(document, {
        versionId: id,
        ...(parent ? { parentVersionId: parent.id } : {}),
        authorType: "human",
        reasonCode: "LOCAL_VERSION",
        reason: copy.versions.userReason,
        createdAt,
        warnings: [...document.metadata.warnings],
      });
      setVersions((current) => [...current, {
        id: version.versionId,
        createdAt: version.createdAt,
        document: cloneDocument(version.content),
        semanticHash: version.semanticHash,
      }]);
      setHistoryStatus(copy.history.versionCreated);
    } catch (error) {
      setHistoryStatus(storageErrorMessage(error));
    }
  };
  const restoreCheckpoint = async (checkpointId: string) => {
    if (!repository) {
      setHistoryStatus(copy.history.storageUnavailable);
      return;
    }
    try {
      const restored = await repository.restoreCheckpoint(checkpointId, document.stateRevision);
      lastSavedRevisionRef.current = restored.stateRevision;
      const nextSession = new EditorSession(restored);
      setSession(nextSession);
      setSessionState(nextSession.getState());
      setHistoryStatus(copy.history.checkpointRestored);
    } catch (error) {
      setHistoryStatus(storageErrorMessage(error));
    }
  };
  const compareVersions = () => {
    const first = versions[0];
    const last = versions.at(-1);
    if (!first || !last) return;
    const diff = diffLayoutDocuments(first.id, first.document, last.id, last.document);
    setDiffSummary(diff);
  };

  const exportArtifact = async (format: "json" | "svg" | "png" | "glb" | "print") => {
    try {
      if (!repository || !latestPublished?.semanticHash) {
        setHistoryStatus(copy.export.publishRequired);
        return;
      }

      // The sidecar name is derived from the artifact it describes, so exporting
      // every format leaves one manifest per artifact instead of overwriting.
      const downloadManifest = (manifest: Record<string, unknown>) => {
        const artifactName = typeof manifest.filename === "string"
          ? manifest.filename
          : `archidom-layout-${safeFilePart(latestPublished.id)}`;
        downloadArtifact(
          JSON.stringify({ ...manifest, disclaimer: copy.export.manifestDisclaimer }, null, 2),
          "application/json",
          `${safeFilePart(artifactName)}.manifest.json`,
        );
      };

      if (format === "json" || format === "svg" || format === "glb" || format === "print") {
        const exported = await new LayoutExportService({
          repository,
          generatorVersion: "archidom-layout-studio-preview/0.1",
        }).exportVersion(latestPublished.id, format);
        downloadArtifact(exported.artifact, exported.manifest.mimeType, exported.manifest.filename);
        downloadManifest(exported.manifest as unknown as Record<string, unknown>);
        return;
      }

      const exactVersion = await repository.loadVersion(latestPublished.id);
      if (!exactVersion) {
        setHistoryStatus(copy.export.publishRequired);
        return;
      }
      const exactDerived = deriveLayout(exactVersion.content);
      const exactProjection = createSvgProjection(exactDerived, { versionId: exactVersion.versionId });
      const svg = serializeSvgProjection(exactProjection);
      const pngArtifactId = `layout-${exactVersion.semanticHash.slice(0, 16)}-png`;
      const manifestFor = async (artifact: string | ArrayBuffer | Blob) => ({
        contractVersion: "archidom.layout-export/0.1",
        artifactId: pngArtifactId,
        format: "png",
        filename: `${pngArtifactId}.png`,
        mimeType: "image/png",
        byteLength: artifact instanceof Blob ? artifact.size : typeof artifact === "string" ? new TextEncoder().encode(artifact).byteLength : artifact.byteLength,
        documentId: exactVersion.documentId,
        versionId: exactVersion.versionId,
        semanticHash: exactVersion.semanticHash,
        artifactChecksum: await artifactChecksum(artifact),
        generatedAt: new Date().toISOString(),
        generatorVersion: "archidom-layout-studio-preview/0.1",
        warnings: [...exactVersion.content.metadata.warnings],
      });

      if (format === "png") {
        const image = new Image();
        const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(copy.export.failed));
          image.src = svgUrl;
        });
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = Math.max(900, Math.round(1600 * exactProjection.viewBox.height / exactProjection.viewBox.width));
        const context = canvas.getContext("2d");
        if (!context) throw new Error(copy.export.failed);
        context.fillStyle = "#f4f0e8";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(svgUrl);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((value) => value ? resolve(value) : reject(new Error(copy.export.failed)), "image/png"),
        );
        downloadArtifact(blob, "image/png", `${pngArtifactId}.png`);
        downloadManifest(await manifestFor(blob));
        return;
      }

    } catch {
      setHistoryStatus(copy.export.failed);
    }
  };

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className={styles.documentName}>{document.name}</p>
        </div>
        <div className={styles.documentState}>
          <span>{copy.document.revision} <b>{document.stateRevision}</b></span>
          <span>{copy.document.units} <b>{document.canonicalUnits}</b></span>
          <span>{copy.document.area} <b>{(derived.roomAreaMm2 / 1_000_000).toFixed(2)} {copy.document.squareMeters}</b></span>
          <span className={sessionState.dirty ? styles.dirty : styles.clean}>
            {sessionState.dirty ? copy.document.dirty : copy.document.clean}
          </span>
        </div>
      </header>

      <div className={styles.disclaimer} role="note">
        <b>{copy.syntheticBadge}</b>
        <span>{copy.disclaimer}</span>
      </div>

      <p className={styles.loadState} role={loadState === "error" ? "alert" : "status"} aria-live="polite">
        {loadState === "loading"
          ? copy.states.loading
          : loadState === "error"
            ? copy.states.error
            : document.walls.length === 0 && document.objects.length === 0
              ? copy.states.empty
              : copy.states.ready}
      </p>

      <nav className={styles.toolbar} aria-label={copy.toolbar.viewMode}>
        <div className={styles.segmented}>
          <button type="button" aria-pressed={viewMode === "2d"} onClick={() => setViewMode("2d")}>{copy.toolbar.twoD}</button>
          <button type="button" aria-pressed={viewMode === "3d"} onClick={() => setViewMode("3d")}>{copy.toolbar.threeD}</button>
        </div>
        <div className={styles.historyButtons}>
          <button type="button" disabled={!sessionState.canUndo} onClick={() => runHistory("undo")}>↶ <span>{copy.toolbar.undo}</span></button>
          <button type="button" disabled={!sessionState.canRedo} onClick={() => runHistory("redo")}>↷ <span>{copy.toolbar.redo}</span></button>
        </div>
        <div className={styles.zoomControls}>
          <button type="button" aria-label={copy.toolbar.zoomOut} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
          <span>{copy.toolbar.zoom}: {Math.round(zoom * 100)}%</span>
          <button type="button" aria-label={copy.toolbar.zoomIn} onClick={() => setZoom((value) => Math.min(3, value + 0.25))}>+</button>
          <button type="button" onClick={fitToView}>{copy.toolbar.fit}</button>
          <button type="button" aria-label={copy.toolbar.panLeft} onClick={() => setPanState((value) => ({ ...value, xMm: value.xMm - 300 }))}>←</button>
          <button type="button" aria-label={copy.toolbar.panRight} onClick={() => setPanState((value) => ({ ...value, xMm: value.xMm + 300 }))}>→</button>
          <button type="button" aria-label={copy.toolbar.panUp} onClick={() => setPanState((value) => ({ ...value, yMm: value.yMm - 300 }))}>↑</button>
          <button type="button" aria-label={copy.toolbar.panDown} onClick={() => setPanState((value) => ({ ...value, yMm: value.yMm + 300 }))}>↓</button>
          <button type="button" aria-pressed={showClearance} onClick={() => setShowClearance((value) => !value)}>
            {copy.toolbar.clearance}
          </button>
        </div>
      </nav>

      <div className={styles.workspace}>
        <LayerPanel
          document={document}
          layers={layers}
          selection={sessionState.selection}
          onLayer={(key, visible) => setLayers((current) => ({ ...current, [key]: visible }))}
          onSelect={select}
        />

        <section className={styles.viewport}>
          <div className={styles.viewportHeader}>
            <div>
              <p>{viewMode === "2d" ? copy.canvas.title2d : copy.canvas.title3d}</p>
              <span>{sessionState.selection ? `${copy.canvas.selected}: ${entityLabel(selectedEntity ?? { id: sessionState.selection })}` : copy.canvas.selectHint}</span>
            </div>
            <span aria-label={copy.common.scale}>1:{Math.round(100 / zoom)}</span>
          </div>
          <div className={styles.canvasFrame}>
            {viewMode === "2d" ? (
              <PlanCanvas
                projection={projection}
                document={document}
                layers={layers}
                zoom={zoom}
                panState={panState}
                showClearance={showClearance}
                selection={sessionState.selection}
                onSelect={select}
                onPan={setPanState}
              />
            ) : (
              <SceneCanvas document={document} layers={layers} selection={sessionState.selection} onSelect={select} />
            )}
          </div>
        </section>

        <aside className={styles.rightRail}>
          <Inspector
            entity={selectedEntity}
            draft={draft}
            error={inspectorError}
            onDraft={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
            onApply={applyInspector}
            onReset={() => setDraft(draftForEntity(selectedEntity))}
          />
          <ValidationPanel issues={allIssues} />
          <HistoryPanel
            checkpoints={checkpoints}
            versions={versions}
            diffSummary={diffSummary}
            status={historyStatus}
            onCheckpoint={createCheckpoint}
            onPublish={publishVersion}
            onCompare={compareVersions}
            onRestore={(checkpointId) => void restoreCheckpoint(checkpointId)}
          />
          <ExportPanel onExport={exportArtifact} />
        </aside>
      </div>

      <footer className={styles.printSummary}>
        <h2>{copy.print.title}</h2>
        <p>{document.name}</p>
        <dl>
          <div><dt>{copy.print.documentId}</dt><dd>{document.documentId}</dd></div>
          <div><dt>{copy.print.contractVersion}</dt><dd>{document.contractVersion}</dd></div>
          <div><dt>{copy.print.stateRevision}</dt><dd>{document.stateRevision}</dd></div>
          <div>
            <dt>{copy.print.publishedVersion}</dt>
            <dd>{latestPublished?.id ?? copy.print.noPublishedVersion}</dd>
          </div>
          <div>
            <dt>{copy.print.semanticHash}</dt>
            <dd>{latestPublished?.semanticHash ?? copy.common.notAvailable}</dd>
          </div>
          <div>
            <dt>{copy.print.validation}</dt>
            <dd>{validation.issues.length === 0 ? copy.print.noWarnings : copy.validation.issueCount(validation.issues.length)}</dd>
          </div>
        </dl>
        {validation.issues.map((issue) => (
          <p key={`${issue.code}-${issue.path ?? ""}`}>{issue.code}: {issue.message}</p>
        ))}
        <p>{copy.disclaimer}</p>
      </footer>
    </main>
  );
}
