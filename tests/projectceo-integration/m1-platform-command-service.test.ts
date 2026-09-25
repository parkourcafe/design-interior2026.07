import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PostgresRpcClient } from "../../lib/project-intelligence/adapters/postgres";
import type { ProjectCeoCommand } from "../../lib/project-intelligence/delivery/projectceo/command-contract";
import { ProjectCeoCommandService } from "../../lib/project-intelligence/delivery/projectceo/command-service";

const projectId = "10000000-0000-4000-8000-000000000001";
const organizationId = "20000000-0000-4000-8000-000000000001";
const factId = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";

interface Call {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

function foundationEnvelope(data: unknown) {
  return {
    contractVersion: "project-ceo-foundation/0.1",
    requestId: "db:test",
    data,
    error: null,
  };
}

function mutation(operation: string, result: Readonly<Record<string, unknown>>, replay = false) {
  return { operation, replay, stateRevision: 42, result };
}

function fakeClient(calls: Call[]): PostgresRpcClient {
  const seen = new Set<string>();
  return {
    schema: (schemaName) => ({
      rpc: async (functionName, args = {}) => {
        const name = `${schemaName}.${functionName}`;
        calls.push({ name, args });
        if (name === "projectceo_api.list_projects") {
          return {
            data: foundationEnvelope([{
              accessScope: "project",
              organizationId,
              projectId,
              role: "owner_lead",
              stateRevision: 41,
            }]),
            error: null,
          };
        }
        if (schemaName === "projectceo_platform_api") {
          const key = String(args.idempotency_key ?? "");
          const replay = seen.has(key);
          seen.add(key);
          return {
            data: mutation(functionName, {
              factId,
              requestId,
              status: functionName === "create_approval_request" ? "draft" : "submitted",
            }, replay),
            error: null,
          };
        }
        return { data: null, error: { code: "P1104", message: "not_found" } };
      },
    }),
  };
}

function service(calls: Call[]): ProjectCeoCommandService {
  return new ProjectCeoCommandService({ client: fakeClient(calls) });
}

function command<T extends ProjectCeoCommand["kind"]>(
  kind: T,
  commandPayload: Extract<ProjectCeoCommand, { readonly kind: T }>["payload"],
  id: string,
): Extract<ProjectCeoCommand, { readonly kind: T }> {
  return {
    contractVersion: "projectceo-command/0.1",
    commandId: id,
    kind,
    projectId,
    payload: commandPayload,
  } as Extract<ProjectCeoCommand, { readonly kind: T }>;
}

describe("M1 platform command boundary", () => {
  it("records a stage revision through the server-derived project scope", async () => {
    const calls: Call[] = [];
    const input = command("record_project_stage_revision", {
      stageId: "01_brief",
      resultRevisionId: "passport-v1",
      ownerUserId: "50000000-0000-4000-8000-000000000001",
      plannedAt: "2026-09-24T10:00:00+05:00",
      actualAt: null,
      blockerReason: null,
      requirements: [{ id: "brief", label: "Версия брифа", satisfied: true }],
      approvalStatus: "submitted",
      approvalRevisionId: "passport-v1",
      notApplicableReason: null,
    }, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");

    const result = await service(calls).execute(input, "http-aldo-stage");
    expect(result).toMatchObject({ status: "completed", operation: "record_project_stage_revision", stateRevision: 42 });
    expect(calls).toContainEqual({
      name: "projectceo_platform_api.record_project_stage_revision",
      args: {
        project_id: projectId,
        stage_id: "01_brief",
        result_revision_id: "passport-v1",
        owner_user_id: input.payload.ownerUserId,
        planned_at: input.payload.plannedAt,
        actual_at: null,
        blocker_reason: null,
        requirements: input.payload.requirements,
        approval_status: "submitted",
        approval_revision_id: "passport-v1",
        not_applicable_reason: null,
        expected_state_revision: 41,
        idempotency_key: `ui:${projectId}:record_project_stage_revision:${input.commandId}`,
      },
    });
    expect(JSON.stringify(calls)).not.toContain("actorId");
    expect(JSON.stringify(calls)).not.toContain("organizationId");
  });

  it("uses the server project state revision and keeps fact provenance in the RPC contract", async () => {
    const calls: Call[] = [];
    const input = command("create_project_fact", {
      factType: "requirement",
      content: { title: "Нужна отдельная зона выдачи", detail: "Зафиксировано на встрече" },
      extractionKind: "human_stated",
      sourceId: null,
      sourceRevisionId: null,
      statedReason: "Зафиксировано владельцем проекта на встрече",
      supersedesFactId: null,
    }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const result = await service(calls).execute(input, "http-m1-fact");
    expect(result).toMatchObject({ status: "completed", replay: false, stateRevision: 42 });
    expect(calls).toContainEqual({
      name: "projectceo_platform_api.create_project_fact",
      args: {
        p_project_id: projectId,
        p_fact_type: "requirement",
        p_content: input.payload.content,
        p_extraction_kind: "human_stated",
        p_source_id: null,
        p_source_revision_id: null,
        p_stated_reason: input.payload.statedReason,
        p_supersedes_fact_id: null,
        p_expected_state_revision: 41,
        p_idempotency_key: `ui:${projectId}:create_project_fact:${input.commandId}`,
      },
    });
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain("actor");
    expect(serialized).not.toContain("role");
    expect(serialized).not.toContain("organization");
  });

  it.each([
    ["project_passport", "review_claim"],
    ["client_passport", "review_selection"],
  ] as const)("derives %s approver capability server-side", async (subjectKind, expectedCapability) => {
    const calls: Call[] = [];
    const input = command("create_approval_request", {
      subjectKind,
      subjectId: projectId,
      reason: "Паспорт готов к human approval",
    }, subjectKind === "project_passport"
      ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      : "cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    const result = await service(calls).execute(input, `http-m1-${subjectKind}`);
    expect(result.status).toBe("completed");
    expect(calls.find((call) => call.name === "projectceo_platform_api.create_approval_request")?.args)
      .toMatchObject({
        p_project_id: projectId,
        p_subject_kind: subjectKind,
        p_subject_id: projectId,
        p_approver_capability: expectedCapability,
        p_expected_state_revision: 41,
      });
    expect(calls.find((call) => call.name === "projectceo_platform_api.create_approval_request")?.args)
      .not.toHaveProperty("p_role");
  });

  it("preserves idempotency for approval submission retries", async () => {
    const calls: Call[] = [];
    const input = command("submit_approval_request", {
      requestId,
    }, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    const subject = service(calls);

    const first = await subject.execute(input, "http-m1-submit");
    const retry = await subject.execute(input, "http-m1-submit-retry");
    expect(first).toMatchObject({ status: "completed", replay: false });
    expect(retry).toMatchObject({ status: "completed", replay: true });
    const writes = calls.filter((call) => call.name === "projectceo_platform_api.submit_approval_request");
    expect(writes).toHaveLength(2);
    expect(writes[0]?.args).toEqual(writes[1]?.args);
  });
});
