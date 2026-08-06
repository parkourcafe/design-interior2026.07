import {
  diffLayoutDocuments,
  semanticHash,
  type LayoutDocument,
  type LayoutDocumentDiff,
} from "@/lib/layout-studio/domain";
import type {
  LayoutRepository,
  LayoutVersion,
  VersionPublicationInput,
} from "@/lib/layout-studio/application/layout-repository";

export type {
  LayoutVersion,
  VersionPublicationInput,
} from "@/lib/layout-studio/application/layout-repository";

interface MemoryVersionPublicationInput extends VersionPublicationInput {
  /** Test-adapter compatibility only; memory persistence does not trust this metadata. */
  authorType?: string;
  createdAt?: string;
  warnings?: string[];
}

export interface DraftRecord {
  document: LayoutDocument;
  parentVersionId: string | null;
}

export interface CheckpointInput {
  checkpointId: string;
  reasonCode: string;
  reason: string;
  createdAt: string;
}

export interface LayoutCheckpoint extends CheckpointInput {
  documentId: string;
  document: LayoutDocument;
}

export class LayoutRepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LayoutRepositoryError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function deterministicRevisionId(
  documentId: string,
  versionId: string,
  revisionNo: number,
): Promise<string> {
  const seed = new TextEncoder().encode(
    `archidom:memory-layout-revision:${documentId}:${versionId}:${revisionNo}`,
  );
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", seed));
  const bytes = digest.slice(0, 16);

  // RFC 9562 UUIDv8: deterministic application-defined payload with RFC variant bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class MemoryLayoutRepository implements LayoutRepository {
  private readonly drafts = new Map<string, DraftRecord>();
  private readonly checkpoints = new Map<string, LayoutCheckpoint>();
  private readonly versions = new Map<string, LayoutVersion>();
  private readonly pendingVersionIds = new Set<string>();
  private readonly pendingDocumentIds = new Set<string>();

  async saveDraft(document: LayoutDocument, parentVersionId: string | null): Promise<void> {
    this.drafts.set(document.documentId, clone({ document, parentVersionId }));
  }

  async loadDraft(documentId: string): Promise<LayoutDocument | null> {
    const record = this.drafts.get(documentId);
    return record ? clone(record.document) : null;
  }

  async createCheckpoint(
    document: LayoutDocument,
    input: CheckpointInput,
  ): Promise<LayoutCheckpoint> {
    if (this.checkpoints.has(input.checkpointId)) {
      throw new LayoutRepositoryError("CHECKPOINT_IMMUTABLE", "Checkpoint уже существует");
    }
    const checkpoint: LayoutCheckpoint = {
      ...clone(input),
      documentId: document.documentId,
      document: clone(document),
    };
    this.checkpoints.set(checkpoint.checkpointId, checkpoint);
    return clone(checkpoint);
  }

  async loadCheckpoint(checkpointId: string): Promise<LayoutCheckpoint | null> {
    const checkpoint = this.checkpoints.get(checkpointId);
    return checkpoint ? clone(checkpoint) : null;
  }

  async publishVersion(
    document: LayoutDocument,
    input: MemoryVersionPublicationInput,
  ): Promise<LayoutVersion> {
    if (this.versions.has(input.versionId) || this.pendingVersionIds.has(input.versionId)) {
      throw new LayoutRepositoryError("VERSION_IMMUTABLE", "Опубликованную версию нельзя заменить");
    }

    if (this.pendingDocumentIds.has(document.documentId)) {
      throw new LayoutRepositoryError("STALE_STATE", "Документ уже публикуется");
    }

    const documentVersions = [...this.versions.values()]
      .filter((version) => version.documentId === document.documentId)
      .sort((left, right) => left.revisionNo - right.revisionNo);
    const latestVersion = documentVersions.at(-1);
    if (
      (latestVersion === undefined && input.parentVersionId !== undefined) ||
      (latestVersion !== undefined && input.parentVersionId !== latestVersion.versionId)
    ) {
      throw new LayoutRepositoryError(
        "STALE_STATE",
        "Родитель должен быть последней версией того же документа",
      );
    }

    this.pendingVersionIds.add(input.versionId);
    this.pendingDocumentIds.add(document.documentId);
    try {
      const content = clone(document);
      const revisionNo = (latestVersion?.revisionNo ?? 0) + 1;
      const version: LayoutVersion = {
        versionId: input.versionId,
        documentId: content.documentId,
        revisionId: await deterministicRevisionId(content.documentId, input.versionId, revisionNo),
        revisionNo,
        createdAt: new Date(revisionNo).toISOString(),
        semanticHash: `sha256:${await semanticHash(content)}`,
        content,
      };
      this.versions.set(version.versionId, version);
      return clone(version);
    } finally {
      this.pendingVersionIds.delete(input.versionId);
      this.pendingDocumentIds.delete(document.documentId);
    }
  }

  async loadVersion(versionId: string): Promise<LayoutVersion | null> {
    const version = this.versions.get(versionId);
    return version ? clone(version) : null;
  }

  async listVersions(documentId: string): Promise<LayoutVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.documentId === documentId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.versionId.localeCompare(right.versionId),
      )
      .map(clone);
  }

  async diffVersions(fromVersionId: string, toVersionId: string): Promise<LayoutDocumentDiff> {
    const from = this.versions.get(fromVersionId);
    const to = this.versions.get(toVersionId);
    if (!from || !to) {
      throw new LayoutRepositoryError("VERSION_NOT_FOUND", "Запрошенная версия не найдена");
    }
    return diffLayoutDocuments(fromVersionId, from.content, toVersionId, to.content);
  }
}
