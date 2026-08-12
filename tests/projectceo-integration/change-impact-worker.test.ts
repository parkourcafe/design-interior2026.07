import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import {
  changeImpactIdempotencyKey,
  planChangeImpactWork,
  ChangeImpactPlanError,
  type ChangeImpactBacklogRow,
} from "../../lib/project-intelligence/workers/change-impact/planner";
import { runChangeImpactWorker } from "../../lib/project-intelligence/workers/change-impact/runner";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333";
const changeRequestId = "44444444-4444-4444-8444-444444444444";

const policy = {
  version: "project-ceo-impact-policy/0.1",
  maxDepth: 8,
  maxImpacts: 5000,
} as const;

function row(overrides: Partial<ChangeImpactBacklogRow> = {}): ChangeImpactBacklogRow {
  return {
    organizationId,
    projectId,
    packageId,
    changeRequestId,
    proposedBaselineId: "baseline-v2",
    rootCount: 3,
    stateRevision: 9,
    ...overrides,
  };
}

function envelope(rows: readonly ChangeImpactBacklogRow[]) {
  return {
    contractVersion: "project-ceo-impact-worker/0.1",
    requestId: "db:test",
    policy,
    data: rows,
    error: null,
  };
}

interface Call {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * Отказ в той форме, в какой его отдаёт `_raise`: причина живёт в DETAIL.
 * `P1110` — «переход невозможен» (например, прогон уже посчитан), `P1111` —
 * отказ валидации.
 */
function refusal(reason: string, sqlstate = "P1111") {
  return {
    code: sqlstate,
    message: "validation_failed",
    details: JSON.stringify({ reason }),
  };
}

/**
 * Клиент, моделирующий поведение базы, а не желаемое: повтор по тому же ключу
 * идемпотентности возвращается как `replay` — ровно так, как это делает
 * `calculate_change_impact` под обёрткой `20260812010000`.
 */
function fakeClient(
  calls: Call[],
  options: {
    readonly rows?: readonly ChangeImpactBacklogRow[];
    readonly failWith?: { readonly code: string; readonly message: string; readonly details?: string };
    readonly truncation?: "depth_limit" | "result_limit";
    readonly store?: Set<string>;
  } = {},
): PostgresRpcClient {
  const store = options.store ?? new Set<string>();
  return {
    schema: () => ({
      rpc: async (functionName: string, args: Readonly<Record<string, unknown>>) => {
        calls.push({ name: functionName, args });
        if (functionName === "list_change_impact_backlog") {
          return { data: envelope(options.rows ?? [row()]), error: null };
        }
        if (functionName === "calculate_change_impact_policy_bound") {
          if (options.failWith) {
            return { data: null, error: options.failWith };
          }
          const key = String(args.idempotency_key);
          const replay = store.has(key);
          if (!replay) store.add(key);
          return {
            data: {
              operation: "calculate_change_impact",
              replay,
              stateRevision: 10,
              result: {
                id: "impact-run-1",
                isTruncated: options.truncation !== undefined,
                truncationReason: options.truncation ?? null,
              },
            },
            error: null,
          };
        }
        throw new Error(`unexpected rpc ${functionName}`);
      },
    }),
  } as unknown as PostgresRpcClient;
}

describe("change impact worker — determinism", () => {
  /**
   * Ключ намеренно НЕ включает ревизию состояния: повтор после потери ответа
   * обязан попасть в тот же ключ, даже если состояние успело сдвинуться.
   */
  it("keeps the idempotency key independent of the state revision", () => {
    expect(changeImpactIdempotencyKey(row({ stateRevision: 9 })))
      .toBe(changeImpactIdempotencyKey(row({ stateRevision: 42 })));
  });

  it("keeps the key inside the database limit", () => {
    expect(changeImpactIdempotencyKey(row()).length).toBeLessThanOrEqual(512);
  });

  it("separates change requests", () => {
    expect(changeImpactIdempotencyKey(row())).not.toBe(
      changeImpactIdempotencyKey(row({
        changeRequestId: "55555555-5555-4555-8555-555555555555",
      })),
    );
  });

  it("refuses a backlog that returned one change request twice", () => {
    expect(() => planChangeImpactWork([row(), row()]))
      .toThrow(ChangeImpactPlanError);
  });

  it("carries the root count so an empty impact is explainable", () => {
    const [item] = planChangeImpactWork([row({ rootCount: 0 })]);
    expect(item?.rootCount).toBe(0);
  });
});

describe("change impact worker — a single pass", () => {
  it("is a safe no-op on an empty queue", async () => {
    const calls: Call[] = [];
    const result = await runChangeImpactWorker({
      client: fakeClient(calls, { rows: [] }),
    });
    expect(result).toMatchObject({ scanned: 0, calculated: 0, needsAttention: 0 });
    // Главное здесь — тишина в записи: пустая очередь не трогает базу.
    expect(calls.map((call) => call.name)).toEqual(["list_change_impact_backlog"]);
  });

  it("calculates a missing impact under the system identity", async () => {
    const calls: Call[] = [];
    const result = await runChangeImpactWorker({ client: fakeClient(calls) });
    expect(result).toMatchObject({ scanned: 1, calculated: 1, needsAttention: 0 });
    const call = calls.find(
      (entry) => entry.name === "calculate_change_impact_policy_bound",
    );
    expect(call?.args).toMatchObject({
      project_id: projectId,
      change_request_id: changeRequestId,
      idempotency_key: changeImpactIdempotencyKey(row()),
    });
    // Ни организации, ни актора в аргументах: их выводит база, а не воркер.
    expect(call?.args).not.toHaveProperty("organization_id");
    expect(call?.args).not.toHaveProperty("actor_id");
    // И — главное отличие этой двери от прежней — глубины обхода тоже нет.
    // Пока она была аргументом, два воркера с разными числами давали разный
    // результат на одном графе.
    expect(call?.args).not.toHaveProperty("max_depth");
  });

  it("reports the policy it computed under", async () => {
    const result = await runChangeImpactWorker({ client: fakeClient([]) });
    // Без этого по логу нельзя сказать, каким правилом считали старые прогоны.
    expect(result.policy).toEqual(policy);
  });

  /**
   * Два прогона подряд — модель потерянного ответа: ключ тот же, второй вызов
   * обязан вернуть прежний прогон, а не завести второй.
   */
  it("does not duplicate on a repeat run", async () => {
    const store = new Set<string>();
    const calls: Call[] = [];
    const first = await runChangeImpactWorker({ client: fakeClient(calls, { store }) });
    const second = await runChangeImpactWorker({ client: fakeClient(calls, { store }) });
    expect(first.calculated).toBe(1);
    expect(second.calculated).toBe(0);
    expect(second.alreadyPresent).toBe(1);
    expect(store.size).toBe(1);
  });

  it("treats a concurrent winner as done, not as a failure", async () => {
    const result = await runChangeImpactWorker({
      client: fakeClient([], {
        failWith: { code: "P1108", message: "idempotency_conflict" },
      }),
    });
    expect(result).toMatchObject({ scanned: 1, calculated: 0, alreadyPresent: 1 });
    expect(result.needsAttention).toBe(0);
  });

  /**
   * Второй способ проиграть гонку: сосед успел записать прогон, и делегат
   * отвечает `IMPACT_ALREADY_CALCULATED`. Тот же `P1111`, что у отказов, —
   * различает их только причина.
   */
  it("reads IMPACT_ALREADY_CALCULATED as done", async () => {
    const result = await runChangeImpactWorker({
      client: fakeClient([], {
        failWith: refusal("IMPACT_ALREADY_CALCULATED", "P1110"),
      }),
    });
    expect(result).toMatchObject({ alreadyPresent: 1, needsAttention: 0 });
  });

  it("reports stale state instead of computing against a moved snapshot", async () => {
    const result = await runChangeImpactWorker({
      client: fakeClient([], {
        failWith: { code: "P1107", message: "stale_state" },
      }),
    });
    expect(result).toMatchObject({ scanned: 1, calculated: 0, staleState: 1 });
    // Гонка — не повод звать человека: следующий проход доберёт заявку.
    expect(result.needsAttention).toBe(0);
  });
});

describe("change impact worker — an incomplete run still needs a human", () => {
  /**
   * Решение владельца от 12.08.2026: граница больше не отказ, а частичный
   * результат с признаком. Для воркера это НЕ «посчитано и свободен»: закрыть
   * такой прогон без подтверждения архитектора нельзя, значит человек нужен, и
   * проход обязан это назвать.
   */
  it("counts a depth-truncated run as needing a human", async () => {
    const result = await runChangeImpactWorker({
      client: fakeClient([], { truncation: "depth_limit" }),
    });
    expect(result).toMatchObject({
      scanned: 1,
      calculated: 0,
      calculatedTruncated: 1,
      needsAttention: 1,
    });
    expect(result.items[0]?.truncationReason).toBe("depth_limit");
  });

  it("counts a result-limited run the same way", async () => {
    const result = await runChangeImpactWorker({
      client: fakeClient([], { truncation: "result_limit" }),
    });
    expect(result).toMatchObject({ calculatedTruncated: 1, needsAttention: 1 });
    expect(result.items[0]?.truncationReason).toBe("result_limit");
  });

  it("leaves a complete run out of the attention count", async () => {
    const result = await runChangeImpactWorker({ client: fakeClient([]) });
    expect(result).toMatchObject({
      calculated: 1,
      calculatedTruncated: 0,
      needsAttention: 0,
    });
    expect(result.items[0]?.truncationReason).toBeNull();
  });

  /**
   * Очередь намеренно не фильтрует заявки со сломанным baseline: фильтр значил
   * бы, что такая строка не всплывёт никогда. Всплывает она здесь.
   */
  it("surfaces a change request whose baseline does not resolve", async () => {
    const result = await runChangeImpactWorker({
      client: fakeClient([], {
        failWith: { code: "P1104", message: "not_found" },
      }),
    });
    expect(result).toMatchObject({ unresolved: 1, needsAttention: 1 });
  });

  it("does not swallow a refusal it was never taught", async () => {
    // Незнакомая причина — не «нормальный исход гонки». Тихо посчитать её
    // готовой значило бы отчитаться об успехе прохода, которого не было.
    await expect(runChangeImpactWorker({
      client: fakeClient([], { failWith: refusal("SOME_FUTURE_REASON") }),
    })).rejects.toThrow();
  });

  it("keeps working past a refusal instead of stopping the queue", async () => {
    // Один сломанный элемент не имеет отношения к остальным: остановка
    // означала бы, что одна заявка держит очередь целиком.
    const other = "66666666-6666-4666-8666-666666666666";
    const calls: Call[] = [];
    const client = {
      schema: () => ({
        rpc: async (functionName: string, args: Readonly<Record<string, unknown>>) => {
          calls.push({ name: functionName, args });
          if (functionName === "list_change_impact_backlog") {
            return {
              data: envelope([row(), row({ changeRequestId: other })]),
              error: null,
            };
          }
          if (args.change_request_id === changeRequestId) {
            return { data: null, error: { code: "P1104", message: "not_found" } };
          }
          return {
            data: {
              operation: "calculate_change_impact",
              replay: false,
              stateRevision: 10,
              result: { id: "impact-run-2", isTruncated: false, truncationReason: null },
            },
            error: null,
          };
        },
      }),
    } as unknown as PostgresRpcClient;

    const result = await runChangeImpactWorker({ client });
    expect(result).toMatchObject({ scanned: 2, calculated: 1, unresolved: 1 });
  });

  it("fails loudly when the backlog envelope breaks its contract", async () => {
    const client = {
      schema: () => ({
        rpc: async () => ({ data: { contractVersion: "wrong" }, error: null }),
      }),
    } as unknown as PostgresRpcClient;
    // Нечитаемая очередь — это не пустая очередь: молчаливый ноль заданий
    // отчитался бы «работы нет».
    await expect(runChangeImpactWorker({ client })).rejects.toThrow();
  });
});
