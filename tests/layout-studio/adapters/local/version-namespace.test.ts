import { describe, expect, it } from "vitest";

import { BrowserLayoutRepository } from "@/lib/layout-studio/adapters/local/browser-layout-repository";
import type { LayoutDocument } from "@/lib/layout-studio/domain";
import koraFixture from "@/fixtures/layout-studio/kora-liquid-station.v0.1.json";
import syntheticFixture from "@/fixtures/layout-studio/liquid-station.synthetic.v0.1.json";

class FakeStorage {
  readonly values = new Map<string, string>();
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
    this.values.set(key, value);
  }
}

const KORA = koraFixture as unknown as LayoutDocument;
const SYNTHETIC = syntheticFixture as unknown as LayoutDocument;

const publishInput = (versionId: string) => ({
  versionId,
  authorType: "human" as const,
  reasonCode: "LOCAL_VERSION",
  reason: "Публикация",
  createdAt: "2026-08-06T10:00:00.000Z",
  warnings: [],
});

/**
 * The shell numbers versions per document ("V1", "V2", …) from listVersions,
 * which filters by documentId. Storage keys are addressed by versionId alone,
 * so two documents must not share one repository namespace.
 */
describe("LS-AT-062/086: version identity is scoped per document", () => {
  it("rejects a second document's V1 when both share one namespace", async () => {
    const storage = new FakeStorage();
    const shared = new BrowserLayoutRepository({ storage, namespace: "shared" });

    await shared.publishVersion(KORA, publishInput("V1"));
    expect(await shared.listVersions(SYNTHETIC.documentId)).toEqual([]);

    await expect(shared.publishVersion(SYNTHETIC, publishInput("V1")))
      .rejects.toMatchObject({ code: "VERSION_IMMUTABLE" });
  });

  it("lets both documents publish V1 under per-document namespaces", async () => {
    const storage = new FakeStorage();
    const namespaceFor = (document: LayoutDocument) =>
      new BrowserLayoutRepository({ storage, namespace: `preview-v1:${document.documentId}` });

    const koraVersion = await namespaceFor(KORA).publishVersion(KORA, publishInput("V1"));
    const syntheticVersion = await namespaceFor(SYNTHETIC).publishVersion(SYNTHETIC, publishInput("V1"));

    expect(koraVersion.documentId).toBe(KORA.documentId);
    expect(syntheticVersion.documentId).toBe(SYNTHETIC.documentId);
    expect(koraVersion.semanticHash).not.toBe(syntheticVersion.semanticHash);

    expect((await namespaceFor(KORA).listVersions(KORA.documentId)).map((v) => v.versionId))
      .toEqual(["V1"]);
    expect((await namespaceFor(SYNTHETIC).listVersions(SYNTHETIC.documentId)).map((v) => v.versionId))
      .toEqual(["V1"]);
  });

  it("keeps each document's exact version reachable by id inside its namespace", async () => {
    const storage = new FakeStorage();
    const koraRepo = new BrowserLayoutRepository({ storage, namespace: `preview-v1:${KORA.documentId}` });
    const syntheticRepo = new BrowserLayoutRepository({ storage, namespace: `preview-v1:${SYNTHETIC.documentId}` });

    await koraRepo.publishVersion(KORA, publishInput("V1"));
    await syntheticRepo.publishVersion(SYNTHETIC, publishInput("V1"));

    expect((await koraRepo.loadVersion("V1"))?.documentId).toBe(KORA.documentId);
    expect((await syntheticRepo.loadVersion("V1"))?.documentId).toBe(SYNTHETIC.documentId);
  });

  it("still refuses to overwrite a published version inside one namespace", async () => {
    const storage = new FakeStorage();
    const repository = new BrowserLayoutRepository({ storage, namespace: `preview-v1:${KORA.documentId}` });

    await repository.publishVersion(KORA, publishInput("V1"));
    await expect(repository.publishVersion(KORA, publishInput("V1")))
      .rejects.toMatchObject({ code: "VERSION_IMMUTABLE" });
  });
});
