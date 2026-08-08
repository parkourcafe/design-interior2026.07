import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  adapterClient: null as unknown,
  adapterError: null as Error | null,
  adapterInput: null as unknown,
  contextError: null as Error | null,
  contextCalls: 0,
  envelope: null as unknown,
}));

vi.mock("@/lib/project-intelligence/delivery/projectceo/request-context", () => {
  class ProjectCeoAuthenticationError extends Error {
    constructor(readonly code: "unauthenticated" | "identity_unverified") {
      super(code);
    }
  }

  return {
    ProjectCeoAuthenticationError,
    createProjectCeoRequestContext: vi.fn(async () => {
      state.contextCalls += 1;
      if (state.contextError) throw state.contextError;
      return {
        client: { requestBound: true },
        identity: { userId: "authenticated-user" },
      };
    }),
  };
});

vi.mock("@/lib/project-intelligence/adapters/postgres", () => ({
  ProjectCeoAuthenticatedReadPostgresAdapter: class {
    constructor(client: unknown) {
      state.adapterClient = client;
    }

    async getProjectWorkspaceRead(input: unknown) {
      state.adapterInput = input;
      if (state.adapterError) throw state.adapterError;
      return state.envelope;
    }
  },
}));

import { GET } from "../../../app/api/projectceo/projects/[projectId]/layouts/route";
import { ProjectCeoAuthenticationError } from "../../../lib/project-intelligence/delivery/projectceo/request-context";

const projectId = "11111111-1111-4111-8111-111111111111";
const packageId = "22222222-2222-4222-8222-222222222222";
const layoutVersion = {
  id: "living-room-layout",
  packageId,
  revisionId: "33333333-3333-4333-8333-333333333333",
  revisionNo: 3,
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

function readEnvelope(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    contractVersion: "project-ceo-authenticated-read/0.1",
    requestId: "db:m2-read-v5",
    data: {
      approvalPackages: [{ privateForThisRoute: true }],
      m2ApprovedCommits: [{ privateForThisRoute: true }],
      m2LayoutVersions: [layoutVersion],
    },
    error: null,
    scope: {
      accessScope: "package",
      actorUserId: "44444444-4444-4444-8444-444444444444",
      organizationId: "55555555-5555-4555-8555-555555555555",
      packageId,
      projectId,
    },
    stateRevision: 41,
    serverOnlyMetadata: { mustNotLeak: true },
    ...overrides,
  };
}

function request(query = ""): Request {
  return new Request(
    `https://app.example/api/projectceo/projects/${projectId}/layouts${query}`,
  );
}

async function invoke(
  targetProjectId = projectId,
  query = "",
): Promise<Response> {
  return GET(request(query), {
    params: Promise.resolve({ projectId: targetProjectId }),
  });
}

function expectExactEnvelopeKeys(body: Readonly<Record<string, unknown>>) {
  expect(Object.keys(body).sort()).toEqual([
    "contractVersion",
    "data",
    "error",
    "requestId",
    "scope",
    "stateRevision",
  ]);
}

