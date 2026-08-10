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
import { AuthenticatedLayoutRepository } from "@/lib/layout-studio/adapters/http/authenticated-layout-repository";
import type { LayoutRepositoryPort } from "@/lib/layout-studio/application/layout-repository-port";
import {
  parseWorkspaceBinding,
  prepareForPublication,
  type WorkspaceBinding,
} from "@/lib/layout-studio/application/workspace-binding";

/**
 * Хранилище редактора, которое ходит на сервер. Это фасад над двумя мирами:
 *
 * - Черновики и чекпойнты — рабочее состояние. Живут в таблицах студии за RLS,
 *   через /api/layout-studio. Здесь хранилище ничего не решает само: схему,
 *   права и ревизии проверяет серверный роут.
 * - Опубликованные версии — подписанная истина объединённого контура. Живут в
 *   хранилище projectceo_product и публикуются его command API
 *   (publish_m2_layout_version). Этот путь открывается ТОЛЬКО когда планировка
 *   привязана к рабочему пространству (пакет projectceo): привязку возвращает
 *   тот же серверный роут, а публикацией занимается AuthenticatedLayoutRepository
 *   — клиент, написанный командой контура под их собственный контракт.
 *
 * Без привязки публикация честно отвечает VERSION_STORE_NOT_CONNECTED, а
 * список версий пуст — редактор показывает это словами, а не делает вид.
 *
 * Версии и чекпойнты загружаются при открытии и дальше держатся в памяти: их
 * список меняется только действиями самого редактора, а лишний круг по сети на
 * каждое обращение сделал бы интерфейс дёрганым.
 */
export class HttpLayoutRepository implements LayoutRepositoryPort {
  private versionCache: LayoutVersion[] = [];
  private checkpointCache: LayoutCheckpoint[] = [];
  private binding: WorkspaceBinding | null = null;
  private published: AuthenticatedLayoutRepository | null = null;
  // Один общий hydrate на все параллельные вызовы: редактор запрашивает
  // черновик, версии и чекпойнты одновременно, и без единственного полёта
  // они бы наперегонки открывали документ тремя GET-ами.
  private hydration: Promise<{
    draft: LayoutDocument | null;
    versions: LayoutVersion[];
    checkpoints: LayoutCheckpoint[];
  }> | null = null;

  constructor(
    private readonly documentId: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly randomUUID: () => string = () => crypto.randomUUID(),
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

  /** Один запрос на открытие: черновик, привязка, версии и чекпойнты сразу. */
  async hydrate(): Promise<{
    draft: LayoutDocument | null;
    versions: LayoutVersion[];
    checkpoints: LayoutCheckpoint[];
  }> {
    this.hydration ??= this.hydrateOnce();
    return this.hydration;
  }

  private async hydrateOnce(): Promise<{
    draft: LayoutDocument | null;
    versions: LayoutVersion[];
    checkpoints: LayoutCheckpoint[];
  }> {
    const payload = await this.request<{
      draft: LayoutDocument;
      checkpoints: LayoutCheckpoint[];
      binding?: unknown;
    }>();
    this.checkpointCache = payload.checkpoints ?? [];
    this.connectPublishedStore(parseWorkspaceBinding(payload.binding), payload.draft);
    // Отказ хранилища опубликованных версий НЕ роняет редактор: черновик и
    // чекпойнты живут в другом мире и по-прежнему доступны. Урок живого
    // прогона: 403 на чтении пакета превращал открытие планировки в «ошибку
    // загрузки черновика», хотя черновик загрузился. Деградируем честно —
    // список версий пуст, причина в консоли, публикация скажет об ошибке
    // сама, когда её попросят.
    this.versionCache = [];
    if (this.published) {
      try {
        this.versionCache = await this.published.listVersions(this.documentId);
      } catch (error) {
        console.error("layout-studio: чтение опубликованных версий недоступно", error);
      }
    }
    return {
      draft: payload.draft,
      versions: this.versionCache,
      checkpoints: this.checkpointCache,
    };
  }

  /**
   * Собрать клиент опубликованных версий под привязку.
   *
   * variantId контекста — из самого документа: вариант живёт в содержимом и
   * стабилен с создания, а не выбирается при публикации. Клиент контура сам
   * сверит его с документом ещё раз (assertDocumentScope).
   */
  private connectPublishedStore(
    binding: WorkspaceBinding | null,
    draft: LayoutDocument | null,
  ): void {
    this.binding = binding;
    const variantId = draft?.variant?.id;
    this.published = binding && variantId
      ? new AuthenticatedLayoutRepository({
          fetch: this.fetchImpl,
          randomUUID: this.randomUUID,
          context: {
            projectId: binding.projectId,
            packageId: binding.packageId,
            roomId: binding.roomId,
            variantId,
            role: binding.role,
          },
        })
      : null;
  }

  private async ensureHydrated(): Promise<void> {
    await this.hydrate();
  }

  /** Привязка, с которой хранилище работает сейчас; null — не привязано. */
  workspaceBinding(): WorkspaceBinding | null {
    return this.binding ? { ...this.binding } : null;
  }

  /**
   * Привязать планировку к рабочему пространству и сразу подключить хранилище
   * версий. Список версий перечитывается: в выбранном пакете уже могли жить
   * публикации этой комнаты.
   */
  async bindWorkspace(binding: WorkspaceBinding, draft: LayoutDocument): Promise<LayoutVersion[]> {
    await this.post<{ ok: true }>({ action: "bindWorkspace", ...binding });
    this.connectPublishedStore(binding, draft);
    // Привязка записана — это свершившийся факт. Недоступность чтения версий
    // после неё — деградация, а не откат: политика та же, что в hydrate.
    this.versionCache = [];
    if (this.published) {
      try {
        this.versionCache = await this.published.listVersions(this.documentId);
      } catch (error) {
        console.error("layout-studio: чтение опубликованных версий недоступно", error);
      }
    }
    return [...this.versionCache];
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
    // id чеканит сервер: клиентский на глобальном ключе — коллизии.
    const { checkpoint } = await this.post<{ checkpoint: LayoutCheckpoint }>({
      action: "createCheckpoint",
      document,
      reasonCode: input.reasonCode,
      reason: input.reason,
      createdAt: input.createdAt,
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
    document: LayoutDocument,
    input: VersionPublicationInput,
  ): Promise<LayoutVersion> {
    await this.ensureHydrated();
    if (!this.published || !this.binding) {
      throw new LayoutRepositoryError(
        "VERSION_STORE_NOT_CONNECTED",
        "Планировка не привязана к рабочему пространству. Выберите пакет проекта — и публикация откроется.",
      );
    }
    // Черновик несёт studio-идентификатор проекта и живой статус варианта;
    // команда публикации требует projectceo-проект и статус published. Копию
    // готовит одна чистая функция, черновик остаётся нетронутым.
    const publication = prepareForPublication(document, this.binding);
    const version = await this.published.publishVersion(publication, input);
    this.versionCache = [...this.versionCache, version];
    return version;
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
