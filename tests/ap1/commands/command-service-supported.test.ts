import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PostgresRpcClient } from "../../../lib/project-intelligence/adapters/postgres";
import type { ProjectCeoCommand } from "../../../lib/project-intelligence/delivery/projectceo/command-contract";
import { ProjectCeoCommandService } from "../../../lib/project-intelligence/delivery/projectceo/command-service";
import { buildReleaseSnapshot } from "../../../lib/project-intelligence/modules/package/release-snapshot";
import { buildBaselineSnapshot } from "../../../lib/project-intelligence/modules/decisions";

const projectId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333";
const recipientUserId = "44444444-4444-4444-8444-444444444444";
const invitationId = "55555555-5555-4555-8555-555555555555";
const grantId = "66666666-6666-4666-8666-666666666666";
const distributionId = "77777777-7777-4777-8777-777777777777";
const impactRunId = "88888888-8888-4888-8888-888888888888";
const milestoneId = "99999999-9999-4999-8999-999999999999";
const photoEvidenceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const semanticHash = `sha256:${"a".repeat(64)}`;

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

function mutation(operation: string, result: Readonly<Record<string, unknown>>, replay = false) {
  return { operation, replay, stateRevision: 10, result };
}

function executionDelivery() {
  return {
    contractVersion: "project-ceo-m4-delivery/0.2",
    requestId: "db:m4",
    data: {
      changeRequests: [],
      impactRuns: [{ id: impactRunId, impacts: [{ id: "impact-1" }] }],
      milestones: [{
        id: milestoneId,
        areas: [{
          areaNodeId: "area-1",
          photos: [{ id: photoEvidenceId }],
        }],
      }],
      handoverDocuments: [],
      constructionHandovers: [],
    },
    error: null,
    scope: { organizationId, projectId, packageId },
    stateRevision: 9,
  };
}

function authenticatedRead(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    contractVersion: "project-ceo-authenticated-read/0.1",
    requestId: "db:read",
    data: {
      approvalPackages: [],
      decisions: [],
      distributionSummary: [],
      executionPackages: [executionDelivery()],
      extensionStatus: {},
      latestBaseline: { id: "baseline-v2" },
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
        name: "Controlled project",
      },
      recipientDistributions: [{
        acknowledged: false,
        acknowledgedAt: null,
        artifactId: "artifact-1",
        distributedAt: "2026-07-18T00:00:00.000Z",
        distributionId,
        packageId,
        productionPackageVersionId: "package-v1",
        semanticHash,
      }],
      releaseArtifacts: [{
        artifactId: "artifact-1",
        productionPackageVersionId: "package-v1",
        semanticHash,
      }],
      releaseRecipients: [{
        packageId,
        role: "builder",
        scope: "package",
        userId: recipientUserId,
      }],
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
      accessScope: "project",
      actorUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      organizationId,
      packageId: null,
      projectId,
    },
    stateRevision: 9,
  };
}

