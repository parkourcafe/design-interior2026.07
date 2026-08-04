import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { LayoutExportService } from "@/lib/layout-studio/application/export-service";
import { MemoryLayoutRepository } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import { applyLayoutCommand } from "@/lib/layout-studio/domain";

import { makeSimpleRoom, moveTableCommand } from "./layout-test-fixture";

const generatedAt = "2026-08-04T12:00:00.000Z";
const versionAWarning = "Проверьте привязку оборудования на площадке";

type HeadlessExportFormat = "json" | "svg" | "glb" | "print";

function bytesOf(artifact: unknown): Uint8Array {
  if (typeof artifact === "string") {
    return new TextEncoder().encode(artifact);
  }
  if (artifact instanceof Uint8Array) {
    return artifact;
  }
  if (artifact instanceof ArrayBuffer) {
    return new Uint8Array(artifact);
  }
  throw new TypeError("Export artifact must be text, Uint8Array, or ArrayBuffer");
}

function sha256(artifact: unknown): string {
  return createHash("sha256").update(bytesOf(artifact)).digest("hex");
}

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

  it("requires an immutable published version instead of exporting a live draft", async () => {
    const repository = new MemoryLayoutRepository();
    const draft = makeSimpleRoom();
    await repository.saveDraft(draft, null);

    await expect(
      makeService(repository).exportVersion("version.simple-room.unpublished", "json"),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/VERSION.*NOT_FOUND|NOT.*PUBLISHED/i),
    });
  });

  it("builds the print summary strictly from Version A after Version B is live", async () => {
    const repository = new MemoryLayoutRepository();
    const documentA = makeSimpleRoom();
    const versionA = await repository.publishVersion(documentA, {
      versionId: "version.simple-room.print-a",
      authorType: "human",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Версия A для печати",
      createdAt: "2026-08-04T10:00:00.000Z",
      warnings: [versionAWarning],
    });
    const moved = applyLayoutCommand(documentA, moveTableCommand(documentA, 1700));
    expect(moved.ok).toBe(true);
    const versionB = await repository.publishVersion(moved.document, {
      versionId: "version.simple-room.print-b",
      parentVersionId: versionA.versionId,
      authorType: "human",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Версия B для печати",
      createdAt: "2026-08-04T11:00:00.000Z",
      warnings: ["Предупреждение только версии B"],
    });
    await repository.saveDraft(moved.document, null);

    const exported = await makeService(repository).exportVersion(versionA.versionId, "print");
    expect(typeof exported.artifact).toBe("string");
    const print = String(exported.artifact);

    expect(print).toContain(versionA.versionId);
    expect(print).toContain(versionA.semanticHash);
    expect(print).toContain(versionAWarning);
    expect(print).toMatch(/прототип|не является.{0,80}строительн/i);
    expect(print).not.toContain(versionB.versionId);
    expect(print).not.toContain(versionB.semanticHash);
    expect(print).not.toContain("Предупреждение только версии B");
  });

  it.each([
    ["json", "json"],
    ["svg", "svg"],
    ["glb", "glb"],
    ["print", "html"],
  ] as const)(
    "creates a complete %s sidecar manifest whose checksum is over the actual artifact bytes",
    async (format, extension) => {
      const repository = new MemoryLayoutRepository();
      const document = makeSimpleRoom();
      const version = await repository.publishVersion(document, {
        versionId: "version.simple-room.manifest",
        authorType: "human",
        reasonCode: "EXPORT_CONTRACT",
        reason: "Проверка export manifest",
        createdAt: "2026-08-04T10:00:00.000Z",
        warnings: [versionAWarning],
      });

      const exported = await makeService(repository).exportVersion(version.versionId, format);
      const manifest = exported.manifest as typeof exported.manifest & {
        artifactId?: string;
        filename?: string;
      };

      expect(manifest).toMatchObject({
        contractVersion: "archidom.layout-export/0.1",
        artifactId: expect.any(String),
        format,
        documentId: document.documentId,
        versionId: version.versionId,
        semanticHash: version.semanticHash,
        warnings: [versionAWarning],
      });
      expect(manifest.filename).toBe(`${manifest.artifactId}.${extension}`);
      expect(manifest.artifactChecksum).toBe(sha256(exported.artifact));
    },
  );

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

  it.each(["json", "svg", "glb", "print"] as const)(
    "applies the privacy gate to the %s artifact and manifest",
    async (format: HeadlessExportFormat) => {
      const repository = new MemoryLayoutRepository();
      const tainted = makeSimpleRoom();
      tainted.metadata.sourceRefs = [
        "/Users/designer/private/kora.plan",
        "designer@example.test",
        "auth_token=secret-value",
        "https://private.example.test/file?signed_url=secret",
        "localStorage.layout-session",
      ];
      const version = await repository.publishVersion(tainted, {
        versionId: `version.simple-room.private-${format}`,
        authorType: "human",
        reasonCode: "PRIVACY_TEST",
        reason: `Проверка privacy gate: ${format}`,
        createdAt: "2026-08-04T10:00:00.000Z",
        warnings: [],
      });

      await expect(makeService(repository).exportVersion(version.versionId, format)).rejects.toMatchObject({
        code: "EXPORT_PRIVACY_VIOLATION",
      });
    },
  );
});
