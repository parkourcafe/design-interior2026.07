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

  it("rejects malformed create_decision payloads and requires non-empty specification for create_selection", () => {
    const validDecision = {
      contractVersion: "projectceo-command/0.1",
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "create_decision",
      projectId: userId,
      payload: {
        packageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        nodeId: "decision-node-1",
        revisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        expectedRevisionId: null,
        claimStatus: "human_origin",
        title: "Kitchen island placement",
        resolution: "Island stays.",
        areaNodeId: null,
        decisionStatus: "confirmed",
        evidence: [],
        reason: "Client decided on the walkthrough.",
      },
    };
    expect(projectCeoCommandSchema.safeParse(validDecision).success).toBe(true);
    // Empty title — the RPC's _assert_text requires length >= 1.
    expect(projectCeoCommandSchema.safeParse({
      ...validDecision,
      payload: { ...validDecision.payload, title: "" },
    }).success).toBe(false);
    // claimStatus outside the four RPC-accepted values.
    expect(projectCeoCommandSchema.safeParse({
      ...validDecision,
      payload: { ...validDecision.payload, claimStatus: "guessed" },
    }).success).toBe(false);
    // Unknown payload field — schema is .strict().
    expect(projectCeoCommandSchema.safeParse({
      ...validDecision,
      payload: { ...validDecision.payload, unexpected: true },
    }).success).toBe(false);
    // Evidence entry missing a required provenance field.
    expect(projectCeoCommandSchema.safeParse({
      ...validDecision,
      payload: {
        ...validDecision.payload,
        evidence: [{
          evidenceVersionId: "v1",
          evidenceLinkId: "l1",
          sourceId: "s1",
          sourceNodeId: "n1",
          sourceRevisionId: "r1",
          // fragmentId missing
        }],
      },
    }).success).toBe(false);

    const validSelection = {
      contractVersion: "projectceo-command/0.1",
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "create_selection",
      projectId: userId,
      payload: {
        packageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        nodeId: "selection-node-1",
        revisionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        expectedRevisionId: null,
        claimStatus: "human_origin",
        title: "Countertop material",
        areaNodeId: "area-kitchen",
        decisionRevisionId: "decision-r1",
        specification: { material: "porcelain" },
        evidence: [],
        reason: "Client decided on the walkthrough.",
      },
    };
    expect(projectCeoCommandSchema.safeParse(validSelection).success).toBe(true);
    // RPC's SELECTION_CONTRACT_INVALID rejects an empty specification object.
    expect(projectCeoCommandSchema.safeParse({
      ...validSelection,
      payload: { ...validSelection.payload, specification: {} },
    }).success).toBe(false);
    // areaNodeId is required (non-nullable) for selections, unlike decisions.
    expect(projectCeoCommandSchema.safeParse({
      ...validSelection,
      payload: { ...validSelection.payload, areaNodeId: null },
    }).success).toBe(false);
  });

  it("has no create_guest_grant command kind (guest grants are read-only issued elsewhere, only revocable here)", () => {
    // Locks in the current, deliberate gap: only revoke_guest_grant exists.
    // If this ever needs to change, it must be a reviewed schema addition
    // with the same ownership/"belongs" rigor as revoke_guest_grant — not a
    // silent side effect of some other refactor.
    expect(projectCeoCommandSchema.safeParse({
      contractVersion: "projectceo-command/0.1",
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "create_guest_grant",
      projectId: userId,
      payload: {},
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
