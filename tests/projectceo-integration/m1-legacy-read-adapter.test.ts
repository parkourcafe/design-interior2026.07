import { describe, expect, it } from "vitest";
import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import {
  M1_LEGACY_READ_CONTRACT_VERSION,
  ProjectCeoM1LegacyReadPostgresAdapter,
  parseM1LegacyProjectRead,
} from "../../lib/project-intelligence/adapters/postgres";

const projectId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "66666666-6666-4666-8666-666666666666";
const organizationId = "11111111-1111-4111-8111-111111111111";
const documentId = "77777777-7777-4777-8777-777777777777";

function envelope() {
  return {
    contractVersion: M1_LEGACY_READ_CONTRACT_VERSION,
    requestId: "db:00000000-0000-4000-8000-000000000000",
    scope: { accessScope: "project", actorUserId, organizationId, packageId: null, projectId },
    stateRevision: 9,
    data: {
      passportRevision: {
        projectId,
        revisionNo: 2,
        passport: { object: { type: "flat", area_m2: 80, city: "Убуд" } },
        llmOk: true,
        createdAt: "2026-09-10T00:00:00Z",
      },
      contractDocument: {
        documentId,
        status: "received",
        createdAt: "2026-09-10T00:01:00Z",
        statusUpdatedAt: "2026-09-10T00:02:00Z",
      },
    },
    error: null,
  } as const;
}

describe("M1 legacy read adapter", () => {
  it("parses the request-bound sanitized envelope", () => {
    const parsed = parseM1LegacyProjectRead(envelope());
    expect(parsed.scope).toEqual({ accessScope: "project", actorUserId, organizationId, packageId: null, projectId });
    expect(parsed.data.passportRevision?.revisionNo).toBe(2);
    expect(parsed.data.contractDocument?.status).toBe("received");
  });

  it("rejects an envelope that exposes a package scope", () => {
    expect(() => parseM1LegacyProjectRead({
      ...envelope(),
      scope: { ...envelope().scope, packageId: "33333333-3333-4333-8333-333333333333" },
    })).toThrow("project_ceo.internal_error");
  });

  it("calls the read RPC with only the project selector", async () => {
    const calls: Array<{ readonly name: string; readonly args: Readonly<Record<string, unknown>> }> = [];
    const client: PostgresRpcClient = {
      schema: (schemaName) => ({
        rpc: async (name, args) => {
          expect(schemaName).toBe("projectceo_read_api");
          calls.push({ name, args: args ?? {} });
          return { data: envelope(), error: null };
        },
      }),
    };
    const result = await new ProjectCeoM1LegacyReadPostgresAdapter(client)
      .getM1LegacyProjectRead({ projectId });
    expect(result.data.contractDocument?.documentId).toBe(documentId);
    expect(calls).toEqual([{ name: "get_m1_legacy_project_read", args: { project_id: projectId } }]);
  });
});
