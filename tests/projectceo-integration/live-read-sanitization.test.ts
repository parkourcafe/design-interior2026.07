import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import { ProjectCeoLiveReadPort } from "../../lib/project-intelligence/delivery/projectceo/live-read-port";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333";
const defaultProjectEntries = [{
  accessScope: "project",
  organizationId,
  projectId,
  role: "owner_lead",
  stateRevision: 4,
}] as const;

function foundation(data: unknown) {
  return { contractVersion: "project-ceo-foundation/0.1", requestId: "db:test", data, error: null };
}

function fakeClient(
  productOverrides: Readonly<Record<string, unknown>> = {},
  projectEntries: readonly Readonly<Record<string, unknown>>[] = defaultProjectEntries,
): PostgresRpcClient {
  return {
  schema: (schemaName) => ({
    rpc: async (functionName) => {
      if (schemaName === "projectceo_api" && functionName === "list_projects") {
        return { data: foundation(projectEntries), error: null };
      }
      if (schemaName === "projectceo_read_api" && functionName === "get_project_workspace_read_v3") {
        return { data: {
          contractVersion: "project-ceo-authenticated-read/0.1",
          requestId: "db:authenticated-read",
          data: {
            approvalPackages: [],
            decisions: [],
            distributionSummary: [],
            executionPackages: [{
              contractVersion: "project-ceo-m4-delivery/0.1",
              requestId: "db:m4",
              data: {
                changeRequests: [],
                impactRuns: [],
                milestones: [{
                  id: "55555555-5555-4555-8555-555555555555",
                  title: "Inspection",
                  acceptance: { id: "accepted", semanticHash: `sha256:${"d".repeat(64)}` },
                  areas: [
                    { areaNodeId: "area-a", photos: [] },
                    { areaNodeId: "area-b", photos: [] },
                    { areaNodeId: "area-a", photos: [] },
                  ],
                }],
                handoverDocuments: [],
                constructionHandovers: [],
              },
              error: null,
              scope: { organizationId, projectId, packageId },
              stateRevision: 4,
            }],
            extensionStatus: {},
            latestBaseline: { id: "baseline-v2", versionNo: 2, semanticHash: `sha256:${"c".repeat(64)}`, publishedAt: "2026-07-17T00:00:00Z" },
            noChangeTerminals: [],
            packages: [
              { id: "44444444-4444-4444-8444-444444444444", kind: "project_root", name: "Full project", status: "active" },
              { id: packageId, kind: "work_package", name: "Architecture", status: "active" },
            ],
            packageVersions: [],
            projectMetadata: {
              areaM2: 1800,
              location: "Убуд",
              model: "full_project",
              name: "Controlled project",
            },
            recipientDistributions: [],
            releaseArtifacts: [],
            releaseRecipients: [],
            reviewQueue: [],
            selections: [],
            sourceStats: {
              duplicateGroups: 0,
              materializedRecords: 2,
              physicalRecords: 2,
              placeholders: 0,
              quarantinedGroups: 0,
              reviewQueue: 0,
              uniqueBlobs: 2,
            },
            sources: [
              { id: "source-pdf", sourceRevisionId: "source-pdf-r1", packageId, checksum: "a".repeat(64), mediaType: "application/pdf", sourceRole: "document", documentStatus: "current", availability: "materialized", reviewStatus: "confirmed", originalFilename: "/Users/private.pdf" },
              { id: "source-archive", sourceRevisionId: "source-archive-r1", packageId, checksum: "b".repeat(64), mediaType: "application/zip", sourceRole: "document", documentStatus: "current", availability: "materialized", reviewStatus: "confirmed" },
            ],
            unresolvedImpactReviewCount: 0,
            ...productOverrides,
          },
          error: null,
          scope: {
            accessScope: "project",
            actorUserId: "66666666-6666-4666-8666-666666666666",
            organizationId,
            packageId: null,
            projectId,
          },
          stateRevision: 4,
        }, error: null };
      }
      if (schemaName === "projectceo_api" && functionName === "get_project_summary") {
        return { data: foundation({ packages: [
          { id: "44444444-4444-4444-8444-444444444444", kind: "project_root", name: "Full project", status: "active" },
          { id: packageId, kind: "work_package", name: "Architecture", status: "active" },
        ] }), error: null };
      }
      if (schemaName === "projectceo_api" && functionName === "list_project_sources") {
        return { data: foundation([
          { sourceId: "source-pdf", packageId, checksum: "a".repeat(64), mediaType: "application/pdf", sourceRole: "document", documentStatus: "current", originalFilename: "/Users/private.pdf" },
          { sourceId: "source-archive", packageId, checksum: "b".repeat(64), mediaType: "application/zip", sourceRole: "document", documentStatus: "current" },
        ]), error: null };
      }
      if (schemaName === "projectceo_api" && functionName === "get_project_delivery") {
        return { data: foundation({
          projectId,
          package: null,
          latestBaseline: { id: "baseline-v2", versionNo: 2, semanticHash: `sha256:${"c".repeat(64)}`, publishedAt: "2026-07-17T00:00:00Z" },
          packageVersions: [],
          releaseArtifacts: [],
          distributions: [],
          acknowledgements: [],
          noChangeTerminals: [],
          unresolvedImpactReviewCount: 0,
          extensionStatus: {},
          ...productOverrides,
        }), error: null };
      }
      if (schemaName === "projectceo_api" && functionName === "list_project_access") {
        return { data: foundation({ invitations: [], memberships: [], packageMemberships: [] }), error: null };
      }
      if (schemaName === "projectceo_api" && functionName === "get_audit_timeline") {
        return { data: foundation([]), error: null };
      }
      if (schemaName === "projectceo_m4_api" && functionName === "get_execution_delivery") {
        return { data: {
          contractVersion: "project-ceo-m4-delivery/0.1",
          requestId: "db:m4",
          data: {
            changeRequests: [],
            impactRuns: [],
            milestones: [{
              id: "55555555-5555-4555-8555-555555555555",
              title: "Inspection",
              acceptance: { id: "accepted", semanticHash: `sha256:${"d".repeat(64)}` },
              areas: [
                { areaNodeId: "area-a", photos: [] },
                { areaNodeId: "area-b", photos: [] },
                { areaNodeId: "area-a", photos: [] },
              ],
            }],
            handoverDocuments: [],
            constructionHandovers: [],
          },
          error: null,
          scope: { organizationId, projectId, packageId },
          stateRevision: 4,
        }, error: null };
      }
      return { data: null, error: { code: "P1104", message: "not_found" } };
    },
  }),
  };
}

