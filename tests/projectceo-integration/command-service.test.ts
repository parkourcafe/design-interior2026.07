import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import { ProjectCeoCommandService } from "../../lib/project-intelligence/delivery/projectceo/command-service";
import type { ProjectCeoCommand } from "../../lib/project-intelligence/delivery/projectceo/command-contract";

const projectId = "11111111-1111-4111-8111-111111111111";
const packageA = "22222222-2222-4222-8222-222222222222";
const packageB = "33333333-3333-4333-8333-333333333333";
const baseline1 = "baseline-v1";
const baseline2 = "baseline-v2";

function foundation(data: unknown) {
  return {
    contractVersion: "project-ceo-foundation/0.1",
    requestId: "db:test",
    data,
    error: null,
  };
}

function fakeClient(
  calls: { readonly functionName: string; readonly args: Readonly<Record<string, unknown>> }[],
  projectEntries: readonly Readonly<Record<string, unknown>>[] = [{
    accessScope: "project",
    organizationId: "44444444-4444-4444-8444-444444444444",
    projectId,
    role: "owner_lead",
    stateRevision: 9,
  }],
): PostgresRpcClient {
  const replays = new Set<string>();
  return {
    schema: (schemaName) => ({
      rpc: async (functionName, args = {}) => {
        calls.push({ functionName: `${schemaName}.${functionName}`, args });
        if (schemaName === "projectceo_api" && functionName === "list_projects") {
          return { data: foundation(projectEntries), error: null };
        }
        if (schemaName === "projectceo_api" && functionName === "get_project_delivery") {
          return { data: foundation({
            projectId,
            package: null,
            latestBaseline: { id: baseline2, versionNo: 2 },
            packageVersions: [
              { id: "package-a-v1", packageId: packageA, baselineId: baseline1, versionNo: 1 },
              { id: "package-b-v1", packageId: packageB, baselineId: baseline1, versionNo: 1 },
            ],
            releaseArtifacts: [],
            distributions: [],
            acknowledgements: [],
            noChangeTerminals: [],
            unresolvedImpactReviewCount: 0,
            extensionStatus: {},
          }), error: null };
        }
        if (schemaName === "projectceo_m4_api" && functionName === "replay_submit_change_request") {
          const key = String(args.idempotency_key);
          return { data: replays.has(key) ? {
            operation: "submit_change_request",
            replay: true,
            stateRevision: 10,
            result: { id: "55555555-5555-4555-8555-555555555555" },
          } : null, error: null };
        }
        if (schemaName === "projectceo_m4_api" && functionName === "submit_change_request") {
          const key = String(args.idempotency_key);
          const replay = replays.has(key);
          replays.add(key);
          return { data: {
            operation: "submit_change_request",
            replay,
            stateRevision: 10,
            result: { id: "55555555-5555-4555-8555-555555555555" },
          }, error: null };
        }
        return { data: null, error: { code: "P1104", message: "not_found" } };
      },
    }),
  };
}

function changeCommand(target: string): ProjectCeoCommand {
  return {
    contractVersion: "projectceo-command/0.1",
    commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "create_change",
    projectId,
    payload: {
      reason: "Изменён материал покрытия",
      fromProductionPackageVersionId: target,
      deltaCostRub: 120000,
      deltaDays: 2,
    },
  };
}

describe("ProjectCEO command service", () => {
  it("returns a typed unavailable result before any partial invitation write when the token secret is absent", async () => {
    const calls: { readonly functionName: string; readonly args: Readonly<Record<string, unknown>> }[] = [];
    const service = new ProjectCeoCommandService({ client: fakeClient(calls), executionEnabled: "true" });
    const result = await service.execute({
      contractVersion: "projectceo-command/0.1",
      commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: "create_invitation",
      projectId,
      payload: {
        recipientEmail: "architect@example.test",
        targetRole: "architect",
        expiresAt: "2026-07-25T00:00:00.000Z",
      },
    }, "invite-unavailable");

    expect(result).toMatchObject({
      status: "unavailable",
      error: { code: "operation_unavailable" },
    });
    expect(calls).toEqual([]);
  });

  it("keeps a stable DB idempotency key for an exact HTTP retry", async () => {
    const calls: { readonly functionName: string; readonly args: Readonly<Record<string, unknown>> }[] = [];
    const service = new ProjectCeoCommandService({ client: fakeClient(calls), executionEnabled: "true" });
    const first = await service.execute(changeCommand("package-a-v1"), "http-1");
    const retry = await service.execute(changeCommand("package-a-v1"), "http-2");
    expect(first.status).toBe("completed");
    expect(retry).toMatchObject({ status: "completed", replay: true });
    const mutations = calls.filter((call) => call.functionName === "projectceo_m4_api.submit_change_request");
    const replayProbes = calls.filter((call) => call.functionName === "projectceo_m4_api.replay_submit_change_request");
    expect(mutations).toHaveLength(1);
    expect(replayProbes).toHaveLength(2);
    expect(mutations[0]?.args.idempotency_key).toBe(replayProbes[1]?.args.idempotency_key);
    expect(mutations[0]?.args.idempotency_key).toBe(
      `ui:${projectId}:create_change:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    );
  });

  it("derives the exact package from the selected version and rejects a sibling/unknown target", async () => {
    const calls: { readonly functionName: string; readonly args: Readonly<Record<string, unknown>> }[] = [];
    const service = new ProjectCeoCommandService({ client: fakeClient(calls), executionEnabled: "true" });
    const accepted = await service.execute(changeCommand("package-a-v1"), "accepted");
    expect(accepted.status).toBe("completed");
    expect(calls.find((call) => call.functionName === "projectceo_m4_api.submit_change_request")?.args)
      .toMatchObject({ package_id: packageA, from_baseline_id: baseline1, proposed_baseline_id: baseline2 });

    const before = calls.filter((call) => call.functionName === "projectceo_m4_api.submit_change_request").length;
    const rejected = await service.execute(changeCommand("sibling-not-in-delivery"), "rejected");
    expect(rejected).toMatchObject({ status: "error", error: { code: "scope_conflict" } });
    expect(calls.filter((call) => call.functionName === "projectceo_m4_api.submit_change_request")).toHaveLength(before);
  });

  it("fails closed for ambiguous sibling package grants", async () => {
    const calls: { readonly functionName: string; readonly args: Readonly<Record<string, unknown>> }[] = [];
    const service = new ProjectCeoCommandService({
      client: fakeClient(calls, [
        {
          accessScope: "package",
          organizationId: "44444444-4444-4444-8444-444444444444",
          projectId,
          packageId: packageA,
          role: "architect",
          stateRevision: 9,
        },
        {
          accessScope: "package",
          organizationId: "44444444-4444-4444-8444-444444444444",
          projectId,
          packageId: packageB,
          role: "builder",
          stateRevision: 9,
        },
      ]),
      executionEnabled: "true",
    });
    const result = await service.execute(changeCommand("package-a-v1"), "ambiguous");
    expect(result).toMatchObject({ status: "error", error: { code: "scope_conflict" } });
    expect(calls.some((call) => call.functionName.endsWith("get_project_delivery"))).toBe(false);
  });
});
