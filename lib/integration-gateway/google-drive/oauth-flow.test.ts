import { describe, expect, it, vi } from "vitest";
import { GOOGLE_DRIVE_FILE_SCOPE } from "./policy";
import {
  GoogleDriveOAuthFlow,
  type GoogleDriveOAuthRegistry,
} from "./oauth-flow";
import { googleDriveStateDigestHex } from "./oauth";

const organizationId = "64111111-1111-4111-8111-111111111111";
const intentId = "65111111-1111-4111-8111-111111111111";
const connectionId = "66111111-1111-4111-8111-111111111111";
const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: new URL("https://staging.example.test/api/integrations/google_drive/oauth/callback"),
};

function createHarness() {
  let verifier = "";
  let lastCredentialRef = "";
  const pkceRecords = new Map<string, { rawState: string; verifier: string }>();
  let storedCredential = "";
  const deleteCredential = vi.fn(async () => undefined);
  const takeVerifier = vi.fn(async (input: { credentialRef: string }) => {
    const record = pkceRecords.get(input.credentialRef);
    pkceRecords.delete(input.credentialRef);
    return record?.verifier ?? null;
  });
  const registry: GoogleDriveOAuthRegistry = {
    createIntent: vi.fn(async (input) => {
      return {
        intentId,
        providerCode: "google_drive" as const,
        requestedScopes: [...input.requestedScopes],
        pkceCredentialRef: input.pkceCredentialRef,
        stateDigestHex: input.stateDigestHex,
        expiresAt: input.expiresAt,
        replay: false,
      };
    }),
    consumeIntent: vi.fn(async () => ({
      intentId,
      providerCode: "google_drive" as const,
      organizationId,
      actorId: "67111111-1111-4111-8111-111111111111",
      requestedScopes: [GOOGLE_DRIVE_FILE_SCOPE],
      pkceCredentialRef: lastCredentialRef,
    })),
    activateConnection: vi.fn(async () => ({
      connectionId,
      providerCode: "google_drive" as const,
      organizationId,
      status: "connected" as const,
    })),
  };
  const flow = new GoogleDriveOAuthFlow({
    config,
    registry,
    pkceStore: {
      putVerifier: vi.fn(async (input) => {
        verifier = input.verifier;
        lastCredentialRef = input.credentialRef;
        pkceRecords.set(input.credentialRef, {
          rawState: input.rawState,
          verifier: input.verifier,
        });
      }),
      getVerifier: vi.fn(async (input) => pkceRecords.get(input.credentialRef) ?? null),
      takeVerifier,
    },
    credentialStore: {
      save: vi.fn(async (input) => {
        storedCredential = input.tokenSet.accessToken;
        return { credentialRef: "vault:integration:google-drive:test" };
      }),
      delete: deleteCredential,
    },
    accountResolver: {
      resolve: vi.fn(async (input) => {
        expect(input.accessToken).toBe("access-token");
        return {
          externalSubjectHashHex: "a".repeat(64),
          displayLabel: "Drive Workspace",
        };
      }),
    },
    fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
    }), { status: 200 })),
    now: () => new Date("2026-08-26T00:00:00.000Z"),
  });
  return {
    flow,
    registry,
    takeVerifier,
    deleteCredential,
    getVerifier: () => verifier,
    getStoredCredential: () => storedCredential,
  };
}

