import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import { projectCeoCommandSchema, type ProjectCeoCommand } from "../../lib/project-intelligence/delivery/projectceo/command-contract";
import { ProjectCeoCommandService } from "../../lib/project-intelligence/delivery/projectceo/command-service";

const projectId = "10000000-0000-4000-8000-000000000001";
const packageId = "10000000-0000-4000-8000-000000000002";
const commandId = "10000000-0000-4000-8000-000000000003";
const refId = "10000000-0000-4000-8000-000000000004";
const command: Extract<ProjectCeoCommand, { kind: "attach_external_release_refs" }> = {
  contractVersion: "projectceo-command/0.1", projectId, commandId,
  kind: "attach_external_release_refs",
  payload: {
    packageId, handoffId: "handoff-1", handoffRevisionId: "handoff-r1",
    expectedStateRevision: 12,
    candidateRefs: [
      { kind: "asset_version", assetVersionId: refId },
      { kind: "representation_version", representationVersionId: refId },
      { kind: "documentation_sheet_revision", sheetId: "sheet-1", sheetRevisionId: "sheet-r1" },
      { kind: "object_representation_binding", objectRepresentationBindingId: refId },
      { kind: "technical_reference_revision", technicalReferenceRevisionId: refId },
      { kind: "annotation_revision", annotationRevisionId: refId },
    ],
  },
};

type Call = { name: string; args: Readonly<Record<string, unknown>> };
function fixture(options: { error?: string; replay?: boolean; scope?: boolean } = {}) {
  const calls: Call[] = [];
  const client: PostgresRpcClient = {
    schema: (schema) => ({ rpc: async (fn, args = {}) => {
      const name = `${schema}.${fn}`;
      calls.push({ name, args });
      if (name === "projectceo_api.list_projects") return {
        data: { contractVersion: "project-ceo-foundation/0.1", requestId: "db-read", error: null,
          data: options.scope === false ? [] : [{ accessScope: "project", organizationId: refId,
            projectId, role: "owner_lead", stateRevision: 99 }] }, error: null,
      };
      if (name === "projectceo_product_api.attach_external_release_refs") return options.error
        ? { data: null, error: { code: options.error, message: "candidate_failed" } }
        : { data: { operation: "attach_external_release_refs", replay: options.replay ?? false,
          stateRevision: 13, result: { submissionId: refId, subjectDigest: `sha256:${"a".repeat(64)}`,
            status: "candidate", refCount: 6 } }, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    } }),
  };
  return { calls, service: new ProjectCeoCommandService({ client, documentationEnabled: "true" }), client };
}

describe("R1 external release candidate command", () => {
  it("accepts all six exact selector types", () => {
    expect(projectCeoCommandSchema.safeParse(command).success).toBe(true);
  });

  it.each(["actorUserId", "organizationId", "role", "approvedBy", "semanticDigest", "subjectDigest", "status"])(
    "rejects injected %s at every request level", (field) => {
      for (const value of [
        { ...command, [field]: "forged" },
        { ...command, payload: { ...command.payload, [field]: "forged" } },
        ...command.payload.candidateRefs.map((ref) => ({ ...command, payload: {
          ...command.payload, candidateRefs: [{ ...ref, [field]: "forged" }],
        } })),
      ]) expect(projectCeoCommandSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each([undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid expected revision %s", (revision) => {
    expect(projectCeoCommandSchema.safeParse({ ...command, payload: {
      ...command.payload, expectedStateRevision: revision,
    } }).success).toBe(false);
  });

  it("rejects missing, oversized, unknown and inexact selectors", () => {
    for (const candidateRefs of [[], Array(2001).fill(command.payload.candidateRefs[0]),
      [{ kind: "asset_version" }], [{ kind: "unknown", assetVersionId: refId }],
      [{ kind: "documentation_sheet_revision", sheetId: " sheet", sheetRevisionId: "r" }]]) {
      expect(projectCeoCommandSchema.safeParse({ ...command, payload: {
        ...command.payload, candidateRefs,
      } }).success).toBe(false);
    }
  });

  it.each([false, true])("forwards the caller revision unchanged and preserves replay=%s", async (replay) => {
    const { calls, service } = fixture({ replay });
    const result = await service.execute(command, "http-candidate");
    expect(result).toMatchObject({ requestId: "http-candidate", status: "completed", replay,
      stateRevision: 13, operation: command.kind, result: { status: "candidate", refCount: 6 } });
    expect(calls.map((call) => call.name)).toEqual([
      "projectceo_api.list_projects", "projectceo_product_api.attach_external_release_refs",
    ]);
    expect(calls[1]?.args).toEqual({ p_project_id: projectId, p_package_id: packageId,
      p_handoff_id: "handoff-1", p_handoff_revision_id: "handoff-r1",
      p_candidate_refs: command.payload.candidateRefs, p_expected_state_revision: 12,
      p_idempotency_key: `ui:${projectId}:${command.kind}:${commandId}` });
  });

  it.each([["P1107", "stale_state"], ["P1103", "forbidden"], ["P1109", "scope_conflict"],
    ["P1111", "validation_failed"], ["P1104", "not_found"]])("maps %s without another write", async (error, code) => {
    const { service, calls } = fixture({ error });
    expect(await service.execute(command, "request-error")).toMatchObject({ error: { code } });
    expect(calls).toHaveLength(2);
  });

  it("keeps the M3 authoring gate closed by default", async () => {
    const { client, calls } = fixture();
    const service = new ProjectCeoCommandService({ client, documentationEnabled: "false" });
    expect(await service.execute(command, "closed")).toMatchObject({ status: "unavailable" });
    expect(calls).toEqual([]);
  });

  it("does not write when request-bound project scope is absent", async () => {
    const { service, calls } = fixture({ scope: false });
    expect(await service.execute(command, "no-scope")).toMatchObject({ error: { code: "not_found" } });
    expect(calls).toHaveLength(1);
  });
});
