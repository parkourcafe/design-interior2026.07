import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import type { ProjectCeoCommand } from "../../lib/project-intelligence/delivery/projectceo/command-contract";
import { ProjectCeoCommandService } from "../../lib/project-intelligence/delivery/projectceo/command-service";

const projectId = "10000000-0000-4000-8000-000000000002";
const organizationId = "20000000-0000-4000-8000-000000000002";
const packageId = "10000000-0000-4000-8000-000000000003";
const revisionId = "10000000-0000-4000-8000-000000000004";
const expectedRevisionId = "10000000-0000-4000-8000-000000000005";
const commandId = "10000000-0000-4000-8000-000000000001";

interface Call {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

function envelope(data: unknown) {
  return {
    contractVersion: "project-ceo-foundation/0.1",
    requestId: "db:test",
    data,
    error: null,
  };
}

function fakeClient(calls: Call[]): PostgresRpcClient {
  return {
    schema: (schemaName) => ({
      rpc: async (functionName, args = {}) => {
        const name = `${schemaName}.${functionName}`;
        calls.push({ name, args });
        if (name === "projectceo_api.list_projects") {
          return {
            data: envelope([{
              accessScope: "project",
              organizationId,
              projectId,
              role: "owner_lead",
              stateRevision: 37,
            }]),
            error: null,
          };
        }
        if (name === "projectceo_api.get_project_delivery") {
          return {
            data: envelope({
              projectId,
              package: null,
              latestBaseline: null,
              packageVersions: [{
                id: "production-package-v1",
                packageId,
                baselineId: "baseline-v1",
                versionNo: 1,
              }],
              releaseArtifacts: [],
              distributions: [],
              acknowledgements: [],
              noChangeTerminals: [],
              unresolvedImpactReviewCount: 0,
              extensionStatus: {},
            }),
            error: null,
          };
        }
        if (name === "projectceo_product_api.append_m2_workspace_revision") {
          return {
            data: {
              operation: "append_m2_workspace_revision",
              replay: false,
              stateRevision: 38,
              result: {
                entityKind: "approved_commit",
                entityId: "commit-42",
                revisionId,
                revisionNo: 1,
                packageId,
                status: "approved",
              },
            },
            error: null,
          };
        }
        return { data: null, error: { code: "P1104", message: "not_found" } };
      },
    }),
  };
}

function approvedCommitCommand(): Extract<ProjectCeoCommand, { readonly kind: "commit_m2_approval" }> {
  return {
    contractVersion: "projectceo-command/0.1",
    commandId,
    kind: "commit_m2_approval",
    projectId,
    payload: {
      packageId,
      commitId: "commit-42",
      revisionId,
      expectedRevisionId,
      approvalPackageId: "approval-package-42",
      roomId: "living-room",
      designIntentRevisionId: "design-intent-r7",
      chosenVariant: {
        variantId: "variant-premium",
        role: "premium",
        layoutDocumentId: "layout-document-1",
        layoutVersionId: "layout-version-3",
        semanticHash: `sha256:${"a".repeat(64)}`,
      },
      approvedSelectionRevisionIds: ["selection-r1", "selection-r2"],
      budget: {
        asOf: "2026-08-06T10:15:30+08:00",
        staleAfterDays: 30,
        amountRub: 1_250_000,
        staleSelectionRevisionIds: [],
        missingPriceSelectionRevisionIds: [],
      },
      submittedAt: "2026-08-06T10:15:30+08:00",
      reviewedAt: "2026-08-06T11:00:00+08:00",
      submissionReason: "Дизайн-пакет готов к согласованию",
      reviewReason: "Вариант и выборы согласованы",
    },
  };
}

describe("M2 approved commit command service", () => {
  it("dispatches the exact approved snapshot with request-bound state and idempotency", async () => {
    const calls: Call[] = [];
    const command = approvedCommitCommand();
    const result = await new ProjectCeoCommandService({ client: fakeClient(calls) })
      .execute(command, "http-m2-commit");

    expect(result).toMatchObject({ status: "completed", replay: false, stateRevision: 38 });
    const writes = calls.filter(
      (call) => call.name === "projectceo_product_api.append_m2_workspace_revision",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.args).toEqual({
      project_id: projectId,
      package_id: packageId,
      entity_kind: "approved_commit",
      entity_id: "commit-42",
      revision_id: revisionId,
      expected_revision_id: expectedRevisionId,
      status: "approved",
      payload: {
        approvalPackageId: "approval-package-42",
        roomId: "living-room",
        designIntentRevisionId: "design-intent-r7",
        chosenVariant: command.payload.chosenVariant,
        approvedSelectionRevisionIds: ["selection-r1", "selection-r2"],
        budget: command.payload.budget,
        submittedAt: "2026-08-06T10:15:30+08:00",
        reviewedAt: "2026-08-06T11:00:00+08:00",
        submissionReason: "Дизайн-пакет готов к согласованию",
        reviewReason: "Вариант и выборы согласованы",
      },
      reason: "Вариант и выборы согласованы",
      expected_state_revision: 37,
      idempotency_key: `ui:${projectId}:commit_m2_approval:${commandId}`,
    });
    expect(JSON.stringify(writes)).not.toContain("actorId");
    expect(JSON.stringify(writes)).not.toContain("organizationId");
  });
});
