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
  version: "project-ceo-impact-policy/0.2",
  maxDepth: 7,
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
interface RecordedFailureShape {
  readonly status: "retrying" | "dead_letter";
  readonly attemptCount?: number;
  readonly maxAttempts?: number;
  readonly nextAttemptAt?: string | null;
  readonly deadLetteredAt?: string | null;
}

function fakeClient(
  calls: Call[],
  options: {
    readonly rows?: readonly ChangeImpactBacklogRow[];
    readonly failWith?: { readonly code: string; readonly message: string; readonly details?: string };
    readonly truncation?: "depth_limit" | "result_limit";
    readonly store?: Set<string>;
    /** Ответ `record_change_impact_worker_failure`. По умолчанию — `retrying`. */
    readonly recordFailure?: RecordedFailureShape;
    /** Если задано — запись отказа сама недостижима (сеть упала). */
    readonly recordFailureUnreachable?: boolean;
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
        if (functionName === "record_change_impact_worker_failure") {
          if (options.recordFailureUnreachable) {
            throw new Error("network unreachable");
          }
          const record = options.recordFailure ?? { status: "retrying" as const };
          const deadLettered = record.status === "dead_letter";
          return {
            data: {
              status: record.status,
              attemptCount: record.attemptCount ?? (deadLettered ? 5 : 1),
              maxAttempts: record.maxAttempts ?? 5,
              nextAttemptAt: deadLettered
                ? null
                : record.nextAttemptAt ?? "2026-01-01T00:00:00.000Z",
              deadLetteredAt: deadLettered
                ? record.deadLetteredAt ?? "2026-01-01T00:00:00.000Z"
                : null,
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
   * Глубокое усечение (depth_limit) — нормальный, ожидаемый исход, когда
   * обход упёрся в максимальную глубину политики. Результаты были рассчитаны до
   * лимита, и прогун рассматривается успешно завершённым. Это НЕ требует
   * внимания человека — политика сделала свою работу.
   *
   * Только result_limit (ничего не сохранено из-за превышения лимита результатов)
   * требует внимания.
   */
  it("treats a depth-limited run as complete (policy limit reached normally)", async () => {
    const result = await runChangeImpactWorker({
      client: fakeClient([], { truncation: "depth_limit" }),
    });
    expect(result).toMatchObject({
      scanned: 1,
      calculated: 0,
      calculatedTruncated: 1,
      needsAttention: 0,
    });
    expect(result.items[0]?.truncationReason).toBe("depth_limit");
  });

  it("counts a result-limited run as needing a human (nothing was saved)", async () => {
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

  it("does not swallow a refusal it was never taught, but records it durably instead of crashing the pass", async () => {
    // Незнакомая причина — не «нормальный исход гонки» и (с DEC-036) больше
    // не роняет весь проход: она классифицируется как структурный (permanent)
    // отказ и уходит в durable запись, а не теряется молча и не прерывает
    // обработку остальных заявок.
    const calls: Call[] = [];
    const result = await runChangeImpactWorker({
      client: fakeClient(calls, {
        failWith: refusal("SOME_FUTURE_REASON"),
        recordFailure: { status: "dead_letter" },
      }),
    });
    expect(result).toMatchObject({ scanned: 1, calculated: 0, failedDeadLetter: 1 });
    expect(result.needsAttention).toBe(1);
    const record = calls.find((entry) => entry.name === "record_change_impact_worker_failure");
    // Незнакомый, но структурный код (validation_failed) — не транзиентный:
    // повтор с теми же входными данными не изменит исход.
    expect(record?.args).toMatchObject({ failure_kind: "permanent" });
  });

  it("records a transient failure as failed_retrying while the retry budget still has room", async () => {
    const result = await runChangeImpactWorker({
      client: fakeClient([], {
        failWith: { code: "P1199", message: "internal_error" },
        recordFailure: { status: "retrying", attemptCount: 2, maxAttempts: 5 },
      }),
    });
    expect(result).toMatchObject({ scanned: 1, failedRetrying: 1, failedDeadLetter: 0 });
    // Транзиентный отказ в пределах бюджета — ожидаемый, самовосстанавливающийся
    // исход: следующий проход доберёт его сам, как только пройдёт `next_attempt_at`.
    // Звать человека тут ещё не за что.
    expect(result.needsAttention).toBe(0);
    expect(result.items[0]?.failure).toMatchObject({ status: "retrying", attemptCount: 2 });
  });

  it("reports failed_dead_letter once the record RPC says the retry budget is exhausted", async () => {
    const result = await runChangeImpactWorker({
      client: fakeClient([], {
        failWith: { code: "P1199", message: "internal_error" },
        recordFailure: { status: "dead_letter", attemptCount: 5, maxAttempts: 5 },
      }),
    });
    expect(result).toMatchObject({ scanned: 1, failedRetrying: 0, failedDeadLetter: 1 });
    // Бюджет исчерпан — дальше без оператора (редрайва) заявка не оживёт сама.
    expect(result.needsAttention).toBe(1);
    expect(result.items[0]?.failure).toMatchObject({ status: "dead_letter", attemptCount: 5 });
  });

  it("still reports an outcome for the item when recording its failure is itself unreachable", async () => {
    // Сеть упала дважды подряд (и на расчёт, и на запись отказа) — воркер не
    // роняет проход и не выдумывает состояние базы, которого не видел: заявка
    // остаётся `failed_retrying` без durable следа до следующей попытки.
    const result = await runChangeImpactWorker({
      client: fakeClient([], {
        failWith: { code: "P1199", message: "internal_error" },
        recordFailureUnreachable: true,
      }),
    });
    expect(result).toMatchObject({ scanned: 1, failedRetrying: 1 });
    expect(result.items[0]?.failure).toBeNull();
  });

  it("reflects whatever attempt state the record RPC reports rather than counting locally", async () => {
    // Попытки живут в базе, не в памяти процесса: два независимых прохода с
    // разным ответом БД просто пересказывают то, что она сказала — «рестарт
    // воркера не сбрасывает бюджет попыток» верно постольку, поскольку сам
    // воркер никакого бюджета не считает.
    const first = await runChangeImpactWorker({
      client: fakeClient([], {
        failWith: { code: "P1199", message: "internal_error" },
        recordFailure: { status: "retrying", attemptCount: 1 },
      }),
    });
    const second = await runChangeImpactWorker({
      client: fakeClient([], {
        failWith: { code: "P1199", message: "internal_error" },
        recordFailure: { status: "retrying", attemptCount: 4 },
      }),
    });
    expect(first.items[0]?.failure?.attemptCount).toBe(1);
    expect(second.items[0]?.failure?.attemptCount).toBe(4);
  });

  it("keeps working past a refusal instead of stopping the queue, and reports both items", async () => {
    // Один сломанный (ядовитый) элемент не имеет отношения к остальным:
    // остановка означала бы, что одна заявка держит очередь целиком. Отчёт
    // обязан назвать исход КАЖДОЙ заявки прохода, а не только выживших.
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
          if (functionName === "record_change_impact_worker_failure") {
            return {
              data: {
                status: "dead_letter",
                attemptCount: 1,
                maxAttempts: 5,
                nextAttemptAt: null,
                deadLetteredAt: "2026-01-01T00:00:00.000Z",
              },
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
    // Структурный отчёт содержит исход КАЖДОЙ заявки прохода — не только той,
    // что выжила: ни одна не пропала молча.
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.changeRequestId).sort()).toEqual(
      [changeRequestId, other].sort(),
    );
    expect(
      result.items.find((item) => item.changeRequestId === changeRequestId)?.outcome,
    ).toBe("unresolved");
    expect(
      result.items.find((item) => item.changeRequestId === other)?.outcome,
    ).toBe("calculated");
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