const client = fakeClient();

function failingEnvelopeClient(functionToFail: string): PostgresRpcClient {
  const base = fakeClient();
  return {
    schema(schemaName) {
      const delegate = base.schema(schemaName);
      return {
        rpc(functionName, args) {
          if (functionName === functionToFail) {
            return Promise.resolve({
              data: {
                contractVersion: "project-ceo-foundation/0.1",
                requestId: `db:failed:${functionName}`,
                data: null,
                error: { code: "internal_error", messageKey: "project_ceo.error.internal_error" },
              },
              error: null,
            });
          }
          return delegate.rpc(functionName, args);
        },
      };
    },
  };
}

function executionWithPhotoDecision(decision: "accepted" | "rejected" | null) {
  return [{
    contractVersion: "project-ceo-m4-delivery/0.1",
    requestId: `db:m4:${decision ?? "undecided"}`,
    data: {
      changeRequests: [],
      impactRuns: [],
      milestones: [{
        id: "55555555-5555-4555-8555-555555555555",
        title: "Inspection",
        acceptance: null,
        areas: [{
          areaNodeId: "area-a",
          photos: [{
            capturedAt: "2026-07-18T00:00:00Z",
            decision,
            id: "77777777-7777-4777-8777-777777777777",
          }],
        }],
      }],
      handoverDocuments: [],
      constructionHandovers: [],
    },
    error: null,
    scope: { organizationId, projectId, packageId },
    stateRevision: 4,
  }];
}

