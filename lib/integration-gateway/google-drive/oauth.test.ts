import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  createGoogleDriveOAuthStart,
  googleDriveOAuthConfigFromEnv,
  googleDrivePkceCredentialRef,
  parseGoogleDriveCallback,
  parseGoogleDriveTokenResponse,
  exchangeGoogleDriveAuthorizationCode,
  revokeGoogleDriveToken,
} from "./oauth";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: new URL("https://staging.example.test/api/integrations/google-drive/oauth/callback"),
};

describe("Google Drive OAuth contract", () => {
  it("creates state and S256 PKCE without exposing the verifier in the URL", () => {
    const start = createGoogleDriveOAuthStart({
      config,
      requestedScopes: [GOOGLE_DRIVE_FILE_SCOPE, "openid"],
    });
    expect(start.rawState).toMatch(/^[A-Za-z0-9_-]{32,}$/u);
    expect(start.verifier).toMatch(/^[A-Za-z0-9_-]{32,}$/u);
    expect(start.authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(start.authorizationUrl.searchParams.get("code_challenge")).toBe(start.challenge);
    expect(start.authorizationUrl.searchParams.get("state")).toBe(start.rawState);
    expect(start.authorizationUrl.searchParams.get("client_secret")).toBeNull();
    expect(start.authorizationUrl.searchParams.get("scope")).not.toContain("auth/drive ");
    expect(googleDrivePkceCredentialRef(start.stateDigestHex)).toContain(start.stateDigestHex);
  });

  it("rejects missing OAuth configuration and unsafe redirect", () => {
    expect(() => googleDriveOAuthConfigFromEnv({})).toThrow("credentials_required");
    expect(() => googleDriveOAuthConfigFromEnv({
      GOOGLE_DRIVE_CLIENT_ID: "id",
      GOOGLE_DRIVE_CLIENT_SECRET: "secret",
      GOOGLE_DRIVE_REDIRECT_URI: "http://localhost/callback",
    })).toThrow("redirect_not_allowed");
  });

  it("parses callback success and reduces provider cancellation to a safe code", () => {
    const success = parseGoogleDriveCallback(new URL("https://app.test/callback?code=abc&state=state-abcdefghijklmnopqrstuvwxyz-123456"));
    expect(success).toEqual({ kind: "success", code: "abc", state: "state-abcdefghijklmnopqrstuvwxyz-123456" });
    const cancelled = parseGoogleDriveCallback(new URL("https://app.test/callback?error=access_denied&state=state-abcdefghijklmnopqrstuvwxyz-123456"));
    expect(cancelled).toEqual({ kind: "cancelled", errorCode: "access_denied", state: "state-abcdefghijklmnopqrstuvwxyz-123456" });
  });

  it("accepts any successful token status but rejects extra scopes and malformed bodies", () => {
    expect(parseGoogleDriveTokenResponse(201, {
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      scope: `${GOOGLE_DRIVE_FILE_SCOPE} openid`,
    }, [GOOGLE_DRIVE_FILE_SCOPE, "openid"]).expiresInSeconds).toBe(3600);
    expect(() => parseGoogleDriveTokenResponse(200, {
      access_token: "access",
      refresh_token: "refresh",
      scope: `${GOOGLE_DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/drive`,
    }, [GOOGLE_DRIVE_FILE_SCOPE])).toThrow("token_response_invalid");
    expect(() => parseGoogleDriveTokenResponse(500, { access_token: "access" }, [GOOGLE_DRIVE_FILE_SCOPE])).toThrow("token_exchange_failed");
  });

  it("keeps token exchange and revocation server-side form POSTs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).not.toContain("webhook_body");
      return new Response(JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        scope: GOOGLE_DRIVE_FILE_SCOPE,
      }), { status: 200 });
    });
    await exchangeGoogleDriveAuthorizationCode(fetchImpl, {
      config,
      code: "code",
      verifier: "verifier",
      requestedScopes: [GOOGLE_DRIVE_FILE_SCOPE],
    });
    await revokeGoogleDriveToken(fetchImpl, "refresh");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("bounds streamed token responses and rejects invalid UTF-8", async () => {
    const encoder = new TextEncoder();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("{"));
        controller.enqueue(encoder.encode("x".repeat(64 * 1024)));
        controller.close();
      },
    });
    const oversizedFetch = vi.fn<typeof fetch>(async () => new Response(oversized, { status: 200 }));
    await expect(exchangeGoogleDriveAuthorizationCode(oversizedFetch, {
      config,
      code: "code",
      verifier: "verifier",
      requestedScopes: [GOOGLE_DRIVE_FILE_SCOPE],
    })).rejects.toThrow("token_response_invalid");

    const invalidUtf8Fetch = vi.fn<typeof fetch>(async () => new Response(
      new Uint8Array([0x7b, 0xff]),
      { status: 200 },
    ));
    await expect(exchangeGoogleDriveAuthorizationCode(invalidUtf8Fetch, {
      config,
      code: "code",
      verifier: "verifier",
      requestedScopes: [GOOGLE_DRIVE_FILE_SCOPE],
    })).rejects.toThrow("token_response_invalid");
  });
});
