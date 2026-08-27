import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ authError: false }));

vi.mock("@/lib/project-intelligence/delivery/projectceo/request-context", () => {
  class ProjectCeoAuthenticationError extends Error {
    constructor(readonly code: "unauthenticated" | "identity_unverified") {
      super(code);
    }
  }

  return {
    ProjectCeoAuthenticationError,
    createProjectCeoRequestContext: vi.fn(async () => {
      if (state.authError) throw new ProjectCeoAuthenticationError("unauthenticated");
      return {
        client: {
          schema: () => ({
            rpc: async () => ({
              data: {
                contractVersion: "project-ceo-foundation/0.1",
                requestId: "test-request",
                data: [],
                error: null,
              },
              error: null,
            }),
          }),
        },
        storage: {},
        identity: { userId: "user-1", displayName: "Участник" },
      };
    }),
  };
});

import { GET as providersGet } from "../../app/api/integrations/providers/route";
import { POST as connectIntentPost } from "../../app/api/integrations/[provider]/connect-intent/route";
import { POST as projectLinkPost } from "../../app/api/projects/[projectId]/links/route";
import { POST as fileReviewPost } from "../../app/api/projects/[projectId]/file-intakes/[intakeId]/review/route";

const projectId = "11111111-1111-4111-8111-111111111111";
const intakeId = "22222222-2222-4222-8222-222222222222";
const origin = "https://app.example";

function request(
  url: string,
  body: BodyInit | null,
  headers: HeadersInit = {},
): NextRequest {
  return new Request(url, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": "route-early-path",
      ...headers,
    },
    body,
  }) as unknown as NextRequest;
}

function routeContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

describe("Integration Gateway direct handler early paths", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("REMHAOS_INTEGRATIONS_ENABLED", "true");
    vi.stubEnv("REMHAOS_PROJECT_LINKS_ENABLED", "true");
    vi.stubEnv("REMHAOS_FILE_INTAKE_ENABLED", "true");
    state.authError = false;
  });

  it("maps request-bound provider authentication failures to a private 401", async () => {
    state.authError = true;

    const response = await providersGet();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("keeps provider catalog and OAuth initiation owner-only", async () => {
    const providers = await providersGet();
    expect(providers.status).toBe(403);
    expect(await providers.json()).toMatchObject({ error: { code: "forbidden" } });

    const connectIntent = await connectIntentPost(
      request(
        `${origin}/api/integrations/google_drive/connect-intent`,
        JSON.stringify({ requestedScopes: ["https://www.googleapis.com/auth/drive.file"] }),
      ),
      routeContext({ provider: "google_drive" }),
    );
    expect(connectIntent.status).toBe(403);
    expect(await connectIntent.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("rejects cross-origin and non-JSON connect-intent requests before auth", async () => {
    const crossOrigin = await connectIntentPost(
      request(`${origin}/api/integrations/google_drive/connect-intent`, "{}", {
        Origin: "https://attacker.example",
      }),
      routeContext({ provider: "google_drive" }),
    );
    expect(crossOrigin.status).toBe(403);

    const unsupportedMedia = await connectIntentPost(
      request(`${origin}/api/integrations/google_drive/connect-intent`, "{}", {
        "Content-Type": "text/plain",
      }),
      routeContext({ provider: "google_drive" }),
    );
    expect(unsupportedMedia.status).toBe(422);
    expect(await unsupportedMedia.json()).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("rejects malformed JSON and maps valid request authentication failures", async () => {
    const malformed = await connectIntentPost(
      request(`${origin}/api/integrations/google_drive/connect-intent`, "{"),
      routeContext({ provider: "google_drive" }),
    );
    expect(malformed.status).toBe(422);

    state.authError = true;
    const unauthenticated = await connectIntentPost(
      request(
        `${origin}/api/integrations/google_drive/connect-intent`,
        JSON.stringify({ requestedScopes: ["https://www.googleapis.com/auth/drive.file"] }),
      ),
      routeContext({ provider: "google_drive" }),
    );
    expect(unauthenticated.status).toBe(401);
  });

  it("rejects unsupported providers and scopes before any transport boundary", async () => {
    const unsupportedProvider = await connectIntentPost(
      request(`${origin}/api/integrations/telegram/connect-intent`, JSON.stringify({
        requestedScopes: ["telegram.read"],
      })),
      routeContext({ provider: "telegram" }),
    );
    expect(unsupportedProvider.status).toBe(422);
    expect(await unsupportedProvider.json()).toMatchObject({
      error: { code: "validation_failed", messageKey: "integrations.errors.provider_not_supported" },
    });

    const unsupportedScope = await connectIntentPost(
      request(`${origin}/api/integrations/google_drive/connect-intent`, JSON.stringify({
        requestedScopes: ["https://www.googleapis.com/auth/drive"],
      })),
      routeContext({ provider: "google_drive" }),
    );
    expect(unsupportedScope.status).toBe(422);
    expect(await unsupportedScope.json()).toMatchObject({
      error: { code: "validation_failed", messageKey: "integrations.errors.scope_not_allowed" },
    });
  });

  it("keeps Project Links malformed bodies controlled", async () => {
    const crossOrigin = await projectLinkPost(
      request(`${origin}/api/projects/${projectId}/links`, "{}", {
        Origin: "https://attacker.example",
      }),
      routeContext({ projectId }),
    );
    expect(crossOrigin.status).toBe(403);

    const malformed = await projectLinkPost(
      request(`${origin}/api/projects/${projectId}/links`, "{"),
      routeContext({ projectId }),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("keeps File Intake malformed review JSON out of the internal-error path", async () => {
    const malformed = await fileReviewPost(
      request(`${origin}/api/projects/${projectId}/file-intakes/${intakeId}/review`, "{"),
      routeContext({ projectId, intakeId }),
    );

    expect(malformed.status).toBe(422);
    expect(await malformed.json()).toMatchObject({ error: { code: "validation_failed" } });
  });
});
