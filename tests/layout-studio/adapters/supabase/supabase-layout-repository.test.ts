import { beforeEach, describe, expect, it } from "vitest";

import {
  LayoutRepositoryError,
  MemoryLayoutRepository,
} from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import { SupabaseLayoutRepository } from "@/lib/layout-studio/adapters/supabase/supabase-layout-repository";
import type { LayoutDocument } from "@/lib/layout-studio/domain";
import fixture from "@/fixtures/layout-studio/simple-room.v0.1.json";

const BASE = fixture as unknown as LayoutDocument;

/**
 * Поддельный PostgREST ровно в том объёме, которым пользуется хранилище.
 *
 * Он НЕ изображает RLS: изоляция между дизайнерами живёт в политиках базы и
 * проверена отдельно, прогоном по живому PostgreSQL (DB_STORAGE_VERIFICATION_
 * 2026-08-08.md). Здесь проверяется другое — что серверное хранилище отдаёт
 * те же ошибки и те же данные, что локальное, чтобы редактор не зависел от
 * того, где лежит документ.
 *
 * Уникальные ключи он изображает честно: именно на них держатся
 * VERSION_IMMUTABLE и CHECKPOINT_IMMUTABLE.
 */
const PRIMARY_KEY: Record<string, string> = {
  layout_documents: "document_id",
  layout_checkpoints: "checkpoint_id",
  layout_versions: "version_id",
};

class FakePostgrest {
  readonly tables: Record<string, Record<string, unknown>[]> = {
    layout_documents: [],
    layout_checkpoints: [],
    layout_versions: [],
  };

  from(table: string) {
    const rows = this.tables[table];
    if (!rows) throw new Error(`неизвестная таблица ${table}`);
    const self = this;

    const query = {
      _filters: [] as Array<[string, unknown]>,
      _orders: [] as Array<{ column: string; ascending: boolean }>,
      _pending: null as null | { kind: "insert" | "update"; payload: Record<string, unknown> },

      select() {
        return query;
      },
      eq(column: string, value: unknown) {
        query._filters.push([column, value]);
        return query;
      },
      order(column: string, options?: { ascending?: boolean }) {
        query._orders.push({ column, ascending: options?.ascending !== false });
        return query;
      },
      insert(payload: Record<string, unknown>) {
        query._pending = { kind: "insert", payload };
        return query;
      },
      update(payload: Record<string, unknown>) {
        query._pending = { kind: "update", payload };
        return query;
      },

      _matched() {
        return rows.filter((row) =>
          query._filters.every(([column, value]) => row[column] === value),
        );
      },

      _commit() {
        const pending = query._pending;
        if (!pending) return { data: null, error: null };
        if (pending.kind === "insert") {
          const key = PRIMARY_KEY[table] ?? "id";
          const keyValue = pending.payload[key];
          if (rows.some((row) => row[key] === keyValue)) {
            return { data: null, error: { code: "23505", message: `duplicate ${key}` } };
          }
          if (
            table === "layout_versions" &&
            pending.payload.parent_version_id &&
            !rows.some((row) => row.version_id === pending.payload.parent_version_id)
          ) {
            return { data: null, error: { code: "23503", message: "parent missing" } };
          }
          const row = { id: `row-${rows.length + 1}`, ...pending.payload };
          rows.push(row);
          return { data: row, error: null };
        }
        const target = query._matched();
        target.forEach((row) => Object.assign(row, pending.payload));
        return { data: target[0] ?? null, error: null };
      },

      async maybeSingle() {
        return { data: query._matched()[0] ?? null, error: null };
      },
      async single() {
        const result = query._pending ? query._commit() : { data: query._matched()[0] ?? null, error: null };
        if (result.error) return result;
        if (!result.data) return { data: null, error: { code: "PGRST116", message: "no rows" } };
        return result;
      },
      // Запрос без maybeSingle()/single() — список или голая запись.
      then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
        if (query._pending) return resolve(query._commit());
        const matched = [...query._matched()].sort((left, right) => {
          for (const { column, ascending } of query._orders) {
            const a = String(left[column] ?? "");
            const b = String(right[column] ?? "");
            if (a !== b) return ascending ? a.localeCompare(b) : b.localeCompare(a);
          }
          return 0;
        });
        return resolve({ data: matched, error: null });
      },
    };

    void self;
    return query;
  }
}

function withId(document: LayoutDocument, documentId: string): LayoutDocument {
  return { ...structuredClone(document), documentId };
}

async function seeded() {
  const fake = new FakePostgrest();
  const repository = new SupabaseLayoutRepository(fake);
  await repository.createDocument("project-1", BASE, "Простая комната");
  return { fake, repository };
}

const publication = {
  authorType: "human",
  reasonCode: "OWNER_CHECKPOINT",
  reason: "Публикация",
  createdAt: "2026-08-08T10:00:00.000Z",
  warnings: [],
};

