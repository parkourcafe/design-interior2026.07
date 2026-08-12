import { describe, expect, it } from "vitest";
import type {
  PostgresRpcClient,
} from "../../lib/project-intelligence/adapters/postgres/contracts";
import {
  ProjectCeoM4HumanPostgresAdapter,
  ProjectCeoM4WorkerPostgresAdapter,
} from "../../lib/project-intelligence/adapters/postgres/execution";

interface RpcCall {
  readonly schema: string;
  readonly functionName: string;
  readonly args: Readonly<Record<string, unknown>> | undefined;
}

function clientReturning(data: unknown, calls: RpcCall[]): PostgresRpcClient {
  return {
    schema(schema) {
      return {
        rpc(functionName, args) {
          calls.push({ schema, functionName, args });
          return Promise.resolve({ data, error: null });
        },
      };
    },
  };
}

function clientReturningSequence(data: readonly unknown[], calls: RpcCall[]): PostgresRpcClient {
  let index = 0;
  return {
    schema(schema) {
      return {
        rpc(functionName, args) {
          calls.push({ schema, functionName, args });
          const value = data[Math.min(index, data.length - 1)];
          index += 1;
          return Promise.resolve({ data: value, error: null });
        },
      };
    },
  };
}

describe("ProjectCEO M4 postgres adapter", () => {
  it("maps a human change request without caller-controlled security identity", async () => {
    const calls: RpcCall[] = [];
    const adapter = new ProjectCeoM4HumanPostgresAdapter(
      clientReturningSequence([null, {
        operation: "submit_change_request",
        replay: false,
        stateRevision: 10,
        result: { id: "change-request" },
      }], calls),
    );

    await adapter.submitChangeRequest({
      projectId: "project",
      packageId: "package",
      fromBaselineId: "baseline-v1",
      proposedBaselineId: "baseline-v2",
      fromProductionPackageVersionId: "package-v1",
      reason: "Client changed the floor finish",
      deltaCostRub: 125000,
      deltaDays: 3,
      expectedStateRevision: 9,
      idempotencyKey: "change-request-1",
    });

    const request = {
        project_id: "project",
        package_id: "package",
        from_baseline_id: "baseline-v1",
        proposed_baseline_id: "baseline-v2",
        from_production_package_version_id: "package-v1",
        reason: "Client changed the floor finish",
        delta_cost_rub: 125000,
        delta_days: 3,
        idempotency_key: "change-request-1",
    };
    expect(calls).toEqual([
      {
        schema: "projectceo_m4_api",
        functionName: "replay_submit_change_request",
        args: request,
      },
      {
        schema: "projectceo_m4_api",
        functionName: "submit_change_request",
        args: { ...request, expected_state_revision: 9 },
      },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(
      /organization_id|actor_id|actor_user_id|effective_role|requested_at/i,
    );
  });

  it("keeps human and worker capabilities disjoint", () => {
    const client = clientReturning(null, []);
    const human = new ProjectCeoM4HumanPostgresAdapter(client);
    const worker = new ProjectCeoM4WorkerPostgresAdapter(client);

    expect("submitChangeRequest" in human).toBe(true);
    expect("reviewChangeImpact" in human).toBe(true);
    expect("acceptMilestone" in human).toBe(true);
    expect("calculateChangeImpactPolicyBound" in human).toBe(false);
    expect("listChangeImpactBacklog" in human).toBe(false);
    expect("buildConstructionHandover" in human).toBe(false);

    expect("calculateChangeImpactPolicyBound" in worker).toBe(true);
    expect("listChangeImpactBacklog" in worker).toBe(true);
    expect("buildConstructionHandover" in worker).toBe(true);
    expect("submitChangeRequest" in worker).toBe(false);
    expect("reviewPhotoEvidence" in worker).toBe(false);
  });

  it("uses the package-scoped read RPC and validates its contract", async () => {
    const calls: RpcCall[] = [];
    const adapter = new ProjectCeoM4HumanPostgresAdapter(
      clientReturning({
        contractVersion: "project-ceo-m4-delivery/0.1",
        requestId: "db:request",
        data: {
          changeRequests: [],
          impactRuns: [],
          milestones: [],
          handoverDocuments: [],
          constructionHandovers: [],
        },
        error: null,
        scope: {
          organizationId: "11111111-1111-4111-8111-111111111111",
          projectId: "22222222-2222-4222-8222-222222222222",
          packageId: "33333333-3333-4333-8333-333333333333",
        },
        stateRevision: 20,
      }, calls),
    );

    const delivery = await adapter.getExecutionDelivery({
      projectId: "22222222-2222-4222-8222-222222222222",
      packageId: "33333333-3333-4333-8333-333333333333",
    });

    expect(delivery.stateRevision).toBe(20);
    expect(calls).toEqual([{
      schema: "projectceo_m4_api",
      functionName: "get_execution_delivery",
      args: {
        project_id: "22222222-2222-4222-8222-222222222222",
        package_id: "33333333-3333-4333-8333-333333333333",
      },
    }]);
  });

  it("maps worker impact traversal without a caller-supplied depth (DEC-033: policy-bound)", async () => {
    const calls: RpcCall[] = [];
    const adapter = new ProjectCeoM4WorkerPostgresAdapter(
      clientReturning({
        operation: "calculate_change_impact",
        replay: false,
        stateRevision: 12,
        result: { id: "impact-run" },
      }, calls),
    );

    await adapter.calculateChangeImpactPolicyBound({
      projectId: "project",
      changeRequestId: "change-request",
      expectedStateRevision: 11,
      idempotencyKey: "impact-run-1",
    });

    expect(calls).toEqual([{
      schema: "projectceo_m4_api",
      functionName: "calculate_change_impact_policy_bound",
      args: {
        project_id: "project",
        change_request_id: "change-request",
        expected_state_revision: 11,
        idempotency_key: "impact-run-1",
      },
    }]);
    expect(JSON.stringify(calls)).not.toMatch(/max_depth|max_impacts/);
  });

  it("lists the impact backlog with the caller's row limit and passes the raw envelope through", async () => {
    const calls: RpcCall[] = [];
    const envelope = {
      contractVersion: "project-ceo-impact-worker/0.1",
      requestId: "db:request",
      policy: {
        version: "project-ceo-impact-policy/0.1",
        maxDepth: 7,
        maxImpacts: 5000,
      },
      data: [],
      error: null,
    };
    const adapter = new ProjectCeoM4WorkerPostgresAdapter(
      clientReturning(envelope, calls),
    );

    const backlog = await adapter.listChangeImpactBacklog({ maxRows: 100 });

    expect(backlog).toEqual(envelope);
    expect(calls).toEqual([{
      schema: "projectceo_m4_api",
      functionName: "list_change_impact_backlog",
      args: { max_rows: 100 },
    }]);
  });
});
