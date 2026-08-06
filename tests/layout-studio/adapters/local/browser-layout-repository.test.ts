import { describe, expect, it } from "vitest";

import { BrowserLayoutRepository } from "@/lib/layout-studio/adapters/local/browser-layout-repository";
import { applyLayoutCommand } from "@/lib/layout-studio/domain";

import {
  makeSimpleRoom,
  moveTableCommand,
} from "../../application/layout-test-fixture";

class FakeStorage {
  readonly values = new Map<string, string>();
  failNextWrite = false;

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      const error = new Error("Storage quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }

    this.values.set(key, value);
  }
}

const VERSION_A = {
  versionId: "version.simple-room.a",
  authorType: "human" as const,
  reasonCode: "OWNER_CHECKPOINT",
  reason: "Версия A",
  createdAt: "2026-08-04T10:00:00.000Z",
  warnings: [],
};

function createRepository(storage: FakeStorage, namespace: string) {
  return new BrowserLayoutRepository({ storage, namespace });
}

describe("LS-050: BrowserLayoutRepository", () => {
  it("restores an autosaved draft after reload only inside its user namespace", async () => {
    const storage = new FakeStorage();
    const document = makeSimpleRoom();

    await createRepository(storage, "user.alpha").saveDraft(document, null);

    await expect(
      createRepository(storage, "user.alpha").loadDraft(document.documentId),
    ).resolves.toEqual(document);
    await expect(
      createRepository(storage, "user.beta").loadDraft(document.documentId),
    ).resolves.toBeNull();
  });

  it("persists recoverable checkpoints without sharing document references", async () => {
    const storage = new FakeStorage();
    const repository = createRepository(storage, "user.alpha");
    const document = makeSimpleRoom();

    const checkpoint = await repository.createCheckpoint(document, {
      checkpointId: "checkpoint.simple-room.1",
      reasonCode: "USER_CHECKPOINT",
      reason: "Перед перемещением",
      createdAt: "2026-08-04T09:00:00.000Z",
    });
    document.objects[0]!.xMm = 9999;

    await expect(
      createRepository(storage, "user.alpha").loadCheckpoint(
        checkpoint.checkpointId,
      ),
    ).resolves.toMatchObject({
      document: { objects: [expect.objectContaining({ xMm: 1000 })] },
    });
    await expect(
      createRepository(storage, "user.alpha").listCheckpoints(document.documentId),
    ).resolves.toEqual([expect.objectContaining({ checkpointId: checkpoint.checkpointId })]);
  });

  it("keeps published versions immutable while later edits create a new draft", async () => {
    const storage = new FakeStorage();
    const repository = createRepository(storage, "user.alpha");
    const documentA = makeSimpleRoom();
    const versionA = await repository.publishVersion(documentA, VERSION_A);
    const moved = applyLayoutCommand(documentA, moveTableCommand(documentA));

    expect(moved.ok).toBe(true);
    await repository.saveDraft(moved.document, null);
    moved.document.objects[0]!.xMm = 9999;

    await expect(
      createRepository(storage, "user.alpha").loadVersion(versionA.versionId),
    ).resolves.toMatchObject({
      content: {
        stateRevision: 3,
        objects: [expect.objectContaining({ xMm: 1000 })],
      },
    });
    await expect(repository.publishVersion(documentA, VERSION_A)).rejects.toMatchObject({
      code: "VERSION_IMMUTABLE",
    });
  });

  it("reports quota exhaustion without erasing the saved draft or mutating the live session", async () => {
    const storage = new FakeStorage();
    const repository = createRepository(storage, "user.alpha");
    const saved = makeSimpleRoom();
    await repository.saveDraft(saved, null);

    const moved = applyLayoutCommand(saved, moveTableCommand(saved));
    expect(moved.ok).toBe(true);
    storage.failNextWrite = true;

    await expect(repository.saveDraft(moved.document, 3)).rejects.toMatchObject({
      code: "STORAGE_QUOTA_EXCEEDED",
      recoverable: true,
    });
    expect(moved.document).toMatchObject({
      stateRevision: 4,
      objects: [expect.objectContaining({ xMm: 1100 })],
    });
    await expect(repository.loadDraft(saved.documentId)).resolves.toMatchObject({
      stateRevision: 3,
      objects: [expect.objectContaining({ xMm: 1000 })],
    });
  });

  it("reports corrupted local records as recoverable", async () => {
    const storage = new FakeStorage();
    const repository = createRepository(storage, "user.alpha");
    const document = makeSimpleRoom();
    await repository.saveDraft(document, null);
    const key = [...storage.values.keys()][0]!;
    storage.values.set(key, "{broken-json");

    await expect(repository.loadDraft(document.documentId)).rejects.toMatchObject({
      code: "STORAGE_CORRUPTED",
      recoverable: true,
    });
  });
});