describe("SupabaseLayoutRepository: контракт совпадает с локальным хранилищем", () => {
  let repository: SupabaseLayoutRepository;

  beforeEach(async () => {
    repository = (await seeded()).repository;
  });

  it("сохраняет и читает черновик", async () => {
    const edited = { ...structuredClone(BASE), stateRevision: BASE.stateRevision + 1 };
    await repository.saveDraft(edited, null);

    const loaded = await repository.loadDraft(BASE.documentId);
    expect(loaded?.stateRevision).toBe(BASE.stateRevision + 1);
  });

  it("не выдаёт черновик несуществующей планировки", async () => {
    expect(await repository.loadDraft("layout.does-not-exist")).toBeNull();
  });

  it("отказывается писать в планировку, которой нет", async () => {
    await expect(repository.saveDraft(withId(BASE, "layout.other"), null)).rejects.toThrow(
      LayoutRepositoryError,
    );
  });

  it("публикует версию и считает семантический хеш на сервере", async () => {
    const version = await repository.publishVersion(BASE, {
      versionId: "version.1",
      ...publication,
    });

    expect(version.versionId).toBe("version.1");
    expect(version.contractVersion).toBe("archidom.layout-version/0.1");
    expect(version.semanticHash).toMatch(/^[0-9a-f]{64}$/);

    // Тот же документ — тот же хеш, что и у локального хранилища: выгруженные
    // файлы не должны зависеть от того, где документ сохранён.
    const memory = new MemoryLayoutRepository();
    const local = await memory.publishVersion(BASE, { versionId: "version.1", ...publication });
    expect(version.semanticHash).toBe(local.semanticHash);
  });

  it("не даёт заменить опубликованную версию", async () => {
    await repository.publishVersion(BASE, { versionId: "version.1", ...publication });
    await expect(
      repository.publishVersion(BASE, { versionId: "version.1", ...publication }),
    ).rejects.toMatchObject({ code: "VERSION_IMMUTABLE" });
  });

  it("не даёт сослаться на несуществующую родительскую версию", async () => {
    await expect(
      repository.publishVersion(BASE, {
        versionId: "version.2",
        parentVersionId: "version.missing",
        ...publication,
      }),
    ).rejects.toMatchObject({ code: "PARENT_VERSION_NOT_FOUND" });
  });

  it("не публикует документ, не проходящий замороженную схему", async () => {
    const broken = structuredClone(BASE) as unknown as Record<string, unknown>;
    broken.walls = [{ id: "wall.broken" }];
    await expect(
      repository.publishVersion(broken as unknown as LayoutDocument, {
        versionId: "version.broken",
        ...publication,
      }),
    ).rejects.toMatchObject({ code: "VERSION_SCHEMA_INVALID" });
  });

  it("не даёт переписать чекпойнт", async () => {
    const input = {
      checkpointId: "checkpoint.1",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Снимок",
      createdAt: "2026-08-08T10:00:00.000Z",
    };
    await repository.createCheckpoint(BASE, input);
    await expect(repository.createCheckpoint(BASE, input)).rejects.toMatchObject({
      code: "CHECKPOINT_IMMUTABLE",
    });
  });

  it("перечисляет версии и чекпойнты в порядке создания", async () => {
    await repository.publishVersion(BASE, {
      versionId: "version.1",
      ...publication,
      createdAt: "2026-08-08T10:00:00.000Z",
    });
    await repository.publishVersion(BASE, {
      versionId: "version.2",
      parentVersionId: "version.1",
      ...publication,
      createdAt: "2026-08-08T11:00:00.000Z",
    });

    const versions = await repository.listVersions(BASE.documentId);
    expect(versions.map((version) => version.versionId)).toEqual(["version.1", "version.2"]);
  });

  it("считает разницу между двумя версиями", async () => {
    await repository.publishVersion(BASE, { versionId: "version.1", ...publication });
    const moved = structuredClone(BASE);
    moved.floor.clearHeightMm = BASE.floor.clearHeightMm + 100;
    await repository.publishVersion(moved, {
      versionId: "version.2",
      parentVersionId: "version.1",
      ...publication,
    });

    const diff = await repository.diffVersions("version.1", "version.2");
    expect(diff.fromVersionId).toBe("version.1");
    expect(diff.toVersionId).toBe("version.2");
  });

  it("сообщает понятную ошибку, если версии для сравнения нет", async () => {
    await expect(repository.diffVersions("version.a", "version.b")).rejects.toMatchObject({
      code: "VERSION_NOT_FOUND",
    });
  });

  it("не даёт создать две планировки с одним documentId", async () => {
    const { repository: fresh } = await seeded();
    await expect(fresh.createDocument("project-1", BASE, "Дубль")).rejects.toMatchObject({
      code: "DOCUMENT_EXISTS",
    });
  });
});
