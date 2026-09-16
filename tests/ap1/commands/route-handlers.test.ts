import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  fixture: false,
  contextError: null as Error | null,
  serviceError: null as Error | null,
  commandResponse: null as unknown,
  portfolioEnvelope: null as unknown,
  workspaceEnvelope: null as unknown,
  serviceDependencies: null as unknown,
  projectId: null as string | null,
}));

vi.mock("@/lib/project-intelligence/delivery/projectceo/request-context", () => {
  class ProjectCeoAuthenticationError extends Error {
    constructor(readonly code: "unauthenticated" | "identity_unverified") {
      super(code);
    }
  }
  return {
    PROJECTCEO_SESSION_PROVENANCE_HEADER: "X-ArchiDom-Auth-Session-Digest",
    ProjectCeoAuthenticationError,
    createProjectCeoRequestContext: vi.fn(async () => {
      if (state.contextError) throw state.contextError;
      return { client: { requestBound: true }, identity: { userId: "user-1", sessionDigest: `sha256:${"a".repeat(64)}` } };
    }),
  };
});

vi.mock("@/lib/project-intelligence/delivery/projectceo/command-service", () => ({
  ProjectCeoCommandService: class {
    constructor(dependencies: unknown) {
      state.serviceDependencies = dependencies;
    }

    async execute() {
      if (state.serviceError) throw state.serviceError;
      return state.commandResponse;
    }
  },
}));

vi.mock("@/lib/project-intelligence/delivery/projectceo/server-port", () => ({
  isProjectCeoLocalFixtureMode: () => state.fixture,
  createProjectCeoServerRequest: vi.fn(async () => {
    if (state.contextError) throw state.contextError;
    return { identity: { userId: "user-1", sessionDigest: `sha256:${"a".repeat(64)}` }, port: {
      getPortfolio: async () => state.portfolioEnvelope,
      getProjectWorkspace: async ({ projectId }: { readonly projectId: string }) => {
        state.projectId = projectId;
        if (state.serviceError) throw state.serviceError;
        return state.workspaceEnvelope;
      },
    } };
  }),
}));

import { POST as commandPost } from "../../../app/api/projectceo/commands/route";
import { GET as portfolioGet } from "../../../app/api/projectceo/portfolio/route";
import { GET as projectGet } from "../../../app/api/projectceo/projects/[projectId]/route";
import { ProjectCeoAuthenticationError } from "../../../lib/project-intelligence/delivery/projectceo/request-context";

const projectId = "11111111-1111-4111-8111-111111111111";
const endpoint = "https://app.example/api/projectceo/commands";

function commandRequest(): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      Origin: "https://app.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contractVersion: "projectceo-command/0.1",
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "create_change",
      projectId,
      payload: {
        reason: "Контролируемое изменение",
        fromProductionPackageVersionId: "release-v1",
        deltaCostRub: 0,
        deltaDays: 0,
      },
    }),
  });
}

function uiEnvelope(data: unknown, error: unknown = null) {
  return {
    contractVersion: "projectceo-ui/0.1",
    requestId: "db-request",
    data,
    error,
  };
}

