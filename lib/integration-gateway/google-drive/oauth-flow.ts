import { z } from "zod";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import {
  createGoogleDriveOAuthStart,
  exchangeGoogleDriveAuthorizationCode,
  googleDriveByteaHex,
  googleDriveOAuthConfigFromEnv,
  googleDrivePkceCredentialRef,
  googleDriveRedirectUriHashHex,
  googleDriveStateDigestHex,
  createGoogleDriveOAuthAuthorizationUrl,
  parseGoogleDriveCallback,
  type GoogleDriveOAuthConfig,
  type GoogleDriveTokenSet,
} from "./oauth";
import { assertGoogleDriveScopes, GOOGLE_DRIVE_FILE_SCOPE } from "./policy";

const commandResultSchema = z.object({
  operation: z.string().min(1),
  replay: z.boolean(),
  result: z.record(z.string(), z.unknown()),
});

const intentResultSchema = z.object({
  intentId: z.string().uuid(),
  providerCode: z.literal("google_drive"),
  organizationId: z.string().uuid(),
  actorId: z.string().uuid(),
  requestedScopes: z.array(z.string().min(1)),
  pkceCredentialRef: z.string().min(1),
});

const activationResultSchema = z.object({
  connectionId: z.string().uuid(),
  providerCode: z.literal("google_drive"),
  organizationId: z.string().uuid(),
  status: z.literal("connected"),
});

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export class GoogleDriveOAuthFlowError extends Error {
  constructor(
    readonly code:
      | "callback_uri_mismatch"
      | "pkce_verifier_missing"
      | "credential_ref_invalid"
      | "account_identity_invalid",
  ) {
    super(`google_drive_oauth_flow_${code}`);
    this.name = "GoogleDriveOAuthFlowError";
  }
}

export interface GoogleDriveOAuthIntent {
  readonly intentId: string;
  readonly providerCode: "google_drive";
  readonly organizationId: string;
  readonly actorId: string;
  readonly requestedScopes: readonly string[];
  readonly pkceCredentialRef: string;
}

export interface GoogleDriveCreatedOAuthIntent {
  readonly intentId: string;
  readonly providerCode: "google_drive";
  readonly requestedScopes: readonly string[];
  readonly pkceCredentialRef: string;
  readonly stateDigestHex: string;
  readonly expiresAt: string;
  readonly replay: boolean;
}

export interface GoogleDriveOAuthRegistry {
  createIntent(input: {
    readonly organizationId: string;
    readonly stateDigestHex: string;
    readonly pkceCredentialRef: string;
    readonly redirectUriHashHex: string;
    readonly requestedScopes: readonly string[];
    readonly expiresAt: string;
    readonly idempotencyKey: string;
  }): Promise<GoogleDriveCreatedOAuthIntent>;
  consumeIntent(input: {
    readonly providerCode: "google_drive";
    readonly stateDigestHex: string;
    readonly redirectUriHashHex: string;
  }): Promise<GoogleDriveOAuthIntent>;
  activateConnection(input: {
    readonly intentId: string;
    readonly credentialRef: string;
    readonly grantedScopes: readonly string[];
    readonly externalSubjectHashHex: string;
    readonly displayLabel: string;
    readonly tokenExpiresAt: string | null;
    readonly idempotencyKey: string;
  }): Promise<{ readonly connectionId: string; readonly providerCode: "google_drive"; readonly organizationId: string; readonly status: "connected" }>;
}

export interface GoogleDrivePkceSecretStore {
  putVerifier(input: {
    readonly credentialRef: string;
    readonly rawState: string;
    readonly verifier: string;
    readonly expiresAt: string;
  }): Promise<void>;
  getVerifier(input: { readonly credentialRef: string }): Promise<{
    readonly rawState: string;
    readonly verifier: string;
  } | null>;
  takeVerifier(input: { readonly credentialRef: string }): Promise<string | null>;
}

export interface GoogleDriveCredentialStore {
  save(input: {
    readonly intentId: string;
    readonly tokenSet: GoogleDriveTokenSet;
  }): Promise<{ readonly credentialRef: string }>;
  delete?(input: { readonly credentialRef: string }): Promise<void>;
}

export interface GoogleDriveAccountResolver {
  resolve(input: {
    readonly accessToken: string;
  }): Promise<{
    readonly externalSubjectHashHex: string;
    readonly displayLabel: string;
  }>;
}

function assertIdempotencyKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > 512) throw new Error("google_drive_oauth_idempotency_invalid");
  return key;
}

