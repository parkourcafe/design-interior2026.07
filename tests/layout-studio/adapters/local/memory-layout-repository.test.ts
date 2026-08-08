import { describe, expect, it } from "vitest";

import { MemoryLayoutRepository } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import { applyLayoutCommand, semanticHash } from "@/lib/layout-studio/domain";

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function anotherDocument() {
  const document = makeSimpleRoom();
  document.documentId = "layout.simple-room.secondary";
  return document;
}

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
  });

  it("publishes immutable versions and reports an exact A-to-B diff", async () => {
    const repository = new MemoryLayoutRepository();
    const documentA = makeSimpleRoom();
    const versionA = await repository.publishVersion(documentA, VERSION_A);
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

  it("numbers revisions independently per document", async () => {
    const firstRepository = new MemoryLayoutRepository();
    const documentA = makeSimpleRoom();
    const documentB = anotherDocument();

    const versionA1 = await firstRepository.publishVersion(documentA, VERSION_A);
    const versionB1 = await firstRepository.publishVersion(documentB, {
      ...VERSION_A,
      versionId: "version.secondary-room.a",
    });
    const versionA2 = await firstRepository.publishVersion(documentA, {
      ...VERSION_A,
      versionId: "version.simple-room.b",
      parentVersionId: versionA1.versionId,
    });

    expect([versionA1.revisionNo, versionA2.revisionNo]).toEqual([1, 2]);
    expect(versionB1.revisionNo).toBe(1);
  });

  it("returns unique deterministic UUID revision identities", async () => {
    const firstRepository = new MemoryLayoutRepository();
    const documentA = makeSimpleRoom();
    const documentB = anotherDocument();
    const versionA1 = await firstRepository.publishVersion(documentA, VERSION_A);
    const versionB1 = await firstRepository.publishVersion(documentB, {
      ...VERSION_A,
      versionId: "version.secondary-room.a",
    });
    const versionA2 = await firstRepository.publishVersion(documentA, {
      ...VERSION_A,
      versionId: "version.simple-room.b",
      parentVersionId: versionA1.versionId,
    });

    expect(versionA1.revisionId).toMatch(UUID_PATTERN);
    expect(versionA2.revisionId).toMatch(UUID_PATTERN);
    expect(versionB1.revisionId).toMatch(UUID_PATTERN);
    expect(new Set([versionA1.revisionId, versionA2.revisionId, versionB1.revisionId])).toHaveLength(3);

    const replayRepository = new MemoryLayoutRepository();
    const replayA1 = await replayRepository.publishVersion(documentA, VERSION_A);
    expect(replayA1.revisionId).toBe(versionA1.revisionId);
  });

  it("allows no parent only for the first version and requires the latest version of the same document", async () => {
    const repository = new MemoryLayoutRepository();
    const document = makeSimpleRoom();
    const first = await repository.publishVersion(document, VERSION_A);

    await expect(repository.publishVersion(document, {
      ...VERSION_A,
      versionId: "version.simple-room.missing-parent",
    })).rejects.toMatchObject({ code: "STALE_STATE" });

    await expect(repository.publishVersion(document, {
      ...VERSION_A,
      versionId: "version.simple-room.unknown-parent",
      parentVersionId: "version.simple-room.does-not-exist",
    })).rejects.toMatchObject({ code: "STALE_STATE" });

    const second = await repository.publishVersion(document, {
      ...VERSION_A,
      versionId: "version.simple-room.b",
      parentVersionId: first.versionId,
    });
    expect(second.revisionNo).toBe(2);

    await expect(repository.publishVersion(document, {
      ...VERSION_A,
      versionId: "version.simple-room.stale-parent",
      parentVersionId: first.versionId,
    })).rejects.toMatchObject({ code: "STALE_STATE" });
  });

  it("rejects a parent version that belongs to another document", async () => {
    const repository = new MemoryLayoutRepository();
    const documentA = makeSimpleRoom();
    const documentB = anotherDocument();
    const versionA = await repository.publishVersion(documentA, VERSION_A);

    await expect(repository.publishVersion(documentB, {
      ...VERSION_A,
      versionId: "version.secondary-room.a",
      parentVersionId: versionA.versionId,
    })).rejects.toMatchObject({ code: "STALE_STATE" });
  });

  it("returns deterministic complete history with exact canonical sha256 hashes", async () => {
    const repository = new MemoryLayoutRepository();
    const original = makeSimpleRoom();
    const first = await repository.publishVersion(original, VERSION_A);
    const moved = applyLayoutCommand(original, moveTableCommand(original));
    expect(moved.ok).toBe(true);
    const second = await repository.publishVersion(moved.document, {
      ...VERSION_A,
      versionId: "version.simple-room.b",
      parentVersionId: first.versionId,
    });

    const expectedFirstHash = `sha256:${await semanticHash(original)}`;
    const expectedSecondHash = `sha256:${await semanticHash(moved.document)}`;
    const firstRead = await repository.listVersions(original.documentId);
    const secondRead = await repository.listVersions(original.documentId);

    expect(firstRead).toEqual(secondRead);
    expect(firstRead).toHaveLength(2);
    expect(firstRead.map(({ versionId, revisionNo, semanticHash: hash }) => ({
      versionId,
      revisionNo,
      semanticHash: hash,
    }))).toEqual([
      { versionId: first.versionId, revisionNo: 1, semanticHash: expectedFirstHash },
      { versionId: second.versionId, revisionNo: 2, semanticHash: expectedSecondHash },
    ]);
    expect(firstRead.every((version) => /^sha256:[0-9a-f]{64}$/.test(version.semanticHash))).toBe(true);
  });
});
