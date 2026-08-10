import type {
  CheckpointInput,
  LayoutCheckpoint,
} from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import type { LayoutRepository } from "@/lib/layout-studio/application/layout-repository";
import type { LayoutDocument } from "@/lib/layout-studio/domain";

/**
 * Контракты хранилищ, от которых зависит редактор.
 *
 * Разделение на два интерфейса отражает разделение ответственности в
 * объединённом контуре:
 *
 * - Черновики и чекпойнты — рабочее состояние редактора. Живут в таблицах
 *   layout_documents / layout_checkpoints (миграция 20260808050000), правятся
 *   свободно, защищены оптимистической блокировкой по ревизии.
 * - Опубликованные версии — подписанная истина. Живут в хранилище
 *   projectceo_product (миграция 20260802080000): Postgres сам перевалидирует
 *   документ и пересчитывает семантический хеш, версия неизменяема. Контракт
 *   чтения/публикации — LayoutRepository (см. layout-repository.ts).
 *
 * Второй аргумент saveDraft зафиксирован здесь из-за конкретной пойманной
 * ошибки. У браузерного хранилища это был номер ревизии, на которой основана
 * правка: он защищает от потери чужих изменений. У первой версии серверного
 * хранилища тем же вторым аргументом был id родительской версии. Подмена
 * одного другим не ломает ни типы, ни тесты по отдельности: номер молча
 * уезжает в текстовую колонку, а защита от перезаписи исчезает. Семантика
 * записана один раз, и все хранилища обязаны ей соответствовать.
 */
export interface LayoutDraftStorePort {
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
}

/**
 * Полный порт редактора: рабочее состояние + подписанные версии.
 *
 * MemoryLayoutRepository реализует его целиком (эталон для тестов).
 * Серверная пара в продукте: SupabaseLayoutRepository (черновики, RLS) +
 * хранилище projectceo_product (версии, через command API).
 */
export interface LayoutRepositoryPort extends LayoutDraftStorePort, LayoutRepository {}
