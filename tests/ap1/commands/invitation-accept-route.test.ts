import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  fixture: false,
  contextError: null as Error | null,
  adapterError: null as Error | null,
  acceptInput: null as unknown,
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
      async acceptInvitation(input: unknown) {
        state.acceptInput = input;
        if (state.adapterError) throw state.adapterError;
        return {
          operation: "accept_invitation",
          replay: false,
          stateRevision: 7,
          result: { projectId: "22222222-2222-4222-8222-222222222222" },
        };
      }
    },
  };
});

import { POST } from "../../../app/api/projectceo/invitations/accept/route";
import { ProjectIntelligenceAdapterError } from "../../../lib/project-intelligence/adapters/postgres";
import { ProjectCeoAuthenticationError } from "../../../lib/project-intelligence/delivery/projectceo/request-context";

const token = "A".repeat(43);
const endpoint = "https://app.example/api/projectceo/invitations/accept";

function request(body: BodyInit | null, headers: HeadersInit = {
  Origin: "https://app.example",
  "Content-Type": "application/json",
}): Request {
  return new Request(endpoint, { method: "POST", body, headers });
}

function validRequest(): Request {
  return request(JSON.stringify({
    contractVersion: "projectceo-invitation-accept/0.1",
    token,
  }));
}

describe("AP1 invitation acceptance route", () => {
  beforeEach(() => {
    state.fixture = false;
    state.contextError = null;
    state.adapterError = null;
    state.acceptInput = null;
  });

  it("rejects CSRF, unsupported content type, malformed JSON and invalid token before auth", async () => {
    const csrf = await POST(request("{}", {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    }));
    expect(csrf.status).toBe(403);

    const media = await POST(request("{}", {
      Origin: "https://app.example",
      "Content-Type": "text/plain",
    }));
    expect(media.status).toBe(415);

    expect((await POST(request("{"))).status).toBe(400);
    const invalid = await POST(request(JSON.stringify({
      contractVersion: "projectceo-invitation-accept/0.1",
      token: "private-invalid-token",
    })));
    const invalidText = await invalid.text();
    expect(invalid.status).toBe(400);
    expect(invalidText).not.toContain("private-invalid-token");
  });

  it("keeps fixture mode read-only and maps request authentication", async () => {
    state.fixture = true;
    const fixture = await POST(validRequest());
    expect(fixture.status).toBe(409);
    expect(await fixture.json()).toMatchObject({
      status: "unavailable",
      error: { code: "operation_unavailable" },
    });

    state.fixture = false;
    state.contextError = new ProjectCeoAuthenticationError("unauthenticated");
    const auth = await POST(validRequest());
    expect(auth.status).toBe(401);
    expect(await auth.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("hashes the raw token, derives stable server idempotency and never echoes the secret", async () => {
    const first = await POST(validRequest());
    const second = await POST(validRequest());
    const text = await first.text();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(text).not.toContain(token);
    expect(JSON.parse(text)).toMatchObject({
      status: "completed",
      operation: "accept_invitation",
    });
    expect(state.acceptInput).toMatchObject({
      tokenDigest: expect.stringMatching(/^\\x[0-9a-f]{64}$/),
      idempotencyKey: expect.stringMatching(/^ui:accept-invitation:/),
    });
  });

  it("maps controlled database and unexpected errors without leaking details", async () => {
    state.adapterError = new ProjectIntelligenceAdapterError("expired", null);
    const expired = await POST(validRequest());
    expect(expired.status).toBe(403);
    expect(await expired.json()).toMatchObject({ error: { code: "expired" } });

    state.adapterError = new Error("private invitation marker");
    const internal = await POST(validRequest());
    const text = await internal.text();
    expect(internal.status).toBe(500);
    expect(text).not.toContain("private invitation marker");
  });
});