describe("AP1 ProjectCEO direct route handlers", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    state.fixture = false;
    state.contextError = null;
    state.serviceError = null;
    state.serviceDependencies = null;
    state.projectId = null;
    state.commandResponse = {
      contractVersion: "projectceo-command/0.1",
      requestId: "command-request",
      status: "completed",
      operation: "submit_change_request",
      replay: false,
      stateRevision: 4,
      result: { id: "change-1" },
    };
    state.portfolioEnvelope = uiEnvelope({ projects: [] });
    state.workspaceEnvelope = uiEnvelope({ project: { id: projectId } });
  });

  it("returns a no-store command success and injects only request-bound dependencies", async () => {
    vi.stubEnv("PROJECTCEO_TOKEN_SECRET", "s".repeat(32));
    const response = await commandPost(commandRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-archidom-auth-session-digest")).toBe(`sha256:${"a".repeat(64)}`);
    expect(await response.json()).toMatchObject({
      status: "completed",
      operation: "submit_change_request",
    });
    expect(state.serviceDependencies).toEqual({
      client: { requestBound: true },
      tokenSecret: "s".repeat(32),
    });
  });

  it("rejects command CSRF, unsupported media, malformed/authority-bearing JSON and fixture writes before auth", async () => {
    const validBody = await commandRequest().text();
    const csrf = await commandPost(new Request(endpoint, {
      method: "POST",
      headers: { Origin: "https://attacker.test", "Content-Type": "application/json" },
      body: validBody,
    }));
    expect(csrf.status).toBe(403);

    const media = await commandPost(new Request(endpoint, {
      method: "POST",
      headers: { Origin: "https://app.example", "Content-Type": "text/plain" },
      body: validBody,
    }));
    expect(media.status).toBe(415);

    const malformed = await commandPost(new Request(endpoint, {
      method: "POST",
      headers: { Origin: "https://app.example", "Content-Type": "application/json" },
      body: "{",
    }));
    expect(malformed.status).toBe(400);

    const authorityBearing = JSON.parse(validBody) as Record<string, unknown>;
    authorityBearing.organizationId = "attacker-organization";
    const strict = await commandPost(new Request(endpoint, {
      method: "POST",
      headers: { Origin: "https://app.example", "Content-Type": "application/json" },
      body: JSON.stringify(authorityBearing),
    }));
    expect(strict.status).toBe(400);

    state.fixture = true;
    const fixture = await commandPost(commandRequest());
    expect(fixture.status).toBe(409);
    expect(await fixture.json()).toMatchObject({
      status: "unavailable",
      error: { code: "operation_unavailable" },
    });
    expect(state.serviceDependencies).toBeNull();
  });

  it("maps command authentication, downstream and unexpected errors without leaking details", async () => {
    state.contextError = new ProjectCeoAuthenticationError("unauthenticated");
    const unauthenticated = await commandPost(commandRequest());
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ error: { code: "unauthenticated" } });

    state.contextError = null;
    state.commandResponse = {
      contractVersion: "projectceo-command/0.1",
      requestId: "command-request",
      status: "error",
      error: { code: "stale_state", messageKey: "controlled", retryable: true },
    };
    const stale = await commandPost(commandRequest());
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "stale_state" } });

    state.serviceError = new Error("private backend marker");
    const internal = await commandPost(commandRequest());
    const internalText = await internal.text();
    expect(internal.status).toBe(500);
    expect(internalText).not.toContain("private backend marker");
    expect(JSON.parse(internalText)).toMatchObject({ error: { code: "internal_error" } });
  });

  it("returns controlled no-store portfolio success, RPC error, auth error and internal error", async () => {
    const success = await portfolioGet();
    expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toBe("private, no-store");
    expect(success.headers.get("x-archidom-auth-session-digest")).toBe(`sha256:${"a".repeat(64)}`);

    state.portfolioEnvelope = uiEnvelope(null, {
      code: "forbidden",
      messageKey: "controlled",
      retryable: false,
    });
    expect((await portfolioGet()).status).toBe(403);

    state.contextError = new ProjectCeoAuthenticationError("identity_unverified");
    const identity = await portfolioGet();
    expect(identity.status).toBe(403);
    expect(await identity.json()).toMatchObject({ error: { code: "identity_unverified" } });

    state.contextError = new Error("private portfolio marker");
    const internal = await portfolioGet();
    const text = await internal.text();
    expect(internal.status).toBe(500);
    expect(text).not.toContain("private portfolio marker");
  });

  it("passes the exact route project selector and maps project errors fail-closed", async () => {
    const success = await projectGet(
      new Request(`https://app.example/api/projectceo/projects/${projectId}`),
      { params: Promise.resolve({ projectId }) },
    );
    expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toBe("private, no-store");
    expect(state.projectId).toBe(projectId);

    state.workspaceEnvelope = uiEnvelope(null, {
      code: "not_found",
      messageKey: "controlled",
      retryable: false,
    });
    expect((await projectGet(
      new Request(`https://app.example/api/projectceo/projects/${projectId}`),
      { params: Promise.resolve({ projectId }) },
    )).status).toBe(404);

    state.serviceError = new Error("private project marker");
    const internal = await projectGet(
      new Request(`https://app.example/api/projectceo/projects/${projectId}`),
      { params: Promise.resolve({ projectId }) },
    );
    const text = await internal.text();
    expect(internal.status).toBe(500);
    expect(text).not.toContain("private project marker");
  });
});
