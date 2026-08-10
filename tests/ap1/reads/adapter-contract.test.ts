import { describe, expect, it } from "vitest";
import {
  ProjectCeoAuthenticatedReadPostgresAdapter,
  type PostgresRpcClient,
} from "../../../lib/project-intelligence/adapters/postgres";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333";
const actorUserId = "44444444-4444-4444-8444-444444444444";

function envelope(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    contractVersion: "project-ceo-authenticated-read/0.1",
    requestId: "db:ap1-read",
    data: {
      approvalPackages: [],
      decisions: [],
      distributionSummary: [],
      executionPackages: [],
      extensionStatus: { workspaceRead: "durable_ap1" },
      latestBaseline: null,
      m2ApprovedCommits: [],
      m2LayoutVersions: [],
      m2ClientReviewSubmissions: [],
      m2ClientReviews: [],
      m2M3Handoffs: [],
      noChangeTerminals: [],
      packages: [],
      packageVersions: [],
      projectMetadata: {
        areaM2: 1800,
        location: "Убуд",
        model: "full_project",
        name: "Kora Food Hall",
      },
      recipientDistributions: [],
      releaseArtifacts: [],
      releaseRecipients: [],
      reviewQueue: [],
      selections: [],
      sourceStats: {
        duplicateGroups: 0,
        materializedRecords: 0,
        physicalRecords: 0,
        placeholders: 0,
        quarantinedGroups: 0,
        reviewQueue: 0,
        uniqueBlobs: 0,
      },
      sources: [],
      unresolvedImpactReviewCount: 0,
      ...overrides,
    },
    error: null,
    scope: {
      accessScope: "package",
      actorUserId,
      organizationId,
      packageId,
      projectId,
    },
    stateRevision: 9,
  };
}

describe("AP1 authenticated read postgres adapter", () => {
  it("calls only the RPC-only read schema without caller authorization fields", async () => {
    const calls: Array<{
      readonly schema: string;
      readonly functionName: string;
      readonly args: Readonly<Record<string, unknown>> | undefined;
    }> = [];
    const client: PostgresRpcClient = {
      schema(schema) {
        return {
          rpc(functionName, args) {
            calls.push({ schema, functionName, args });
            return Promise.resolve({ data: envelope(), error: null });
          },
        };
      },
    };

    const result = await new ProjectCeoAuthenticatedReadPostgresAdapter(client)
      .getProjectWorkspaceRead({ projectId, packageId });

    expect(result.scope).toMatchObject({
      accessScope: "package",
      actorUserId,
      organizationId,
      packageId,
      projectId,
    });
    expect(calls).toEqual([{
      schema: "projectceo_read_api",
      functionName: "get_project_workspace_read_v7",
      args: { project_id: projectId, package_id: packageId },
    }]);
    expect(JSON.stringify(calls)).not.toMatch(/actor|organization|role|recipient/i);
  });

  it("rejects a malformed distribution projection before it reaches the UI", async () => {
    const client: PostgresRpcClient = {
      schema() {
        return {
          rpc() {
            return Promise.resolve({
              data: envelope({ recipientDistributions: { leaked: true } }),
              error: null,
            });
          },
        };
      },
    };

    await expect(
      new ProjectCeoAuthenticatedReadPostgresAdapter(client)
        .getProjectWorkspaceRead({ projectId, packageId }),
    ).rejects.toThrow("Invalid ProjectCEO authenticated read envelope");
  });
});