describe("ProjectCEO live DTO sanitizer", () => {
  it("counts exact M4 areas and excludes quarantined evidence", async () => {
    const result = await new ProjectCeoLiveReadPort(client, {
      userId: "66666666-6666-4666-8666-666666666666",
      displayName: "Controlled user",
    }).getProjectWorkspace({ projectId, requestId: "ui:test" });
    expect(result.error).toBeNull();
    expect(result.data?.handover).toMatchObject({
      acceptedAreaCount: 2,
      totalAreaCount: 2,
      status: "ready",
    });
    expect(result.data?.sources.find((source) => source.id === "source-pdf")?.evidenceEligible).toBe(true);
    expect(result.data?.sources.find((source) => source.id === "source-archive")).toMatchObject({
      quarantine: "preview_required",
      evidenceEligible: false,
    });
    expect(JSON.stringify(result)).not.toContain("/Users/private.pdf");
  });

  it("never exposes a distribution id without a recipient-bound read field", async () => {
    const port = new ProjectCeoLiveReadPort(fakeClient({
      packageVersions: [{
        id: "release-v1",
        packageId,
        versionNo: 1,
        semanticHash: `sha256:${"e".repeat(64)}`,
        publishedAt: "2026-07-17T00:00:00Z",
      }],
      releaseArtifacts: [],
      distributions: [{
        distributionId: "foreign-distribution-id",
        productionPackageVersionId: "release-v1",
        acknowledged: false,
      }],
    }), {
      userId: "66666666-6666-4666-8666-666666666666",
      displayName: "Controlled user",
    });
    const result = await port.getProjectWorkspace({ projectId, requestId: "distribution-scope" });
    expect(result.data?.releases[0]?.pendingDistributionId).toBeNull();
    expect(result.data?.operations.acknowledge_release).toEqual({
      status: "unavailable",
      reason: "prerequisite_missing",
    });
  });

  it("keeps an authenticated user with no grants empty and non-authoritative", async () => {
    const result = await new ProjectCeoLiveReadPort(fakeClient({}, []), {
      userId: "66666666-6666-4666-8666-666666666666",
      displayName: "Unassigned user",
    }).getPortfolio({ requestId: "empty-grants" });

    expect(result.error).toBeNull();
    expect(result.data?.projects).toEqual([]);
    expect(result.data?.actor).toMatchObject({
      actorId: "66666666-6666-4666-8666-666666666666",
      role: "guest",
      projectId: "",
      packageId: null,
      capabilities: [],
    });
  });

  it("does not offer milestone acceptance while photo evidence is undecided", async () => {
    const result = await new ProjectCeoLiveReadPort(fakeClient({
      executionPackages: executionWithPhotoDecision(null),
    }), {
      userId: "66666666-6666-4666-8666-666666666666",
      displayName: "Controlled user",
    }).getProjectWorkspace({ projectId, requestId: "milestone-undecided" });

    expect(result.data?.operations.accept_milestone).toEqual({
      status: "unavailable",
      reason: "prerequisite_missing",
    });
  });

  it("does not offer milestone acceptance when photo evidence was rejected", async () => {
    const result = await new ProjectCeoLiveReadPort(fakeClient({
      executionPackages: executionWithPhotoDecision("rejected"),
    }), {
      userId: "66666666-6666-4666-8666-666666666666",
      displayName: "Controlled user",
    }).getProjectWorkspace({ projectId, requestId: "milestone-rejected" });

    expect(result.data?.operations.accept_milestone).toEqual({
      status: "unavailable",
      reason: "prerequisite_missing",
    });
  });

  it("offers exact milestone acceptance only after every photo was accepted", async () => {
    const result = await new ProjectCeoLiveReadPort(fakeClient({
      executionPackages: executionWithPhotoDecision("accepted"),
    }), {
      userId: "66666666-6666-4666-8666-666666666666",
      displayName: "Controlled user",
    }).getProjectWorkspace({ projectId, requestId: "milestone-accepted" });

    expect(result.data?.operations.accept_milestone).toEqual({
      status: "available",
      commandTargetId: "55555555-5555-4555-8555-555555555555",
    });
  });

  it("does not invent fixture pilot counts in the live portfolio", async () => {
    const result = await new ProjectCeoLiveReadPort(client, {
      userId: "66666666-6666-4666-8666-666666666666",
      displayName: "Controlled user",
    }).getPortfolio({ requestId: "ui:portfolio" });
    expect(result.data?.organization.paidPilotScopeCount).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/Kora Food Hall|kora-food-hall/);
  });

  it("fails closed when a required downstream read returns an error envelope", async () => {
    for (const functionName of [
      "get_project_workspace_read_v3",
      "list_project_access",
      "get_audit_timeline",
    ]) {
      const result = await new ProjectCeoLiveReadPort(failingEnvelopeClient(functionName), {
        userId: "66666666-6666-4666-8666-666666666666",
        displayName: "Controlled user",
      }).getProjectWorkspace({ projectId, requestId: `failure:${functionName}` });
      expect(result.data, functionName).toBeNull();
      expect(result.error?.code, functionName).toBe("internal_error");
    }
  });

  it("fails closed instead of collapsing sibling package memberships", async () => {
    const packageScopes = [
      {
        accessScope: "package",
        organizationId,
        projectId,
        packageId,
        role: "architect",
        stateRevision: 4,
      },
      {
        accessScope: "package",
        organizationId,
        projectId,
        packageId: "77777777-7777-4777-8777-777777777777",
        role: "builder",
        stateRevision: 4,
      },
    ];
    const result = await new ProjectCeoLiveReadPort(fakeClient({}, packageScopes), {
      userId: "66666666-6666-4666-8666-666666666666",
      displayName: "Controlled user",
    }).getProjectWorkspace({ projectId, requestId: "ambiguous-packages" });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("scope_conflict");
  });

  it("fails closed when a singular portfolio would merge organizations", async () => {
    const multiOrganizationEntries = [
      defaultProjectEntries[0],
      {
        accessScope: "project",
        organizationId: "88888888-8888-4888-8888-888888888888",
        projectId: "99999999-9999-4999-8999-999999999999",
        role: "owner_lead",
        stateRevision: 1,
      },
    ];
    const result = await new ProjectCeoLiveReadPort(fakeClient({}, multiOrganizationEntries), {
      userId: "66666666-6666-4666-8666-666666666666",
      displayName: "Controlled user",
    }).getPortfolio({ requestId: "multi-organization" });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("scope_conflict");
  });

  it("fails closed when one project selector appears under multiple organizations", async () => {
    const conflictingEntries = [
      defaultProjectEntries[0],
      {
        ...defaultProjectEntries[0],
        organizationId: "88888888-8888-4888-8888-888888888888",
      },
    ];
    const result = await new ProjectCeoLiveReadPort(fakeClient({}, conflictingEntries), {
      userId: "66666666-6666-4666-8666-666666666666",
      displayName: "Controlled user",
    }).getProjectWorkspace({ projectId, requestId: "project-org-conflict" });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("scope_conflict");
  });
});