function fakeClient(calls: Call[], readOverrides: Readonly<Record<string, unknown>> = {}): PostgresRpcClient {
  const seen = new Set<string>();
  const resultByName: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    "projectceo_api.create_invitation": { invitationId },
    "projectceo_api.revoke_invitation": { invitationId, revoked: true },
    "projectceo_api.revoke_guest_access_grant": { grantId, revoked: true },
    "projectceo_product_api.acknowledge_release_request_bound": { distributionId },
    "projectceo_product_api.distribute_release_request_bound": { artifactId: "artifact-1", recipientUserId },
    "projectceo_m4_api.submit_change_request": { id: "change-1" },
    "projectceo_m4_api.review_change_impact": { id: "impact-review-1" },
    "projectceo_m4_api.register_photo_evidence": { id: "photo-1" },
    "projectceo_m4_api.review_photo_evidence": { id: "photo-review-1" },
    "projectceo_m4_api.accept_milestone": { id: "acceptance-1" },
    "projectceo_product_api.append_decision_revision": {
      projectId,
      packageId,
      kind: "decision",
      nodeId: "decision-node-1",
      revisionId: "decision-r1",
      revisionNo: 1,
      replacesRevisionId: null,
    },
    "projectceo_product_api.append_selection_revision": {
      projectId,
      packageId,
      kind: "selection",
      nodeId: "selection-node-1",
      revisionId: "selection-r1",
      revisionNo: 1,
      replacesRevisionId: null,
    },
    "projectceo_product_api.create_approval_package": {
      id: "approval-1",
      projectId,
      packageId,
      itemCount: 1,
      status: "draft",
    },
    "projectceo_product_api.submit_approval_package": {
      approvalPackageId: "approval-1",
      projectId,
      status: "submitted",
    },
    "projectceo_product_api.review_approval_package": {
      approvalPackageId: "approval-1",
      projectId,
      status: "approved",
    },
    "projectceo_product_api.publish_production_package_version": {
      id: "package-v1",
      projectId,
      packageId,
      versionNo: 1,
      status: "published",
      semanticHash,
    },
    "projectceo_product_api.publish_project_baseline": {
      id: "baseline-v3",
      projectId,
      versionNo: 3,
      status: "published",
      semanticHash,
    },
    "projectceo_api.register_source_inventory": { registeredPhysicalRecords: 1 },
    "projectceo_api.publish_version": { version: { id: "graph-v3" } },
    "projectceo_m3_api.register_documentation_sheet": {
      sheetId: "m3-sheet-a101",
      revisionId: "sheet-r1",
      revisionNo: 1,
      packageId,
      roomId: "living-room",
      specificationRevisionIds: [],
    },
    "projectceo_m3_api.attach_documentation_sheet_specifications": {
      sheetId: "m3-sheet-a101",
      revisionId: "sheet-r2",
      revisionNo: 2,
      packageId,
      specificationRevisionIds: ["selection-a@1"],
    },
    // Дверь в отданной схеме: приложение зовёт её, а не приватную
    // `project_intelligence_api.review_claim` (миграция `20260810050000`).
    "projectceo_api.review_source": {
      reviewId: "review:source-r1",
      targetRevisionId: "source-r1",
      decision: "confirmed",
    },
  };
  const replayTargetByName: Readonly<Record<string, string>> = {
    "projectceo_m4_api.replay_submit_change_request": "projectceo_m4_api.submit_change_request",
    "projectceo_m4_api.replay_review_change_impact": "projectceo_m4_api.review_change_impact",
    "projectceo_m4_api.replay_register_photo_evidence": "projectceo_m4_api.register_photo_evidence",
    "projectceo_m4_api.replay_review_photo_evidence": "projectceo_m4_api.review_photo_evidence",
    "projectceo_m4_api.replay_accept_milestone": "projectceo_m4_api.accept_milestone",
  };
  return {
    schema: (schemaName) => ({
      rpc: async (functionName, args = {}) => {
        const name = `${schemaName}.${functionName}`;
        calls.push({ name, args });
        if (name === "projectceo_api.list_projects") {
          return { data: envelope([{
            accessScope: "project",
            organizationId,
            projectId,
            role: "owner_lead",
            stateRevision: 9,
          }]), error: null };
        }
        if (name === "projectceo_api.get_project_delivery") {
          return { data: envelope({
            projectId,
            package: null,
            latestBaseline: { id: "baseline-v2", versionNo: 2 },
            packageVersions: [{
              id: "package-v1",
              packageId,
              baselineId: "baseline-v1",
              versionNo: 1,
            }],
            releaseArtifacts: [{
              id: "artifact-1",
              productionPackageVersionId: "package-v1",
              packageId,
              semanticHash,
              format: "logical_json",
            }],
            distributions: [],
            acknowledgements: [],
            noChangeTerminals: [],
            unresolvedImpactReviewCount: 0,
            extensionStatus: {},
          }), error: null };
        }
        if (name === "projectceo_api.list_project_access") {
          return { data: envelope({
            invitations: [{ invitationId }],
            memberships: [],
            packageMemberships: [],
          }), error: null };
        }
        if (name === "projectceo_read_api.get_project_workspace_read_v9") {
          return { data: authenticatedRead(readOverrides), error: null };
        }
        if (name === "projectceo_m4_api.get_execution_delivery") {
          return { data: executionDelivery(), error: null };
        }
        const idempotencyKey = String(args.idempotency_key ?? "");
        const replayTarget = replayTargetByName[name];
        if (replayTarget) {
          const result = resultByName[replayTarget];
          return {
            data: seen.has(idempotencyKey) && result
              ? mutation(replayTarget.split(".")[1]!, result, true)
              : null,
            error: null,
          };
        }
        const replay = seen.has(idempotencyKey);
        seen.add(idempotencyKey);
        if (resultByName[name]) {
          return { data: mutation(functionName, resultByName[name], replay), error: null };
        }
        return { data: null, error: { code: "P1104", message: "not_found" } };
      },
    }),
  };
}

function service(
  calls: Call[],
  readOverrides: Readonly<Record<string, unknown>> = {},
  documentationEnabled = "true",
) {
  return new ProjectCeoCommandService({
    client: fakeClient(calls, readOverrides),
    tokenSecret: "secret-".repeat(6),
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    documentationEnabled,
    // Guardrail модуля 4 закрыт по умолчанию; здесь проверяется поведение
    // принятых команд, а не сам запрет — его проверяет execution-guardrail.test.ts.
    executionEnabled: "true",
  });
}

function command<T extends ProjectCeoCommand["kind"]>(
  kind: T,
  payload: Extract<ProjectCeoCommand, { readonly kind: T }>["payload"],
): Extract<ProjectCeoCommand, { readonly kind: T }> {
  return {
    contractVersion: "projectceo-command/0.1",
    commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind,
    projectId,
    payload,
  } as Extract<ProjectCeoCommand, { readonly kind: T }>;
}

