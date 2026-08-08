import { beforeEach, describe, expect, it } from "vitest";

import { LayoutRepositoryError } from "@/lib/layout-studio/adapters/local/memory-layout-repository";
import { SupabaseLayoutRepository } from "@/lib/layout-studio/adapters/supabase/supabase-layout-repository";
import type { LayoutDocument } from "@/lib/layout-studio/domain";
import fixture from "@/fixtures/layout-studio/simple-room.v0.1.json";

const BASE = fixture as unknown as LayoutDocument;

/**
 * Поддельный PostgREST ровно в том объёме, которым пользуется хранилище.
 *
 * Он НЕ изображает RLS: изоляция между дизайнерами живёт в политиках базы.
 * Здесь проверяется другое — что серверное хранилище отдаёт те же ошибки и те
 * же данные, что локальное, чтобы редактор не зависел от того, где лежит
 * документ.
 *
 * Таблицы версий в подделке нет намеренно: SupabaseLayoutRepository реализует
 * только черновики и чекпойнты (LayoutDraftStorePort). Подписанные версии
 * живут в хранилище projectceo_product и проверяются его собственными тестами.
 *
 * Уникальные ключи подделка изображает честно: именно на них держится
 * CHECKPOINT_IMMUTABLE.
 */
const PRIMARY_KEY: Record<string, string> = {
  layout_documents: "document_id",
  layout_checkpoints: "checkpoint_id",
};

class FakePostgrest {
  readonly tables: Record<string, Record<string, unknown>[]> = {
    layout_documents: [],
    layout_checkpoints: [],
  };

  from(table: string) {
    const rows = this.tables[table];
    if (!rows) throw new Error(`неизвестная таблица ${table}`);

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
          query._filters.every(([column, value]) => {
            // PostgREST-фильтр по полю внутри jsonb: draft->>stateRevision.
            // Именно на нём держится защита от потери чужих правок, поэтому
            // подделка обязана его понимать, а не игнорировать.
            const jsonPath = /^(\w+)->>(\w+)$/.exec(column);
            if (jsonPath) {
              const [, field, key] = jsonPath as unknown as [string, string, string];
              const container = row[field] as Record<string, unknown> | undefined;
              return String(container?.[key]) === value;
            }
            return row[column] === value;
          }),
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
          const row = { id: `row-${rows.length + 1}`, ...pending.payload };
          rows.push(row);
          return { data: row, error: null };
        }
        const target = query._matched();
        target.forEach((row) => Object.assign(row, pending.payload));
        // UPDATE возвращает НАБОР задетых строк: пустой набор — это и есть
        // сигнал «условие не совпало, кто-то успел раньше».
        return { data: target, error: null };
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

  it("не даёт затереть чужую правку устаревшей ревизией", async () => {
    // Вкладка А и вкладка Б открыли одну планировку на ревизии N.
    const fromTabA = { ...structuredClone(BASE), stateRevision: BASE.stateRevision + 1 };
    await repository.saveDraft(fromTabA, BASE.stateRevision);

    // Вкладка Б всё ещё думает, что в базе ревизия N, и пишет поверх.
    const fromTabB = { ...structuredClone(BASE), stateRevision: BASE.stateRevision + 1 };
    await expect(repository.saveDraft(fromTabB, BASE.stateRevision)).rejects.toMatchObject({
      code: "STATE_STALE",
    });

    // Правка вкладки А на месте — она не была затёрта молча.
    const loaded = await repository.loadDraft(BASE.documentId);
    expect(loaded?.stateRevision).toBe(BASE.stateRevision + 1);
  });

  it("сохраняет без проверки, когда ревизия не заявлена", async () => {
    const edited = { ...structuredClone(BASE), stateRevision: BASE.stateRevision + 7 };
    await expect(repository.saveDraft(edited, null)).resolves.toBeUndefined();
    expect((await repository.loadDraft(BASE.documentId))?.stateRevision).toBe(
      BASE.stateRevision + 7,
    );
  });

  it("восстанавливает чекпойнт вперёд по ревизии, а не назад", async () => {
    await repository.createCheckpoint(BASE, {
      checkpointId: "checkpoint.restore",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Снимок",
      createdAt: "2026-08-08T10:00:00.000Z",
    });
    const edited = { ...structuredClone(BASE), stateRevision: BASE.stateRevision + 1 };
    await repository.saveDraft(edited, BASE.stateRevision);

    const restored = await repository.restoreCheckpoint(
      "checkpoint.restore",
      BASE.stateRevision + 1,
    );

    // Содержимое — как в снимке, а ревизия выросла: восстановление это правка,
    // а не путешествие во времени.
    expect(restored.stateRevision).toBe(BASE.stateRevision + 2);
    expect(restored.walls.length).toBe(BASE.walls.length);
  });

  it("отклоняет восстановление на устаревшей ревизии", async () => {
    await repository.createCheckpoint(BASE, {
      checkpointId: "checkpoint.stale",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Снимок",
      createdAt: "2026-08-08T10:00:00.000Z",
    });
    await expect(
      repository.restoreCheckpoint("checkpoint.stale", BASE.stateRevision + 99),
    ).rejects.toMatchObject({ code: "STATE_STALE" });
  });

  it("не выдаёт черновик несуществующей планировки", async () => {
    expect(await repository.loadDraft("layout.does-not-exist")).toBeNull();
  });

  it("отказывается писать в планировку, которой нет", async () => {
    await expect(repository.saveDraft(withId(BASE, "layout.other"), null)).rejects.toThrow(
      LayoutRepositoryError,
    );
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

  it("перечисляет чекпойнты в порядке создания", async () => {
    await repository.createCheckpoint(BASE, {
      checkpointId: "checkpoint.a",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Первый",
      createdAt: "2026-08-08T10:00:00.000Z",
    });
    await repository.createCheckpoint(BASE, {
      checkpointId: "checkpoint.b",
      reasonCode: "OWNER_CHECKPOINT",
      reason: "Второй",
      createdAt: "2026-08-08T11:00:00.000Z",
    });

    const checkpoints = await repository.listCheckpoints(BASE.documentId);
    expect(checkpoints.map((checkpoint) => checkpoint.checkpointId)).toEqual([
      "checkpoint.a",
      "checkpoint.b",
    ]);
  });

  it("не даёт создать две планировки с одним documentId", async () => {
    const { repository: fresh } = await seeded();
    await expect(fresh.createDocument("project-1", BASE, "Дубль")).rejects.toMatchObject({
      code: "DOCUMENT_EXISTS",
    });
  });
});
