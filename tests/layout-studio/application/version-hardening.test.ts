// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BrowserLayoutRepository } from "@/lib/layout-studio/adapters/local/browser-layout-repository";
import type { LayoutDocument } from "@/lib/layout-studio/domain";

import { makeSimpleRoom } from "./layout-test-fixture";

class FakeStorage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function repository(): BrowserLayoutRepository {
  return new BrowserLayoutRepository({
    storage: new FakeStorage(),
    namespace: "user.version-hardening",
  });
}

function revised(document: LayoutDocument, changes: Partial<LayoutDocument["objects"][number]>): LayoutDocument {
  const next = structuredClone(document);
  next.stateRevision += 1;
  next.objects[0] = { ...next.objects[0]!, ...changes };
  return next;
}

function versionUiSource(): string {
  const root = join(process.cwd(), "components/layout-studio");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
    .map((entry) => readFileSync(join(root, entry.name), "utf8"))
    .join("\n");
}

describe("LS-050: version hardening", () => {
  it("rejects a stale BrowserLayoutRepository save using expectedRevision", async () => {
    const repo = repository();
    const initial = makeSimpleRoom();
    await repo.saveDraft(initial, null);

    const update = revised(initial, { xMm: 1400 });

    await expect(repo.saveDraft(update, initial.stateRevision - 1)).rejects.toMatchObject({
      code: "STATE_STALE",
    });
    await expect(repo.loadDraft(initial.documentId)).resolves.toEqual(initial);
  });

  it("restores a checkpoint as a new draft revision and leaves the checkpoint immutable", async () => {
    const repo = repository();
    const checkpointDocument = makeSimpleRoom();
    await repo.saveDraft(checkpointDocument, null);
    const checkpoint = await repo.createCheckpoint(checkpointDocument, {
      checkpointId: "checkpoint.simple-room.restore",
      reasonCode: "USER_CHECKPOINT",
      reason: "До редактирования",
      createdAt: "2026-08-04T09:00:00.000Z",
    });
    const edited = revised(checkpointDocument, { xMm: 1400 });
    await repo.saveDraft(edited, checkpointDocument.stateRevision);

    const restorable = repo as BrowserLayoutRepository & {
      restoreCheckpoint(checkpointId: string, expectedRevision: number): Promise<LayoutDocument>;
    };
    const restored = await restorable.restoreCheckpoint(checkpoint.checkpointId, edited.stateRevision);

    expect(restored.stateRevision).toBe(edited.stateRevision + 1);
    expect(restored.objects[0]).toMatchObject({ xMm: 1000 });
    await expect(repo.loadDraft(checkpointDocument.documentId)).resolves.toEqual(restored);
    await expect(repo.loadCheckpoint(checkpoint.checkpointId)).resolves.toMatchObject({
      document: {
        stateRevision: checkpointDocument.stateRevision,
        objects: [expect.objectContaining({ xMm: 1000 })],
      },
    });
  });

  it("reports exact changed fields in the A-to-B diff model", async () => {
    const repo = repository();
    const versionAContent = makeSimpleRoom();
    const versionA = await repo.publishVersion(versionAContent, {
      versionId: "version.simple-room.a.hardening",
      authorType: "human",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Версия A",
      createdAt: "2026-08-04T10:00:00.000Z",
      warnings: [],
    });
    const versionBContent = revised(versionAContent, { rotationDeg: 90, widthMm: 800 });
    const versionB = await repo.publishVersion(versionBContent, {
      versionId: "version.simple-room.b.hardening",
      parentVersionId: versionA.versionId,
      authorType: "human",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Версия B",
      createdAt: "2026-08-04T11:00:00.000Z",
      warnings: [],
    });

    await expect(repo.diffVersions(versionA.versionId, versionB.versionId)).resolves.toMatchObject({
      changed: [
        {
          entityId: "object.simple-room.table",
          entityType: "object",
          fields: [
            { path: "rotationDeg", before: 0, after: 90 },
            { path: "widthMm", before: 600, after: 800 },
          ],
        },
      ],
    });
  });

  it("renders exact diff field paths and values instead of counts only", () => {
    const source = versionUiSource();
    const rendersChangedFields = /changed[\s\S]{0,1800}fields[\s\S]{0,800}(?:\.path|before|after)/.test(source);

    expect(rendersChangedFields, "diff UI must iterate changed[].fields and expose path/before/after").toBe(true);
  });
});
