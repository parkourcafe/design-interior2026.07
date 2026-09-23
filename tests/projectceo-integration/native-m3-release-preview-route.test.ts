import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcSchemaClient } from "../../lib/project-intelligence/adapters/postgres/contracts";
import type { NativeM3ReleaseContext } from "../../lib/project-intelligence/adapters/postgres/documentation";
import type { RequestBoundProjectCeoClient } from "../../lib/project-intelligence/delivery/projectceo/request-context";

vi.mock("server-only", () => ({}));
const transport = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: transport.createClient }));

import { GET } from "../../app/api/projectceo/projects/[projectId]/packages/[packageId]/release-context/route";
import { PROJECTCEO_SESSION_PROVENANCE_HEADER } from "../../lib/project-intelligence/delivery/projectceo/request-context";

const selector = {
  projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  packageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sessionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const serverSessionDigest = `sha256:${createHash("sha256").update(sessionId).digest("hex")}`;
const dbRequestId = "db:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const contractVersion = "remhaos.native-m3-release-preview/1";

function fixture() {
  const layout = {
    documentId: "layout", versionId: "layout-v1", revisionId: "layout-r1",
    semanticHash: `sha256:${"1".repeat(64)}`,
  };
  const context: NativeM3ReleaseContext = {
    schemaVersion: "remhaos.native-m3-release-context/1",
    scope: { organizationId: "ffffffff-ffff-4fff-8fff-ffffffffffff", ...selector },
    stateRevision: 7,
    baselineId: "baseline-1",
    previousVersionId: null,
    handoffs: [{
      handoffId: "handoff", revisionId: "handoff-r1", revisionNo: 1,
      contractVersion: "archidom.m2-to-m3-handoff/0.1", packageId: selector.packageId,
      roomId: "room-1", approvedM2CommitRevisionId: "approved-r1",
      designIntentRevisionId: "design-r1", layout, selectionRevisionIds: ["selection-r1"],
    }],
    sheets: [{
      sheetId: "sheet-1", packageId: selector.packageId, roomId: "room-1",
      sheetNumber: "A-01", title: "Synthetic unit sheet", revisionId: "sheet-r1", revisionNo: 1,
      specificationRevisionIds: ["selection-r1"],
      origin: {
        handoffId: "handoff", handoffRevisionId: "handoff-r1",
        handoffContractVersion: "archidom.m2-to-m3-handoff/0.1",
        approvedM2CommitRevisionId: "approved-r1", designIntentRevisionId: "design-r1",
        layoutDocumentId: layout.documentId, layoutVersionId: layout.versionId,
        layoutRevisionId: layout.revisionId, semanticHash: layout.semanticHash,
      },
    }],
    baselineDecisionRevisionIds: ["design-r1"], baselineSelectionRevisionIds: ["selection-r1"],
    findings: [], structurallyComplete: true, contextDigest: `sha256:${"2".repeat(64)}`,
  };
  const rpc = vi.fn<RpcSchemaClient["rpc"]>().mockResolvedValue({
    data: { requestId: dbRequestId, data: context, error: null }, error: null,
  });
  const schema = vi.fn(() => ({ rpc }));
  const getClaims = vi.fn<RequestBoundProjectCeoClient["auth"]["getClaims"]>().mockResolvedValue({
    data: { claims: { sub: userId, session_id: sessionId } }, error: null,
  });
  const getUser = vi.fn<RequestBoundProjectCeoClient["auth"]["getUser"]>().mockResolvedValue({
    data: { user: { id: userId } }, error: null,
  });
  const client: RequestBoundProjectCeoClient = {
    schema, auth: { getClaims, getUser }, storage: { from: () => { throw new Error("storage_not_used"); } },
  };
  transport.createClient.mockResolvedValue(client);
  return { context, rpc, schema, getClaims, getUser };
}

function preview(params = selector) {
  return GET(new Request("https://app.example/api/projectceo/projects/test/packages/test/release-context", {
    headers: { [PROJECTCEO_SESSION_PROVENANCE_HEADER]: "caller-controlled-provenance" },
  }), { params: Promise.resolve(params) });
}

function expectHeaders(response: Response, authenticated: boolean) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get(PROJECTCEO_SESSION_PROVENANCE_HEADER))
    .toBe(authenticated ? serverSessionDigest : null);
}

async function expectError(response: Response, status: number, code: string, authenticated = false) {
  expect(response.status).toBe(status);
  expectHeaders(response, authenticated);
  const body = await response.json();
  expect(body).toEqual({
    contractVersion,
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    data: null,
    error: { code, messageKey: `project_ceo.error.${code}`, retryable: code === "internal_error" },
  });
  expect(body.requestId).not.toBe(dbRequestId);
  return body;
}

