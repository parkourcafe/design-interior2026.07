import {
  diffLayoutDocuments,
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

/**
 * Хранилище редактора, которое ходит на сервер.
 *
 * Работает в браузере и потому НИЧЕГО не решает само: ни схему, ни хеш, ни
 * права. Всё это считает серверный роут — здесь только перенос данных и
 * обратный перевод HTTP-кодов в доменные ошибки, чтобы редактор реагировал
 * одинаково независимо от того, где лежит документ.
 *
 * Версии и чекпойнты загружаются один раз при открытии и дальше держатся в
 * памяти: их список меняется только действиями самого редактора, а лишний
 * круг по сети на каждое обращение сделал бы интерфейс дёрганым.
 *
 * Публикация версий из этого хранилища пока недоступна — и об этом оно
 * говорит прямо, а не делает вид, что опубликовало. Подписанные версии в
 * объединённом контуре живут в хранилище projectceo_product и публикуются
 * его command API с контекстом рабочего пространства (пакет, комната,
 * вариант). Подключение редактора к этому контексту — следующий шаг M2;
 * до него publishVersion возвращает код VERSION_STORE_NOT_CONNECTED,
 * который редактор показывает человеку словами.
 */
export class HttpLayoutRepository implements LayoutRepositoryPort {
  private versionCache: LayoutVersion[] = [];
  private checkpointCache: LayoutCheckpoint[] = [];
  private hydrated = false;

  constructor(
    private readonly documentId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get endpoint(): string {
    return `/api/layout-studio/${encodeURIComponent(this.documentId)}`;
  }

  private async request<T>(init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, init);
    } catch {
      // Обрыв связи — не «планировка сломалась». Разделение важно: на первое
      // редактор предлагает повторить, на второе показывает ошибку данных.
      throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", "Нет связи с сервером");
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      throw new LayoutRepositoryError(
        payload?.error ?? "STORAGE_UNAVAILABLE",
        payload?.message ?? "Сервер отклонил операцию",
      );
    }
    return (await response.json()) as T;
  }

  private post<T>(body: Record<string, unknown>): Promise<T> {
    return this.request<T>({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** Один запрос на открытие: черновик, версии и чекпойнты сразу. */
  async hydrate(): Promise<{
    draft: LayoutDocument | null;
    versions: LayoutVersion[];
    checkpoints: LayoutCheckpoint[];
  }> {
    const payload = await this.request<{
      draft: LayoutDocument;
      versions: LayoutVersion[];
      checkpoints: LayoutCheckpoint[];
    }>();
    this.versionCache = payload.versions ?? [];
    this.checkpointCache = payload.checkpoints ?? [];
    this.hydrated = true;
    return { draft: payload.draft, versions: this.versionCache, checkpoints: this.checkpointCache };
  }

  private async ensureHydrated(): Promise<void> {
    if (!this.hydrated) await this.hydrate();
  }

  async saveDraft(document: LayoutDocument, expectedRevision: number | null): Promise<void> {
    await this.post({ action: "saveDraft", document, expectedRevision });
  }

  async loadDraft(documentId: string): Promise<LayoutDocument | null> {
    if (documentId !== this.documentId) return null;
    try {
      return (await this.hydrate()).draft;
    } catch (error) {
      if (error instanceof LayoutRepositoryError && error.code === "not_found") return null;
      throw error;
    }
  }

  async createCheckpoint(
    document: LayoutDocument,
    input: CheckpointInput,
  ): Promise<LayoutCheckpoint> {
    const { checkpoint } = await this.post<{ checkpoint: LayoutCheckpoint }>({
      action: "createCheckpoint",
      document,
      ...input,
    });
    this.checkpointCache = [...this.checkpointCache, checkpoint];
    return checkpoint;
  }

  async loadCheckpoint(checkpointId: string): Promise<LayoutCheckpoint | null> {
    await this.ensureHydrated();
    return this.checkpointCache.find((item) => item.checkpointId === checkpointId) ?? null;
  }

  async listCheckpoints(documentId: string): Promise<LayoutCheckpoint[]> {
    await this.ensureHydrated();
    return this.checkpointCache.filter((item) => item.documentId === documentId);
  }

  async restoreCheckpoint(
    checkpointId: string,
    expectedRevision: number,
  ): Promise<LayoutDocument> {
    const { document } = await this.post<{ document: LayoutDocument }>({
      action: "restoreCheckpoint",
      checkpointId,
      expectedRevision,
    });
    return document;
  }

  async publishVersion(
    _document: LayoutDocument,
    _input: VersionPublicationInput,
  ): Promise<LayoutVersion> {
    throw new LayoutRepositoryError(
      "VERSION_STORE_NOT_CONNECTED",
      "Публикация версий подключается через рабочее пространство M2 — следующий шаг. Черновик и чекпойнты уже сохраняются на сервере.",
    );
  }

  async loadVersion(versionId: string): Promise<LayoutVersion | null> {
    await this.ensureHydrated();
    return this.versionCache.find((item) => item.versionId === versionId) ?? null;
  }

  async listVersions(documentId: string): Promise<LayoutVersion[]> {
    await this.ensureHydrated();
    return this.versionCache.filter((item) => item.documentId === documentId);
  }

  async diffVersions(fromVersionId: string, toVersionId: string): Promise<LayoutDocumentDiff> {
    // Считается на клиенте: обе версии уже загружены, и это чистая функция над
    // ними. Лишний запрос ничего не добавил бы к достоверности.
    const [from, to] = await Promise.all([
      this.loadVersion(fromVersionId),
      this.loadVersion(toVersionId),
    ]);
    if (!from || !to) {
      throw new LayoutRepositoryError("VERSION_NOT_FOUND", "Запрошенная версия не найдена");
    }
    return diffLayoutDocuments(fromVersionId, from.content, toVersionId, to.content);
  }
}
