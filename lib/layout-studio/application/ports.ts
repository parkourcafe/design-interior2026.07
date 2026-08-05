import type { LayoutDocument, LayoutVersion } from "../domain";

export interface LayoutCheckpoint { checkpointId: string; documentId: string; content: LayoutDocument; createdAt: string; label: string }
export interface LayoutRepository {
  loadDraft(documentId: string): Promise<LayoutDocument | null>;
  saveDraft(document: LayoutDocument, expectedRevision?: number): Promise<void>;
  createCheckpoint(document: LayoutDocument, label: string): Promise<LayoutCheckpoint>;
  listCheckpoints(documentId: string): Promise<LayoutCheckpoint[]>;
  loadCheckpoint(checkpointId: string): Promise<LayoutCheckpoint | null>;
  publishVersion(input: Omit<LayoutVersion, "contractVersion" | "createdAt">): Promise<LayoutVersion>;
  listVersions(documentId: string): Promise<LayoutVersion[]>;
  loadVersion(versionId: string): Promise<LayoutVersion | null>;
}

export interface SvgExporter { render(document: LayoutDocument): string }
export interface PngExporter { render(document: LayoutDocument, width: number, height: number): Promise<Uint8Array> }
export interface GlbExporter { render(document: LayoutDocument): Promise<Uint8Array> }
export interface PrintExporter { render(document: LayoutDocument, svg: string, metadata: Record<string, unknown>): string }
