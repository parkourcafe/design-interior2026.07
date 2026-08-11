import { describe, expect, it } from "vitest";

import {
  ProjectCeoAuthenticatedReadPostgresAdapter,
  type PostgresRpcClient,
} from "@/lib/project-intelligence/adapters/postgres";

const projectId = "73000000-0000-4000-8000-000000000001";
const packageId = "73000000-0000-4000-8000-000000000002";

function envelope(extra: Record<string, unknown> = {}) {
  return {
    contractVersion: "project-ceo-authenticated-read/0.1",
    requestId: "db:m2-read-v6",
    data: {
      approvalPackages: [], decisions: [], distributionSummary: [], executionPackages: [],
      extensionStatus: {}, latestBaseline: null, m2ApprovedCommits: [], m2LayoutVersions: [],
      noChangeTerminals: [], packages: [], packageVersions: [], recipientDistributions: [],
      releaseArtifacts: [], releaseRecipients: [], reviewQueue: [], selections: [], sources: [],
      projectMetadata: { areaM2: 100, location: "Москва", model: "full_project", name: "Pilot" },
      sourceStats: { duplicateGroups: 0, materializedRecords: 0, physicalRecords: 0, placeholders: 0, quarantinedGroups: 0, reviewQueue: 0, uniqueBlobs: 0 },
      unresolvedImpactReviewCount: 0,
      m2ClientReviewSubmissions: [{
        id: "submission-1", packageId, revisionId: "73000000-0000-4000-8000-000000000010",
        revisionNo: 1, status: "submitted", assignedClientUserId: "73000000-0000-4000-8000-000000000011",
        payload: {
          approvalPackageId: "approval-living-room", roomId: "living-room",
          designIntentRevisionId: "decision-living-room-r4",
          budgetAsOf: "2026-08-06T09:45:00.000Z", staleAfterDays: 30,
          submittedByActorUserId: "73000000-0000-4000-8000-000000000020",
          submissionReason: "Три варианта отправлены клиенту на согласование",
          submittedAt: "2026-08-06T10:00:00.000Z",
          variants: [
            {
              variantId: "variant-preferred", role: "preferred",
              layoutDocumentId: "layout-preferred", layoutVersionId: "layout-preferred@2",
              layoutRevisionId: "73000000-0000-4000-8000-000000000021",
              semanticHash: `sha256:${"a".repeat(64)}`,
              selectionRevisionIds: ["selection-preferred-r2"],
              budget: { amountRub: 125000, staleSelectionRevisionIds: [], missingPriceSelectionRevisionIds: [] },
            },
            {
              variantId: "variant-value", role: "value_engineered",
              layoutDocumentId: "layout-value", layoutVersionId: "layout-value@1",
              layoutRevisionId: "73000000-0000-4000-8000-000000000022",
              semanticHash: `sha256:${"b".repeat(64)}`,
              selectionRevisionIds: ["selection-value-r1"],
              budget: { amountRub: 98000, staleSelectionRevisionIds: [], missingPriceSelectionRevisionIds: [] },
            },
            {
              variantId: "variant-premium", role: "premium",
              layoutDocumentId: "layout-premium", layoutVersionId: "layout-premium@3",
              layoutRevisionId: "73000000-0000-4000-8000-000000000023",
              semanticHash: `sha256:${"c".repeat(64)}`,
              selectionRevisionIds: ["selection-premium-r3"],
              budget: { amountRub: 189000, staleSelectionRevisionIds: [], missingPriceSelectionRevisionIds: [] },
            },
          ],
        },
        createdAt: "2026-08-06T10:00:00.000Z",
      }],
      m2ClientReviews: [{
        id: "review-1", packageId, revisionId: "73000000-0000-4000-8000-000000000012",
        revisionNo: 1, status: "approved", submissionId: "submission-1",
        chosenVariantId: "variant-preferred", createdAt: "2026-08-06T11:00:00.000Z",
      }],
      m2M3Handoffs: [{
        id: "handoff-1", packageId, revisionId: "73000000-0000-4000-8000-000000000013",
        revisionNo: 1, status: "published", approvedCommitId: "commit-1",
        approvedCommitRevisionId: "73000000-0000-4000-8000-000000000015",
        layoutRevisionId: "73000000-0000-4000-8000-000000000014",
        selectionRevisionIds: ["selection-a@1"],
        budget: { asOf: "2026-08-06T09:45:00.000Z", staleAfterDays: 30, amountRub: 125000,
          staleSelectionRevisionIds: [], missingPriceSelectionRevisionIds: [] },
        createdAt: "2026-08-06T12:00:00.000Z",
      }],
      ...extra,
    },
    error: null,
    scope: {
      accessScope: "package", actorUserId: "73000000-0000-4000-8000-000000000011",
      organizationId: "73000000-0000-4000-8000-000000000003", packageId, projectId,
    },
    stateRevision: 70,
  };
}

