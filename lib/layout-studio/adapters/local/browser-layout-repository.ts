import type { LayoutCheckpoint, LayoutRepository } from "../../application/ports";
import type { LayoutDocument, LayoutVersion } from "../../domain";

interface Envelope { drafts: Record<string, LayoutDocument>; checkpoints: Record<string, LayoutCheckpoint>; versions: Record<string, LayoutVersion> }
const empty = (): Envelope => ({ drafts: {}, checkpoints: {}, versions: {} });

export class BrowserLayoutRepository implements LayoutRepository {
  constructor(private readonly namespace = "archidom.layout-studio.v1", private readonly storage: Storage = window.localStorage) {}
  private read(): Envelope {
    const raw = this.storage.getItem(this.namespace); if (!raw) return empty();
    try { const parsed = JSON.parse(raw) as Partial<Envelope>; return { drafts: parsed.drafts ?? {}, checkpoints: parsed.checkpoints ?? {}, versions: parsed.versions ?? {} }; }
    catch { this.storage.setItem(`${this.namespace}.corrupt.${Date.now()}`, raw); this.storage.removeItem(this.namespace); return empty(); }
  }
  private write(value: Envelope) { this.storage.setItem(this.namespace, JSON.stringify(value)); }
  async loadDraft(documentId: string) { return structuredClone(this.read().drafts[documentId] ?? null); }
  async saveDraft(document: LayoutDocument, expectedRevision?: number) {
    const value = this.read(); const current = value.drafts[document.documentId];
    if (expectedRevision !== undefined && current && current.stateRevision !== expectedRevision) throw new Error("STATE_STALE");
    if (current && document.stateRevision < current.stateRevision) throw new Error("STATE_STALE");
    value.drafts[document.documentId] = structuredClone(document); this.write(value);
  }
  async createCheckpoint(document: LayoutDocument, label: string) {
    const value = this.read(); const checkpoint: LayoutCheckpoint = { checkpointId: `checkpoint.${document.documentId}.${crypto.randomUUID()}`, documentId: document.documentId, content: structuredClone(document), createdAt: new Date().toISOString(), label };
    value.checkpoints[checkpoint.checkpointId] = checkpoint; this.write(value); return structuredClone(checkpoint);
  }
  async listCheckpoints(documentId: string) { return Object.values(this.read().checkpoints).filter((item) => item.documentId === documentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => structuredClone(item)); }
  async loadCheckpoint(checkpointId: string) { return structuredClone(this.read().checkpoints[checkpointId] ?? null); }
  async publishVersion(input: Omit<LayoutVersion, "contractVersion" | "createdAt">) {
    const value = this.read(); if (value.versions[input.versionId]) throw new Error("VERSION_EXISTS");
    if (input.parentVersionId) { const parent = value.versions[input.parentVersionId]; if (!parent || parent.documentId !== input.documentId) throw new Error("INVALID_PARENT_VERSION"); }
    const version: LayoutVersion = { ...structuredClone(input), contractVersion: "archidom.layout-version/0.1", createdAt: new Date().toISOString() };
    value.versions[version.versionId] = version; this.write(value); return structuredClone(version);
  }
  async listVersions(documentId: string) { return Object.values(this.read().versions).filter((item) => item.documentId === documentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => structuredClone(item)); }
  async loadVersion(versionId: string) { return structuredClone(this.read().versions[versionId] ?? null); }
}
