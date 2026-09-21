import { describe, expect, it } from "vitest";
import type {
  PostgresRpcClient,
} from "../../lib/project-intelligence/adapters/postgres/contracts";
import {
  ProjectBrainHumanPostgresAdapter,
  ProjectBrainWorkerPostgresAdapter,
} from "../../lib/project-intelligence/adapters/postgres/project-brain";

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

const mutation = {
  operation: "append_selection_revision",
  replay: false,
  stateRevision: 17,
  result: {
    projectId: "project",
    packageId: "package",
    kind: "selection",
    nodeId: "selection",
    revisionId: "selection-r1",
    revisionNo: 1,
    replacesRevisionId: null,
  },
};

describe("ProjectCEO Product Brain postgres adapter", () => {
  it("maps an authenticated selection revision without caller actor or time", async () => {
    const calls: RpcCall[] = [];
    const adapter = new ProjectBrainHumanPostgresAdapter(
      clientReturning(mutation, calls),
    );

    await adapter.appendSelectionRevision({
      projectId: "project",
      packageId: "package",
      nodeId: "selection",
      revisionId: "selection-r1",
      expectedRevisionId: null,
      claimStatus: "human_origin",
      title: "Finish",
      areaNodeId: "area",
      decisionRevisionId: "decision-r1",
      specification: { material: "porcelain" },
      evidence: [],
      reason: "Human authored",
      expectedStateRevision: 16,
      idempotencyKey: "selection-r1",
    });

    expect(calls).toEqual([
      {
        schema: "projectceo_product_api",
        functionName: "append_selection_revision",
        args: {
          project_id: "project",
          package_id: "package",
          node_id: "selection",
          revision_id: "selection-r1",
          expected_revision_id: null,
          claim_status: "human_origin",
          title: "Finish",
          area_node_id: "area",
          decision_revision_id: "decision-r1",
          specification: { material: "porcelain" },
          evidence: [],
          reason: "Human authored",
          expected_state_revision: 16,
          idempotency_key: "selection-r1",
        },
      },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(
      /organization_id|actor_id|created_at|observed_at|published_at/i,
    );
  });

  it("keeps human and worker operations on disjoint adapters", () => {
    const client = clientReturning(null, []);
    const human = new ProjectBrainHumanPostgresAdapter(client);
    const worker = new ProjectBrainWorkerPostgresAdapter(client);

    expect("appendDecisionRevision" in human).toBe(true);
    expect("reviewApprovalPackage" in human).toBe(true);
    expect("distributeRelease" in human).toBe(true);
    expect("acknowledgeRelease" in human).toBe(true);
    expect("appendSystemDecisionRevision" in human).toBe(false);
    expect("buildReleaseArtifact" in human).toBe(false);

    expect("appendSystemDecisionRevision" in worker).toBe(true);
    expect("appendSystemSelectionRevision" in worker).toBe(true);
    expect("buildReleaseArtifact" in worker).toBe(true);
    expect("reviewApprovalPackage" in worker).toBe(false);
    expect("acknowledgeRelease" in worker).toBe(false);
  });

  it("calls the root release door without caller-owned package, refs, or hash", async () => {
    const calls: RpcCall[] = [];
    const adapter = new ProjectBrainHumanPostgresAdapter(clientReturning({
      operation: "publish_release_request_bound",
      replay: false,
      stateRevision: 18,
      result: { id: "release:root-v1", packageId: "project" },
    }, calls));

    await adapter.publishReleaseRequestBound({
      projectId: "project",
      expectedBaselineId: "baseline-v1",
      expectedPreviousVersionId: null,
      expectedStateRevision: 17,
      commandRef: "root-v1",
      idempotencyKey: "root-v1",
    });

    expect(calls).toEqual([{
      schema: "projectceo_product_api",
      functionName: "publish_release_request_bound",
      args: {
        project_id: "project",
        expected_baseline_id: "baseline-v1",
        expected_previous_version_id: null,
        expected_state_revision: 17,
        command_ref: "root-v1",
        idempotency_key: "root-v1",
      },
    }]);
  });

  it("builds only the P0 logical-json artifact through the worker schema", async () => {
    const calls: RpcCall[] = [];
    const worker = new ProjectBrainWorkerPostgresAdapter(
      clientReturning({
        operation: "build_release_artifact",
        replay: false,
        stateRevision: 25,
        result: { kind: "created" },
      }, calls),
    );

    await worker.buildReleaseArtifact({
      projectId: "project",
      artifact: {
        id: "artifact",
        productionPackageVersionId: "package-version",
        format: "logical_json",
        semanticHash: `sha256:${"a".repeat(64)}`,
      },
      expectedStateRevision: 24,
      idempotencyKey: "artifact-build",
    });

    expect(calls).toEqual([
      {
        schema: "projectceo_product_api",
        functionName: "build_release_artifact",
        args: {
          project_id: "project",
          artifact: {
            artifactId: "artifact",
            productionPackageVersionId: "package-version",
            format: "logical_json",
            semanticHash: `sha256:${"a".repeat(64)}`,
          },
          expected_state_revision: 24,
          idempotency_key: "artifact-build",
        },
      },
    ]);
  });

  it("reads delivery only through the package-scoped Foundation projection", async () => {
    const calls: RpcCall[] = [];
    const adapter = new ProjectBrainHumanPostgresAdapter(
      clientReturning({
        contractVersion: "project-ceo-foundation/0.1",
        requestId: "db:test",
        data: {
          projectId: "project",
          package: { id: "package" },
          latestBaseline: null,
          packageVersions: [],
          releaseArtifacts: [],
          distributions: [],
          acknowledgements: [],
          noChangeTerminals: [],
          unresolvedImpactReviewCount: 0,
          extensionStatus: {},
        },
        error: null,
      }, calls),
    );

    await adapter.getProjectDelivery({
      projectId: "project",
      packageId: "package",
    });

    expect(calls).toEqual([
      {
        schema: "projectceo_api",
        functionName: "get_project_delivery",
        args: {
          project_id: "project",
          package_id: "package",
        },
      },
    ]);
  });
});
