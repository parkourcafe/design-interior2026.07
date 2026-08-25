import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import {
  planSourceIngestWork,
  sourceIngestIdempotencyKey,
  SourceIngestPlanError,
  type SourceIngestBacklogRow,
} from "../../lib/project-intelligence/workers/ingest-source-graph/planner";
import { runSourceIngestWorker } from "../../lib/project-intelligence/workers/ingest-source-graph/runner";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const otherProjectId = "44444444-4444-4444-8444-444444444444";
const packageId = "33333333-3333-4333-8333-333333333333";
const logicalSourceId = `source-sha256-${"d".repeat(24)}`;

function row(overrides: Partial<SourceIngestBacklogRow> = {}): SourceIngestBacklogRow {
  return {
    organizationId,
    projectId,
    packageId,
    logicalSourceId,
    sourceRevisionId: "revision-source-1",
    stateRevision: 9,
    ...overrides,
  };
}

function envelope(rows: readonly SourceIngestBacklogRow[]) {
  return {
    contractVersion: "project-ceo-ingest-worker/0.1",
    requestId: "db:test",
    data: rows,
    error: null,
  };
}

interface Call {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * Клиент, моделирующий поведение базы, а не желаемое: ингест дедуплицируется
 * по ключу идемпотентности (реплей), каждая успешная запись двигает
 * `state_revision`, несовпадение ревизии — P1107, а запись отказа считает
 * попытки и переводит в dead_letter — ровно как `20260824180000`.
 */
function fakeClient(
  calls: Call[],
  options: {
    readonly rows?: readonly SourceIngestBacklogRow[];
    readonly failWith?: {
      readonly code: string;
      readonly message: string;
      readonly details?: string;
    };
    readonly failRecordToo?: boolean;
    readonly store?: Map<string, number>;
    readonly brokenEnvelope?: boolean;
  } = {},
): PostgresRpcClient {
  const store = options.store ?? new Map<string, number>();
  const failures = new Map<string, number>();
  const stateByProject = new Map<string, number>();
  return {
    schema: () => ({
      rpc: async (functionName: string, args: Readonly<Record<string, unknown>>) => {
        calls.push({ name: functionName, args });
        if (functionName === "list_source_ingest_backlog") {
          if (options.brokenEnvelope) {
            return { data: { nonsense: true }, error: null };
          }
          return { data: envelope(options.rows ?? [row()]), error: null };
        }
        if (functionName === "ingest_source_graph_system") {
          if (options.failWith) {
            return { data: null, error: options.failWith };
          }
          const key = String(args.idempotency_key);
          const project = String(args.project_id);
          const expected = Number(args.expected_state_revision);
          if (store.has(key)) {
            return {
              data: {
                operation: "ingest_source_graph",
                replay: true,
                stateRevision: store.get(key),
                result: {
                  ingestionId: "ingestion-1",
                  packageId,
                  sourceId: String(args.logical_source_id),
                  sourceRevisionId: "revision-source-1",
                },
              },
              error: null,
            };
          }
          const current = stateByProject.get(project)
            ?? (options.rows ?? [row()]).find(
              (candidate) => candidate.projectId === project,
            )?.stateRevision
            ?? 9;
          if (expected !== current) {
            return {
              data: null,
              error: { code: "P1107", message: "stale_state" },
            };
          }
          const next = current + 1;
          stateByProject.set(project, next);
          store.set(key, next);
          return {
            data: {
              operation: "ingest_source_graph",
              replay: false,
              stateRevision: next,
              result: {
                ingestionId: "ingestion-1",
                packageId,
                sourceId: String(args.logical_source_id),
                sourceRevisionId: "revision-source-1",
              },
            },
            error: null,
          };
        }
        if (functionName === "record_source_ingest_worker_failure") {
          if (options.failRecordToo) {
            return { data: null, error: { code: "P1112", message: "internal_error" } };
          }
          const key = `${String(args.p_project_id)}:${String(args.p_logical_source_id)}`;
          const attempts = (failures.get(key) ?? 0) + 1;
          failures.set(key, attempts);
          const dead = args.p_failure_kind === "permanent" || attempts >= 5;
          return {
            data: {
              status: dead ? "dead_letter" : "retrying",
              attemptCount: attempts,
              maxAttempts: 5,
              nextAttemptAt: dead ? null : "2026-08-24T00:00:00Z",
              deadLetteredAt: dead ? "2026-08-24T00:00:00Z" : null,
            },
            error: null,
          };
        }
        throw new Error(`unexpected rpc ${functionName}`);
      },
    }),
  } as unknown as PostgresRpcClient;
}

describe("ingest-source-graph worker — determinism", () => {
  it("выводит стабильный ключ, не зависящий от ревизии состояния", () => {
    const a = sourceIngestIdempotencyKey(row({ stateRevision: 1 }));
    const b = sourceIngestIdempotencyKey(row({ stateRevision: 999 }));
    expect(a).toBe(b);
    expect(a).toBe(`worker:ingest-source-graph:${projectId}:${logicalSourceId}`);
    expect(a.length).toBeLessThanOrEqual(512);
  });

  it("различает один и тот же файл в двух проектах", () => {
    const a = sourceIngestIdempotencyKey(row());
    const b = sourceIngestIdempotencyKey(row({ projectId: otherProjectId }));
    expect(a).not.toBe(b);
  });

  it("роняет план на дубле строки очереди", () => {
    expect(() => planSourceIngestWork([row(), row()]))
      .toThrow(SourceIngestPlanError);
    // Тот же источник в другом проекте — не дубль.
    expect(planSourceIngestWork([row(), row({ projectId: otherProjectId })]))
      .toHaveLength(2);
  });
});

describe("ingest-source-graph worker — a single pass", () => {
  it("пустая очередь — ни одного вызова записи", async () => {
    const calls: Call[] = [];
    const result = await runSourceIngestWorker({
      client: fakeClient(calls, { rows: [] }),
    });
    expect(result.scanned).toBe(0);
    expect(calls.map((call) => call.name))
      .toEqual(["list_source_ingest_backlog"]);
  });

  it("счастливый путь: snake_case аргументы, без organization_id и без содержимого", async () => {
    const calls: Call[] = [];
    const result = await runSourceIngestWorker({ client: fakeClient(calls) });
    expect(result.ingested).toBe(1);
    expect(result.needsAttention).toBe(0);
    const ingestCall = calls.find(
      (call) => call.name === "ingest_source_graph_system",
    );
    expect(ingestCall?.args).toEqual({
      project_id: projectId,
      logical_source_id: logicalSourceId,
      expected_state_revision: 9,
      idempotency_key: `worker:ingest-source-graph:${projectId}:${logicalSourceId}`,
    });
    expect(ingestCall?.args).not.toHaveProperty("organization_id");
    expect(ingestCall?.args).not.toHaveProperty("source");
    expect(ingestCall?.args).not.toHaveProperty("nodes");
  });

  it("повтор прохода — already_present, второй ингест не создаётся", async () => {
    const store = new Map<string, number>();
    const first: Call[] = [];
    await runSourceIngestWorker({ client: fakeClient(first, { store }) });
    const second: Call[] = [];
    const result = await runSourceIngestWorker({
      client: fakeClient(second, { store }),
    });
    expect(result.alreadyPresent).toBe(1);
    expect(result.ingested).toBe(0);
  });

  it("несколько источников одного проекта проходят одним проходом: ревизия несётся вперёд", async () => {
    const other = `source-sha256-${"e".repeat(24)}`;
    const calls: Call[] = [];
    const result = await runSourceIngestWorker({
      client: fakeClient(calls, {
        rows: [
          row(),
          row({ logicalSourceId: other, sourceRevisionId: "revision-source-2" }),
        ],
      }),
    });
    expect(result.ingested).toBe(2);
    expect(result.staleState).toBe(0);
    const ingestCalls = calls.filter(
      (call) => call.name === "ingest_source_graph_system",
    );
    expect(ingestCalls[0]?.args.expected_state_revision).toBe(9);
    // Вторая строка получила ревизию ПОСЛЕ первого ингеста, а не снимок
    // очереди — иначе она упёрлась бы в stale_state на ровном месте.
    expect(ingestCalls[1]?.args.expected_state_revision).toBe(10);
  });

  it("SOURCE_ALREADY_REGISTERED — успех гонки, durable-отказ не пишется", async () => {
    const calls: Call[] = [];
    const result = await runSourceIngestWorker({
      client: fakeClient(calls, {
        failWith: {
          code: "P1109",
          message: "scope_conflict",
          details: '{"reason":"SOURCE_ALREADY_REGISTERED_USE_ORIGINAL_IDEMPOTENCY_KEY"}',
        },
      }),
    });
    expect(result.alreadyPresent).toBe(1);
    expect(calls.map((call) => call.name))
      .not.toContain("record_source_ingest_worker_failure");
  });

  it("stale_state — исход гонки, не отказ", async () => {
    const calls: Call[] = [];
    const result = await runSourceIngestWorker({
      client: fakeClient(calls, {
        failWith: { code: "P1107", message: "stale_state" },
      }),
    });
    expect(result.staleState).toBe(1);
    expect(result.needsAttention).toBe(0);
    expect(calls.map((call) => call.name))
      .not.toContain("record_source_ingest_worker_failure");
  });

  it("нерасшифруемое расширение (P1110) — постоянный отказ, dead-letter сразу", async () => {
    const calls: Call[] = [];
    const result = await runSourceIngestWorker({
      client: fakeClient(calls, {
        failWith: {
          code: "P1110",
          message: "unsupported_source",
          details: '{"reason":"SOURCE_EXTENSION_UNDERIVABLE"}',
        },
      }),
    });
    expect(result.failedDeadLetter).toBe(1);
    expect(result.needsAttention).toBe(1);
    const record = calls.find(
      (call) => call.name === "record_source_ingest_worker_failure",
    );
    expect(record?.args.p_failure_kind).toBe("permanent");
    expect(record?.args.p_error_code).toBe("unsupported_source");
  });

  it("internal_error — транзиентный отказ в пределах бюджета, не dead-letter", async () => {
    const calls: Call[] = [];
    const result = await runSourceIngestWorker({
      client: fakeClient(calls, {
        failWith: { code: "P1112", message: "internal_error" },
      }),
    });
    expect(result.failedRetrying).toBe(1);
    expect(result.needsAttention).toBe(0);
    const record = calls.find(
      (call) => call.name === "record_source_ingest_worker_failure",
    );
    expect(record?.args.p_failure_kind).toBe("transient");
  });

  it("недостижимая запись отказа не роняет проход и не завышает вердикт", async () => {
    const calls: Call[] = [];
    const result = await runSourceIngestWorker({
      client: fakeClient(calls, {
        failWith: { code: "P1112", message: "internal_error" },
        failRecordToo: true,
      }),
    });
    expect(result.failedRetrying).toBe(1);
    expect(result.items[0]?.failure).toBeNull();
  });

  it("нечитаемый конверт очереди роняет весь проход", async () => {
    const calls: Call[] = [];
    await expect(
      runSourceIngestWorker({ client: fakeClient(calls, { brokenEnvelope: true }) }),
    ).rejects.toThrow();
    expect(calls.map((call) => call.name))
      .toEqual(["list_source_ingest_backlog"]);
  });
});
