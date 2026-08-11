import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import {
  planReleaseArtifactWork,
  releaseArtifactId,
  releaseArtifactIdempotencyKey,
  ReleaseArtifactPlanError,
  type ReleaseBacklogRow,
} from "../../lib/project-intelligence/workers/release-artifact/planner";
import { runReleaseArtifactWorker } from "../../lib/project-intelligence/workers/release-artifact/runner";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333";
const semanticHash = `sha256:${"a".repeat(64)}` as const;

function row(overrides: Partial<ReleaseBacklogRow> = {}): ReleaseBacklogRow {
  return {
    organizationId,
    projectId,
    packageId,
    productionPackageVersionId: "package-v1",
    versionNo: 1,
    previousVersionId: null,
    baselineId: "baseline-v1",
    exactRevisionRefs: {
      sources: [],
      requirements: [],
      assumptions: [],
      decisions: ["decision-r1"],
      selections: [],
    },
    semanticHash,
    stateRevision: 9,
    ...overrides,
  };
}

function envelope(rows: readonly ReleaseBacklogRow[]) {
  return {
    contractVersion: "project-ceo-release-worker/0.1",
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
 * Клиент, моделирующий поведение базы, а не желаемое: сборка дедуплицируется по
 * ключу идемпотентности и по семантическому кортежу — ровно так, как это делает
 * `build_release_artifact` (`20260717101000`).
 */
function fakeClient(
  calls: Call[],
  options: {
    readonly rows?: readonly ReleaseBacklogRow[];
    readonly failWith?: { readonly code: string; readonly message: string };
    readonly store?: Map<string, string>;
  } = {},
): PostgresRpcClient {
  const store = options.store ?? new Map<string, string>();
  return {
    schema: () => ({
      rpc: async (functionName: string, args: Readonly<Record<string, unknown>>) => {
        calls.push({ name: functionName, args });
        if (functionName === "list_release_artifact_backlog") {
          return { data: envelope(options.rows ?? [row()]), error: null };
        }
        if (functionName === "build_release_artifact") {
          if (options.failWith) {
            return { data: null, error: options.failWith };
          }
          const key = String(args.idempotency_key);
          const artifact = args.artifact as { readonly artifactId: string };
          const replay = store.has(key);
          if (!replay) store.set(key, artifact.artifactId);
          return {
            data: {
              operation: "build_release_artifact",
              replay,
              stateRevision: 10,
              result: { kind: replay ? "existing_artifact" : "created" },
            },
            error: null,
          };
        }
        throw new Error(`unexpected rpc ${functionName}`);
      },
    }),
  } as unknown as PostgresRpcClient;
}

describe("release artifact worker — determinism", () => {
  it("derives the artifact id from the tenant, project and version only", () => {
    const first = releaseArtifactId(row());
    expect(first).toBe(releaseArtifactId(row()));
    // Ключ и идентификатор обязаны укладываться в пределы базы: artifactId —
    // 160 символов, ключ идемпотентности — 512.
    expect(first.length).toBeLessThanOrEqual(160);
    expect(releaseArtifactIdempotencyKey(row()).length).toBeLessThanOrEqual(512);
    // Длинный идентификатор версии не переполняет artifactId — ради этого он и
    // хешируется, а не склеивается.
    expect(releaseArtifactId(row({
      productionPackageVersionId: "v".repeat(160),
    })).length).toBeLessThanOrEqual(160);
  });

  it("separates tenants that reuse the same version identifier", () => {
    expect(releaseArtifactId(row())).not.toBe(
      releaseArtifactId(row({ organizationId: "44444444-4444-4444-8444-444444444444" })),
    );
    expect(releaseArtifactId(row())).not.toBe(
      releaseArtifactId(row({ projectId: "55555555-5555-4555-8555-555555555555" })),
    );
  });

  /**
   * Ключ намеренно НЕ включает ревизию состояния: повтор после потери ответа
   * обязан попасть в тот же ключ, даже если состояние успело сдвинуться.
   */
  it("keeps the idempotency key independent of the state revision", () => {
    expect(releaseArtifactIdempotencyKey(row({ stateRevision: 9 })))
      .toBe(releaseArtifactIdempotencyKey(row({ stateRevision: 42 })));
  });

  it("builds the descriptor from the frozen version, not from the clock", () => {
    const [first] = planReleaseArtifactWork([row()]);
    const [second] = planReleaseArtifactWork([row({ stateRevision: 11 })]);
    expect(first?.descriptor.semanticHash).toBe(second?.descriptor.semanticHash);
    expect(first?.descriptor.logicalContent.productionPackageSemanticHash)
      .toBe(semanticHash);
    expect(first?.descriptor.logicalContent.schemaVersion)
      .toBe("project-ceo-release/0.1");
  });

  it("refuses a backlog that returned one version twice", () => {
    expect(() => planReleaseArtifactWork([row(), row()]))
      .toThrow(ReleaseArtifactPlanError);
  });
});

describe("release artifact worker — a single pass", () => {
  it("is a safe no-op on an empty queue", async () => {
    const calls: Call[] = [];
    const result = await runReleaseArtifactWorker({
      client: fakeClient(calls, { rows: [] }),
    });
    expect(result).toMatchObject({ scanned: 0, created: 0, alreadyPresent: 0 });
    // Главное здесь — тишина в записи: пустая очередь не трогает базу.
    expect(calls.map((call) => call.name)).toEqual(["list_release_artifact_backlog"]);
  });

  it("builds a missing artifact under the system identity", async () => {
    const calls: Call[] = [];
    const result = await runReleaseArtifactWorker({ client: fakeClient(calls) });
    expect(result).toMatchObject({ scanned: 1, created: 1 });
    const build = calls.find((call) => call.name === "build_release_artifact");
    expect(build?.args).toMatchObject({
      project_id: projectId,
      idempotency_key: releaseArtifactIdempotencyKey(row()),
    });
    // Ни организации, ни актора в аргументах: их выводит база, а не воркер.
    expect(build?.args).not.toHaveProperty("organization_id");
    expect(build?.args).not.toHaveProperty("actor_id");
  });

  /**
   * Два прогона подряд — модель потерянного ответа: ключ тот же, второй вызов
   * обязан вернуть прежний артефакт, а не завести второй.
   */
  it("does not duplicate on a repeat run", async () => {
    const store = new Map<string, string>();
    const calls: Call[] = [];
    const first = await runReleaseArtifactWorker({ client: fakeClient(calls, { store }) });
    const second = await runReleaseArtifactWorker({ client: fakeClient(calls, { store }) });
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.alreadyPresent).toBe(1);
    expect(new Set(store.values()).size).toBe(1);
  });

  it("treats a concurrent winner as done, not as a failure", async () => {
    // Сосед успел раньше и сдвинул состояние: ключ тот же, запрос другой —
    // база отвечает idempotency_conflict. Для очереди это «уже готово».
    const calls: Call[] = [];
    const result = await runReleaseArtifactWorker({
      client: fakeClient(calls, {
        failWith: { code: "P1108", message: "idempotency_conflict" },
      }),
    });
    expect(result).toMatchObject({ scanned: 1, created: 0, alreadyPresent: 1 });
  });

  it("reports stale state instead of publishing against a moved snapshot", async () => {
    const calls: Call[] = [];
    const result = await runReleaseArtifactWorker({
      client: fakeClient(calls, {
        failWith: { code: "P1107", message: "stale_state" },
      }),
    });
    expect(result).toMatchObject({ scanned: 1, created: 0, staleState: 1 });
  });

  it("fails loudly when the backlog envelope breaks its contract", async () => {
    const client = {
      schema: () => ({
        rpc: async () => ({ data: { contractVersion: "wrong" }, error: null }),
      }),
    } as unknown as PostgresRpcClient;
    // Нечитаемая очередь — это не пустая очередь: молчаливый ноль заданий
    // отчитался бы «работы нет».
    await expect(runReleaseArtifactWorker({ client })).rejects.toThrow();
  });
});
