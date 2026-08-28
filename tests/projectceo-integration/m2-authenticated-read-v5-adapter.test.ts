import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ProjectCeoAuthenticatedReadPostgresAdapter,
  type AuthenticatedProjectReadControlledError,
  type AuthenticatedProjectReadProjection,
  type AuthenticatedProjectReadResult,
  type AuthenticatedReadM2ApprovedCommit,
  type AuthenticatedReadM2ApprovedCommitPayload,
  type AuthenticatedReadM2LayoutVersion,
  type PostgresRpcClient,
} from "../../lib/project-intelligence/adapters/postgres";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333";
const actorUserId = "44444444-4444-4444-8444-444444444444";
const approvedCommitRevisionId = "55555555-5555-4555-8555-555555555555";
const layoutRevisionId = "66666666-6666-4666-8666-666666666666";

type MutableApprovedCommitFixture = {
  id: string;
  packageId: string;
  revisionId: string;
  revisionNo: number;
  status: "approved";
  payload: {
    approvalPackageId: string;
    roomId: string;
    designIntentRevisionId: string;
    chosenVariant: {
      variantId: string;
      role: "preferred" | "value_engineered" | "premium";
      layoutDocumentId: string;
      layoutVersionId: string;
      semanticHash: `sha256:${string}`;
    };
    approvedSelectionRevisionIds: string[];
    budget: {
      asOf: string;
      staleAfterDays: number;
      amountRub?: number;
      staleSelectionRevisionIds: string[];
      missingPriceSelectionRevisionIds: string[];
    };
    submittedAt: string;
    reviewedAt: string;
    submissionReason: string;
    reviewReason: string;
  };
  createdAt: string;
};

type ExpectedLayoutVersionFixture = AuthenticatedReadM2LayoutVersion & {
  documentId: string;
  versionId: string;
  semanticHash: `sha256:${string}`;
  roomId: string;
  variantId: string;
  role: "preferred" | "value_engineered" | "premium";
  schemaVersion: "project-ceo-m2-layout/0.1";
};

const approvedCommit: MutableApprovedCommitFixture = {
  id: "living-room-approved-commit",
  packageId,
  revisionId: approvedCommitRevisionId,
  revisionNo: 1,
  status: "approved",
  payload: {
    approvalPackageId: "approval-package-42",
    roomId: "living-room",
    designIntentRevisionId: "design-intent@4",
    chosenVariant: {
      variantId: "variant-preferred",
      role: "preferred",
      layoutDocumentId: "living-room-layout",
      layoutVersionId: "living-room-layout@3",
      semanticHash: `sha256:${"a".repeat(64)}`,
    },
    approvedSelectionRevisionIds: ["selection-chair@2", "selection-table@4"],
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
    reviewReason: "Вариант и подборы согласованы",
  },
  createdAt: "2026-08-06T04:00:00.000Z",
};

const layoutVersion: ExpectedLayoutVersionFixture = {
  id: "living-room-layout",
  documentId: "living-room-layout",
  versionId: "living-room-layout@3",
  packageId,
  revisionId: layoutRevisionId,
  revisionNo: 3,
  semanticHash: `sha256:${"a".repeat(64)}`,
  roomId: "living-room",
  variantId: "variant-preferred",
  role: "preferred",
  schemaVersion: "project-ceo-m2-layout/0.1",
  status: "published",
  payload: {
    versionId: "living-room-layout@3",
    roomId: "living-room",
    variantId: "variant-preferred",
    role: "preferred",
    semanticHash: `sha256:${"a".repeat(64)}`,
    schemaVersion: "project-ceo-m2-layout/0.1",
    layoutContent: { documentId: "living-room-layout" },
  },
  createdAt: "2026-08-06T05:00:00.000Z",
};

function envelope(dataOverrides: Readonly<Record<string, unknown>> = {}) {
  return {
    contractVersion: "project-ceo-authenticated-read/0.1",
    requestId: "db:m2-read-v5",
    data: {
      approvalPackages: [],
      decisions: [],
      distributionSummary: [],
      executionPackages: [],
      extensionStatus: { workspaceRead: "durable_ap1" },
      latestBaseline: null,
      m2ApprovedCommits: [approvedCommit],
      m2LayoutVersions: [layoutVersion],
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
        name: "Kora Food Hall",
      },
      recipientDistributions: [],
      releaseArtifacts: [],
      releaseRecipients: [],
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
      ...dataOverrides,
    },
    error: null,
    scope: {
      accessScope: "package",
      actorUserId,
      organizationId,
      packageId,
      projectId,
    },
    stateRevision: 41,
  };
}