function assertCallbackBase(callbackUrl: URL, redirectUri: URL): void {
  const callbackBase = new URL(callbackUrl.toString());
  callbackBase.search = "";
  callbackBase.hash = "";
  if (callbackBase.toString() !== redirectUri.toString()) {
    throw new GoogleDriveOAuthFlowError("callback_uri_mismatch");
  }
}

function tokenExpiryIso(now: Date, expiresInSeconds: number | null): string | null {
  if (expiresInSeconds === null) return null;
  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

export class PostgresGoogleDriveOAuthRegistry implements GoogleDriveOAuthRegistry {
  constructor(private readonly client: PostgresRpcClient) {}

  async createIntent(input: Parameters<GoogleDriveOAuthRegistry["createIntent"]>[0]) {
    const result = commandResultSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "create_oauth_intent",
      {
        p_organization_id: input.organizationId,
        p_provider_code: "google_drive",
        p_state_digest: googleDriveByteaHex(input.stateDigestHex),
        p_pkce_credential_ref: input.pkceCredentialRef,
        p_redirect_uri_hash: googleDriveByteaHex(input.redirectUriHashHex),
        p_requested_scopes: input.requestedScopes,
        p_expires_at: input.expiresAt,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
    const created = z.object({
      intentId: z.string().uuid(),
      providerCode: z.literal("google_drive"),
      stateDigestHex: z.string().regex(/^[a-f0-9]{64}$/u),
      pkceCredentialRef: z.string().min(1),
      requestedScopes: z.array(z.string().min(1)),
      expiresAt: z.string(),
    }).parse(result.result);
    return { ...created, replay: result.replay };
  }

  async consumeIntent(input: Parameters<GoogleDriveOAuthRegistry["consumeIntent"]>[0]) {
    return intentResultSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "consume_oauth_intent",
      {
        p_provider_code: input.providerCode,
        p_state_digest: googleDriveByteaHex(input.stateDigestHex),
        p_redirect_uri_hash: googleDriveByteaHex(input.redirectUriHashHex),
      },
    ));
  }

  async activateConnection(input: Parameters<GoogleDriveOAuthRegistry["activateConnection"]>[0]) {
    const result = commandResultSchema.parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "activate_oauth_connection",
      {
        p_intent_id: input.intentId,
        p_credential_ref: input.credentialRef,
        p_granted_scopes: input.grantedScopes,
        p_external_subject_hash: googleDriveByteaHex(input.externalSubjectHashHex),
        p_display_label: input.displayLabel,
        p_metadata: {
          authMethod: "oauth",
          selectionMode: "explicit_selected_object",
        },
        p_token_expires_at: input.tokenExpiresAt,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
    return activationResultSchema.parse(result.result);
  }
}

export interface GoogleDriveOAuthFlowDependencies {
  readonly config: GoogleDriveOAuthConfig;
  readonly registry: GoogleDriveOAuthRegistry;
  readonly pkceStore: GoogleDrivePkceSecretStore;
  readonly credentialStore: GoogleDriveCredentialStore;
  readonly accountResolver: GoogleDriveAccountResolver;
  readonly fetchImpl: typeof fetch;
  readonly now?: () => Date;
}

export class GoogleDriveOAuthFlow {
  private readonly now: () => Date;

  constructor(private readonly dependencies: GoogleDriveOAuthFlowDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  static fromEnv(input: Omit<GoogleDriveOAuthFlowDependencies, "config"> & {
    readonly env?: Readonly<Record<string, string | undefined>>;
  }): GoogleDriveOAuthFlow {
    return new GoogleDriveOAuthFlow({
      ...input,
      config: googleDriveOAuthConfigFromEnv(input.env),
    });
  }

  async start(input: {
    readonly organizationId: string;
    readonly requestedScopes?: readonly string[];
    readonly idempotencyKey: string;
  }): Promise<{ readonly intentId: string; readonly authorizationUrl: string; readonly expiresAt: string }> {
    const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
    const requestedScopes = assertGoogleDriveScopes(input.requestedScopes ?? [GOOGLE_DRIVE_FILE_SCOPE]);
    const start = createGoogleDriveOAuthStart({
      config: this.dependencies.config,
      requestedScopes,
    });
    const expiresAt = new Date(this.now().getTime() + 5 * 60 * 1000).toISOString();
    const pkceCredentialRef = googleDrivePkceCredentialRef(start.stateDigestHex);
    await this.dependencies.pkceStore.putVerifier({
      credentialRef: pkceCredentialRef,
      rawState: start.rawState,
      verifier: start.verifier,
      expiresAt,
    });
    try {
      const intent = await this.dependencies.registry.createIntent({
        organizationId: input.organizationId,
        stateDigestHex: start.stateDigestHex,
        pkceCredentialRef,
        redirectUriHashHex: googleDriveRedirectUriHashHex(this.dependencies.config.redirectUri),
        requestedScopes,
        expiresAt,
        idempotencyKey,
      });
      if (!intent.replay) {
        return {
          intentId: intent.intentId,
          authorizationUrl: start.authorizationUrl.toString(),
          expiresAt: intent.expiresAt,
        };
      }
      const existing = await this.dependencies.pkceStore.getVerifier({
        credentialRef: intent.pkceCredentialRef,
      });
      if (!existing || googleDriveStateDigestHex(existing.rawState) !== intent.stateDigestHex) {
        throw new GoogleDriveOAuthFlowError("pkce_verifier_missing");
      }
      return {
        intentId: intent.intentId,
        authorizationUrl: createGoogleDriveOAuthAuthorizationUrl({
          config: this.dependencies.config,
          requestedScopes: intent.requestedScopes,
          rawState: existing.rawState,
          verifier: existing.verifier,
        }).toString(),
        expiresAt: intent.expiresAt,
      };
    } catch (error) {
      // The verifier remains server-side and expires naturally if cleanup is unavailable.
      throw error;
    }
  }

  async complete(input: {
    readonly callbackUrl: URL;
    readonly idempotencyKey: string;
  }): Promise<
    | { readonly kind: "cancelled"; readonly errorCode: string }
    | { readonly kind: "connected"; readonly connectionId: string }
  > {
    assertCallbackBase(input.callbackUrl, this.dependencies.config.redirectUri);
    const callback = parseGoogleDriveCallback(input.callbackUrl);
    if (callback.kind === "cancelled") {
      if (callback.state) {
        try {
          const intent = await this.dependencies.registry.consumeIntent({
            providerCode: "google_drive",
            stateDigestHex: googleDriveStateDigestHex(callback.state),
            redirectUriHashHex: googleDriveRedirectUriHashHex(this.dependencies.config.redirectUri),
          });
          await this.dependencies.pkceStore.takeVerifier({
            credentialRef: intent.pkceCredentialRef,
          });
        } catch {
          // Cancellation is already a terminal browser outcome; do not expose provider/database detail.
        }
      }
      return { kind: "cancelled", errorCode: callback.errorCode };
    }

    const intent = await this.dependencies.registry.consumeIntent({
      providerCode: "google_drive",
      stateDigestHex: googleDriveStateDigestHex(callback.state),
      redirectUriHashHex: googleDriveRedirectUriHashHex(this.dependencies.config.redirectUri),
    });
    const verifier = await this.dependencies.pkceStore.takeVerifier({
      credentialRef: intent.pkceCredentialRef,
    });
    if (!verifier) throw new GoogleDriveOAuthFlowError("pkce_verifier_missing");
    const tokenSet = await exchangeGoogleDriveAuthorizationCode(this.dependencies.fetchImpl, {
      config: this.dependencies.config,
      code: callback.code,
      verifier,
      requestedScopes: intent.requestedScopes,
    });
    const account = await this.dependencies.accountResolver.resolve({ accessToken: tokenSet.accessToken });
    if (!digestSchema.safeParse(account.externalSubjectHashHex).success || !account.displayLabel.trim()) {
      throw new GoogleDriveOAuthFlowError("account_identity_invalid");
    }
    const credential = await this.dependencies.credentialStore.save({
      intentId: intent.intentId,
      tokenSet,
    });
    if (!credential.credentialRef.trim() || credential.credentialRef.length > 512) {
      if (this.dependencies.credentialStore.delete) {
        await this.dependencies.credentialStore.delete({ credentialRef: credential.credentialRef });
      }
      throw new GoogleDriveOAuthFlowError("credential_ref_invalid");
    }
    try {
      const connection = await this.dependencies.registry.activateConnection({
        intentId: intent.intentId,
        credentialRef: credential.credentialRef,
        grantedScopes: tokenSet.grantedScopes,
        externalSubjectHashHex: account.externalSubjectHashHex,
        displayLabel: account.displayLabel.trim(),
        tokenExpiresAt: tokenExpiryIso(this.now(), tokenSet.expiresInSeconds),
        idempotencyKey: `${assertIdempotencyKey(input.idempotencyKey)}:activate`,
      });
      return { kind: "connected", connectionId: connection.connectionId };
    } catch (error) {
      if (this.dependencies.credentialStore.delete) {
        await this.dependencies.credentialStore.delete({ credentialRef: credential.credentialRef });
      }
      throw error;
    }
  }
}