describe("Google Drive OAuth orchestration", () => {
  it("stores PKCE server-side and returns only the authorization URL", async () => {
    const harness = createHarness();
    const result = await harness.flow.start({
      organizationId,
      idempotencyKey: "google-start-1",
    });
    expect(result.intentId).toBe(intentId);
    expect(result.authorizationUrl).toContain("code_challenge_method=S256");
    expect(result.authorizationUrl).not.toContain(harness.getVerifier());
    expect(harness.getVerifier()).toMatch(/^[A-Za-z0-9_-]{32,}$/u);
  });

  it("consumes state once, exchanges server-side, stores opaque credentials, and activates safely", async () => {
    const harness = createHarness();
    const start = await harness.flow.start({
      organizationId,
      idempotencyKey: "google-start-2",
    });
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();
    const result = await harness.flow.complete({
      callbackUrl: new URL(`${config.redirectUri}?code=authorization-code&state=${state}`),
      idempotencyKey: "google-complete-1",
    });
    expect(result).toEqual({ kind: "connected", connectionId });
    expect(harness.getStoredCredential()).toBe("access-token");
    expect(JSON.stringify(result)).not.toContain("access-token");
    expect(harness.registry.activateConnection).toHaveBeenCalledWith(expect.objectContaining({
      credentialRef: "vault:integration:google-drive:test",
      grantedScopes: [GOOGLE_DRIVE_FILE_SCOPE],
      externalSubjectHashHex: "a".repeat(64),
    }));
  });

  it("rejects callbacks on a different URI before consuming the OAuth intent", async () => {
    const harness = createHarness();
    await expect(harness.flow.complete({
      callbackUrl: new URL("https://evil.example.test/callback?code=code&state=state-abcdefghijklmnopqrstuvwxyz-123456"),
      idempotencyKey: "google-complete-2",
    })).rejects.toThrow("callback_uri_mismatch");
    expect(harness.registry.consumeIntent).not.toHaveBeenCalled();
  });

  it("treats provider cancellation as terminal without exchanging or activating", async () => {
    const harness = createHarness();
    const start = await harness.flow.start({
      organizationId,
      idempotencyKey: "google-cancel-1",
    });
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    const result = await harness.flow.complete({
      callbackUrl: new URL(`${config.redirectUri}?error=access_denied&state=${state}`),
      idempotencyKey: "google-cancel-complete-1",
    });
    expect(result).toEqual({ kind: "cancelled", errorCode: "access_denied" });
    expect(harness.registry.consumeIntent).toHaveBeenCalledTimes(1);
    expect(harness.takeVerifier).toHaveBeenCalledWith({ credentialRef: expect.any(String) });
    expect(harness.registry.activateConnection).not.toHaveBeenCalled();
    expect(harness.getStoredCredential()).toBe("");
  });

  it("reuses the persisted state and verifier when the create command replays", async () => {
    const harness = createHarness();
    const first = await harness.flow.start({
      organizationId,
      idempotencyKey: "google-start-replay",
    });
    const firstUrl = new URL(first.authorizationUrl);
    const persistedState = firstUrl.searchParams.get("state");
    const persistedChallenge = firstUrl.searchParams.get("code_challenge");
    harness.registry.createIntent = vi.fn(async () => ({
      intentId,
      providerCode: "google_drive" as const,
      requestedScopes: [GOOGLE_DRIVE_FILE_SCOPE],
      pkceCredentialRef: `oauth-pkce:google-drive:${googleDriveStateDigestHex(persistedState ?? "")}`,
      stateDigestHex: googleDriveStateDigestHex(persistedState ?? ""),
      expiresAt: "2026-08-26T00:05:00.000Z",
      replay: true,
    }));
    const replay = await harness.flow.start({
      organizationId,
      idempotencyKey: "google-start-replay",
    });
    const replayUrl = new URL(replay.authorizationUrl);
    expect(replayUrl.searchParams.get("state")).toBe(persistedState);
    expect(replayUrl.searchParams.get("code_challenge")).toBe(persistedChallenge);
  });

  it("deletes the opaque credential when connection activation fails", async () => {
    const harness = createHarness();
    harness.registry.activateConnection = vi.fn(async () => {
      throw new Error("activation_failed");
    });
    const start = await harness.flow.start({
      organizationId,
      idempotencyKey: "google-activation-failure",
    });
    const state = new URL(start.authorizationUrl).searchParams.get("state");

    await expect(harness.flow.complete({
      callbackUrl: new URL(`${config.redirectUri}?code=authorization-code&state=${state}`),
      idempotencyKey: "google-activation-failure-complete",
    })).rejects.toThrow("activation_failed");
    expect(harness.deleteCredential).toHaveBeenCalledWith({
      credentialRef: "vault:integration:google-drive:test",
    });
  });
});
