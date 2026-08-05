import type { LayoutCheckpoint, LayoutRepository } from "../../application/ports";
import type { LayoutDocument, LayoutVersion } from "../../domain";

export class MemoryLayoutRepository implements LayoutRepository {
  private drafts = new Map<string, LayoutDocument>(); private checkpoints = new Map<string, LayoutCheckpoint>(); private versions = new Map<string, LayoutVersion>();
  async loadDraft(id: string) { return structuredClone(this.drafts.get(id) ?? null); }
  async saveDraft(document: LayoutDocument, expectedRevision?: number) { const current = this.drafts.get(document.documentId); if (expectedRevision !== undefined && current?.stateRevision !== expectedRevision) throw new Error("STATE_STALE"); this.drafts.set(document.documentId, structuredClone(document)); }
  async createCheckpoint(document: LayoutDocument, label: string) { const item = { checkpointId: `checkpoint.${document.documentId}.${crypto.randomUUID()}`, documentId: document.documentId, content: structuredClone(document), createdAt: new Date().toISOString(), label }; this.checkpoints.set(item.checkpointId, item); return structuredClone(item); }
  async listCheckpoints(documentId: string) { return [...this.checkpoints.values()].filter((item) => item.documentId === documentId).map((item) => structuredClone(item)); }
  async loadCheckpoint(id: string) { return structuredClone(this.checkpoints.get(id) ?? null); }
  async publishVersion(input: Omit<LayoutVersion, "contractVersion" | "createdAt">) { if (this.versions.has(input.versionId)) throw new Error("VERSION_EXISTS"); if (input.parentVersionId && this.versions.get(input.parentVersionId)?.documentId !== input.documentId) throw new Error("INVALID_PARENT_VERSION"); const item: LayoutVersion = { ...structuredClone(input), contractVersion: "archidom.layout-version/0.1", createdAt: new Date().toISOString() }; this.versions.set(item.versionId, item); return structuredClone(item); }
  async listVersions(documentId: string) { return [...this.versions.values()].filter((item) => item.documentId === documentId).map((item) => structuredClone(item)); }
  async loadVersion(id: string) { return structuredClone(this.versions.get(id) ?? null); }
}
