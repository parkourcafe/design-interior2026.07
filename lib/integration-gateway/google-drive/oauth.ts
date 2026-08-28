import { createHash } from "node:crypto";
import {
  createOAuthIntentState,
  createPkceChallenge,
  redirectUriHashHex,
  sha256Hex,
  type OAuthIntentState,
  type PkceChallenge,
} from "../core/oauth-intent";
import { assertGoogleDriveScopes, GOOGLE_DRIVE_FILE_SCOPE } from "./policy";

export const GOOGLE_DRIVE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_DRIVE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_DRIVE_REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_DRIVE_TOKEN_RESPONSE_MAX_BYTES = 64 * 1024;
export { GOOGLE_DRIVE_FILE_SCOPE };

export interface GoogleDriveOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: URL;
}

export class GoogleDriveOAuthConfigurationError extends Error {
  constructor(readonly code: "credentials_required" | "redirect_not_allowed") {
    super(`google_drive_oauth_${code}`);
    this.name = "GoogleDriveOAuthConfigurationError";
  }
}

export class GoogleDriveOAuthProtocolError extends Error {
  constructor(readonly code: "token_exchange_failed" | "token_response_invalid" | "revoke_failed") {
    super(`google_drive_oauth_${code}`);
    this.name = "GoogleDriveOAuthProtocolError";
  }
}

export function googleDriveOAuthConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GoogleDriveOAuthConfig {
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ?? "";
  const redirectValue = env.GOOGLE_DRIVE_REDIRECT_URI?.trim() ?? "";
  if (!clientId || !clientSecret || !redirectValue) {
    throw new GoogleDriveOAuthConfigurationError("credentials_required");
  }
  let redirectUri: URL;
  try {
    redirectUri = new URL(redirectValue);
  } catch {
    throw new GoogleDriveOAuthConfigurationError("redirect_not_allowed");
  }
  if (redirectUri.protocol !== "https:" || redirectUri.username || redirectUri.password || redirectUri.hash) {
    throw new GoogleDriveOAuthConfigurationError("redirect_not_allowed");
  }
  return { clientId, clientSecret, redirectUri };
}

export function createGoogleDriveOAuthStart(input: {
  readonly config: GoogleDriveOAuthConfig;
  readonly requestedScopes: readonly string[];
}): OAuthIntentState & PkceChallenge & { readonly authorizationUrl: URL } {
  const requestedScopes = assertGoogleDriveScopes(input.requestedScopes);
  const state = createOAuthIntentState();
  const pkce = createPkceChallenge();
  return {
    ...state,
    ...pkce,
    authorizationUrl: createGoogleDriveOAuthAuthorizationUrl({
      config: input.config,
      requestedScopes,
      rawState: state.rawState,
      verifier: pkce.verifier,
    }),
  };
}

export function createGoogleDriveOAuthAuthorizationUrl(input: {
  readonly config: GoogleDriveOAuthConfig;
  readonly requestedScopes: readonly string[];
  readonly rawState: string;
  readonly verifier: string;
}): URL {
  const requestedScopes = assertGoogleDriveScopes(input.requestedScopes);
  const authorizationUrl = new URL(GOOGLE_DRIVE_AUTHORIZATION_ENDPOINT);
  const challenge = createHash("sha256").update(input.verifier, "utf8").digest("base64url");
  authorizationUrl.searchParams.set("client_id", input.config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", input.config.redirectUri.toString());
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", requestedScopes.join(" "));
  authorizationUrl.searchParams.set("state", input.rawState);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  return authorizationUrl;
}

export function googleDrivePkceCredentialRef(stateDigestHex: string): string {
  if (!/^[a-f0-9]{64}$/u.test(stateDigestHex)) throw new Error("google_drive_state_digest_invalid");
  return `oauth-pkce:google-drive:${stateDigestHex}`;
}

export function parseGoogleDriveCallback(url: URL):
  | { readonly kind: "success"; readonly code: string; readonly state: string }
  | { readonly kind: "cancelled"; readonly state: string | null; readonly errorCode: string } {
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) {
    return {
      kind: "cancelled",
      state: state && state.length <= 512 ? state : null,
      errorCode: /^[a-z][a-z0-9_-]{0,63}$/u.test(error) ? error : "provider_denied",
    };
  }
  const code = url.searchParams.get("code");
  if (!state || state.length < 32 || state.length > 512 || !code || code.length > 4096) {
    throw new GoogleDriveOAuthProtocolError("token_response_invalid");
  }
  return { kind: "success", code, state };
}

