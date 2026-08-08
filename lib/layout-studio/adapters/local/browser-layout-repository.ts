import {
  diffLayoutDocuments,
  semanticHash,
  validateLayoutDocument,
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
import type { LayoutRepositoryPort } from "@/lib/layout-studio/application/layout-repository-port";

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

export class BrowserLayoutRepository implements LayoutRepositoryPort {
  private readonly storage: BrowserStorage;
  private readonly keyPrefix: string;
  private readonly pendingVersionIds = new Set<string>();

  constructor(options: BrowserLayoutRepositoryOptions) {
    this.storage = options.storage;
    this.keyPrefix = `archidom:layout-studio:${encodeURIComponent(options.namespace)}`;
  }

  async saveDraft(document: LayoutDocument, expectedRevision: number | null): Promise<void> {
    const key = this.key("draft", document.documentId);
    const current = this.read<BrowserDraftRecord>(key);
    if (
      expectedRevision !== null &&
      (current === null || current.document.stateRevision !== expectedRevision)
    ) {
      throw new BrowserLayoutRepositoryError(
        "STATE_STALE",
        "Черновик основан на устаревшей ревизии документа",
        true,
      );
    }
    this.write(key, clone({ document, expectedRevision }));
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

  async listCheckpoints(documentId: string): Promise<LayoutCheckpoint[]> {
    const prefix = this.kindPrefix("checkpoint");
    const checkpoints: LayoutCheckpoint[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const checkpoint = this.read<LayoutCheckpoint>(key);
      if (checkpoint?.documentId === documentId) checkpoints.push(checkpoint);
    }
    return checkpoints.sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map(clone);
  }

  async restoreCheckpoint(
    checkpointId: string,
    expectedRevision: number,
  ): Promise<LayoutDocument> {
    const checkpoint = await this.loadCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new LayoutRepositoryError("CHECKPOINT_NOT_FOUND", "Checkpoint не найден");
    }

    const current = await this.loadDraft(checkpoint.documentId);
    if (!current || current.stateRevision !== expectedRevision) {
      throw new BrowserLayoutRepositoryError(
        "STATE_STALE",
        "Восстановление основано на устаревшей ревизии документа",
        true,
      );
    }

    const restored = clone(checkpoint.document);
    restored.stateRevision = current.stateRevision + 1;
    await this.saveDraft(restored, expectedRevision);
    return clone(restored);
  }

  async publishVersion(
    document: LayoutDocument,
    input: VersionPublicationInput,
  ): Promise<LayoutVersion> {
    const validation = validateLayoutDocument(document);
    if (!validation.valid) {
      throw new LayoutRepositoryError("VERSION_SCHEMA_INVALID", "Невалидный документ нельзя опубликовать");
    }
    if (input.parentVersionId) {
      const parent = await this.loadVersion(input.parentVersionId);
      if (!parent) throw new LayoutRepositoryError("PARENT_VERSION_NOT_FOUND", "Родительская версия не найдена");
      if (parent.documentId !== document.documentId) {
        throw new LayoutRepositoryError("PARENT_DOCUMENT_MISMATCH", "Родительская версия относится к другому документу");
      }
    }
    const key = this.key("version", input.versionId);
    if (this.storage.getItem(key) !== null || this.pendingVersionIds.has(input.versionId)) {
      throw new LayoutRepositoryError("VERSION_IMMUTABLE", "Опубликованную версию нельзя заменить");
    }

    this.pendingVersionIds.add(input.versionId);
    try {
      const content = clone(document);
      const version: LayoutVersion = {
        contractVersion: "archidom.layout-version/0.1",
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
    if (stored === null) return null;
    try {
      return JSON.parse(stored) as T;
    } catch {
      throw new BrowserLayoutRepositoryError(
        "STORAGE_CORRUPTED",
        "Локальные данные повреждены и не могут быть прочитаны",
        true,
      );
    }
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
