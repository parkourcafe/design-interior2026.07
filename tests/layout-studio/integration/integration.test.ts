// @vitest-environment node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deriveLayout,
  validateLayoutDocument,
  type LayoutDocument,
} from "@/lib/layout-studio/domain";
import { createSvgProjection } from "@/lib/layout-studio/adapters/svg/svg-projection";
import { compileSceneDescriptor } from "@/lib/layout-studio/adapters/three/scene-compiler";

const repoRoot = process.cwd();
const fixturePath = join(
  repoRoot,
  "fixtures/layout-studio/liquid-station.synthetic.v0.1.json",
);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function fixture(): LayoutDocument {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as LayoutDocument;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function allMillimeterValues(value: unknown, path = "fixture"): Array<[string, number]> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => allMillimeterValues(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const itemPath = `${path}.${key}`;
    const own = key.endsWith("Mm") && typeof item === "number"
      ? [[itemPath, item] as [string, number]]
      : [];
    return [...own, ...allMillimeterValues(item, itemPath)];
  });
}

describe("Layout Studio delivery/UI slice", () => {
  it("validates and deterministically derives the synthetic Liquid Station fixture", () => {
    const document = fixture();
    const validation = validateLayoutDocument(document);
    const first = deriveLayout(document);
    const second = deriveLayout(structuredClone(document));

    expect(validation.valid, JSON.stringify(validation.issues, null, 2)).toBe(true);
    expect(first.valid, JSON.stringify(first.issues, null, 2)).toBe(true);
    expect(second).toEqual(first);
    expect(first.roomAreaMm2).toBe(33_120_000);
    expect(allMillimeterValues(document).length).toBeGreaterThan(0);
    expect(allMillimeterValues(document).every(([, value]) => Number.isInteger(value))).toBe(true);

    const contour = document.walls.map((wall) => [wall.startNodeId, wall.endNodeId]);
    expect(contour.every((wall, index) => wall[1] === contour[(index + 1) % contour.length]?.[0])).toBe(true);
    expect(document.openings).toHaveLength(2);
    expect(document.columns).toContainEqual(
      expect.objectContaining({
        id: "column.synthetic-liquid-station.structural",
        widthMm: 250,
        depthMm: 250,
      }),
    );
    expect(document.objects.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "object.synthetic-liquid-station.front-counter",
        "object.synthetic-liquid-station.central-double-sink",
        "object.synthetic-liquid-station.rear-coffee-machine",
      ]),
    );
    expect(document.materials.length).toBeGreaterThanOrEqual(5);
    expect(document.lights).toHaveLength(2);
    expect(`${document.metadata.sourceRefs.join(" ")} ${document.metadata.warnings.join(" ")}`).toMatch(
      /synthetic|синтетическ/i,
    );
    expect(document.metadata.warnings.join(" ")).toMatch(/не является evidence KORA/i);
  });

  it("feeds SVG and Three adapters from one derivation of the canonical document", () => {
    const document = fixture();
    const derived = deriveLayout(document);
    const svg = createSvgProjection(derived);
    const three = compileSceneDescriptor(derived.sceneProjection);
    const requiredIds = [
      "wall.synthetic-liquid-station.north",
      "opening.synthetic-liquid-station.entry-door",
      "column.synthetic-liquid-station.structural",
      "object.synthetic-liquid-station.front-counter",
      "object.synthetic-liquid-station.central-double-sink",
    ];
    const svgIds = Object.values(svg)
      .filter(Array.isArray)
      .flatMap((entities) => entities as Array<{ sourceId?: string }>)
      .flatMap((entity) => entity.sourceId ? [entity.sourceId] : []);
    const threeIds = three.objects.map((entity) => entity.sourceId);

    expect(svg.units).toBe("mm");
    expect(three.units).toBe("m");
    expect(svgIds).toEqual(expect.arrayContaining(requiredIds));
    expect(threeIds).toEqual(expect.arrayContaining(requiredIds));
  });

  it("keeps the feature flag strictly default-off", () => {
    const source = read("lib/layout-studio/feature-flag.ts");

    expect(source).toMatch(/ARCHIDOM_LAYOUT_STUDIO_ENABLED/);
    expect(source).toMatch(/===\s*["']true["']/);
    expect(source).not.toMatch(/Boolean\s*\(|!!\s*(?:process\.env|value)|!==\s*["']false["']/);
  });

  it("provides the route, shell and centralized Russian UI copy", () => {
    const requiredFiles = [
      "app/app/layout-studio/page.tsx",
      "components/layout-studio/layout-studio-shell.tsx",
      "lib/layout-studio/feature-flag.ts",
      "lib/i18n/ru.ts",
    ] as const;
    const [routePath, shellPath, , copyPath] = requiredFiles;

    expect(requiredFiles.filter((path) => !existsSync(join(repoRoot, path)))).toEqual([]);

    const route = read(routePath);
    const shell = read(shellPath);
    const copy = read(copyPath);
    const uiContract = `${route}\n${shell}\n${copy}`;

    expect(route).toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
    expect(route).toMatch(/isLayoutStudioEnabled/);
    expect(route).toMatch(/layout-studio-shell/i);
    expect(uiContract).toMatch(/(?:^|[^\p{L}])2D(?:[^\p{L}]|$)/u);
    expect(uiContract).toMatch(/(?:^|[^\p{L}])3D(?:[^\p{L}]|$)/u);
    expect(uiContract).toMatch(/Редактор/i);
    expect(uiContract).toMatch(/Верси(?:я|и)/i);
    expect(uiContract).toMatch(/Экспорт/i);
    expect(uiContract).toMatch(/синтетическ/i);
    expect(uiContract).toMatch(/не является[\s\S]{0,120}(?:evidence|доказательств)/i);
  });

  it("keeps the pure domain free of React, Next, Three and Supabase dependencies", () => {
    const domainRoot = join(repoRoot, "lib/layout-studio/domain");
    const violations = sourceFiles(domainRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const specifiers = [...source.matchAll(/(?:from\s+|import\s*\(|require\s*\()["']([^"']+)["']/g)]
        .flatMap((match) => match[1] ? [match[1]] : []);
      return specifiers
        .filter((specifier) => /^(?:react(?:\/|$)|next(?:\/|$)|three(?:\/|$)|@supabase\/|@\/components\/|@\/app\/)/.test(specifier))
        .map((specifier) => `${path}: ${specifier}`);
    });

    expect(violations).toEqual([]);
  });

  it("does not add or rewrite Supabase migrations for the local-only experiment", () => {
    const expectedBaseline = [
      "20260716071024_legacy_production_baseline.sql",
      "20260716072000_project_intelligence_core.sql",
      "20260716073000_project_intelligence_operations.sql",
      "20260717090000_projectceo_foundation_access.sql",
      "20260717091000_projectceo_foundation_ingestion_read.sql",
      "20260717092000_projectceo_foundation_integration_hardening.sql",
      "20260717100000_projectceo_product_brain_persistence.sql",
      "20260717101000_projectceo_product_brain_operations.sql",
      "20260717101500_projectceo_product_brain_relational_hardening.sql",
      "20260717102000_projectceo_m4_execution_persistence.sql",
      "20260717103000_projectceo_m4_execution_operations.sql",
    ];
    const actual = readdirSync(join(repoRoot, "supabase/migrations"), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => basename(entry.name))
      .sort();

    expect(actual).toEqual(expectedBaseline);
  });
});