function client(value: unknown, calls: string[]): PostgresRpcClient {
  return { schema: (schema) => ({ rpc: async (name) => {
    calls.push(`${schema}.${name}`);
    return { data: value, error: null };
  } }) };
}

describe("Cycle 6 authenticated read adapter", () => {
  // Адаптер ходит в самую свежую проекцию — сейчас v7, которая надстроена над
  // v6. Проверяется здесь именно то, что цикл 6 обещал: разборы обзоров и
  // входа M3 не изменились от смены версии.
  it("uses only the latest projection and parses the exact persisted review and M3 projections", async () => {
    const calls: string[] = [];
    const result = await new ProjectCeoAuthenticatedReadPostgresAdapter(client(envelope(), calls))
      .getProjectWorkspaceRead({ projectId, packageId });
    const data = result.data as unknown as Record<string, unknown>;

    expect(calls).toEqual(["projectceo_read_api.get_project_workspace_read_v9"]);
    expect(data.m2ClientReviewSubmissions).toEqual([
      expect.objectContaining({ id: "submission-1", assignedClientUserId: "73000000-0000-4000-8000-000000000011" }),
    ]);
    expect(data.m2ClientReviews).toEqual([
      expect.objectContaining({ status: "approved", chosenVariantId: "variant-preferred" }),
    ]);
    expect(data.m2M3Handoffs).toEqual([
      expect.objectContaining({ approvedCommitId: "commit-1", approvedCommitRevisionId: "73000000-0000-4000-8000-000000000015", selectionRevisionIds: ["selection-a@1"], budget: expect.objectContaining({ amountRub: 125000 }) }),
    ]);
  });

  it.each([
    ["malformed submission", { m2ClientReviewSubmissions: [{ status: "draft" }] }],
    ["unassigned review", { m2ClientReviews: [{ status: "approved", chosenVariantId: "variant-preferred" }] }],
    ["client-authored M3 input", { m2M3Handoffs: [{ layoutRevisionId: "not-a-uuid" }] }],
  ])("fails closed for %s", async (_name, extra) => {
    const adapter = new ProjectCeoAuthenticatedReadPostgresAdapter(client(envelope(extra), []));
    await expect(adapter.getProjectWorkspaceRead({ projectId, packageId }))
      .rejects.toThrow("Invalid ProjectCEO authenticated read envelope");
  });

  it("fails closed when a nested dirty-price reference is outside the exact variant selections", async () => {
    const value = structuredClone(envelope());
    (value.data.m2ClientReviewSubmissions[0]!.payload.variants[0]!.budget as {
      staleSelectionRevisionIds: string[];
    }).staleSelectionRevisionIds = ["selection-from-another-variant@1"];
    await expect(new ProjectCeoAuthenticatedReadPostgresAdapter(client(value, []))
      .getProjectWorkspaceRead({ projectId, packageId }))
      .rejects.toThrow("Invalid ProjectCEO authenticated read envelope");
  });
});
