import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { semanticHash } from "../../lib/layout-studio/domain";
import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import type { ProjectCeoCommand } from "../../lib/project-intelligence/delivery/projectceo/command-contract";
import { ProjectCeoCommandService } from "../../lib/project-intelligence/delivery/projectceo/command-service";
import { makeSimpleRoom } from "../layout-studio/application/layout-test-fixture";

const commandId = "30000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000002";
const organizationId = "30000000-0000-4000-8000-000000000003";
const packageId = "30000000-0000-4000-8000-000000000004";
const revisionId = "30000000-0000-4000-8000-000000000005";

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
              stateRevision: 52,
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
              stateRevision: 53,
              result: {
                entityKind: "layout_version",
                entityId: "living-room-layout",
                revisionId,
                revisionNo: 1,
                packageId,
                status: "published",
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

async function layoutVersionCommand(): Promise<
  Extract<ProjectCeoCommand, { readonly kind: "publish_m2_layout_version" }>
> {
  const layoutContent = makeSimpleRoom();
  layoutContent.documentId = "living-room-layout";
  layoutContent.projectId = projectId;
  layoutContent.variant.id = "variant-preferred";
  layoutContent.variant.status = "published";

  return {
    contractVersion: "projectceo-command/0.1",
    commandId,
    kind: "publish_m2_layout_version",
    projectId,
    payload: {
      packageId,
      documentId: "living-room-layout",
      versionId: "living-room-layout@3",
      revisionId,
      expectedRevisionId: null,
      roomId: "living-room",
      variantId: "variant-preferred",
      role: "preferred",
      semanticHash: `sha256:${await semanticHash(layoutContent)}`,
      schemaVersion: "project-ceo-m2-layout/0.1",
      layoutContent,
      reason: "Публикация согласуемой версии планировки",
    },
  };
}

describe("M2 layout version command service", () => {
  it("dispatches one immutable layout version with request-bound state and idempotency", async () => {
    const calls: Call[] = [];
    const command = await layoutVersionCommand();

    const result = await new ProjectCeoCommandService({ client: fakeClient(calls) })
      .execute(command, "http-m2-layout-version");

    const writes = calls.filter(
      (call) => call.name === "projectceo_product_api.append_m2_workspace_revision",
    );
    expect(writes).toHaveLength(1);
    expect(result).toMatchObject({ status: "completed", replay: false, stateRevision: 53 });
    expect(writes[0]?.args).toEqual({
      project_id: projectId,
      package_id: packageId,
      entity_kind: "layout_version",
      entity_id: "living-room-layout",
      revision_id: revisionId,
      expected_revision_id: null,
      status: "published",
      payload: {
        versionId: "living-room-layout@3",
        roomId: "living-room",
        variantId: "variant-preferred",
        role: "preferred",
        semanticHash: command.payload.semanticHash,
        schemaVersion: "project-ceo-m2-layout/0.1",
        layoutContent: command.payload.layoutContent,
      },
      reason: "Публикация согласуемой версии планировки",
      expected_state_revision: 52,
      idempotency_key: `ui:${projectId}:publish_m2_layout_version:${commandId}`,
    });
    expect(JSON.stringify(writes)).not.toContain("actorId");
    expect(JSON.stringify(writes)).not.toContain("organizationId");
    expect(JSON.stringify(writes)).not.toContain("publishedAt");
  });
});
