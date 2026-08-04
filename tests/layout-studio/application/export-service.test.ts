import { describe, expect, it } from "vitest";

import { LayoutExportService } from "@/lib/layout-studio/application/export-service";
import { MemoryLayoutRepository } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import { applyLayoutCommand } from "@/lib/layout-studio/domain";

import { makeSimpleRoom, moveTableCommand } from "./layout-test-fixture";

const generatedAt = "2026-08-04T12:00:00.000Z";

function makeService(repository: MemoryLayoutRepository): LayoutExportService {
  return new LayoutExportService({
    repository,
    generatorVersion: "archidom-layout-studio/test",
    now: () => generatedAt,
  });
}

describe("LS-060: exact-version JSON/SVG export", () => {
  it("binds JSON, SVG, and sidecar manifests to immutable Version A after Version B exists", async () => {
    const repository = new MemoryLayoutRepository();
    const documentA = makeSimpleRoom();
    const versionA = await repository.publishVersion(documentA, {
      versionId: "version.simple-room.a",
      authorType: "human",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Версия A",
      createdAt: "2026-08-04T10:00:00.000Z",
      warnings: [],
    });
    const service = makeService(repository);
    const jsonBefore = await service.exportVersion(versionA.versionId, "json");

    const moved = applyLayoutCommand(documentA, moveTableCommand(documentA));
    expect(moved.ok).toBe(true);
    await repository.publishVersion(moved.document, {
      versionId: "version.simple-room.b",
      parentVersionId: versionA.versionId,
      authorType: "human",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Версия B",
      createdAt: "2026-08-04T11:00:00.000Z",
      warnings: [],
    });

    const jsonAfter = await service.exportVersion(versionA.versionId, "json");
    const svgAfter = await service.exportVersion(versionA.versionId, "svg");
    const jsonEnvelope = JSON.parse(jsonAfter.artifact) as {
      versionId: string;
      semanticHash: string;
      content: { objects: Array<{ id: string; xMm: number }> };
    };

    expect(jsonAfter.artifact).toBe(jsonBefore.artifact);
    expect(jsonEnvelope.versionId).toBe(versionA.versionId);
    expect(jsonEnvelope.semanticHash).toBe(versionA.semanticHash);
    expect(jsonEnvelope.content.objects).toContainEqual(
      expect.objectContaining({ id: "object.simple-room.table", xMm: 1000 }),
    );
    expect(svgAfter.artifact).toContain('data-version-id="version.simple-room.a"');
    expect(svgAfter.artifact).toContain('data-source-id="object.simple-room.table"');
    expect(svgAfter.artifact).not.toMatch(/selected|selection/i);

    for (const exported of [jsonAfter, svgAfter]) {
      expect(exported.manifest).toMatchObject({
        contractVersion: "archidom.layout-export/0.1",
        documentId: documentA.documentId,
        versionId: versionA.versionId,
        semanticHash: versionA.semanticHash,
        generatedAt,
        generatorVersion: "archidom-layout-studio/test",
      });
      expect(exported.manifest.artifactChecksum).toMatch(/^[a-f0-9]{64}$/);
      expect(`${exported.artifact}\n${JSON.stringify(exported.manifest)}`).not.toMatch(
        /(?:\/Users\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|auth[_-]?token|signed[_-]?url|localStorage)/i,
      );
    }
  });

  it("fails closed when an exact version would leak a private source reference", async () => {
    const repository = new MemoryLayoutRepository();
    const tainted = makeSimpleRoom();
    tainted.metadata.sourceRefs = ["/Users/designer/private/kora.plan"];
    const version = await repository.publishVersion(tainted, {
      versionId: "version.simple-room.private",
      authorType: "human",
      reasonCode: "PRIVACY_TEST",
      reason: "Проверка privacy gate",
      createdAt: "2026-08-04T10:00:00.000Z",
      warnings: [],
    });

    await expect(makeService(repository).exportVersion(version.versionId, "json")).rejects.toMatchObject({
      code: "EXPORT_PRIVACY_VIOLATION",
    });
  });
});
