import { describe, expect, it } from "vitest";

import { LayoutExportService } from "@/lib/layout-studio/application/export-service";
import { buildPrintSummary } from "@/lib/layout-studio/application/print-summary";
import { MemoryLayoutRepository } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import type { LayoutDocument } from "@/lib/layout-studio/domain";
import koraFixture from "@/fixtures/layout-studio/kora-liquid-station.v0.2.json";

const KORA = koraFixture as unknown as LayoutDocument;

async function exportKora(format: "print" | "json" | "svg" | "glb") {
  const repository = new MemoryLayoutRepository();
  const version = await repository.publishVersion(KORA, {
    versionId: "version.kora.a",
    authorType: "human",
    reasonCode: "OWNER_CHECKPOINT",
    reason: "Печатная сводка",
    createdAt: "2026-08-06T10:00:00.000Z",
    warnings: [...KORA.metadata.warnings],
  });
  const service = new LayoutExportService({
    repository,
    generatorVersion: "archidom-layout-studio/test",
    now: () => "2026-08-06T12:00:00.000Z",
  });
  return { version, exported: await service.exportVersion(version.versionId, format), service };
}

describe("LS-AT-074: print artifact carries hash, warnings and schedule", () => {
  it("prints every canonical entity in the element schedule", async () => {
    const { exported, version } = await exportKora("print");
    const html = exported.artifact as string;

    expect(html).toContain("Ведомость элементов");
    expect(html).toContain("<table>");
    expect(html).toContain("Габариты, мм");

    const expectedIds = [
      ...KORA.walls.map((entity) => entity.id),
      ...KORA.openings.map((entity) => entity.id),
      ...KORA.columns.map((entity) => entity.id),
      ...KORA.objects.map((entity) => entity.id),
    ];
    for (const id of expectedIds) {
      expect(html, `schedule must list ${id}`).toContain(`<td>${id}</td>`);
    }
    const rowCount = [...html.matchAll(/<tr><td>/g)].length;
    expect(rowCount).toBe(expectedIds.length);

    expect(html).toContain(version.semanticHash);
    for (const warning of KORA.metadata.warnings) expect(html).toContain(warning);
  });

  it("records owner-confirmed KORA dimensions in the schedule", async () => {
    const { exported } = await exportKora("print");
    const html = exported.artifact as string;

    // 8100 × 3000 contour, 250×250 column, 1200 mm door, 1500 mm left opening.
    expect(html).toMatch(/длина 8100 · высота 3000 · толщина 100/);
    expect(html).toMatch(/250×250 · высота 3000/);
    expect(html).toMatch(/ширина 1200 · высота 2100/);
    expect(html).toMatch(/ширина 1500 · высота 3000/);
  });

  it("keeps the summary standalone when no schedule is supplied", () => {
    const html = buildPrintSummary({
      documentId: "layout.test",
      versionId: "V1",
      semanticHash: "a".repeat(64),
      warnings: [],
    });
    expect(html).toContain("Ведомость пуста.");
    expect(html).toContain("Предупреждений нет.");
  });

  it("escapes schedule content instead of emitting raw markup", () => {
    const html = buildPrintSummary({
      documentId: "layout.test",
      versionId: "V1",
      semanticHash: "a".repeat(64),
      warnings: [],
      schedule: [{ group: "Стены", entityId: "wall.x", label: "<script>x</script>", dimensions: "1&2" }],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("1&amp;2");
  });
});

describe("LS-AT-075: manifest identity is unique per format", () => {
  it("gives every format its own artifact id and filename for one version", async () => {
    const formats = ["json", "svg", "glb", "print"] as const;
    const manifests = [];
    for (const format of formats) {
      const { exported } = await exportKora(format);
      manifests.push(exported.manifest);
    }

    expect(new Set(manifests.map((manifest) => manifest.artifactId)).size).toBe(formats.length);
    expect(new Set(manifests.map((manifest) => manifest.filename)).size).toBe(formats.length);
    expect(new Set(manifests.map((manifest) => `${manifest.filename}.manifest.json`)).size)
      .toBe(formats.length);
    for (const manifest of manifests) {
      expect(manifest.versionId).toBe("version.kora.a");
      // Каноническая форма подписи в объединённом контуре — sha256:<hex>;
      // формат хранилища зафиксирован решением владельца.
      expect(manifest.semanticHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      // Имя файла при этом остаётся из голого hex — без двоеточия.
      expect(manifest.artifactId).toMatch(/^layout-[0-9a-f]{16}-/);
      expect(manifest.byteLength).toBeGreaterThan(0);
      expect(manifest.warnings).toEqual([...KORA.metadata.warnings]);
    }
  });
});