export interface GoogleDriveTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresInSeconds: number | null;
  readonly tokenType: string;
  readonly grantedScopes: readonly string[];
}

export function parseGoogleDriveTokenResponse(
  status: number,
  body: unknown,
  requestedScopes: readonly string[],
): GoogleDriveTokenSet {
  if (status < 200 || status >= 300) throw new GoogleDriveOAuthProtocolError("token_exchange_failed");
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new GoogleDriveOAuthProtocolError("token_response_invalid");
  }
  const record = body as Record<string, unknown>;
  const accessToken = typeof record.access_token === "string" ? record.access_token : "";
  const refreshToken = record.refresh_token === undefined
    ? null
    : typeof record.refresh_token === "string" ? record.refresh_token : "";
  const tokenType = typeof record.token_type === "string" ? record.token_type : "Bearer";
  const expiresIn = record.expires_in === undefined
    ? null
    : typeof record.expires_in === "number" && Number.isSafeInteger(record.expires_in) && record.expires_in > 0
      ? record.expires_in
      : 0;
  const grantedScopes = typeof record.scope === "string"
    ? record.scope.split(/\s+/u).filter(Boolean)
    : [...requestedScopes];
  if (!accessToken || !refreshToken && record.refresh_token !== undefined || !expiresIn && record.expires_in !== undefined) {
    throw new GoogleDriveOAuthProtocolError("token_response_invalid");
  }
  try {
    assertGoogleDriveScopes(grantedScopes);
  } catch {
    throw new GoogleDriveOAuthProtocolError("token_response_invalid");
  }
  const requested = new Set(requestedScopes);
  if (grantedScopes.some((scope) => !requested.has(scope))) {
    throw new GoogleDriveOAuthProtocolError("token_response_invalid");
  }
  return { accessToken, refreshToken, expiresInSeconds: expiresIn, tokenType, grantedScopes };
}

async function readBoundedTokenResponse(
  response: Response,
  maxBytes = GOOGLE_DRIVE_TOKEN_RESPONSE_MAX_BYTES,
): Promise<string> {
  const declaredLength = response.headers.get("content-length")?.trim();
  if (declaredLength) {
    const length = Number(declaredLength);
    if (!/^\d+$/u.test(declaredLength) || !Number.isSafeInteger(length) || length > maxBytes) {
      throw new GoogleDriveOAuthProtocolError("token_response_invalid");
    }
  }
  if (!response.body) {
    try {
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > maxBytes) {
        throw new GoogleDriveOAuthProtocolError("token_response_invalid");
      }
      return raw;
    } catch (error) {
      if (error instanceof GoogleDriveOAuthProtocolError) throw error;
      throw new GoogleDriveOAuthProtocolError("token_response_invalid");
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        throw new GoogleDriveOAuthProtocolError("token_response_invalid");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof GoogleDriveOAuthProtocolError) throw error;
    throw new GoogleDriveOAuthProtocolError("token_response_invalid");
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GoogleDriveOAuthProtocolError("token_response_invalid");
  }
}

export async function exchangeGoogleDriveAuthorizationCode(
  fetchImpl: typeof fetch,
  input: {
    readonly config: GoogleDriveOAuthConfig;
    readonly code: string;
    readonly verifier: string;
    readonly requestedScopes: readonly string[];
  },
): Promise<GoogleDriveTokenSet> {
  const body = new URLSearchParams({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: "authorization_code",
    redirect_uri: input.config.redirectUri.toString(),
  });
  const response = await fetchImpl(GOOGLE_DRIVE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const raw = await readBoundedTokenResponse(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new GoogleDriveOAuthProtocolError("token_response_invalid");
  }
  return parseGoogleDriveTokenResponse(response.status, parsed, input.requestedScopes);
}

export async function revokeGoogleDriveToken(
  fetchImpl: typeof fetch,
  token: string,
): Promise<void> {
  const response = await fetchImpl(GOOGLE_DRIVE_REVOCATION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new GoogleDriveOAuthProtocolError("revoke_failed");
  }
}

export function googleDriveStateDigestHex(rawState: string): string {
  return sha256Hex(rawState);
}

export function googleDriveRedirectUriHashHex(redirectUri: URL): string {
  return redirectUriHashHex(redirectUri);
}

export function googleDriveByteaHex(hex: string): string {
  if (!/^[a-f0-9]{64}$/u.test(hex)) throw new Error("google_drive_bytea_invalid");
  return `\\x${hex}`;
}

export const googleDriveRequiredScope = GOOGLE_DRIVE_FILE_SCOPE;