describe("native M3 release preview HTTP boundary (mock Auth and RPC transport)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("REMHAOS_DOCUMENTATION_ENABLED", "true");
    vi.stubEnv("PROJECTCEO_LOCAL_FIXTURE_MODE", "0");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "false", "TRUE"])("hides the route before Auth or RPC when the module flag is %s", async flag => {
    const f = fixture();
    vi.stubEnv("REMHAOS_DOCUMENTATION_ENABLED", flag);
    await expectError(await preview(), 404, "not_found");
    expect(transport.createClient).not.toHaveBeenCalled();
    expect(f.getClaims).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("rejects local fixture mode without creating a human context or synthesizing release data", async () => {
    const f = fixture();
    vi.stubEnv("PROJECTCEO_LOCAL_FIXTURE_MODE", "1");
    await expectError(await preview(), 409, "operation_unavailable");
    expect(transport.createClient).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("sanitizes a forbidden production fixture configuration with no cache or provenance", async () => {
    const f = fixture();
    vi.stubEnv("PROJECTCEO_LOCAL_FIXTURE_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    await expectError(await preview(), 500, "internal_error");
    expect(transport.createClient).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { ...selector, projectId: "invalid" },
    { ...selector, packageId: "" },
    { ...selector, packageId: "root" },
    { ...selector, projectId: ` ${selector.projectId}` },
    { ...selector, packageId: selector.projectId },
    { ...selector, packageId: selector.projectId.toUpperCase() },
  ])("rejects malformed or project-root selectors before Auth: %j", async params => {
    const f = fixture();
    await expectError(await preview(params), 400, "validation_failed");
    expect(transport.createClient).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("awaits route parameters and contains parameter resolution errors", async () => {
    const f = fixture();
    const response = await GET(new Request("https://app.example"), {
      params: Promise.reject(new Error("private-param-details")),
    });
    await expectError(response, 500, "internal_error");
    expect(transport.createClient).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("returns 401 when Auth claims are absent, without querying the package", async () => {
    const f = fixture();
    f.getClaims.mockResolvedValue({ data: null, error: null });
    await expectError(await preview(), 401, "unauthenticated");
    expect(f.getUser).not.toHaveBeenCalled();
    expect(f.schema).not.toHaveBeenCalled();
  });

  it("returns 403 with no provenance when the current user does not match the claims", async () => {
    const f = fixture();
    f.getUser.mockResolvedValue({ data: { user: { id: selector.packageId } }, error: null });
    await expectError(await preview(), 403, "identity_unverified");
    expect(f.schema).not.toHaveBeenCalled();
  });

  it.each([
    ["P1103", 403, "forbidden"],
    ["P1104", 404, "not_found"],
    ["P1111", 400, "validation_failed"],
    ["XX000", 500, "internal_error"],
  ] as const)("maps %s without exposing database error payloads or falling back to project scope", async (sqlstate, status, code) => {
    const f = fixture();
    f.rpc.mockResolvedValue({
      data: null,
      error: { code: sqlstate, message: "private-rpc-message", details: "private-rpc-details", hint: "private-rpc-hint" },
    });
    await expectError(await preview(), status, code, true);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("get_native_m3_release_context", {
      project_id: selector.projectId, package_id: selector.packageId,
    });
    expect(f.schema).toHaveBeenCalledExactlyOnceWith("projectceo_m3_api");
  });

  it.each(["shape", "scope", "inconsistent"])("sanitizes %s failures after authentication", async failure => {
    const f = fixture();
    if (failure === "shape") f.context.contextDigest = "private-invalid-digest";
    if (failure === "scope") f.context.scope.packageId = userId;
    if (failure === "inconsistent") f.context.handoffs = [];
    await expectError(await preview(), 500, "internal_error", true);
    expect(f.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    { projectId: selector.projectId.toUpperCase(), packageId: selector.packageId },
    { projectId: selector.projectId, packageId: selector.packageId.toUpperCase() },
    { projectId: selector.projectId.replaceAll("a", "A"), packageId: selector.packageId.replace("bbbb", "bBbB") },
  ])("normalizes UUID case and returns the exact snapshot for later human confirmation: %j", async params => {
    const f = fixture();
    const response = await preview(params);
    expect(response.status).toBe(200);
    expectHeaders(response, true);
    const body = await response.json();
    expect(body).toEqual({
      contractVersion,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      data: {
        context: f.context,
        confirmation: {
          packageId: selector.packageId, snapshotToken: f.context.contextDigest,
          expectedBaselineId: f.context.baselineId, expectedPreviousVersionId: null,
          expectedStateRevision: f.context.stateRevision,
        },
      },
      error: null,
    });
    expect(body.requestId).not.toBe(dbRequestId);
    expect(JSON.stringify(body)).not.toContain(sessionId);
    expect(f.getClaims).toHaveBeenCalledOnce();
    expect(f.getUser).toHaveBeenCalledOnce();
    expect(f.schema).toHaveBeenCalledExactlyOnceWith("projectceo_m3_api");
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("get_native_m3_release_context", {
      project_id: selector.projectId, package_id: selector.packageId,
    });
  });

  it("preserves the previous release version in confirmation", async () => {
    const f = fixture();
    f.context.previousVersionId = "release-v1";
    const response = await preview();
    expectHeaders(response, true);
    expect((await response.json()).data.confirmation.expectedPreviousVersionId).toBe("release-v1");
    expect(f.rpc).toHaveBeenCalledOnce();
  });

  it.each(["incomplete", "missing baseline"])("returns honest metadata and no confirmation for %s context", async state => {
    const f = fixture();
    f.context.structurallyComplete = false;
    if (state === "missing baseline") {
      f.context.baselineId = null;
      f.context.findings = [{ code: "BASELINE_REQUIRED", subject: selector.packageId }];
    } else {
      f.context.findings = [{ code: "SPECIFICATION_NOT_COVERED", subject: "selection-r1" }];
    }
    const response = await preview();
    expect(response.status).toBe(200);
    expectHeaders(response, true);
    expect(await response.json()).toEqual({
      contractVersion,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      data: { context: f.context, confirmation: null },
      error: null,
    });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("get_native_m3_release_context", {
      project_id: selector.projectId, package_id: selector.packageId,
    });
  });
});
