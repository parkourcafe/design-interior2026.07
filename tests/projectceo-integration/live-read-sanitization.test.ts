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
      if (schemaName === "projectceo_read_api" && functionName === "get_project_workspace_read_v7") {
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
            m2ApprovedCommits: [],
            m2ClientReviewSubmissions: [],
            m2ClientReviews: [],
            m2M3Handoffs: [],
            m2LayoutVersions: [],
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
  it("fails closed for malformed nested v6 client-review submissions", async () => {
    const variant = (role: string, suffix: string): {
      role: string;
      variantId: string;
      layoutDocumentId: string;
      layoutVersionId: string;
      layoutRevisionId: string;
      semanticHash: string;
      selectionRevisionIds: string[];
      budget: {
        amountRub: number;
        staleSelectionRevisionIds: string[];
        missingPriceSelectionRevisionIds: string[];
      };
    } => ({
      role, variantId: `variant-${suffix}`, layoutDocumentId: `layout-${suffix}`,
      layoutVersionId: `layout-${suffix}@1`, layoutRevisionId: `88888888-8888-4888-8888-88888888888${suffix}`,
      semanticHash: `sha256:${suffix.repeat(64)}`, selectionRevisionIds: [`selection-${suffix}`],
      budget: { amountRub: 125000, staleSelectionRevisionIds: [], missingPriceSelectionRevisionIds: [] },
    });
    const valid = {
      id: "submission-v6", packageId, revisionId: "99999999-9999-4999-8999-999999999999", revisionNo: 1,
      assignedClientUserId: "66666666-6666-4666-8666-666666666666", createdAt: "2026-08-06T10:00:00Z",
      payload: { approvalPackageId: "approval-v6", roomId: "room-v6", designIntentRevisionId: "decision-v6",
        budgetAsOf: "2026-08-06T10:00:00Z", staleAfterDays: 30,
        variants: [variant("preferred", "1"), variant("value_engineered", "2"), variant("premium", "3")] },
    };
    const malformed: Array<(item: typeof valid) => void> = [
      (item) => { Object.assign(item.payload, { extra: true }); },
      (item) => { Reflect.deleteProperty(item.payload, "roomId"); },
      (item) => { item.payload.variants[2]!.role = "preferred"; },
      (item) => { item.payload.variants[2]!.variantId = item.payload.variants[0]!.variantId; },
      (item) => { item.payload.variants[0]!.layoutRevisionId = "not-a-uuid"; },
      (item) => { item.payload.variants[0]!.semanticHash = "sha256:abc"; },
      (item) => { item.payload.budgetAsOf = "06.08.2026"; },
      (item) => { item.payload.variants[0]!.budget.amountRub = -1; },
      (item) => { item.payload.variants[0]!.budget.staleSelectionRevisionIds = ["selection-other"]; },
    ];
    for (const mutate of malformed) {
      const item = structuredClone(valid);
      mutate(item);
      const result = await new ProjectCeoLiveReadPort(fakeClient({ m2ClientReviewSubmissions: [item] }), {
        userId: "66666666-6666-4666-8666-666666666666", displayName: "Controlled user",
      }).getProjectWorkspace({ projectId, requestId: "ui:v6-malformed" });
      if (result.error) {
        expect(result.data).toBeNull();
        expect(["validation_failed", "internal_error"]).toContain(result.error.code);
      } else {
        expect(result.data?.m2ClientReviewSubmissions).toEqual([]);
      }
    }
  });

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

  // Intake M3 P0: поверхность открыта, но ровно по тем правам, которые
  // проверит сервер, и только когда есть что рецензировать.
  it("offers source intake by capability, and never offers a review it cannot deliver", async () => {
    const previous = process.env.REMHAOS_DOCUMENTATION_ENABLED;
    process.env.REMHAOS_DOCUMENTATION_ENABLED = "true";
    try {
    const pending = {
      id: "source-pending",
      sourceRevisionId: "source-pending-r1",
      reviewTargetRevisionId: "source-pending-r1",
      packageId,
      checksum: "c".repeat(64),
      mediaType: "application/pdf",
      sourceRole: "document",
      documentStatus: "current",
      availability: "materialized",
      reviewStatus: "pending",
    };

    const architect = await new ProjectCeoLiveReadPort(
      fakeClient({ sources: [pending] }, [{ ...defaultProjectEntries[0], role: "architect" }]),
      { userId: "66666666-6666-4666-8666-666666666666", displayName: "Architect" },
    ).getProjectWorkspace({ projectId, requestId: "intake-architect" });
    expect(architect.data?.operations.register_source).toEqual({ status: "available" });
    // Ревизия ждёт решения, право у роли есть — и всё равно не предлагаем.
    // Решение пишет project_intelligence_api.review_claim, а эта схема не
    // отдана Data API: вызов не доходит до RPC. Обещать действие, которое
    // сервер не выполнит, нельзя — AP5 получал на нём 500.
    expect(architect.data?.operations.review_source).toEqual({
      status: "unavailable",
      reason: "read_contract_pending",
    });

    // Строитель заводит источники, но решений по ним не принимает:
    // review_claim у него нет, и обещать действие нельзя.
    const builder = await new ProjectCeoLiveReadPort(
      fakeClient({ sources: [pending] }, [{ ...defaultProjectEntries[0], role: "builder" }]),
      { userId: "66666666-6666-4666-8666-666666666666", displayName: "Builder" },
    ).getProjectWorkspace({ projectId, requestId: "intake-builder" });
    expect(builder.data?.operations.register_source).toEqual({ status: "available" });
    expect(builder.data?.operations.review_source).toEqual({
      status: "unavailable",
      reason: "capability_missing",
    });

    // Клиент не заводит источники вовсе.
    const client = await new ProjectCeoLiveReadPort(
      fakeClient({ sources: [pending] }, [{ ...defaultProjectEntries[0], role: "client_approver" }]),
      { userId: "66666666-6666-4666-8666-666666666666", displayName: "Client" },
    ).getProjectWorkspace({ projectId, requestId: "intake-client" });
    expect(client.data?.operations.register_source).toEqual({
      status: "unavailable",
      reason: "capability_missing",
    });
    } finally {
      if (previous === undefined) delete process.env.REMHAOS_DOCUMENTATION_ENABLED;
      else process.env.REMHAOS_DOCUMENTATION_ENABLED = previous;
    }
  });

  // Листы, которые нельзя прочитать, для пользователя не существуют. Раздел
  // документации собирается из проекции, а комплектность считает код модуля.
  it("builds the documentation section from the projection and names what is missing", async () => {
    const previous = process.env.REMHAOS_DOCUMENTATION_ENABLED;
    process.env.REMHAOS_DOCUMENTATION_ENABLED = "true";
    const hash = `sha256:${"d".repeat(64)}`;
    const projection = {
      m3DocumentationSheets: [{
        sheetId: "sheet-a101",
        packageId,
        roomId: "living-room",
        sheetNumber: "A-101",
        title: "План расстановки",
        revisionId: "sheet-r2",
        revisionNo: 2,
        specificationRevisionIds: ["selection-a@1"],
        reason: "Привязка утверждённого выбора",
        createdByUserId: "66666666-6666-4666-8666-666666666666",
        origin: {
          handoffId: "handoff-1",
          handoffRevisionId: "handoff-r1",
          handoffContractVersion: "archidom.m2-to-m3-handoff/0.1",
          approvedM2CommitRevisionId: "commit-r1",
          designIntentRevisionId: "intent-r1",
          layoutDocumentId: "layout-1",
          layoutVersionId: "layout-1@1",
          layoutRevisionId: "layout-r1",
          semanticHash: hash,
        },
        createdAt: "2026-08-10T00:00:00Z",
      }],
      m3DocumentationHandoffs: [{
        handoffId: "handoff-1",
        revisionId: "handoff-r1",
        contractVersion: "archidom.m2-to-m3-handoff/0.1",
        packageId,
        roomId: "living-room",
        approvedM2CommitRevisionId: "commit-r1",
        designIntentRevisionId: "intent-r1",
        layout: {
          documentId: "layout-1",
          versionId: "layout-1@1",
          revisionId: "layout-r1",
          semanticHash: hash,
        },
        // Второй утверждённый выбор ни на одном листе не отражён.
        selectionRevisionIds: ["selection-a@1", "selection-b@1"],
      }],
    };
    try {
      const result = await new ProjectCeoLiveReadPort(
        fakeClient(projection, [{ ...defaultProjectEntries[0], role: "architect" }]),
        { userId: "66666666-6666-4666-8666-666666666666", displayName: "Architect" },
      ).getProjectWorkspace({ projectId, requestId: "documentation-section" });

      expect(result.data?.documentation?.sheets).toEqual([{
        sheetId: "sheet-a101",
        packageId,
        sheetNumber: "A-101",
        title: "План расстановки",
        roomId: "living-room",
        revisionId: "sheet-r2",
        revisionNo: 2,
        specificationRevisionIds: ["selection-a@1"],
        layoutSemanticHash: hash,
        approvedM2CommitRevisionId: "commit-r1",
      }]);
      expect(result.data?.documentation?.completeness).toEqual([{
        handoffId: "handoff-1",
        handoffRevisionId: "handoff-r1",
        packageId,
        roomId: "living-room",
        complete: false,
        findings: [{ code: "SPECIFICATION_NOT_COVERED", subject: "selection-b@1" }],
      }]);
    } finally {
      if (previous === undefined) delete process.env.REMHAOS_DOCUMENTATION_ENABLED;
      else process.env.REMHAOS_DOCUMENTATION_ENABLED = previous;
    }
  });

  // Команды листа предлагаются по данным: без опубликованного handoff
  // регистрировать не от чего, без листа — нечего дополнять.
  it("offers sheet commands only when their prerequisites exist", async () => {
    const previous = process.env.REMHAOS_DOCUMENTATION_ENABLED;
    process.env.REMHAOS_DOCUMENTATION_ENABLED = "true";
    try {
      const empty = await new ProjectCeoLiveReadPort(
        fakeClient({}, [{ ...defaultProjectEntries[0], role: "architect" }]),
        { userId: "66666666-6666-4666-8666-666666666666", displayName: "Architect" },
      ).getProjectWorkspace({ projectId, requestId: "sheet-commands-empty" });
      expect(empty.data?.operations.register_documentation_sheet).toEqual({
        status: "unavailable",
        reason: "prerequisite_missing",
      });
      expect(empty.data?.operations.attach_documentation_sheet_specifications).toEqual({
        status: "unavailable",
        reason: "prerequisite_missing",
      });

      const ready = await new ProjectCeoLiveReadPort(
        fakeClient({
          m3DocumentationHandoffs: [{
            handoffId: "handoff-1",
            revisionId: "handoff-r1",
            contractVersion: "archidom.m2-to-m3-handoff/0.1",
            packageId,
            roomId: "living-room",
            approvedM2CommitRevisionId: "commit-r1",
            designIntentRevisionId: "intent-r1",
            layout: {
              documentId: "layout-1",
              versionId: "layout-1@1",
              revisionId: "layout-r1",
              semanticHash: `sha256:${"d".repeat(64)}`,
            },
            selectionRevisionIds: ["selection-a@1"],
          }],
          m3DocumentationSheets: [],
        }, [{ ...defaultProjectEntries[0], role: "architect" }]),
        { userId: "66666666-6666-4666-8666-666666666666", displayName: "Architect" },
      ).getProjectWorkspace({ projectId, requestId: "sheet-commands-ready" });
      expect(ready.data?.operations.register_documentation_sheet).toEqual({ status: "available" });
      // Листов ещё нет — дополнять нечего.
      expect(ready.data?.operations.attach_documentation_sheet_specifications).toEqual({
        status: "unavailable",
        reason: "prerequisite_missing",
      });

      // Клиент-утверждающий не готовит документацию.
      const client = await new ProjectCeoLiveReadPort(
        fakeClient({}, [{ ...defaultProjectEntries[0], role: "client_approver" }]),
        { userId: "66666666-6666-4666-8666-666666666666", displayName: "Client" },
      ).getProjectWorkspace({ projectId, requestId: "sheet-commands-client" });
      expect(client.data?.operations.register_documentation_sheet).toEqual({
        status: "unavailable",
        reason: "capability_missing",
      });
    } finally {
      if (previous === undefined) delete process.env.REMHAOS_DOCUMENTATION_ENABLED;
      else process.env.REMHAOS_DOCUMENTATION_ENABLED = previous;
    }
  });

  // Роль, которой проекция листов не отдаёт, не получает и пустого раздела:
  // «нет доступа» и «пусто» — разные утверждения.
  it("has no documentation section when the projection carries no M3 keys", async () => {
    const previous = process.env.REMHAOS_DOCUMENTATION_ENABLED;
    process.env.REMHAOS_DOCUMENTATION_ENABLED = "true";
    try {
      const result = await new ProjectCeoLiveReadPort(
        fakeClient({}, [{ ...defaultProjectEntries[0], role: "architect" }]),
        { userId: "66666666-6666-4666-8666-666666666666", displayName: "Architect" },
      ).getProjectWorkspace({ projectId, requestId: "documentation-absent" });
      expect(result.data?.documentation).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.REMHAOS_DOCUMENTATION_ENABLED;
      else process.env.REMHAOS_DOCUMENTATION_ENABLED = previous;
    }
  });

  // Выключенный модуль 3 закрывает поверхность всем, включая архитектора.
  it("hides source intake entirely while the documentation module is disabled", async () => {
    const previous = process.env.REMHAOS_DOCUMENTATION_ENABLED;
    delete process.env.REMHAOS_DOCUMENTATION_ENABLED;
    try {
      const result = await new ProjectCeoLiveReadPort(
        fakeClient({}, [{ ...defaultProjectEntries[0], role: "architect" }]),
        { userId: "66666666-6666-4666-8666-666666666666", displayName: "Architect" },
      ).getProjectWorkspace({ projectId, requestId: "intake-disabled" });
      expect(result.data?.operations.register_source).toEqual({
        status: "unavailable",
        reason: "module_disabled",
      });
      expect(result.data?.operations.review_source).toEqual({
        status: "unavailable",
        reason: "module_disabled",
      });
    } finally {
      if (previous !== undefined) process.env.REMHAOS_DOCUMENTATION_ENABLED = previous;
    }
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
      "get_project_workspace_read_v7",
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
