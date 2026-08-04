import {
  diffLayoutDocuments,
  semanticHash,
  type LayoutDocument,
  type LayoutDocumentDiff,
} from "@/lib/layout-studio/domain";
import {
  LayoutRepositoryError,
  type CheckpointInput,
  type LayoutCheckpoint,
  type LayoutVersion,
  type VersionPublicationInput,
} from "@/lib/layout-studio/adapters/local/memory-layout-repository";

export interface BrowserStorage {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  setItem(key: string, value: string): void;
}

export interface BrowserLayoutRepositoryOptions {
  storage: BrowserStorage;
  namespace: string;
}

interface BrowserDraftRecord {
  document: LayoutDocument;
  expectedRevision: number | null;
}

export class BrowserLayoutRepositoryError extends LayoutRepositoryError {
  constructor(
    code: string,
    message: string,
    public readonly recoverable: boolean,
  ) {
    super(code, message);
    this.name = "BrowserLayoutRepositoryError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isQuotaExceeded(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === "QuotaExceededError" ||
    candidate.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    candidate.code === 22 ||
    candidate.code === 1014
  );
}

export class BrowserLayoutRepository {
  private readonly storage: BrowserStorage;
  private readonly keyPrefix: string;
  private readonly pendingVersionIds = new Set<string>();

  constructor(options: BrowserLayoutRepositoryOptions) {
    this.storage = options.storage;
    this.keyPrefix = `archidom:layout-studio:${encodeURIComponent(options.namespace)}`;
  }

  async saveDraft(document: LayoutDocument, expectedRevision: number | null): Promise<void> {
    this.write(this.key("draft", document.documentId), clone({ document, expectedRevision }));
  }

  async loadDraft(documentId: string): Promise<LayoutDocument | null> {
    const record = this.read<BrowserDraftRecord>(this.key("draft", documentId));
    return record ? clone(record.document) : null;
  }

  async createCheckpoint(
    document: LayoutDocument,
    input: CheckpointInput,
  ): Promise<LayoutCheckpoint> {
    const key = this.key("checkpoint", input.checkpointId);
    if (this.storage.getItem(key) !== null) {
      throw new LayoutRepositoryError("CHECKPOINT_IMMUTABLE", "Checkpoint уже существует");
    }

    const checkpoint: LayoutCheckpoint = {
      ...clone(input),
      documentId: document.documentId,
      document: clone(document),
    };
    this.write(key, checkpoint);
    return clone(checkpoint);
  }

  async loadCheckpoint(checkpointId: string): Promise<LayoutCheckpoint | null> {
    const checkpoint = this.read<LayoutCheckpoint>(this.key("checkpoint", checkpointId));
    return checkpoint ? clone(checkpoint) : null;
  }

  async publishVersion(
    document: LayoutDocument,
    input: VersionPublicationInput,
  ): Promise<LayoutVersion> {
    const key = this.key("version", input.versionId);
    if (this.storage.getItem(key) !== null || this.pendingVersionIds.has(input.versionId)) {
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

      if (this.storage.getItem(key) !== null) {
        throw new LayoutRepositoryError("VERSION_IMMUTABLE", "Опубликованную версию нельзя заменить");
      }
      this.write(key, version);
      return clone(version);
    } finally {
      this.pendingVersionIds.delete(input.versionId);
    }
  }

  async loadVersion(versionId: string): Promise<LayoutVersion | null> {
    const version = this.read<LayoutVersion>(this.key("version", versionId));
    return version ? clone(version) : null;
  }

  async listVersions(documentId: string): Promise<LayoutVersion[]> {
    const prefix = this.kindPrefix("version");
    const versions: LayoutVersion[] = [];

    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key?.startsWith(prefix)) {
        const version = this.read<LayoutVersion>(key);
        if (version?.documentId === documentId) {
          versions.push(version);
        }
      }
    }

    return versions
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.versionId.localeCompare(right.versionId),
      )
      .map(clone);
  }

  async diffVersions(fromVersionId: string, toVersionId: string): Promise<LayoutDocumentDiff> {
    const from = await this.loadVersion(fromVersionId);
    const to = await this.loadVersion(toVersionId);
    if (!from || !to) {
      throw new LayoutRepositoryError("VERSION_NOT_FOUND", "Запрошенная версия не найдена");
    }

    return diffLayoutDocuments(fromVersionId, from.content, toVersionId, to.content);
  }

  private key(kind: "draft" | "checkpoint" | "version", id: string): string {
    return `${this.kindPrefix(kind)}${encodeURIComponent(id)}`;
  }

  private kindPrefix(kind: "draft" | "checkpoint" | "version"): string {
    return `${this.keyPrefix}:${kind}:`;
  }

  private read<T>(key: string): T | null {
    const stored = this.storage.getItem(key);
    return stored === null ? null : (JSON.parse(stored) as T);
  }

  private write(key: string, value: unknown): void {
    const serialized = JSON.stringify(value);
    try {
      this.storage.setItem(key, serialized);
    } catch (error) {
      if (isQuotaExceeded(error)) {
        throw new BrowserLayoutRepositoryError(
          "STORAGE_QUOTA_EXCEEDED",
          "Недостаточно места для локального сохранения",
          true,
        );
      }
      throw error;
    }
  }
}
