import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres";
import { ProjectCeoCommandService } from "@/lib/project-intelligence/delivery/projectceo/command-service";

const projectId = "72000000-0000-4000-8000-000000000001";
const packageId = "72000000-0000-4000-8000-000000000002";

function fakeClient(role: "architect" | "client_approver", calls: string[]): PostgresRpcClient {
  return {
    schema(schema) {
      return {
        async rpc(name, args = {}) {
          const qualified = `${schema}.${name}`;
          calls.push(`${qualified}:${JSON.stringify(args)}`);
          if (qualified === "projectceo_api.list_projects") return {
            data: {
              contractVersion: "project-ceo-foundation/0.1",
              requestId: "db:scope",
              data: [{ accessScope: "package", organizationId: "72000000-0000-4000-8000-000000000003", projectId, packageId, role, stateRevision: 61 }],
              error: null,
            },
            error: null,
          };
          if (qualified === "projectceo_api.get_project_delivery") return {
            data: {
              contractVersion: "project-ceo-foundation/0.1",
              requestId: "db:delivery",
              data: { projectId, package: null, latestBaseline: null, packageVersions: [{ id: "pv1", packageId }], releaseArtifacts: [], distributions: [], acknowledgements: [], noChangeTerminals: [], unresolvedImpactReviewCount: 0, extensionStatus: {} },
              error: null,
            },
            error: null,
          };
          if (qualified.startsWith("projectceo_product_api.")) return {
            data: { operation: name, replay: false, stateRevision: 62, result: { status: "ok" } },
            error: null,
          };
          return { data: null, error: { code: "P1104", message: "not_found" } };
        },
      };
    },
  };
}

const base = { contractVersion: "projectceo-command/0.1", projectId } as const;

describe("Cycle 6 persisted command dispatch", () => {
  it.each([
    ["submit_m2_client_review", "architect", "submit_m2_client_review"],
    ["review_m2_client_submission", "client_approver", "review_m2_client_submission"],
    ["publish_m2_m3_handoff", "architect", "publish_m2_m3_handoff"],
  ] as const)("dispatches %s through its dedicated authenticated RPC", async (kind, role, rpcName) => {
    const calls: string[] = [];
    const payload = kind === "submit_m2_client_review"
      ? { packageId, submissionId: "submission-1", revisionId: "72000000-0000-4000-8000-000000000011", expectedRevisionId: null, approvalPackageId: "approval-1", roomId: "living-room", designIntentRevisionId: "intent@1", variants: [], budgetAsOf: "2026-08-06T10:00:00+08:00", staleAfterDays: 30, reason: "Передача клиенту" }
      : kind === "review_m2_client_submission"
        ? { packageId, submissionId: "submission-1", revisionId: "72000000-0000-4000-8000-000000000012", expectedRevisionId: "72000000-0000-4000-8000-000000000011", chosenVariantId: "variant-preferred", decision: "approved", reason: "Клиент согласовал" }
        : { packageId, handoffId: "handoff-1", revisionId: "72000000-0000-4000-8000-000000000013", expectedRevisionId: null, approvedCommitId: "commit-1", approvedCommitRevisionId: "72000000-0000-4000-8000-000000000014", reason: "Передача в M3" };
    const command = { ...base, commandId: "72000000-0000-4000-8000-000000000010", kind, payload };

    const result = await new ProjectCeoCommandService({ client: fakeClient(role, calls) })
      .execute(command as never, `http:${kind}`);

    expect(result).toMatchObject({ status: "completed", stateRevision: 62 });
    const writes = calls.filter((call) => call.startsWith(`projectceo_product_api.${rpcName}:`));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"expected_state_revision":61');
    expect(writes[0]).toContain(`"idempotency_key":"ui:${projectId}:${kind}:72000000-0000-4000-8000-000000000010"`);
    expect(writes[0]).not.toMatch(/actor|organization|submitted_at|reviewed_at|published_at/i);
  });
});
