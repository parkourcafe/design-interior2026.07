import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  fixture: false,
  contextError: null as Error | null,
  adapterError: null as Error | null,
  enrollInput: null as unknown,
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
      if (state.contextError) throw state.contextError;
      return {
        client: { requestBound: true },
        identity: { userId: "11111111-1111-4111-8111-111111111111" },
      };
    }),
  };
});

vi.mock("@/lib/project-intelligence/delivery/projectceo/server-port", () => ({
  isProjectCeoLocalFixtureMode: () => state.fixture,
}));

vi.mock("@/lib/project-intelligence/adapters/postgres", () => {
  class ProjectIntelligenceAdapterError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    ProjectIntelligenceAdapterError,
    FoundationPostgresAdapter: class {
      async enrollOrganizationProject(input: unknown) {
        state.enrollInput = input;
        if (state.adapterError) throw state.adapterError;
        return {
          operation: "enroll_organization_project",
          replay: false,
          stateRevision: 1,
          result: { organizationId: "22222222-2222-4222-8222-222222222222" },
        };
      }
    },
  };
});

import { POST, PROJECTCEO_ENROLL_CONTRACT_VERSION } from "../../../app/api/projectceo/enroll/route";
import { ProjectIntelligenceAdapterError } from "../../../lib/project-intelligence/adapters/postgres";
import { ProjectCeoAuthenticationError } from "../../../lib/project-intelligence/delivery/projectceo/request-context";

const endpoint = "https://app.example/api/projectceo/enroll";
const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function request(body: BodyInit | null, headers: HeadersInit = {
  Origin: "https://app.example",
  "Content-Type": "application/json",
}): Request {
  return new Request(endpoint, { method: "POST", headers, body });
}

function validRequest(): Request {
  return request(JSON.stringify({ contractVersion: PROJECTCEO_ENROLL_CONTRACT_VERSION, projectId }));
}

describe("WP-39 enroll route", () => {
  beforeEach(() => {
    state.fixture = false;
    state.contextError = null;
    state.adapterError = null;
    state.enrollInput = null;
  });

  it("rejects cross-origin, malformed and authority-bearing bodies before authentication", async () => {
    expect((await POST(request("{}", {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    }))).status).toBe(403);
    expect((await POST(request("{}", {
      Origin: "https://app.example",
      "Content-Type": "text/plain",
    }))).status).toBe(415);
    expect((await POST(request("{"))).status).toBe(400);

    const rejected = await POST(request(JSON.stringify({
      contractVersion: PROJECTCEO_ENROLL_CONTRACT_VERSION,
      projectId,
      organizationId: "attacker-controlled",
    })));
    const text = await rejected.text();
    expect(rejected.status).toBe(400);
    expect(text).not.toContain("attacker-controlled");
  });

  it("keeps fixture mode read-only and maps unauthenticated requests", async () => {
    state.fixture = true;
    expect((await POST(validRequest())).status).toBe(409);
    expect(state.enrollInput).toBeNull();

    state.fixture = false;
    state.contextError = new ProjectCeoAuthenticationError("unauthenticated");
    const unauthenticated = await POST(validRequest());
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("uses only the request-bound client and server-derived idempotency key", async () => {
    const response = await POST(validRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ status: "completed", operation: "enroll_organization_project" });
    expect(state.enrollInput).toEqual({
      projectId,
      idempotencyKey: `ui:enroll:11111111-1111-4111-8111-111111111111:${projectId}`,
    });
  });

  it("maps controlled database and unexpected errors without leaking details", async () => {
    state.adapterError = new ProjectIntelligenceAdapterError("forbidden", null);
    expect((await POST(validRequest())).status).toBe(403);

    state.adapterError = new Error("private enrollment marker");
    const internal = await POST(validRequest());
    const text = await internal.text();
    expect(internal.status).toBe(500);
    expect(text).not.toContain("private enrollment marker");
  });
});
