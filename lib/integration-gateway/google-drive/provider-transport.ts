import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ConnectionRef,
  ConnectorHealth,
  ExternalObjectPage,
  ImportCandidateResult,
  RequestActorContext,
} from "../core/connector";
import { GOOGLE_DRIVE_FILE_SCOPE, assertGoogleDriveImportableFile, assertGoogleDriveScopes, type GoogleDriveSelectedObject } from "./policy";
import { GOOGLE_DRIVE_TOKEN_RESPONSE_MAX_BYTES, revokeGoogleDriveToken } from "./oauth";
import type { GoogleDriveDownloadedObject } from "./import-worker";
import type { GoogleDriveTransport } from "./connector";
import { callRpc } from "@/lib/project-intelligence/adapters/postgres/rpc";
import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import { SecretStoreGoogleDriveCredentialStore } from "./secret-store-adapters";

const driveFileSchema = z.object({
  id: z.string().min(1).max(1024),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  size: z.string().regex(/^\d+$/u).optional(),
  version: z.string().min(1).max(255),
  modifiedTime: z.string().datetime().nullable().optional(),
}).strict();

const driveListSchema = z.object({
  files: z.array(driveFileSchema).max(100),
  nextPageToken: z.string().max(2048).optional(),
}).strict();

const userInfoSchema = z.object({
  sub: z.string().min(1).max(512),
  name: z.string().max(160).optional(),
  email: z.string().max(320).optional(),
}).strict();

const MAX_DRIVE_OBJECT_BYTES = 50 * 1024 * 1024;
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";

export interface GoogleDriveCredentialResolver {
  getTokenSet(connectionId: string): Promise<{
    readonly accessToken: string;
    readonly refreshToken: string | null;
    readonly expiresInSeconds: number | null;
    readonly tokenType: string;
    readonly grantedScopes: readonly string[];
  } | null>;
  delete?(connectionId: string): Promise<void>;
}

export class GoogleDriveProviderError extends Error {
  constructor(readonly code: "reauth_required" | "provider_unavailable") {
    super(`google_drive_provider_${code}`);
    this.name = "GoogleDriveProviderError";
  }
}

export class PostgresGoogleDriveCredentialResolver implements GoogleDriveCredentialResolver {
  constructor(
    private readonly client: PostgresRpcClient,
    private readonly store: SecretStoreGoogleDriveCredentialStore,
  ) {}

  private async ref(connectionId: string): Promise<string> {
    const result = z.object({ credentialRef: z.string().min(1).max(512) }).parse(await callRpc(
      this.client,
      "remhaos_integration_api",
      "get_integration_credential_ref",
      { p_connection_id: connectionId },
    ));
    return result.credentialRef;
  }

  getTokenSet(connectionId: string) {
    return this.ref(connectionId).then((ref) => this.store.getTokenSet(ref));
  }

  async delete(connectionId: string): Promise<void> {
    await this.store.delete({ credentialRef: await this.ref(connectionId) });
  }
}

function hashOpaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length")?.trim();
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    throw new Error("google_drive_response_too_large");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("google_drive_response_too_large");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new Error("google_drive_response_too_large");
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const bytes = await readBoundedBytes(response, GOOGLE_DRIVE_TOKEN_RESPONSE_MAX_BYTES);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("google_drive_provider_response_invalid");
  }
}

function assertConnection(connection: ConnectionRef, actor: RequestActorContext): void {
  if (
    connection.provider !== "google_drive"
    || connection.organizationId !== actor.organizationId
    || (actor.projectId !== undefined && actor.projectId.length < 1)
  ) throw new Error("google_drive_connection_scope_mismatch");
}

export class GoogleDriveProviderTransport implements GoogleDriveTransport {
  constructor(
    private readonly credentials: GoogleDriveCredentialResolver,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async token(connection: ConnectionRef): Promise<string> {
    const tokenSet = await this.credentials.getTokenSet(connection.connectionId);
    if (!tokenSet) throw new GoogleDriveProviderError("reauth_required");
    try {
      assertGoogleDriveScopes(tokenSet.grantedScopes);
    } catch {
      throw new Error("google_drive_scope_invalid");
    }
    if (tokenSet.expiresInSeconds !== null && tokenSet.expiresInSeconds <= 0) {
      throw new Error("google_drive_token_expired");
    }
    return tokenSet.accessToken;
  }

  async startAuthorization(): Promise<{ readonly authorizationUrl: string; readonly intentId: string }> {
    throw new Error("google_drive_authorization_is_orchestrated_by_oauth_flow");
  }

  async completeAuthorization(): Promise<ConnectionRef> {
    throw new Error("google_drive_authorization_is_orchestrated_by_oauth_flow");
  }

  async disconnect(input: { readonly actor: RequestActorContext; readonly connection: ConnectionRef }): Promise<void> {
    assertConnection(input.connection, input.actor);
    const tokenSet = await this.credentials.getTokenSet(input.connection.connectionId);
    if (tokenSet) await revokeGoogleDriveToken(this.fetchImpl, tokenSet.refreshToken ?? tokenSet.accessToken);
    await this.credentials.delete?.(input.connection.connectionId);
  }

  async listObjects(input: {
    readonly actor: RequestActorContext;
    readonly connection: ConnectionRef;
    readonly cursor?: string;
  }): Promise<ExternalObjectPage> {
    assertConnection(input.connection, input.actor);
    const token = await this.token(input.connection);
    const url = new URL(GOOGLE_DRIVE_FILES_ENDPOINT);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("fields", "files(id,name,mimeType,size,version,modifiedTime),nextPageToken");
    url.searchParams.set("spaces", "drive");
    url.searchParams.set("orderBy", "modifiedTime desc");
    if (input.cursor) url.searchParams.set("pageToken", input.cursor);
    const response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) throw new GoogleDriveProviderError("reauth_required");
    const body = driveListSchema.parse(await readBoundedJson(response));
    if (!response.ok) throw new Error("google_drive_list_failed");
    return {
      items: body.files.map((file) => ({
        opaqueKey: file.id,
        kind: file.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file",
        displayName: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.size ? Number(file.size) : undefined,
        revision: file.version,
        modifiedAt: file.modifiedTime ?? undefined,
      })),
      nextCursor: body.nextPageToken,
    };
  }

