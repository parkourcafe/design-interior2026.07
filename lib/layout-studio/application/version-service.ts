import { semanticHash, validateLayoutDocument, type LayoutDocument, type LayoutVersion } from "../domain";
import type { LayoutRepository } from "./ports";

export class VersionService {
  constructor(private readonly repository: LayoutRepository) {}
  async publish(document: LayoutDocument, input: { versionId: string; parentVersionId?: string; reasonCode: string; reason: string }): Promise<LayoutVersion> {
    const validation = validateLayoutDocument(document);
    if (!validation.valid) throw new Error("Cannot publish an invalid layout document");
    if (input.parentVersionId) {
      const parent = await this.repository.loadVersion(input.parentVersionId);
      if (!parent || parent.documentId !== document.documentId) throw new Error("Parent version does not exist in this document");
    }
    return this.repository.publishVersion({ versionId: input.versionId, documentId: document.documentId, parentVersionId: input.parentVersionId, semanticHash: await semanticHash(document), content: structuredClone(document), authorType: "human", reasonCode: input.reasonCode, reason: input.reason, warnings: validation.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code) });
  }
}
