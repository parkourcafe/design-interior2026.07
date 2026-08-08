import {
  diffLayoutDocuments,
  semanticHash,
  validateLayoutDocument,
  type LayoutDocument,
  type LayoutDocumentDiff,
} from "@/lib/layout-studio/domain";
import type { LayoutRepositoryPort } from "@/lib/layout-studio/application/layout-repository-port";
import {
  LayoutRepositoryError,
  type CheckpointInput,
  type LayoutCheckpoint,
  type LayoutVersion,
  type VersionPublicationInput,
} from "@/lib/layout-studio/adapters/local/memory-layout-repository";

/**
 * Серверное хранилище планировок поверх Supabase.
 *
 * Контракт совпадает с MemoryLayoutRepository метод в метод и код ошибки в код
 * ошибки: редактор не должен знать, где лежит документ. Отличий два, и оба
 * намеренные.
 *
 * 1. Есть дополнительный метод createDocument: у документа появляется владелец —
 *    проект. Локальному хранилищу привязка не нужна, серверному обязательна.
 * 2. Схему и семантический хеш считает СЕРВЕР, а не вызывающий код. Иначе
 *    гарантия «опубликованная версия неизменяема и её хеш что-то значит»
 *    держалась бы на честности клиента, а клиент — браузер.
 *
 * Изоляция между дизайнерами здесь не реализуется: её обеспечивает RLS в
 * миграции 20260808050000. Клиент создаётся из cookie залогиненного
 * пользователя (lib/supabase/server), service role не используется.
 */

/** Минимальная часть клиента Supabase, которой пользуется хранилище. */
export interface LayoutSupabaseClient {
  from(table: string): any;
}

interface DocumentRow {
  id: string;
  project_id: string;
  document_id: string;
  title: string;
  draft: unknown;
  parent_version_id: string | null;
}

interface VersionRow {
  version_id: string;
  document_id: string;
  parent_version_id: string | null;
  contract_version: string;
  author_type: string;
  reason_code: string;
  reason: string;
  semantic_hash: string;
  warnings: string[] | null;
  content: unknown;
  created_at: string;
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
const PG_FOREIGN_KEY_VIOLATION = "23503";

function toVersion(row: VersionRow): LayoutVersion {
  return {
    contractVersion: "archidom.layout-version/0.1",
    versionId: row.version_id,
    documentId: row.document_id,
    parentVersionId: row.parent_version_id ?? undefined,
    authorType: row.author_type,
    reasonCode: row.reason_code,
    reason: row.reason,
    createdAt: row.created_at,
    warnings: row.warnings ?? [],
    semanticHash: row.semantic_hash,
    content: row.content as LayoutDocument,
  };
}

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

export class SupabaseLayoutRepository implements LayoutRepositoryPort {
  constructor(private readonly client: LayoutSupabaseClient) {}

  /**
   * Находит внутренний uuid строки по каноническому documentId движка.
   * Отсутствие строки неотличимо от «нет доступа» — так и задумано: RLS не
   * должен подсказывать, что чужой документ существует.
   */
  private async resolveDocument(documentId: string): Promise<DocumentRow | null> {
    const { data, error } = await this.client
      .from("layout_documents")
      .select("id, project_id, document_id, title, draft, parent_version_id")
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
      parent_version_id: null,
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

  async publishVersion(
    document: LayoutDocument,
    input: VersionPublicationInput,
  ): Promise<LayoutVersion> {
    // Порядок проверок совпадает с MemoryLayoutRepository, чтобы одинаковый
    // сценарий давал одинаковую ошибку в обоих хранилищах.
    const validation = validateLayoutDocument(document);
    if (!validation.valid) {
      throw new LayoutRepositoryError(
        "VERSION_SCHEMA_INVALID",
        "Невалидный документ нельзя опубликовать",
      );
    }
    const row = await this.requireDocument(document.documentId);

    if (input.parentVersionId) {
      const parent = await this.loadVersion(input.parentVersionId);
      if (!parent) {
        throw new LayoutRepositoryError(
          "PARENT_VERSION_NOT_FOUND",
          "Родительская версия не найдена",
        );
      }
      if (parent.documentId !== document.documentId) {
        throw new LayoutRepositoryError(
          "PARENT_DOCUMENT_MISMATCH",
          "Родительская версия относится к другому документу",
        );
      }
    }

    const { data, error } = await this.client
      .from("layout_versions")
      .insert({
        version_id: input.versionId,
        layout_document_id: row.id,
        document_id: document.documentId,
        parent_version_id: input.parentVersionId ?? null,
        contract_version: "archidom.layout-version/0.1",
        author_type: input.authorType,
        reason_code: input.reasonCode,
        reason: input.reason,
        // Хеш считает сервер: клиенту доверять нельзя, на этот хеш ссылаются
        // выгруженные файлы.
        semantic_hash: await semanticHash(document),
        warnings: input.warnings,
        content: document,
        created_at: input.createdAt,
      })
      .select(
        "version_id, document_id, parent_version_id, contract_version, author_type, reason_code, reason, semantic_hash, warnings, content, created_at",
      )
      .single();

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        throw new LayoutRepositoryError(
          "VERSION_IMMUTABLE",
          "Опубликованную версию нельзя заменить",
        );
      }
      if (error.code === PG_FOREIGN_KEY_VIOLATION) {
        throw new LayoutRepositoryError(
          "PARENT_VERSION_NOT_FOUND",
          "Родительская версия не найдена",
        );
      }
      throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", error.message);
    }

    // Черновик теперь происходит от только что опубликованной версии. Пишется
    // здесь, а не в saveDraft: saveDraft вызывается на каждую правку, и
    // происхождение там неоткуда взять.
    await this.client
      .from("layout_documents")
      .update({ parent_version_id: input.versionId })
      .eq("id", row.id);

    return toVersion(data as VersionRow);
  }

  async loadVersion(versionId: string): Promise<LayoutVersion | null> {
    const { data, error } = await this.client
      .from("layout_versions")
      .select(
        "version_id, document_id, parent_version_id, contract_version, author_type, reason_code, reason, semantic_hash, warnings, content, created_at",
      )
      .eq("version_id", versionId)
      .maybeSingle();
    if (error) throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", error.message);
    return data ? toVersion(data as VersionRow) : null;
  }

  async listVersions(documentId: string): Promise<LayoutVersion[]> {
    const { data, error } = await this.client
      .from("layout_versions")
      .select(
        "version_id, document_id, parent_version_id, contract_version, author_type, reason_code, reason, semantic_hash, warnings, content, created_at",
      )
      .eq("document_id", documentId)
      .order("created_at", { ascending: true })
      .order("version_id", { ascending: true });
    if (error) throw new LayoutRepositoryError("STORAGE_UNAVAILABLE", error.message);
    return ((data as VersionRow[]) ?? []).map(toVersion);
  }

  async diffVersions(fromVersionId: string, toVersionId: string): Promise<LayoutDocumentDiff> {
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
