import {
  diffLayoutDocuments,
  semanticHash,
  type LayoutDocument,
  type LayoutDocumentDiff,
} from "@/lib/layout-studio/domain";

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

export interface VersionPublicationInput {
  versionId: string;
  parentVersionId?: string;
  authorType: string;
  reasonCode: string;
  reason: string;
  createdAt: string;
  warnings: string[];
}

export interface LayoutVersion extends VersionPublicationInput {
  documentId: string;
  semanticHash: string;
  content: LayoutDocument;
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

export class MemoryLayoutRepository {
  private readonly drafts = new Map<string, DraftRecord>();
  private readonly checkpoints = new Map<string, LayoutCheckpoint>();
  private readonly versions = new Map<string, LayoutVersion>();
  private readonly pendingVersionIds = new Set<string>();

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
    input: VersionPublicationInput,
  ): Promise<LayoutVersion> {
    if (this.versions.has(input.versionId) || this.pendingVersionIds.has(input.versionId)) {
      throw new LayoutRepositoryError("VERSION_IMMUTABLE", "Опубликованную версию нельзя заменить");
    }

    this.pendingVersionIds.add(input.versionId);
    try {
      const content = clone(document);
      const version: LayoutVersion = {
        ...clone(input),
        documentId: content.documentId,
        semanticHash: await semanticHash(content),
        content,
      };
      this.versions.set(version.versionId, version);
      return clone(version);
    } finally {
      this.pendingVersionIds.delete(input.versionId);
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