describe("authenticated M2 layouts route", () => {
  beforeEach(() => {
    state.adapterClient = null;
    state.adapterError = null;
    state.adapterInput = null;
    state.contextError = null;
    state.contextCalls = 0;
    state.envelope = readEnvelope();
  });

  it("reads v5 through the request-bound client and returns only the layout repository projection", async () => {
    const response = await invoke(projectId, `?packageId=${packageId}`);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.contextCalls).toBe(1);
    expect(state.adapterClient).toEqual({ requestBound: true });
    expect(state.adapterInput).toEqual({ projectId, packageId });
    expectExactEnvelopeKeys(body);
    expect(body).toStrictEqual({
      contractVersion: "project-ceo-authenticated-read/0.1",
      requestId: "db:m2-read-v5",
      data: { m2LayoutVersions: [layoutVersion] },
      error: null,
      scope: {
        accessScope: "package",
        actorUserId: "44444444-4444-4444-8444-444444444444",
        organizationId: "55555555-5555-4555-8555-555555555555",
        packageId,
        projectId,
      },
      stateRevision: 41,
    });
    expect(JSON.stringify(body)).not.toContain("privateForThisRoute");
    expect(JSON.stringify(body)).not.toContain("serverOnlyMetadata");
  });

  it("supports project-scoped reads when packageId is absent", async () => {
    state.envelope = readEnvelope({
      scope: {
        accessScope: "project",
        actorUserId: "44444444-4444-4444-8444-444444444444",
        organizationId: "55555555-5555-4555-8555-555555555555",
        packageId: null,
        projectId,
      },
    });

    const response = await invoke();
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(state.adapterInput).toEqual({ projectId, packageId: null });
    expect(body.scope).toStrictEqual({
      accessScope: "project",
      actorUserId: "44444444-4444-4444-8444-444444444444",
      organizationId: "55555555-5555-4555-8555-555555555555",
      packageId: null,
      projectId,
    });
  });

  it.each([
    ["project id", "not-a-uuid", ""],
    ["package id", projectId, "?packageId=not-a-uuid"],
    ["empty package id", projectId, "?packageId="],
    ["duplicate package id", projectId, `?packageId=${packageId}&packageId=${packageId}`],
  ])("rejects an invalid %s selector before reading", async (_caseName, targetProjectId, query) => {
    const response = await invoke(targetProjectId, query);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({
      data: null,
      error: { code: "validation_failed", retryable: false },
      scope: null,
      stateRevision: null,
    });
    expectExactEnvelopeKeys(body);
    expect(state.adapterInput).toBeNull();
    expect(state.contextCalls).toBe(0);
  });

  it.each([
    ["a different project", {
      accessScope: "package",
      actorUserId: "44444444-4444-4444-8444-444444444444",
      organizationId: "55555555-5555-4555-8555-555555555555",
      packageId,
      projectId: "99999999-9999-4999-8999-999999999999",
    }],
    ["a different package", {
      accessScope: "package",
      actorUserId: "44444444-4444-4444-8444-444444444444",
      organizationId: "55555555-5555-4555-8555-555555555555",
      packageId: "88888888-8888-4888-8888-888888888888",
      projectId,
    }],
    ["project access for a package target", {
      accessScope: "project",
      actorUserId: "44444444-4444-4444-8444-444444444444",
      organizationId: "55555555-5555-4555-8555-555555555555",
      packageId: null,
      projectId,
    }],
  ])("fails closed when the authenticated read returns %s", async (_caseName, scope) => {
    state.envelope = readEnvelope({ scope });

    const response = await invoke(projectId, `?packageId=${packageId}`);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(text).not.toContain("99999999-9999-4999-8999-999999999999");
    expect(text).not.toContain("88888888-8888-4888-8888-888888888888");
    expect(body).toMatchObject({
      data: null,
      error: { code: "internal_error", retryable: true },
      scope: null,
      stateRevision: null,
    });
    expectExactEnvelopeKeys(body);
  });

  it("rejects a package-scoped envelope when the request has no package selector", async () => {
    state.envelope = readEnvelope();

    const response = await invoke();
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(text).not.toContain(packageId);
    expect(body).toMatchObject({
      data: null,
      error: { code: "internal_error", retryable: true },
      scope: null,
      stateRevision: null,
    });
    expectExactEnvelopeKeys(body);
    expect(state.adapterInput).toEqual({ projectId, packageId: null });
  });

  it("maps missing authentication without constructing the read adapter", async () => {
    state.contextError = new ProjectCeoAuthenticationError("unauthenticated");

    const response = await invoke();
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({
      data: null,
      error: { code: "unauthenticated", retryable: false },
      scope: null,
      stateRevision: null,
    });
    expectExactEnvelopeKeys(body);
    expect(state.adapterClient).toBeNull();
  });

  it.each([
    ["forbidden", 403],
    ["not_found", 404],
    ["validation_failed", 400],
  ] as const)("maps the controlled %s read envelope", async (code, status) => {
    state.envelope = readEnvelope({
      data: null,
      error: {
        code,
        messageKey: `project_ceo.error.${code}`,
        retryable: false,
      },
      scope: null,
      stateRevision: null,
    });

    const response = await invoke(projectId, `?packageId=${packageId}`);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({ data: null, error: { code } });
    expectExactEnvelopeKeys(body);
  });

  it("fails closed on unexpected adapter errors without leaking internals", async () => {
    state.adapterError = new Error("private table and service-role marker");

    const response = await invoke();
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(text).not.toContain("private table");
    expect(text).not.toContain("service-role");
    expect(body).toMatchObject({
      data: null,
      error: { code: "internal_error", retryable: true },
      scope: null,
      stateRevision: null,
    });
    expectExactEnvelopeKeys(body);
  });
});
