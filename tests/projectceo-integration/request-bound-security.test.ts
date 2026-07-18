import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  verifyProjectCeoRequestClient,
  type RequestBoundProjectCeoClient,
} from "../../lib/project-intelligence/delivery/projectceo/request-context";
import { isProjectCeoLocalFixtureMode } from "../../lib/project-intelligence/delivery/projectceo/server-port";
import { isSameOriginMutation } from "../../lib/project-intelligence/delivery/projectceo/csrf";
import { projectCeoCommandSchema } from "../../lib/project-intelligence/delivery/projectceo/command-contract";
import { projectCeoHttpStatus } from "../../lib/project-intelligence/delivery/projectceo/http-status";

function authClient(input: {
  readonly subject?: string;
  readonly userId?: string;
  readonly nullClaimsData?: boolean;
  readonly nullUserData?: boolean;
}): RequestBoundProjectCeoClient {
  return {
    auth: {
      async getClaims() {
        return {
          data: input.nullClaimsData
            ? null
            : { claims: input.subject ? { sub: input.subject } : undefined },
          error: null,
        };
      },
      async getUser() {
        return {
          data: input.nullUserData
            ? null
            : { user: input.userId ? { id: input.userId } : null },
          error: null,
        };
      },
    },
    storage: { from: () => { throw new Error("not_used"); } },
    schema: () => ({ rpc: async () => ({ data: null, error: null }) }),
  };
}

describe("ProjectCEO request-bound security", () => {
  const userId = "11111111-1111-4111-8111-111111111111";

  it("accepts only a signature-verified claim matching the current Auth user", async () => {
    const context = await verifyProjectCeoRequestClient(authClient({
      subject: userId,
      userId,
    }));
    expect(context.identity).toMatchObject({ userId });
    expect(context.identity.displayName).not.toContain("@");
  });

  it("fails closed for missing claims and claims/user mismatch", async () => {
    await expect(verifyProjectCeoRequestClient(authClient({ userId })))
      .rejects.toMatchObject({ code: "unauthenticated" });
    await expect(verifyProjectCeoRequestClient(authClient({
      subject: userId,
      userId: "22222222-2222-4222-8222-222222222222",
    }))).rejects.toMatchObject({
      code: "identity_unverified",
    });
  });

  it("maps real no-session null auth data to controlled authentication errors", async () => {
    await expect(verifyProjectCeoRequestClient(authClient({ nullClaimsData: true })))
      .rejects.toMatchObject({ code: "unauthenticated" });
    await expect(verifyProjectCeoRequestClient(authClient({
      subject: "user-1",
      nullUserData: true,
    }))).rejects.toMatchObject({ code: "identity_unverified" });
  });

  it("forbids fixture mode in production", () => {
    expect(() => isProjectCeoLocalFixtureMode({
      NODE_ENV: "production",
      PROJECTCEO_LOCAL_FIXTURE_MODE: "1",
    })).toThrow("projectceo_fixture_mode_forbidden_in_production");
    expect(isProjectCeoLocalFixtureMode({
      NODE_ENV: "test",
      PROJECTCEO_LOCAL_FIXTURE_MODE: "1",
    })).toBe(true);
    expect(isProjectCeoLocalFixtureMode({ NODE_ENV: "production" })).toBe(false);
  });

  it("requires an exact same-origin mutation, including forwarded origin", () => {
    expect(isSameOriginMutation(new Request("https://app.example/api/projectceo/commands", {
      method: "POST",
      headers: { Origin: "https://app.example" },
    }))).toBe(true);
    expect(isSameOriginMutation(new Request("https://app.example/api/projectceo/commands", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    }))).toBe(false);
    expect(isSameOriginMutation(new Request("http://internal/api/projectceo/commands", {
      method: "POST",
      headers: {
        Origin: "https://app.example",
        "X-Forwarded-Host": "app.example",
        "X-Forwarded-Proto": "https",
      },
    }))).toBe(true);
    expect(isSameOriginMutation(new Request("https://app.example/api/projectceo/commands", {
      method: "POST",
    }))).toBe(false);
  });

  it("rejects caller authority and unknown fields while allowing a command id", () => {
    const valid = {
      contractVersion: "projectceo-command/0.1",
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "acknowledge_release",
      projectId: userId,
      payload: { distributionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    };
    expect(projectCeoCommandSchema.safeParse(valid).success).toBe(true);
    for (const forbidden of ["actorId", "organizationId", "packageId", "role", "expectedStateRevision", "idempotencyKey"]) {
      expect(projectCeoCommandSchema.safeParse({ ...valid, [forbidden]: "attacker" }).success)
        .toBe(false);
    }
    expect(projectCeoCommandSchema.safeParse({
      ...valid,
      payload: { ...valid.payload, packageId: "attacker" },
    }).success).toBe(false);
  });

  it("accepts deterministic text impact ids from M4", () => {
    expect(projectCeoCommandSchema.safeParse({
      contractVersion: "projectceo-command/0.1",
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "review_change_impact",
      projectId: userId,
      payload: {
        impactRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        impactId: "impact:area-second-floor:lighting",
        disposition: "accepted",
        reason: "Проверено человеком",
      },
    }).success).toBe(true);
  });

  it("maps API errors consistently and never turns internal errors into 403", () => {
    expect(projectCeoHttpStatus("unauthenticated")).toBe(401);
    expect(projectCeoHttpStatus("identity_unverified")).toBe(403);
    expect(projectCeoHttpStatus("not_found")).toBe(404);
    expect(projectCeoHttpStatus("stale_state")).toBe(409);
    expect(projectCeoHttpStatus("rate_limited")).toBe(429);
    expect(projectCeoHttpStatus("internal_error")).toBe(500);
  });
});
