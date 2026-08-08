import {
  validateLayoutDocument,
  type LayoutDocument,
} from "@/lib/layout-studio/domain";
import type { LayoutDraftStorePort } from "@/lib/layout-studio/application/layout-repository-port";
import {
  LayoutRepositoryError,
  type CheckpointInput,
  type LayoutCheckpoint,
} from "@/lib/layout-studio/adapters/local/memory-layout-repository";

/**
 * Серверное хранилище рабочего состояния редактора поверх Supabase.
 *
 * Реализует ТОЛЬКО черновики и чекпойнты (LayoutDraftStorePort). Опубликованные
 * версии сюда не пишутся намеренно: подписанная истина в объединённом контуре
 * одна — хранилище projectceo_product (миграция 20260802080000), где Postgres
 * сам перевалидирует документ и пересчитывает семантический хеш. Второе место
 * записи версий означало бы два движка версий.
 *
 * Изоляция между дизайнерами здесь не реализуется: её обеспечивает RLS в
 * миграции 20260808050000. Клиент создаётся из cookie залогиненного
 * пользователя (lib/supabase/server), service role не используется.
 */

/** Минимальная часть клиента Supabase, которой пользуется хранилище. */
export interface LayoutSupabaseClient {
  // Билдер PostgREST типизирован генерируемыми типами базы, которых у этого
  // слоя нет намеренно: хранилище объявляет только форму строк, которые читает.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

interface DocumentRow {
  id: string;
  project_id: string;
  document_id: string;
  title: string;
  draft: unknown;
}

interface CheckpointRow {
  checkpoint_id: string;
  document_id: string;
  content: unknown;
  reason_code: string;
  reason: string;
  created_at: string;
}

/** Постгресовые коды, которые отображаются в доменные ошибки. */
const PG_UNIQUE_VIOLATION = "23505";

function toCheckpoint(row: CheckpointRow): LayoutCheckpoint {
  return {
    checkpointId: row.checkpoint_id,
    documentId: row.document_id,
    document: row.content as LayoutDocument,
    reasonCode: row.reason_code,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export class SupabaseLayoutRepository implements LayoutDraftStorePort {
  constructor(private readonly client: LayoutSupabaseClient) {}

  /**
   * Находит внутренний uuid строки по каноническому documentId движка.
   * Отсутствие строки неотличимо от «нет доступа» — так и задумано: RLS не
   * должен подсказывать, что чужой документ существует.
   */
  private async resolveDocument(documentId: string): Promise<DocumentRow | null> {
    const { data, error } = await this.client
      .from("layout_documents")
      .select("id, project_id, document_id, title, draft")
      .eq("document_id", documentId)
      .maybeSingle();
    if (error) throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", error.message);
    return (data as DocumentRow | null) ?? null;
  }

  private async requireDocument(documentId: string): Promise<DocumentRow> {
    const row = await this.resolveDocument(documentId);
    if (!row) {
      throw new LayoutRepositoryError("DOCUMENT_NOT_FOUND", "Планировка не найдена");
    }
    return row;
  }

  /**
   * Создаёт планировку и привязывает её к проекту. Метода нет в локальном
   * хранилище: там документ приходит из фикстуры и владельца не имеет.
   */
  async createDocument(
    projectId: string,
    document: LayoutDocument,
    title: string,
  ): Promise<void> {
    const validation = validateLayoutDocument(document);
    if (!validation.valid) {
      throw new LayoutRepositoryError(
        "DOCUMENT_SCHEMA_INVALID",
        "Невалидную планировку нельзя сохранить",
      );
    }
    const { error } = await this.client.from("layout_documents").insert({
      project_id: projectId,
      document_id: document.documentId,
      title,
      draft: document,
    });
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        throw new LayoutRepositoryError("DOCUMENT_EXISTS", "Планировка с таким id уже есть");
      }
      throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", error.message);
    }
  }

  /**
   * Сохранить черновик с защитой от потери чужих правок.
   *
   * Условие «ревизия в базе = ожидаемая» проверяется НЕ отдельным запросом, а
   * фильтром самого UPDATE. Иначе между чтением и записью помещается правка из
   * другой вкладки, и она молча пропадает. Пустой результат = кто-то успел
   * раньше.
   */
  async saveDraft(document: LayoutDocument, expectedRevision: number | null): Promise<void> {
    const row = await this.requireDocument(document.documentId);
    const patch = { draft: document, updated_at: new Date().toISOString() };

    if (expectedRevision === null) {
      const { error } = await this.client
        .from("layout_documents")
        .update(patch)
        .eq("id", row.id);
      if (error) throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", error.message);
      return;
    }

    const { data, error } = await this.client
      .from("layout_documents")
      .update(patch)
      .eq("id", row.id)
      // ->> отдаёт текст, поэтому сравнение со строкой.
      .eq("draft->>stateRevision", String(expectedRevision))
      .select("id");
    if (error) throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", error.message);
    if (!data || (data as unknown[]).length === 0) {
      throw new LayoutRepositoryError(
        "STATE_STALE",
        "Черновик основан на устаревшей ревизии документа",
      );
    }
  }

  /**
   * Вернуть черновик к состоянию чекпойнта. Ревизия растёт, а не откатывается:
   * восстановление — это ещё одна правка, иначе защита от устаревшей ревизии
   * начала бы конфликтовать сама с собой.
   */
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
      throw new LayoutRepositoryError(
        "STATE_STALE",
        "Восстановление основано на устаревшей ревизии документа",
      );
    }

    const restored = structuredClone(checkpoint.document);
    restored.stateRevision = current.stateRevision + 1;
    await this.saveDraft(restored, expectedRevision);
    return restored;
  }

  async loadDraft(documentId: string): Promise<LayoutDocument | null> {
    const row = await this.resolveDocument(documentId);
    return row ? (row.draft as LayoutDocument) : null;
  }

  async createCheckpoint(
    document: LayoutDocument,
    input: CheckpointInput,
  ): Promise<LayoutCheckpoint> {
    const row = await this.requireDocument(document.documentId);
    const { data, error } = await this.client
      .from("layout_checkpoints")
      .insert({
        checkpoint_id: input.checkpointId,
        layout_document_id: row.id,
        document_id: document.documentId,
        content: document,
        reason_code: input.reasonCode,
        reason: input.reason,
        created_at: input.createdAt,
      })
      .select("checkpoint_id, document_id, content, reason_code, reason, created_at")
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        throw new LayoutRepositoryError("CHECKPOINT_IMMUTABLE", "Checkpoint уже существует");
      }
      throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", error.message);
    }
    return toCheckpoint(data as CheckpointRow);
  }

  async loadCheckpoint(checkpointId: string): Promise<LayoutCheckpoint | null> {
    const { data, error } = await this.client
      .from("layout_checkpoints")
      .select("checkpoint_id, document_id, content, reason_code, reason, created_at")
      .eq("checkpoint_id", checkpointId)
      .maybeSingle();
    if (error) throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", error.message);
    return data ? toCheckpoint(data as CheckpointRow) : null;
  }

  async listCheckpoints(documentId: string): Promise<LayoutCheckpoint[]> {
    const { data, error } = await this.client
      .from("layout_checkpoints")
      .select("checkpoint_id, document_id, content, reason_code, reason, created_at")
      .eq("document_id", documentId)
      .order("created_at", { ascending: true });
    if (error) throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", error.message);
    return ((data as CheckpointRow[]) ?? []).map(toCheckpoint);
  }
}