  async downloadSelectedObject(input: {
    readonly actor: RequestActorContext;
    readonly connection: ConnectionRef;
    readonly projectConnectionId: string;
    readonly selected: GoogleDriveSelectedObject;
  }): Promise<GoogleDriveDownloadedObject> {
    assertConnection(input.connection, input.actor);
    const selected = assertGoogleDriveImportableFile(input.selected);
    const token = await this.token(input.connection);
    const metadataUrl = new URL(`${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(selected.opaqueKey)}`);
    metadataUrl.searchParams.set("fields", "id,name,mimeType,size,version,modifiedTime");
    const metadataResponse = await this.fetchImpl(metadataUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (metadataResponse.status === 401) throw new GoogleDriveProviderError("reauth_required");
    if (!metadataResponse.ok) throw new GoogleDriveProviderError("provider_unavailable");
    const metadata = driveFileSchema.parse(await readBoundedJson(metadataResponse));
    const actual: GoogleDriveSelectedObject = {
      opaqueKey: metadata.id,
      kind: "file",
      displayName: metadata.name,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.size ? Number(metadata.size) : null,
      revision: metadata.version,
      modifiedAt: metadata.modifiedTime ?? null,
    };
    if (
      actual.opaqueKey !== selected.opaqueKey
      || actual.revision !== selected.revision
      || actual.displayName !== selected.displayName
      || actual.mimeType !== selected.mimeType
      || actual.sizeBytes !== selected.sizeBytes
      || actual.modifiedAt !== selected.modifiedAt
    ) throw new Error("google_drive_selected_object_changed");
    if (actual.sizeBytes !== null && actual.sizeBytes > MAX_DRIVE_OBJECT_BYTES) {
      throw new Error("google_drive_selected_object_too_large");
    }
    const downloadUrl = new URL(`${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(selected.opaqueKey)}`);
    downloadUrl.searchParams.set("alt", "media");
    const response = await this.fetchImpl(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) throw new GoogleDriveProviderError("reauth_required");
    if (!response.ok) throw new GoogleDriveProviderError("provider_unavailable");
    const bytes = await readBoundedBytes(response, actual.sizeBytes ?? MAX_DRIVE_OBJECT_BYTES);
    if (actual.sizeBytes !== null && bytes.byteLength !== actual.sizeBytes) {
      throw new Error("google_drive_download_size_mismatch");
    }
    return {
      selected: actual,
      bytes,
      filename: actual.displayName,
      providerMediaType: actual.mimeType,
    };
  }

  async importObject(_input: Parameters<GoogleDriveTransport["importObject"]>[0]): Promise<ImportCandidateResult> {
    void _input;
    throw new Error("google_drive_import_requires_selected_worker_job");
  }

  async health(connection: ConnectionRef): Promise<ConnectorHealth> {
    const checkedAt = this.now().toISOString();
    const tokenSet = await this.credentials.getTokenSet(connection.connectionId);
    return {
      status: tokenSet ? "connected" : "reauth_required",
      checkedAt,
      reasonCode: tokenSet ? undefined : "credential_missing",
    };
  }

  static externalSubjectHash(subject: string): string {
    return hashOpaque(subject);
  }
}

export class GoogleDriveUserInfoResolver {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async resolve(input: { readonly accessToken: string }) {
    const response = await this.fetchImpl(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    if (!response.ok) throw new Error("google_drive_account_lookup_failed");
    const user = userInfoSchema.parse(await readBoundedJson(response));
    return {
      externalSubjectHashHex: GoogleDriveProviderTransport.externalSubjectHash(user.sub),
      displayLabel: (user.name ?? user.email ?? "Google Drive").slice(0, 160),
    };
  }
}

export function assertDriveFileScope(scopes: readonly string[]): readonly string[] {
  return assertGoogleDriveScopes(scopes).filter((scope) => scope === GOOGLE_DRIVE_FILE_SCOPE || scope === "openid" || scope === "email" || scope === "profile");
}