describe("AP1 supported human commands", () => {
  it("creates a deterministic one-time invitation without sending plaintext to Postgres", async () => {
    const calls: Call[] = [];
    const subject = service(calls);
    const input = command("create_invitation", {
      recipientEmail: "  PERSON@Example.Test ",
      targetRole: "client",
      expiresAt: "2026-07-25T00:00:00.000Z",
    });
    const first = await subject.execute(input, "http-1");
    const retry = await subject.execute(input, "http-2");
    expect(first).toMatchObject({ status: "completed", replay: false });
    expect(retry).toMatchObject({ status: "completed", replay: true });
    if (first.status !== "completed" || retry.status !== "completed") throw new Error("expected completion");
    expect(first.result.invitationUrl).toBe(retry.result.invitationUrl);
    expect(first.result.invitationUrl).toMatch(/^\/projectceo\/invitations\/[A-Za-z0-9_-]{43}$/);
    const writes = calls.filter((call) => call.name === "projectceo_api.create_invitation");
    expect(writes).toHaveLength(2);
    expect(writes[0]?.args).toMatchObject({
      recipient_email: "person@example.test",
      role: "client_approver",
      expires_at: input.payload.expiresAt,
      token_digest: expect.stringMatching(/^\\x[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(writes)).not.toContain(String(first.result.invitationUrl));
    expect(writes[0]?.args.idempotency_key).toBe(writes[1]?.args.idempotency_key);
  });

  it("rejects an invitation expiry outside the server window without a write", async () => {
    const calls: Call[] = [];
    const result = await service(calls).execute(command("create_invitation", {
      recipientEmail: "person@example.test",
      targetRole: "architect",
      expiresAt: "2027-07-18T00:00:00.000Z",
    }), "expiry");
    expect(result).toMatchObject({ status: "error", error: { code: "validation_failed" } });
    expect(calls.some((call) => call.name === "projectceo_api.create_invitation")).toBe(false);
  });

  it("acknowledges only the request-bound recipient distribution and derives its exact hash", async () => {
    const calls: Call[] = [];
    const input = command("acknowledge_release", { distributionId });
    const subject = service(calls);
    const result = await subject.execute(input, "ack");
    const retry = await subject.execute(input, "ack-retry-before-read-catches-up");
    expect(result.status).toBe("completed");
    expect(retry).toMatchObject({ status: "completed", replay: true });
    expect(calls.find((call) => call.name === "projectceo_product_api.acknowledge_release_request_bound")?.args)
      .toMatchObject({ distribution_id: distributionId, expected_semantic_hash: semanticHash });
    const writes = calls.filter((call) => call.name === "projectceo_product_api.acknowledge_release_request_bound");
    expect(writes).toHaveLength(2);
    expect(writes[0]?.args.idempotency_key).toBe(writes[1]?.args.idempotency_key);

    const deniedCalls: Call[] = [];
    const denied = await service(deniedCalls, { recipientDistributions: [] }).execute(
      command("acknowledge_release", { distributionId }),
      "ack-denied",
    );
    expect(denied).toMatchObject({ status: "error", error: { code: "scope_conflict" } });
    expect(deniedCalls.some((call) => call.name === "projectceo_product_api.acknowledge_release_request_bound")).toBe(false);
  });

  it("returns a safe logical replay after an acknowledgement response is lost, including after restart", async () => {
    const input = command("acknowledge_release", { distributionId });
    const firstCalls: Call[] = [];
    expect((await service(firstCalls).execute(input, "ack-first")).status).toBe("completed");

    const retryCalls: Call[] = [];
    const retry = await service(retryCalls, {
      recipientDistributions: [{
        acknowledged: true,
        acknowledgedAt: "2026-07-18T00:01:00.000Z",
        artifactId: "artifact-1",
        distributedAt: "2026-07-18T00:00:00.000Z",
        distributionId,
        packageId,
        productionPackageVersionId: "package-v1",
        semanticHash,
      }],
    }).execute(input, "ack-retry");

    expect(retry).toMatchObject({
      status: "completed",
      operation: "acknowledge_release",
      replay: true,
      stateRevision: 9,
      result: {
        distributionId,
        semanticHash,
        acknowledgedAt: "2026-07-18T00:01:00.000Z",
      },
    });
    expect(retryCalls.some((call) => call.name === "projectceo_product_api.acknowledge_release_request_bound"))
      .toBe(false);
  });

  it("distributes only an authenticated-read artifact to an authenticated-read recipient", async () => {
    const calls: Call[] = [];
    const input = command("distribute_release", {
      productionPackageVersionId: "package-v1",
      recipientUserId,
    });
    const subject = service(calls);
    const result = await subject.execute(input, "distribute");
    const retry = await subject.execute(input, "distribute-retry");
    expect(result.status).toBe("completed");
    expect(retry).toMatchObject({ status: "completed", replay: true });
    expect(calls.find((call) => call.name === "projectceo_product_api.distribute_release_request_bound")?.args)
      .toMatchObject({ artifact_id: "artifact-1", recipient_user_id: recipientUserId });
    const writes = calls.filter((call) => call.name === "projectceo_product_api.distribute_release_request_bound");
    expect(writes).toHaveLength(2);
    expect(writes[0]?.args.idempotency_key).toBe(writes[1]?.args.idempotency_key);

    const deniedCalls: Call[] = [];
    const denied = await service(deniedCalls, { releaseRecipients: [] }).execute(command("distribute_release", {
      productionPackageVersionId: "package-v1",
      recipientUserId,
    }), "distribute-denied");
    expect(denied).toMatchObject({ status: "error", error: { code: "scope_conflict" } });
    expect(deniedCalls.some((call) => call.name === "projectceo_product_api.distribute_release_request_bound")).toBe(false);
  });

  it.each([
    command("revoke_invitation", { invitationId }),
    command("revoke_guest_grant", { grantId }),
    command("create_change", {
      reason: "Изменён материал покрытия",
      fromProductionPackageVersionId: "package-v1",
      deltaCostRub: 0,
      deltaDays: 0,
    }),
    // V1 Impact (DEC-033, OWNER GO 12.08.2026): ревью уже посчитанного влияния
    // вернулось сюда 12.08 — воркерный контур, которого ей не хватало, теперь
    // есть (`calculate_change_impact_policy_bound`). Остальные четыре команды
    // V2/V3 по-прежнему закрыты; проверка их закрытости — ниже.
    command("review_change_impact", {
      impactRunId,
      impactId: "impact-1",
      disposition: "resolved",
      reason: "Влияние проверено человеком",
    }),
  ])("keeps the accepted human command $kind request-bound", async (input) => {
    const calls: Call[] = [];
    const subject = service(calls);
    const result = await subject.execute(input, `request-${input.kind}`);
    const retry = await subject.execute(input, `retry-${input.kind}`);
    expect(result.status).toBe("completed");
    expect(retry).toMatchObject({ status: "completed", replay: true });
    const mutationCall = calls.find((call) => "idempotency_key" in call.args);
    expect(mutationCall?.args.idempotency_key).toBe(
      `ui:${projectId}:${input.kind}:${input.commandId}`,
    );
    expect(mutationCall?.args).not.toHaveProperty("actor_id");
    expect(mutationCall?.args).not.toHaveProperty("organization_id");
    expect(mutationCall?.args).not.toHaveProperty("role");

    const m4MutationByKind: Readonly<Partial<Record<ProjectCeoCommand["kind"], string>>> = {
      create_change: "projectceo_m4_api.submit_change_request",
      review_change_impact: "projectceo_m4_api.review_change_impact",
      upload_photo_evidence: "projectceo_m4_api.register_photo_evidence",
      review_photo_evidence: "projectceo_m4_api.review_photo_evidence",
      accept_milestone: "projectceo_m4_api.accept_milestone",
    };
    const m4Mutation = m4MutationByKind[input.kind];
    if (m4Mutation) {
      expect(calls.filter((call) => call.name === m4Mutation)).toHaveLength(1);
      expect(calls.filter((call) => call.name.includes("projectceo_m4_api.replay_"))).toHaveLength(2);
    }
  });

  it("appends a human-origin decision revision without requiring pre-registered evidence", async () => {
    const calls: Call[] = [];
    const decisionRevisionId = "cccccccc-1111-4ccc-8ccc-cccccccccccc";
    const input = command("create_decision", {
      packageId,
      nodeId: "decision-node-1",
      revisionId: decisionRevisionId,
      expectedRevisionId: null,
      claimStatus: "human_origin",
      title: "Kitchen island placement",
      resolution: "Island stays; move sink to the window wall.",
      areaNodeId: null,
      decisionStatus: "confirmed",
      evidence: [],
      reason: "Client decided on the walkthrough.",
    });
    const subject = service(calls);
    const first = await subject.execute(input, "decision-1");
    const retry = await subject.execute(input, "decision-2");
    expect(first).toMatchObject({ status: "completed", replay: false });
    expect(retry).toMatchObject({ status: "completed", replay: true });
    const writes = calls.filter((call) => call.name === "projectceo_product_api.append_decision_revision");
    expect(writes).toHaveLength(2);
    expect(writes[0]?.args).toMatchObject({
      project_id: projectId,
      package_id: packageId,
      node_id: "decision-node-1",
      revision_id: decisionRevisionId,
      expected_revision_id: null,
      claim_status: "human_origin",
      title: "Kitchen island placement",
      resolution: "Island stays; move sink to the window wall.",
      area_node_id: null,
      decision_status: "confirmed",
      evidence: [],
      reason: "Client decided on the walkthrough.",
    });
    expect(writes[0]?.args.idempotency_key).toBe(writes[1]?.args.idempotency_key);
  });

  it("appends a selection revision tied to a decision, carrying version-scoped evidence through untouched", async () => {
    const calls: Call[] = [];
    const evidence = [{
      evidenceVersionId: "version-1",
      evidenceLinkId: "link-1",
      sourceId: "source-1",
      sourceNodeId: "source-node-1",
      sourceRevisionId: "source-r1",
      fragmentId: "fragment-1",
    }];
    const input = command("create_selection", {
      packageId,
      nodeId: "selection-node-1",
      revisionId: "dddddddd-1111-4ddd-8ddd-dddddddddddd",
      expectedRevisionId: null,
      claimStatus: "extracted",
      title: "Countertop material",
      areaNodeId: "area-kitchen",
      decisionRevisionId: "decision-r1",
      specification: { material: "porcelain", finish: "matte" },
      evidence,
      reason: "From the supplier quote PDF.",
    });
    const result = await service(calls).execute(input, "selection-1");
    expect(result).toMatchObject({ status: "completed", replay: false });
    expect(calls.find((call) => call.name === "projectceo_product_api.append_selection_revision")?.args)
      .toMatchObject({
        project_id: projectId,
        package_id: packageId,
        node_id: "selection-node-1",
        claim_status: "extracted",
        area_node_id: "area-kitchen",
        decision_revision_id: "decision-r1",
        specification: { material: "porcelain", finish: "matte" },
        evidence,
      });
  });

  it("creates an approval package bundling a decision and a selection revision, then submits and reviews it", async () => {
    const calls: Call[] = [];
    const subject = service(calls);

    const created = await subject.execute(command("create_approval_package", {
      packageId,
      approvalPackageId: "approval-1",
      items: [
        { targetKind: "decision_revision", entityId: "decision-node-1", revisionId: "decision-r1" },
        { targetKind: "selection_revision", entityId: "selection-node-1", revisionId: "selection-r1" },
      ],
    }), "approval-create");
    expect(created).toMatchObject({ status: "completed", replay: false });
    expect(calls.find((call) => call.name === "projectceo_product_api.create_approval_package")?.args)
      .toMatchObject({
        project_id: projectId,
        package_id: packageId,
        approval_package_id: "approval-1",
        items: [
          { targetKind: "decision_revision", entityId: "decision-node-1", revisionId: "decision-r1" },
          { targetKind: "selection_revision", entityId: "selection-node-1", revisionId: "selection-r1" },
        ],
      });

    const submitted = await subject.execute(command("submit_approval_package", {
      approvalPackageId: "approval-1",
      expectedStatus: "draft",
    }), "approval-submit");
    expect(submitted).toMatchObject({ status: "completed", replay: false });
    expect(calls.find((call) => call.name === "projectceo_product_api.submit_approval_package")?.args)
      .toMatchObject({ approval_package_id: "approval-1", expected_status: "draft" });

    // review_selection: the capability name baked into
    // projectceo_product_api.review_approval_package's own authorization
    // check — it reviews the whole package, not a single selection revision.
    const reviewed = await subject.execute(command("review_selection", {
      approvalPackageId: "approval-1",
      expectedStatus: "submitted",
      decision: "approved",
      reason: "Matches the client's confirmed spec.",
    }), "approval-review");
    expect(reviewed).toMatchObject({ status: "completed", replay: false });
    expect(calls.find((call) => call.name === "projectceo_product_api.review_approval_package")?.args)
      .toMatchObject({
        approval_package_id: "approval-1",
        expected_status: "submitted",
        decision: "approved",
        reason: "Matches the client's confirmed spec.",
      });

    // Idempotent replay on the review step specifically.
    const retryReviewed = await subject.execute(command("review_selection", {
      approvalPackageId: "approval-1",
      expectedStatus: "submitted",
      decision: "approved",
      reason: "Matches the client's confirmed spec.",
    }), "approval-review-retry");
    expect(retryReviewed).toMatchObject({ status: "completed", replay: true });
  });

  it("derives the package version from the published baseline and publishes what was shown", async () => {
    // A′, вторая половина: клиент присылает только токен. Состав версии — это
    // состав опубликованного baseline целиком, а организация и проект в хеше
    // берутся из серверной области запроса, а не из тела команды.
    const packages = [{
      id: packageId,
      kind: "project_root",
      parentPackageId: null,
      stableKey: "root",
    }];
    const baselineRefs = {
      sources: ["source-r1"],
      requirements: [],
      assumptions: [],
      decisions: ["decision-r1"],
      selections: ["selection-r1"],
    };
    const snapshot = buildReleaseSnapshot({
      packageId,
      baselineId: "baseline-v2",
      previousVersionId: null,
      baselineRefs,
    });

    const calls: Call[] = [];
    const result = await service(calls, {
      packages,
      packageVersions: [],
      latestBaseline: { id: "baseline-v2", exactRevisionRefs: baselineRefs },
    }).execute(
      command("publish_release", { snapshotToken: snapshot.token }),
      "release-publish",
    );
    expect(result).toMatchObject({ status: "completed", replay: false });

    const published = calls.find((call) => (
      call.name === "projectceo_product_api.publish_production_package_version"
    ))?.args as { descriptor: Record<string, unknown> } | undefined;
    expect(published?.descriptor).toMatchObject({
      packageId,
      baselineId: "baseline-v2",
      previousVersionId: null,
      organizationId,
      projectId,
      schemaVersion: "project-ceo-production-package/0.1",
      exactRevisionRefs: baselineRefs,
    });
    expect(String(published?.descriptor.semanticHash)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("refuses the release with stale_state when a version was published after the preview", async () => {
    const baselineRefs = {
      sources: [],
      requirements: [],
      assumptions: [],
      decisions: ["decision-r1"],
      selections: [],
    };
    // Токен посчитан, когда версий ещё не было; читается состояние, где версия
    // уже есть, — значит подтверждают не то, что показывали.
    const stale = buildReleaseSnapshot({
      packageId,
      baselineId: "baseline-v2",
      previousVersionId: null,
      baselineRefs,
    });

    const calls: Call[] = [];
    const result = await service(calls, {
      packages: [{ id: packageId, kind: "project_root", parentPackageId: null, stableKey: "root" }],
      packageVersions: [{ id: "package-v1", packageId, versionNo: 1, baselineId: "baseline-v2" }],
      latestBaseline: { id: "baseline-v2", exactRevisionRefs: baselineRefs },
    }).execute(
      command("publish_release", { snapshotToken: stale.token }),
      "release-publish-stale",
    );
    expect(result).toMatchObject({ status: "error", error: { code: "stale_state" } });
    expect(calls.some((call) => (
      call.name === "projectceo_product_api.publish_production_package_version"
    ))).toBe(false);
  });

  it("does not offer a release when no baseline is published", async () => {
    const calls: Call[] = [];
    const result = await service(calls, {
      packages: [{ id: packageId, kind: "project_root", parentPackageId: null, stableKey: "root" }],
      latestBaseline: null,
    }).execute(
      command("publish_release", {
        snapshotToken: `sha256:${"0".repeat(64)}`,
      }),
      "release-publish-no-baseline",
    );
    expect(result).toMatchObject({ status: "unavailable", error: { code: "operation_unavailable" } });
  });

  it("derives the baseline itself and publishes exactly what the preview showed", async () => {
    // A′: клиент присылает только снапшот-токен. Состав выводит сервер по
    // правилу полноты, версию графа создаёт через дверь, хеш считает сам.
    const approvalPackages = [{
      id: "approval-1",
      status: "approved",
      createdAt: "2026-07-18T00:00:00.000Z",
      items: [
        { targetKind: "decision_revision", entityId: "decision-a", revisionId: "decision-r1" },
        { targetKind: "selection_revision", entityId: "selection-a", revisionId: "selection-r1" },
      ],
    }];
    const packages = [{
      id: packageId,
      kind: "project_root",
      parentPackageId: null,
      stableKey: "root",
    }];
    const snapshot = buildBaselineSnapshot({
      approvalPackages,
      packageIds: [packageId],
      previousBaselineId: "baseline-v2",
    });

    const calls: Call[] = [];
    const result = await service(calls, {
      approvalPackages,
      packages,
      latestBaseline: { id: "baseline-v2", graphVersionId: "graph-v2" },
    }).execute(
      command("publish_baseline", { snapshotToken: snapshot.token }),
      "baseline-publish",
    );
    expect(result).toMatchObject({ status: "completed", replay: false });

    // Версия графа создаётся раньше baseline и именно через дверь: без неё RPC
    // ответила бы not_found graphVersion.
    const version = calls.find((call) => call.name === "projectceo_api.publish_version");
    expect(version?.args).toMatchObject({
      project_id: projectId,
      expected_latest_version_id: "graph-v2",
    });

    const published = calls.find((call) => (
      call.name === "projectceo_product_api.publish_project_baseline"
    ))?.args as { descriptor: Record<string, unknown> } | undefined;
    expect(published?.descriptor).toMatchObject({
      graphVersionId: "graph-v3",
      previousBaselineId: "baseline-v2",
      decisionRevisionIds: ["decision-r1"],
      selectionRevisionIds: ["selection-r1"],
      approvalPackageIds: ["approval-1"],
      packageIds: [packageId],
    });
    expect(String(published?.descriptor.semanticHash)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("refuses with stale_state when the state moved after the preview", async () => {
    // Токен посчитан по одному составу, а читается другой — публиковать не
    // показанное нельзя, и до RPC дело не доходит.
    const stale = buildBaselineSnapshot({
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        createdAt: "2026-07-18T00:00:00.000Z",
        items: [{
          targetKind: "decision_revision",
          entityId: "decision-a",
          revisionId: "decision-r1",
        }],
      }],
      packageIds: [packageId],
      previousBaselineId: null,
    });

    const calls: Call[] = [];
    const result = await service(calls, {
      approvalPackages: [{
        id: "approval-1",
        status: "approved",
        createdAt: "2026-07-18T00:00:00.000Z",
        items: [
          // Состояние сдвинулось: одобрили ВТОРУЮ сущность. Именно вторую, а не
          // вторую ревизию первой: с 11.08 повторное одобрение той же сущности
          // состав не расширяет — побеждает поздняя ревизия.
          { targetKind: "decision_revision", entityId: "decision-a", revisionId: "decision-r1" },
          { targetKind: "decision_revision", entityId: "decision-b", revisionId: "decision-r2" },
        ],
      }],
      packages: [{ id: packageId, kind: "project_root", parentPackageId: null, stableKey: "root" }],
      latestBaseline: null,
    }).execute(
      command("publish_baseline", { snapshotToken: stale.token }),
      "baseline-stale",
    );

    expect(result).toMatchObject({ status: "error", error: { code: "stale_state" } });
    expect(calls.some((call) => call.name === "projectceo_api.publish_version")).toBe(false);
    expect(calls.some((call) => (
      call.name === "projectceo_product_api.publish_project_baseline"
    ))).toBe(false);
  });

  it.each([
    // Сборка handover — воркерный путь с отдельным allowlist (AP3 §10);
    // человеческой команды нет намеренно.
    "build_handover",
  ] as const)("keeps unsupported %s fail-closed without reads or writes", async (kind) => {
    const calls: Call[] = [];
    const result = await service(calls).execute(command(kind, {}), `unavailable-${kind}`);
    expect(result).toMatchObject({ status: "unavailable", error: { code: "operation_unavailable" } });
    expect(calls).toEqual([]);
  });

  // V2/V3 модуля 4 закрыты НЕЗАВИСИМО от флага. Здесь модуль включён
  // (`service()` передаёт executionEnabled = "true"), и всё равно каждая из
  // четырёх команд обязана отказать до единого чтения и записи: A6 §1.1 их не
  // открывал, DEC-033 не расширяет открытие сверх ревью влияния, а включение
  // модуля не имеет права открывать неавторизованное.
  it.each([
    command("upload_photo_evidence", {
      milestoneId,
      areaNodeId: "area-1",
      sourceId: "source-1",
      sourceRevisionId: "source-revision-1",
      capturedAt: "2026-07-18T01:00:00.000Z",
      note: null,
    }),
    command("review_photo_evidence", {
      photoEvidenceId,
      decision: "accepted",
      reason: "Фото соответствует этапу",
    }),
    command("accept_milestone", { milestoneId }),
    command("build_handover", {}),
  ])(
    "keeps the unauthorized V2/V3 command $kind closed with the module enabled",
    async (input) => {
      const calls: Call[] = [];
      const result = await service(calls).execute(input, `increment2-${input.kind}`);
      expect(result).toMatchObject({
        status: "unavailable",
        error: { code: "operation_unavailable" },
      });
      expect(calls).toEqual([]);
    },
  );

  // Пока модуль 3 выключен, intake не существует для пользователя: отказ
  // приходит до единого чтения или записи (A5 §4.2.2).
  it.each([
    "register_source",
    "review_source",
    "register_documentation_sheet",
    "attach_documentation_sheet_specifications",
  ] as const)(
    "keeps %s closed while the documentation module is disabled",
    async (kind) => {
      const calls: Call[] = [];
      const payload = kind === "register_documentation_sheet"
        ? {
            packageId,
            handoffId: "cycle6-handoff",
            handoffRevisionId: "handoff-r1",
            sheetId: "m3-sheet-a101",
            sheetNumber: "A-101",
            title: "План расстановки",
            revisionId: "sheet-r1",
            specificationRevisionIds: [],
            reason: "Регистрация листа",
          }
        : kind === "attach_documentation_sheet_specifications"
          ? {
              packageId,
              sheetId: "m3-sheet-a101",
              revisionId: "sheet-r2",
              expectedRevisionId: "sheet-r1",
              specificationRevisionIds: ["selection-a@1"],
              reason: "Привязка выбора",
            }
        : kind === "register_source"
        ? {
            packageId,
            physicalRecordId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            sanitizedName: "AR-01_plan.pdf",
            floorId: "floor-1",
            zoneId: "zone-1",
            disciplineId: "AR",
            availability: "placeholder" as const,
            documentStatus: "current" as const,
            sizeBytes: null,
            checksum: null,
            sourceRevisionId: null,
            semanticConflict: false,
          }
        : {
            targetRevisionId: "source-r1",
            expectedRevisionId: "source-r1",
            decision: "confirmed" as const,
          };
      const result = await service(calls, {}, "false")
        .execute(command(kind, payload), `disabled-${kind}`);
      expect(result).toMatchObject({
        status: "unavailable",
        error: { code: "operation_unavailable" },
      });
      expect(calls).toEqual([]);
    },
  );

  // Intake M3 P0. Одна команда — один документ; план импорта собирает сервер,
  // браузер его не присылает и подменить не может.
  it("registers one inventory record with a server-derived import plan", async () => {
    const calls: Call[] = [];
    const result = await service(calls).execute(command("register_source", {
      packageId,
      physicalRecordId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sanitizedName: "AR-01_plan.pdf",
      floorId: "floor-1",
      zoneId: "zone-1",
      disciplineId: "AR",
      availability: "materialized",
      documentStatus: "current",
      sizeBytes: 2048,
      checksum: "b".repeat(64),
      sourceRevisionId: "source-r1",
      semanticConflict: false,
    }), "register-source");
    expect(result).toMatchObject({ status: "completed", replay: false });
    const call = calls.find((entry) => entry.name === "projectceo_api.register_source_inventory");
    expect(call?.args).toMatchObject({
      project_id: projectId,
      expected_state_revision: 9,
      import_plan: { projectId, packageId, origin: "projectceo_command" },
    });
    expect((call?.args.records as readonly Record<string, unknown>[])).toHaveLength(1);
    expect((call?.args.records as readonly Record<string, unknown>[])[0]).toMatchObject({
      physicalRecordId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      hierarchy: { projectId, packageId, floorId: "floor-1", zoneId: "zone-1", disciplineId: "AR" },
      availability: "materialized",
      checksum: "b".repeat(64),
    });
  });

  // Происхождение листа команда не несёт: сервер выведет его из handoff.
  it("registers a documentation sheet against the published handoff", async () => {
    const calls: Call[] = [];
    const result = await service(calls).execute(command("register_documentation_sheet", {
      packageId,
      handoffId: "cycle6-handoff",
      handoffRevisionId: "handoff-r1",
      sheetId: "m3-sheet-a101",
      sheetNumber: "A-101",
      title: "План расстановки",
      revisionId: "sheet-r1",
      specificationRevisionIds: [],
      reason: "Регистрация листа A-101 по согласованному решению M2",
    }), "register-sheet");
    expect(result).toMatchObject({ status: "completed", replay: false });
    const call = calls.find((entry) => entry.name === "projectceo_m3_api.register_documentation_sheet");
    expect(call?.args).toMatchObject({
      project_id: projectId,
      package_id: packageId,
      handoff_id: "cycle6-handoff",
      handoff_revision_id: "handoff-r1",
      sheet_id: "m3-sheet-a101",
      expected_state_revision: 9,
    });
    // Ни комнаты, ни подписи, ни коммита в аргументах нет — их выводит сервер.
    expect(Object.keys(call?.args ?? {})).not.toEqual(
      expect.arrayContaining(["room_id", "semantic_hash", "approved_m2_commit_revision_id"]),
    );
  });

  it("attaches specifications as a new sheet revision", async () => {
    const calls: Call[] = [];
    const result = await service(calls).execute(command("attach_documentation_sheet_specifications", {
      packageId,
      sheetId: "m3-sheet-a101",
      revisionId: "sheet-r2",
      expectedRevisionId: "sheet-r1",
      specificationRevisionIds: ["selection-a@1"],
      reason: "Привязка утверждённого выбора к листу A-101",
    }), "attach-sheet");
    expect(result).toMatchObject({ status: "completed", replay: false });
    expect(calls.find((entry) => entry.name === "projectceo_m3_api.attach_documentation_sheet_specifications")?.args)
      .toMatchObject({
        sheet_id: "m3-sheet-a101",
        revision_id: "sheet-r2",
        expected_revision_id: "sheet-r1",
        specification_revision_ids: ["selection-a@1"],
        expected_state_revision: 9,
      });
  });

  it("reviews only a source revision this human can already see, and only once", async () => {
    // Вызов идёт в `projectceo_api.review_source` — тонкую дверь в отданной
    // схеме (миграция `20260810050000`), а не напрямую в
    // `project_intelligence_api.review_claim`: та схема намеренно не отдана
    // Data API (`supabase/config.toml`, и `verify-runtime.mjs` требует от неё
    // 406), из браузера её не видно, и AP5 получал на ней 500.
    const pendingSource = {
      availability: "materialized",
      checksum: "b".repeat(64),
      disciplineKey: "AR",
      documentStatus: "current",
      floorKey: "floor-1",
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      kind: "pdf",
      logicalSourceId: "source-1",
      mediaType: "application/pdf",
      packageId,
      reviewStatus: "pending",
      reviewTargetRevisionId: "source-r1",
      sanitizedName: "AR-01_plan.pdf",
      semanticConflict: false,
      sizeBytes: 2048,
      sourceRevisionId: "source-r1",
      sourceRole: "architecture",
      zoneKey: "zone-1",
    };
    const calls: Call[] = [];
    const result = await service(calls, { sources: [pendingSource] }).execute(
      command("review_source", {
        targetRevisionId: "source-r1",
        expectedRevisionId: "source-r1",
        decision: "confirmed",
      }),
      "review-source",
    );
    expect(result).toMatchObject({ status: "completed", replay: false });
    expect(calls.find((entry) => entry.name === "projectceo_api.review_source")?.args)
      .toMatchObject({
        project_id: projectId,
        target_revision_id: "source-r1",
        expected_revision_id: "source-r1",
        decision: "confirmed",
        expected_state_revision: 9,
      });
    // Приватная схема из приложения не зовётся вовсе — иначе дверь не нужна.
    expect(calls.some((entry) => entry.name === "project_intelligence_api.review_claim")).toBe(false);

    // Ревизия вне видимых источников — отказ до сети.
    const unknownCalls: Call[] = [];
    const unknown = await service(unknownCalls, { sources: [pendingSource] }).execute(
      command("review_source", {
        targetRevisionId: "source-r9",
        expectedRevisionId: "source-r9",
        decision: "confirmed",
      }),
      "review-source-unknown",
    );
    expect(unknown).toMatchObject({ status: "error", error: { code: "not_found" } });
    expect(unknownCalls.some((entry) => entry.name === "projectceo_api.review_source")).toBe(false);

    // Уже решённая ревизия не пересматривается этой командой.
    const decidedCalls: Call[] = [];
    const decided = await service(decidedCalls, {
      sources: [{ ...pendingSource, reviewStatus: "confirmed" }],
    }).execute(
      command("review_source", {
        targetRevisionId: "source-r1",
        expectedRevisionId: "source-r1",
        decision: "rejected",
      }),
      "review-source-decided",
    );
    expect(decided).toMatchObject({ status: "error", error: { code: "scope_conflict" } });
    expect(decidedCalls.some((entry) => entry.name === "projectceo_api.review_source")).toBe(false);
  });

  /**
   * Идемпотентность публикации baseline: повтор той же команды обязан вернуть
   * прежний результат, а не конфликт.
   *
   * Метка версии графа раньше содержала текущее время. Она входит в request
   * digest RPC, поэтому повтор после потери ответа приходил с ДРУГИМ digest и
   * получал `idempotency_conflict` — то есть ключ идемпотентности существовал,
   * а идемпотентности не было. Метка стала производной от `commandId`, и этот
   * тест держит её такой: два вызова с одним `commandId` обязаны послать
   * побайтово одинаковые аргументы.
   */
  it("sends a byte-identical version label when the same command repeats", async () => {
    const packages = [{ id: packageId, kind: "project_root", parentPackageId: null, stableKey: "root" }];
    const approvalPackages = [{
      id: "approval-1",
      status: "approved",
      createdAt: "2026-07-18T00:00:00.000Z",
      items: [{
        targetKind: "decision_revision",
        entityId: "decision-a",
        revisionId: "decision-r1",
      }],
    }];
    const snapshot = buildBaselineSnapshot({
      approvalPackages,
      packageIds: [packageId],
      previousBaselineId: null,
    });
    const overrides = { approvalPackages, packages, latestBaseline: null };

    const first: Call[] = [];
    await service(first, overrides).execute(
      // Хелпер `command` даёт фиксированный commandId — именно то, что
      // совпадает у повтора одной и той же команды.
      command("publish_baseline", { snapshotToken: snapshot.token }),
      "baseline-idempotency-1",
    );
    const second: Call[] = [];
    await service(second, overrides).execute(
      command("publish_baseline", { snapshotToken: snapshot.token }),
      "baseline-idempotency-2",
    );

    const label = (calls: Call[]) => calls
      .find((call) => call.name === "projectceo_api.publish_version")?.args.label;
    expect(label(first)).toBe(label(second));
    expect(String(label(first))).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  /**
   * Граница приложения у guardrail модуля 3 (решение владельца 11.08).
   *
   * Существенно не только то, что команда отказывает, но и КОГДА: до первого
   * RPC. Отказ после чтения проекта означал бы, что выключенный модуль всё ещё
   * ходит в базу — и что запрет держится на удаче, а не на порядке проверок.
   * Поэтому проверяется пустой список вызовов, а не только код ответа.
   */
  it.each(["publish_baseline", "publish_release"] as const)(
    "refuses %s before any RPC while the documentation module is off",
    async (kind) => {
      const calls: Call[] = [];
      const payload = kind === "publish_baseline"
        ? { snapshotToken: `sha256:${"0".repeat(64)}` }
        : { snapshotToken: `sha256:${"0".repeat(64)}` };
      const result = await service(calls, {}, "false").execute(
        command(kind, payload),
        `m3-guardrail-${kind}`,
      );

      expect(result).toMatchObject({
        status: "unavailable",
        error: { code: "operation_unavailable" },
      });
      expect(calls).toEqual([]);
    },
  );
});