function cloneApprovedCommit(): MutableApprovedCommitFixture {
  return structuredClone(approvedCommit);
}

function cloneLayoutVersion(): ExpectedLayoutVersionFixture {
  return structuredClone(layoutVersion);
}

function clientReturning(
  value: unknown,
  calls: Array<{
    readonly schema: string;
    readonly functionName: string;
    readonly args: Readonly<Record<string, unknown>> | undefined;
  }> = [],
): PostgresRpcClient {
  return {
    schema(schema) {
      return {
        rpc(functionName, args) {
          calls.push({ schema, functionName, args });
          return Promise.resolve({ data: value, error: null });
        },
      };
    },
  };
}

function controlledErrorEnvelope(
  code: "forbidden" | "not_found" | "validation_failed",
) {
  return {
    contractVersion: "project-ceo-authenticated-read/0.1",
    requestId: `db:m2-read-v5:${code}`,
    data: null,
    error: {
      code,
      messageKey: `projectceo.read.${code}`,
    },
    scope: null,
    stateRevision: null,
  };
}

describe("M2 authenticated read v5 postgres adapter", () => {
  it("uses only read v5 and exposes exact approved-commit and typed layout-version projections", async () => {
    const calls: Array<{
      readonly schema: string;
      readonly functionName: string;
      readonly args: Readonly<Record<string, unknown>> | undefined;
    }> = [];

    const result = await new ProjectCeoAuthenticatedReadPostgresAdapter(
      clientReturning(envelope(), calls),
    ).getProjectWorkspaceRead({ projectId, packageId });

    if (result.error !== null) {
      throw new Error(`Expected authenticated read success, received ${result.error.code}`);
    }

    expect(calls).toEqual([{
      schema: "projectceo_read_api",
      functionName: "get_project_workspace_read_v11",
      args: { project_id: projectId, package_id: packageId },
    }]);
    expect(JSON.stringify(calls)).not.toMatch(/actor|organization|role|recipient/i);
    expect(result).toMatchObject({
      requestId: "db:m2-read-v5",
      scope: {
        accessScope: "package",
        actorUserId,
        organizationId,
        packageId,
        projectId,
      },
      stateRevision: 41,
    });
    expect(result.data.m2ApprovedCommits).toStrictEqual([approvedCommit]);
    expect(result.data.m2LayoutVersions).toStrictEqual([layoutVersion]);
    expect(result.data.m2LayoutVersions[0]).toMatchObject({
      id: "living-room-layout",
      documentId: "living-room-layout",
      versionId: "living-room-layout@3",
      semanticHash: `sha256:${"a".repeat(64)}`,
      roomId: "living-room",
      variantId: "variant-preferred",
      role: "preferred",
      schemaVersion: "project-ceo-m2-layout/0.1",
    });
    expectTypeOf(result.data.m2ApprovedCommits)
      .toEqualTypeOf<readonly AuthenticatedReadM2ApprovedCommit[]>();
    expectTypeOf(result.data.m2ApprovedCommits[0]!.payload)
      .toEqualTypeOf<AuthenticatedReadM2ApprovedCommitPayload>();
    expectTypeOf(result.data.m2LayoutVersions)
      .toEqualTypeOf<readonly AuthenticatedReadM2LayoutVersion[]>();
    expectTypeOf<AuthenticatedReadM2LayoutVersion["documentId"]>().toEqualTypeOf<string>();
    expectTypeOf<AuthenticatedReadM2LayoutVersion["versionId"]>().toEqualTypeOf<string>();
    expectTypeOf<AuthenticatedReadM2LayoutVersion["semanticHash"]>()
      .toEqualTypeOf<`sha256:${string}`>();
    expectTypeOf<AuthenticatedReadM2LayoutVersion["roomId"]>().toEqualTypeOf<string>();
    expectTypeOf<AuthenticatedReadM2LayoutVersion["variantId"]>().toEqualTypeOf<string>();
    expectTypeOf<AuthenticatedReadM2LayoutVersion["role"]>()
      .toEqualTypeOf<"preferred" | "value_engineered" | "premium">();
    expectTypeOf<AuthenticatedReadM2LayoutVersion["schemaVersion"]>()
      .toEqualTypeOf<"project-ceo-m2-layout/0.1">();
    expectTypeOf<AuthenticatedProjectReadProjection["m2LayoutVersions"]>()
      .toEqualTypeOf<readonly AuthenticatedReadM2LayoutVersion[]>();
  });

  it("accepts the builder-redacted layout projection without layoutContent", async () => {
    const redacted = cloneLayoutVersion();
    const { layoutContent: _redacted, ...builderPayload } = redacted.payload;

    const result = await new ProjectCeoAuthenticatedReadPostgresAdapter(
      clientReturning(envelope({
        m2LayoutVersions: [{ ...redacted, payload: builderPayload }],
      })),
    ).getProjectWorkspaceRead({ projectId, packageId });

    if (result.error !== null) {
      throw new Error(`Expected authenticated read success, received ${result.error.code}`);
    }

    expect(result.data.m2LayoutVersions).toStrictEqual([
      { ...redacted, payload: builderPayload },
    ]);
  });

  it.each([
    ["is not an array", { leaked: true }],
    ["omits the revision id", [{ ...layoutVersion, revisionId: undefined }]],
    ["uses a non-UUID package id", [{ ...layoutVersion, packageId: "package-1" }]],
    ["uses a status other than published", [{ ...layoutVersion, status: "draft" }]],
    ["contains an unknown projection field", [{ ...layoutVersion, actorUserId }]],
    ["contains a malformed payload", [{ ...layoutVersion, payload: { versionId: "v3" } }]],
    ["duplicates a documentId inconsistent with id", [{
      ...layoutVersion,
      documentId: "another-layout",
    }]],
    ["duplicates a versionId inconsistent with payload", [{
      ...layoutVersion,
      versionId: "living-room-layout@99",
    }]],
    ["duplicates a semanticHash inconsistent with payload", [{
      ...layoutVersion,
      semanticHash: `sha256:${"b".repeat(64)}`,
    }]],
    ["duplicates a roomId inconsistent with payload", [{
      ...layoutVersion,
      roomId: "kitchen",
    }]],
    ["duplicates a variantId inconsistent with payload", [{
      ...layoutVersion,
      variantId: "variant-premium",
    }]],
    ["duplicates a role inconsistent with payload", [{
      ...layoutVersion,
      role: "premium",
    }]],
    ["duplicates a schemaVersion inconsistent with payload", [{
      ...layoutVersion,
      schemaVersion: "project-ceo-m2-layout/0.2",
    }]],
  ])("fails closed when m2LayoutVersions %s", async (_caseName, malformedProjection) => {
    const adapter = new ProjectCeoAuthenticatedReadPostgresAdapter(
      clientReturning(envelope({ m2LayoutVersions: malformedProjection })),
    );

    await expect(adapter.getProjectWorkspaceRead({ projectId, packageId }))
      .rejects.toThrow("Invalid ProjectCEO authenticated read envelope");
  });

  it.each([
    ["omits a required payload key", (row: MutableApprovedCommitFixture) => {
      const payload = row.payload as Record<string, unknown>;
      delete payload.approvalPackageId;
    }],
    ["contains an unknown payload key", (row: MutableApprovedCommitFixture) => {
      Object.assign(row.payload, { actorUserId });
    }],
    ["uses a blank exact revision identifier", (row: MutableApprovedCommitFixture) => {
      Object.assign(row.payload, { designIntentRevisionId: " " });
    }],
    ["uses an invalid chosen-layout hash", (row: MutableApprovedCommitFixture) => {
      Object.assign(row.payload.chosenVariant, { semanticHash: `sha256:${"A".repeat(64)}` });
    }],
    ["uses duplicate approved selection revisions", (row: MutableApprovedCommitFixture) => {
      Object.assign(row.payload, {
        approvedSelectionRevisionIds: ["selection-chair@2", "selection-chair@2"],
      });
    }],
    ["contains stale price provenance", (row: MutableApprovedCommitFixture) => {
      Object.assign(row.payload.budget, {
        staleSelectionRevisionIds: ["selection-chair@2"],
      });
    }],
    ["contains missing price provenance", (row: MutableApprovedCommitFixture) => {
      Object.assign(row.payload.budget, {
        missingPriceSelectionRevisionIds: ["selection-table@4"],
      });
    }],
    ["uses an unsafe RUB amount", (row: MutableApprovedCommitFixture) => {
      Object.assign(row.payload.budget, { amountRub: Number.MAX_SAFE_INTEGER + 1 });
    }],
    ["uses an invalid budget timestamp", (row: MutableApprovedCommitFixture) => {
      Object.assign(row.payload.budget, { asOf: "2026-08-06T10:15:30" });
    }],
    ["contains an unknown budget key", (row: MutableApprovedCommitFixture) => {
      Object.assign(row.payload.budget, { currency: "RUB" });
    }],
    ["records review before submission", (row: MutableApprovedCommitFixture) => {
      Object.assign(row.payload, { reviewedAt: "2026-08-06T09:00:00+08:00" });
    }],
  ])("fails closed when an approved commit %s", async (_caseName, mutate) => {
    const malformed = cloneApprovedCommit();
    mutate(malformed);
    const adapter = new ProjectCeoAuthenticatedReadPostgresAdapter(
      clientReturning(envelope({ m2ApprovedCommits: [malformed] })),
    );

    await expect(adapter.getProjectWorkspaceRead({ projectId, packageId }))
      .rejects.toThrow("Invalid ProjectCEO authenticated read envelope");
  });

  it("accepts an approved commit whose amountRub was redacted by the server", async () => {
    const redacted = cloneApprovedCommit();
    const { amountRub: _redacted, ...redactedBudget } = redacted.payload.budget;

    const result = await new ProjectCeoAuthenticatedReadPostgresAdapter(
      clientReturning(envelope({
        m2ApprovedCommits: [{
          ...redacted,
          payload: { ...redacted.payload, budget: redactedBudget },
        }],
      })),
    ).getProjectWorkspaceRead({ projectId, packageId });

    if (result.error !== null) {
      throw new Error(`Expected authenticated read success, received ${result.error.code}`);
    }

    expect(result.data.m2ApprovedCommits[0]?.payload.budget)
      .not.toHaveProperty("amountRub");
  });

  it.each([
    ["top-level actor role", (value: ReturnType<typeof envelope>) => {
      Object.assign(value, { actorRole: "architect" });
    }],
    ["top-level trust marker", (value: ReturnType<typeof envelope>) => {
      Object.assign(value, { trusted: true });
    }],
    ["scope role", (value: ReturnType<typeof envelope>) => {
      Object.assign(value.scope, { role: "architect" });
    }],
    ["scope service-role marker", (value: ReturnType<typeof envelope>) => {
      Object.assign(value.scope, { serviceRole: true });
    }],
  ])("rejects an unknown %s field in the request envelope", async (_caseName, mutate) => {
    const malformed = envelope();
    mutate(malformed);

    await expect(
      new ProjectCeoAuthenticatedReadPostgresAdapter(clientReturning(malformed))
        .getProjectWorkspaceRead({ projectId, packageId }),
    ).rejects.toThrow("Invalid ProjectCEO authenticated read envelope");
  });

  it.each(["forbidden", "not_found", "validation_failed"] as const)(
    "returns the controlled DB %s envelope as a typed result",
    async (code) => {
      const expected = controlledErrorEnvelope(code);
      const result = await new ProjectCeoAuthenticatedReadPostgresAdapter(
        clientReturning(expected),
      ).getProjectWorkspaceRead({ projectId, packageId });

      expect(result).toStrictEqual(expected);
      if (result.error === null) {
        throw new Error("Expected controlled authenticated read error, received success");
      }
      expect(result.data).toBeNull();
      expect(result.scope).toBeNull();
      expect(result.stateRevision).toBeNull();
      expect(result.error).toStrictEqual({
        code,
        messageKey: `projectceo.read.${code}`,
      });
      expectTypeOf(result).toMatchTypeOf<AuthenticatedProjectReadResult>();
      expectTypeOf(result).toMatchTypeOf<AuthenticatedProjectReadControlledError>();
    },
  );

  it.each([
    ["an unknown top-level key", (value: ReturnType<typeof controlledErrorEnvelope>) => {
      Object.assign(value, { trusted: true });
    }],
    ["an unknown error key", (value: ReturnType<typeof controlledErrorEnvelope>) => {
      Object.assign(value.error, { details: "private database detail" });
    }],
  ])("rejects a controlled error envelope with %s", async (_caseName, mutate) => {
    const malformed = controlledErrorEnvelope("forbidden");
    mutate(malformed);

    await expect(
      new ProjectCeoAuthenticatedReadPostgresAdapter(clientReturning(malformed))
        .getProjectWorkspaceRead({ projectId, packageId }),
    ).rejects.toThrow("Invalid ProjectCEO authenticated read envelope");
  });
});
