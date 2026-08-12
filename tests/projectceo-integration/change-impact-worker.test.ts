import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import {
  changeImpactIdempotencyKey,
  ChangeImpactPlanError,
  planChangeImpactWork,
  type ImpactBacklogRow,
} from "../../lib/project-intelligence/workers/change-impact/planner";
import { runChangeImpactWorker } from "../../lib/project-intelligence/workers/change-impact/runner";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333";
const changeRequestId = "44444444-4444-4444-8444-444444444444";

function row(overrides: Partial<ImpactBacklogRow> = {}): ImpactBacklogRow {
  return {
    organizationId,
    projectId,
    packageId,
    changeRequestId,
    proposedBaselineId: "baseline-v1",
    rootCount: 1,
    stateRevision: 9,
    ...overrides,
  };
}

function envelope(rows: readonly ImpactBacklogRow[]) {
  return {
    contractVersion: "project-ceo-impact-worker/0.1",
    requestId: "db:test",
    policy: {
      version: "project-ceo-impact-policy/0.1",
      maxDepth: 7,
      maxImpacts: 5000,
    },
    data: rows,
    error: null,
  };
}

interface Call {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

function calculatedResult(coverageStatus: string) {
  return {
    id: "impact-run-1",
    coverageStatus,
    cutoffReason: coverageStatus === "complete" ? null : "depth_boundary",
    hasMoreBeyondDepth: coverageStatus !== "complete",
    returnedImpactCount: coverageStatus === "blocked_result_limit" ? 0 : 1,
    knownImpactCountLowerBound: coverageStatus === "blocked_result_limit" ? 5001 : 1,
    maxDepth: 7,
    maxImpacts: 5000,
    policyVersion: "project-ceo-impact-policy/0.1",
  };
}

/**
 * Клиент, моделирующий поведение базы, а не желаемое: расчёт дедуплицируется
 * по ключу идемпотентности — ровно так, как это делает
 * `calculate_change_impact_policy_bound` (`20260812010000`).
 */
function fakeClient(
  calls: Call[],
  options: {
    readonly rows?: readonly ImpactBacklogRow[];
    readonly failWith?: { readonly code: string; readonly message: string };
    readonly store?: Map<string, boolean>;
    readonly failureResponses?: readonly { readonly attemptCount: number; readonly deadLettered: boolean }[];
  } = {},
): PostgresRpcClient {
  const store = options.store ?? new Map<string, boolean>();
  let failureCallIndex = 0;
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
          if (!replay) store.set(key, true);
          return {
            data: {
              operation: "calculate_change_impact",
              replay,
              stateRevision: 10,
              result: calculatedResult("complete"),
            },
            error: null,
          };
        }
        if (functionName === "record_change_impact_worker_failure") {
          const response = options.failureResponses?.[failureCallIndex]
            ?? { attemptCount: 1, deadLettered: false };
          failureCallIndex += 1;
          return { data: response, error: null };
        }
        throw new Error(`unexpected rpc ${functionName}`);
      },
    }),
  } as unknown as PostgresRpcClient;
}

describe("change impact worker — determinism", () => {
  it("derives the idempotency key from the project and the change request only", () => {
    const first = changeImpactIdempotencyKey(row());
    expect(first).toBe(changeImpactIdempotencyKey(row()));
    expect(first.length).toBeLessThanOrEqual(512);
  });

  it("keeps the idempotency key independent of the state revision", () => {
    expect(changeImpactIdempotencyKey(row({ stateRevision: 9 })))
      .toBe(changeImpactIdempotencyKey(row({ stateRevision: 42 })));
  });

  it("separates tenants and projects that reuse the same change request id", () => {
    expect(changeImpactIdempotencyKey(row())).not.toBe(
      changeImpactIdempotencyKey(row({ projectId: "55555555-5555-4555-8555-555555555555" })),
    );
  });

  it("plans work carrying the state revision snapshot forward, not re-deriving it", () => {
    const [item] = planChangeImpactWork([row({ stateRevision: 42 })]);
    expect(item?.expectedStateRevision).toBe(42);
    expect(item?.idempotencyKey).toBe(changeImpactIdempotencyKey(row()));
  });

  it("refuses a backlog that returned one change request twice", () => {
    expect(() => planChangeImpactWork([row(), row()]))
      .toThrow(ChangeImpactPlanError);
  });
});

