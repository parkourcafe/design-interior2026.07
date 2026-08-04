import { performance } from "node:perf_hooks";
import os from "node:os";

import fixtureJson from "../../fixtures/layout-studio/liquid-station.synthetic.v0.1.json";
import { createSvgProjection } from "../../lib/layout-studio/adapters/svg/svg-projection";
import { compileSceneDescriptor } from "../../lib/layout-studio/adapters/three/scene-compiler";
import { buildThreeScene, disposeThreeScene } from "../../lib/layout-studio/adapters/three/three-runtime";
import { applyLayoutCommand, deriveLayout, type LayoutDocument, type LayoutObject } from "../../lib/layout-studio/domain";

interface Summary {
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

function percentile(sorted: readonly number[], ratio: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function summarize(values: number[]): Summary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    minMs: Number((sorted[0] ?? 0).toFixed(4)),
    p50Ms: Number(percentile(sorted, 0.5).toFixed(4)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(4)),
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(4)),
  };
}

function measure(iterations: number, operation: (index: number) => void): Summary {
  const values: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    operation(index);
    values.push(performance.now() - startedAt);
  }
  return summarize(values);
}

const fixture = structuredClone(fixtureJson) as unknown as LayoutDocument;
const movable = fixture.objects.find((object) => !object.locked);
if (!movable) throw new Error("Synthetic fixture must contain a movable object");

const commandPerformance = measure(5_000, (index) => {
  const document = { ...fixture, stateRevision: index };
  const result = applyLayoutCommand(document, {
    commandId: `command.performance.${index}`,
    idempotencyKey: `performance-${index}`,
    documentId: document.documentId,
    expectedStateRevision: index,
    type: "MOVE_OBJECT",
    payload: { objectId: movable.id, xMm: movable.xMm + (index % 100), yMm: movable.yMm },
    reasonCode: "PERFORMANCE",
    reason: "Reproducible command benchmark",
  });
  if (!result.ok) throw new Error(result.issues[0]?.code ?? "COMMAND_FAILED");
});

const template = movable;
const hundredObjects: LayoutObject[] = Array.from({ length: 100 }, (_, index) => ({
  ...template,
  id: `object.performance.${String(index).padStart(3, "0")}`,
  xMm: 250 + (index % 10) * 650,
  yMm: 250 + Math.floor(index / 10) * 380,
}));
const hundredObjectDocument: LayoutDocument = { ...fixture, objects: hundredObjects };

const projectionPerformance = measure(1_000, () => {
  const derived = deriveLayout(hundredObjectDocument);
  createSvgProjection(derived);
  compileSceneDescriptor(derived.sceneProjection);
});

const heapBefore = process.memoryUsage().heapUsed;
for (let index = 0; index < 10; index += 1) {
  const descriptor = compileSceneDescriptor(deriveLayout(hundredObjectDocument).sceneProjection);
  const scene = buildThreeScene(descriptor);
  disposeThreeScene(scene);
}
const heapAfter = process.memoryUsage().heapUsed;

const result = {
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  machine: { model: os.cpus()[0]?.model ?? "unknown", logicalCpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() },
  fixture: {
    walls: fixture.walls.length,
    openings: fixture.openings.length,
    columns: fixture.columns.length,
    objects: fixture.objects.length,
    lights: fixture.lights.length,
  },
  command5000: commandPerformance,
  deriveSvgScene100Objects1000: projectionPerformance,
  headlessSceneBuildDispose10: { heapDeltaBytes: heapAfter - heapBefore, note: "Node heap signal; not browser GPU proof" },
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
