import type {
  LayoutCheckpoint,
  CheckpointInput,
  LayoutVersion,
  VersionPublicationInput,
} from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import type { LayoutDocument, LayoutDocumentDiff } from "@/lib/layout-studio/domain";

/**
 * Контракт хранилища, от которого зависит редактор.
 *
 * Он существует не ради красоты, а из-за конкретной пойманной ошибки. У
 * браузерного хранилища второй аргумент saveDraft — номер ревизии, на которой
 * основана правка: он защищает от потери чужих изменений. У первой версии
 * серверного хранилища тем же вторым аргументом был id родительской версии.
 * Подмена одного другим не ломает ни типы, ни тесты по отдельности: номер
 * молча уезжает в текстовую колонку, а защита от перезаписи исчезает.
 *
 * Здесь эта семантика зафиксирована один раз, и оба хранилища обязаны ей
 * соответствовать — несоответствие становится ошибкой компиляции
 * (см. layout-repository-port.test.ts).
 */
export interface LayoutRepositoryPort {
  /**
   * Сохранить черновик.
   *
   * @param expectedRevision ревизия, которую вызывающий считает текущей.
   *   Если в хранилище лежит другая — правка отклоняется с кодом STATE_STALE,
   *   а не затирает чужую работу. null отключает проверку: так сохраняется
   *   самый первый черновик, когда в хранилище ещё ничего нет.
   */
  saveDraft(document: LayoutDocument, expectedRevision: number | null): Promise<void>;

  loadDraft(documentId: string): Promise<LayoutDocument | null>;

  createCheckpoint(document: LayoutDocument, input: CheckpointInput): Promise<LayoutCheckpoint>;
  loadCheckpoint(checkpointId: string): Promise<LayoutCheckpoint | null>;
  listCheckpoints(documentId: string): Promise<LayoutCheckpoint[]>;

  /**
   * Вернуть черновик к состоянию чекпойнта. Ревизия не откатывается назад, а
   * растёт: восстановление — это ещё одна правка в истории, а не путешествие
   * во времени. Так undo/redo и защита от устаревшей ревизии остаются
   * согласованными.
   */
  restoreCheckpoint(checkpointId: string, expectedRevision: number): Promise<LayoutDocument>;

  publishVersion(
    document: LayoutDocument,
    input: VersionPublicationInput,
  ): Promise<LayoutVersion>;
  loadVersion(versionId: string): Promise<LayoutVersion | null>;
  listVersions(documentId: string): Promise<LayoutVersion[]>;

  diffVersions(fromVersionId: string, toVersionId: string): Promise<LayoutDocumentDiff>;
}
