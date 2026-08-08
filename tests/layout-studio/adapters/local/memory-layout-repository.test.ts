import { describe, expect, it } from "vitest";

import { MemoryLayoutRepository } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import { applyLayoutCommand } from "@/lib/layout-studio/domain";

import {
  makeSimpleRoom,
  moveTableCommand,
} from "../../application/layout-test-fixture";

const VERSION_A = {
  versionId: "version.simple-room.a",
  authorType: "human" as const,
  reasonCode: "OWNER_CHECKPOINT",
  reason: "Версия A",
  createdAt: "2026-08-04T10:00:00.000Z",
  warnings: [],
};

describe("LS-050: MemoryLayoutRepository", () => {
  it("restores autosaved drafts and recoverable checkpoints without sharing references", async () => {
    const repository = new MemoryLayoutRepository();
    const draft = makeSimpleRoom();

    await repository.saveDraft(draft, null);
    const checkpoint = await repository.createCheckpoint(draft, {
      checkpointId: "checkpoint.simple-room.1",
      reasonCode: "USER_CHECKPOINT",
      reason: "Перед перемещением",
      createdAt: "2026-08-04T09:00:00.000Z",
    });
    draft.objects[0]!.xMm = 9999;

    await expect(repository.loadDraft(draft.documentId)).resolves.toMatchObject({
      stateRevision: 3,
      objects: [expect.objectContaining({ xMm: 1000 })],
    });
    await expect(repository.loadCheckpoint(checkpoint.checkpointId)).resolves.toMatchObject({
      document: { objects: [expect.objectContaining({ xMm: 1000 })] },
    });
    await expect(repository.listCheckpoints(draft.documentId)).resolves.toEqual([
      expect.objectContaining({ checkpointId: checkpoint.checkpointId }),
    ]);
  });

  it("publishes immutable versions and reports an exact A-to-B diff", async () => {
    const repository = new MemoryLayoutRepository();
    const documentA = makeSimpleRoom();
    const versionA = await repository.publishVersion(documentA, VERSION_A);
    expect(versionA.contractVersion).toBe("archidom.layout-version/0.1");
    const moved = applyLayoutCommand(documentA, moveTableCommand(documentA));

    expect(moved.ok).toBe(true);
    const versionB = await repository.publishVersion(moved.document, {
      ...VERSION_A,
      versionId: "version.simple-room.b",
      reason: "Версия B",
      createdAt: "2026-08-04T11:00:00.000Z",
      parentVersionId: versionA.versionId,
    });
    moved.document.objects[0]!.xMm = 9999;

    await expect(repository.loadVersion(versionA.versionId)).resolves.toMatchObject({
      content: { objects: [expect.objectContaining({ xMm: 1000 })] },
    });
    await expect(repository.listVersions(documentA.documentId)).resolves.toEqual([
      expect.objectContaining({ versionId: versionA.versionId }),
      expect.objectContaining({ versionId: versionB.versionId }),
    ]);
    await expect(repository.diffVersions(versionA.versionId, versionB.versionId)).resolves.toEqual({
      fromVersionId: versionA.versionId,
      toVersionId: versionB.versionId,
      addedEntityIds: [],
      removedEntityIds: [],
      changed: [
        {
          entityId: "object.simple-room.table",
          entityType: "object",
          fields: [{ path: "xMm", before: 1000, after: 1100 }],
        },
      ],
    });

    await expect(repository.publishVersion(documentA, VERSION_A)).rejects.toMatchObject({
      code: "VERSION_IMMUTABLE",
    });
  });

  it("rejects invalid documents and missing version parents", async () => {
    const repository = new MemoryLayoutRepository();
    const invalid = makeSimpleRoom();
    invalid.objects[0]!.rotationDeg = 45 as 0;
    await expect(repository.publishVersion(invalid, VERSION_A)).rejects.toMatchObject({
      code: "VERSION_SCHEMA_INVALID",
    });
    await expect(repository.publishVersion(makeSimpleRoom(), {
      ...VERSION_A,
      versionId: "version.simple-room.orphan",
      parentVersionId: "version.missing",
    })).rejects.toMatchObject({ code: "PARENT_VERSION_NOT_FOUND" });
  });
});