describe("change impact worker — a single pass", () => {
  it("is a safe no-op on an empty queue", async () => {
    const calls: Call[] = [];
    const result = await runChangeImpactWorker({
      client: fakeClient(calls, { rows: [] }),
    });
    expect(result).toMatchObject({ scanned: 0, calculated: 0, alreadyPresent: 0 });
    expect(calls.map((call) => call.name)).toEqual(["list_change_impact_backlog"]);
  });

  it("calculates a missing impact run under the system identity", async () => {
    const calls: Call[] = [];
    const result = await runChangeImpactWorker({ client: fakeClient(calls) });
    expect(result).toMatchObject({ scanned: 1, calculated: 1 });
    expect(result.items[0]).toMatchObject({ outcome: "calculated", coverageStatus: "complete" });
    const call = calls.find((entry) => entry.name === "calculate_change_impact_policy_bound");
    expect(call?.args).toMatchObject({
      project_id: projectId,
      change_request_id: changeRequestId,
      idempotency_key: changeImpactIdempotencyKey(row()),
    });
    // Ни организации, ни актора в аргументах: их выводит база, а не воркер.
    // Ни `max_depth`, ни `max_impacts`: это политика сервера, не воркера.
    expect(call?.args).not.toHaveProperty("organization_id");
    expect(call?.args).not.toHaveProperty("actor_id");
    expect(call?.args).not.toHaveProperty("max_depth");
    expect(call?.args).not.toHaveProperty("max_impacts");
  });

  /**
   * Два прогона подряд — модель потерянного ответа: ключ тот же, второй вызов
   * обязан вернуть прежний результат (replay), а не завести второй прогон.
   */
  it("does not duplicate on a repeat run", async () => {
    const store = new Map<string, boolean>();
    const calls: Call[] = [];
    const first = await runChangeImpactWorker({ client: fakeClient(calls, { store }) });
    const second = await runChangeImpactWorker({ client: fakeClient(calls, { store }) });
    expect(first.calculated).toBe(1);
    expect(second.calculated).toBe(1);
    expect(store.size).toBe(1);
  });

  it("treats a concurrent winner as done, not as a failure", async () => {
    // Сосед успел раньше и сдвинул состояние: ключ тот же, запрос другой —
    // база отвечает idempotency_conflict. Для очереди это «уже готово».
    const calls: Call[] = [];
    const result = await runChangeImpactWorker({
      client: fakeClient(calls, {
        failWith: { code: "P1108", message: "idempotency_conflict" },
      }),
    });
    expect(result).toMatchObject({ scanned: 1, calculated: 0, alreadyPresent: 1 });
  });

  it("treats an already-calculated change request as done, not as a failure", async () => {
    // Один ChangeRequest — один прогон (`m4_impact_runs_request_key`): если
    // строка `impact_runs` уже есть, RPC отвечает `unsupported_source`
    // (P1110) — семантически «уже посчитано», а не отказ воркера.
    const calls: Call[] = [];
    const result = await runChangeImpactWorker({
      client: fakeClient(calls, {
        failWith: { code: "P1110", message: "IMPACT_ALREADY_CALCULATED" },
      }),
    });
    expect(result).toMatchObject({ scanned: 1, calculated: 0, alreadyPresent: 1 });
  });

  it("reports stale state without recording a durable failure", async () => {
    const calls: Call[] = [];
    const result = await runChangeImpactWorker({
      client: fakeClient(calls, {
        failWith: { code: "P1107", message: "stale_state" },
      }),
    });
    expect(result).toMatchObject({ scanned: 1, calculated: 0, staleState: 1 });
    expect(calls.some((call) => call.name === "record_change_impact_worker_failure")).toBe(false);
  });

  it("records a durable failure on a permanently broken change request", async () => {
    const calls: Call[] = [];
    const result = await runChangeImpactWorker({
      client: fakeClient(calls, {
        failWith: { code: "P1104", message: "not_found" },
        failureResponses: [{ attemptCount: 1, deadLettered: false }],
      }),
    });
    expect(result).toMatchObject({ scanned: 1, failureRecorded: 1, deadLettered: 0 });
    const record = calls.find((entry) => entry.name === "record_change_impact_worker_failure");
    expect(record?.args).toMatchObject({
      project_id: projectId,
      change_request_id: changeRequestId,
      failure_code: "not_found",
    });
  });

  it("reports dead-letter once the server-side attempt threshold is reached", async () => {
    const calls: Call[] = [];
    const result = await runChangeImpactWorker({
      client: fakeClient(calls, {
        failWith: { code: "P1104", message: "not_found" },
        failureResponses: [{ attemptCount: 5, deadLettered: true }],
      }),
    });
    expect(result).toMatchObject({ scanned: 1, failureRecorded: 0, deadLettered: 1 });
  });

  /**
   * Один испорченный элемент очереди не блокирует остальную очередь: второе
   * задание того же прохода обрабатывается независимо от первого.
   */
  it("keeps processing the rest of the queue after one poison item", async () => {
    const secondChangeRequestId = "66666666-6666-4666-8666-666666666666";
    const calls: Call[] = [];
    let firstCallSeen = false;
    const client: PostgresRpcClient = {
      schema: () => ({
        rpc: async (functionName: string, args: Readonly<Record<string, unknown>>) => {
          calls.push({ name: functionName, args });
          if (functionName === "list_change_impact_backlog") {
            return {
              data: envelope([
                row(),
                row({ changeRequestId: secondChangeRequestId }),
              ]),
              error: null,
            };
          }
          if (functionName === "calculate_change_impact_policy_bound") {
            if (args.change_request_id === changeRequestId && !firstCallSeen) {
              firstCallSeen = true;
              return { data: null, error: { code: "P1104", message: "not_found" } };
            }
            return {
              data: {
                operation: "calculate_change_impact",
                replay: false,
                stateRevision: 10,
                result: calculatedResult("complete"),
              },
              error: null,
            };
          }
          if (functionName === "record_change_impact_worker_failure") {
            return { data: { attemptCount: 1, deadLettered: false }, error: null };
          }
          throw new Error(`unexpected rpc ${functionName}`);
        },
      }),
    } as unknown as PostgresRpcClient;

    const result = await runChangeImpactWorker({ client });
    expect(result.scanned).toBe(2);
    expect(result.failureRecorded).toBe(1);
    expect(result.calculated).toBe(1);
    expect(result.items.map((item) => item.changeRequestId)).toEqual([
      changeRequestId,
      secondChangeRequestId,
    ]);
  });

  it("fails loudly when the backlog envelope breaks its contract", async () => {
    const client = {
      schema: () => ({
        rpc: async () => ({ data: { contractVersion: "wrong" }, error: null }),
      }),
    } as unknown as PostgresRpcClient;
    await expect(runChangeImpactWorker({ client })).rejects.toThrow();
  });
});
