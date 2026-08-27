import type { SecretStore } from "../core/secret-store";
import type {
  GoogleDriveCredentialStore,
  GoogleDrivePkceSecretStore,
} from "./oauth-flow";
import type { GoogleDriveTokenSet } from "./oauth";
import { googleDriveObjectSchema, type GoogleDriveSelectedObject } from "./policy";

function credentialRef(intentId: string): string {
  return `credential:google-drive:${intentId}`;
}

export class SecretStoreGoogleDrivePkceStore implements GoogleDrivePkceSecretStore {
  constructor(private readonly store: SecretStore) {}

  putVerifier(input: Parameters<GoogleDrivePkceSecretStore["putVerifier"]>[0]): Promise<void> {
    return this.store.put({
      ref: input.credentialRef,
      value: { raw_state: input.rawState, pkce_value: input.verifier },
      expiresAt: input.expiresAt,
    });
  }

  async getVerifier(input: Parameters<GoogleDrivePkceSecretStore["getVerifier"]>[0]) {
    const record = await this.store.get(input.credentialRef);
    if (!record) return null;
    const rawState = record.value.raw_state;
    const verifier = record.value.pkce_value;
    return rawState && verifier ? { rawState, verifier } : null;
  }

  async takeVerifier(input: Parameters<GoogleDrivePkceSecretStore["takeVerifier"]>[0]) {
    const record = await this.store.take(input.credentialRef);
    return record?.value.pkce_value ?? null;
  }
}

export class SecretStoreGoogleDriveCredentialStore implements GoogleDriveCredentialStore {
  constructor(private readonly store: SecretStore) {}

  async save(input: {
    readonly intentId: string;
    readonly tokenSet: GoogleDriveTokenSet;
  }): Promise<{ readonly credentialRef: string }> {
    const ref = credentialRef(input.intentId);
    await this.store.put({
      ref,
      value: {
        access_value: input.tokenSet.accessToken,
        refresh_value: input.tokenSet.refreshToken ?? "",
        expires_seconds: input.tokenSet.expiresInSeconds === null
          ? ""
          : String(input.tokenSet.expiresInSeconds),
        expires_at: input.tokenSet.expiresInSeconds === null
          ? ""
          : new Date(Date.now() + input.tokenSet.expiresInSeconds * 1000).toISOString(),
        token_type: input.tokenSet.tokenType,
        granted_scopes: input.tokenSet.grantedScopes.join(" "),
      },
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    return { credentialRef: ref };
  }

  delete(input: { readonly credentialRef: string }): Promise<void> {
    return this.store.delete(input.credentialRef);
  }

  async getTokenSet(credentialRefInput: string): Promise<GoogleDriveTokenSet | null> {
    const record = await this.store.get(credentialRefInput);
    if (!record) return null;
    const accessToken = record.value.access_value;
    const refreshToken = record.value.refresh_value || null;
    const expiresText = record.value.expires_seconds;
    const expiresInSeconds = expiresText ? Number(expiresText) : null;
    if (
      !accessToken
      || (expiresInSeconds !== null && !Number.isSafeInteger(expiresInSeconds))
      || (record.value.expires_at && new Date(record.value.expires_at).getTime() <= Date.now())
    ) return null;
    return {
      accessToken,
      refreshToken,
      expiresInSeconds,
      tokenType: record.value.token_type || "Bearer",
      grantedScopes: (record.value.granted_scopes ?? "").split(/\s+/u).filter(Boolean),
    };
  }
}

export class SecretStoreGoogleDriveSelectionStore {
  constructor(private readonly store: SecretStore) {}

  async put(input: { readonly ref: string; readonly selected: GoogleDriveSelectedObject }): Promise<void> {
    await this.store.put({
      ref: input.ref,
      value: {
        opaque_value: input.selected.opaqueKey,
        object_kind: input.selected.kind,
        display_name: input.selected.displayName,
        mime_type: input.selected.mimeType,
        size_bytes: input.selected.sizeBytes === null ? "" : String(input.selected.sizeBytes),
        revision_value: input.selected.revision,
        modified_at: input.selected.modifiedAt ?? "",
      },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  }

  async take(ref: string): Promise<GoogleDriveSelectedObject | null> {
    const record = await this.store.take(ref);
    return this.toSelection(record);
  }

  async get(ref: string): Promise<GoogleDriveSelectedObject | null> {
    const record = await this.store.get(ref);
    return this.toSelection(record);
  }

  delete(ref: string): Promise<void> {
    return this.store.delete(ref);
  }

  private toSelection(record: Awaited<ReturnType<SecretStore["get"]>>): GoogleDriveSelectedObject | null {
    if (!record) return null;
    const size = record.value.size_bytes;
    const parsed = googleDriveObjectSchema.safeParse({
      opaqueKey: record.value.opaque_value ?? "",
      kind: record.value.object_kind as GoogleDriveSelectedObject["kind"],
      displayName: record.value.display_name ?? "",
      mimeType: record.value.mime_type ?? "",
      sizeBytes: size ? Number(size) : null,
      revision: record.value.revision_value ?? "",
      modifiedAt: record.value.modified_at || null,
    });
    return parsed.success ? parsed.data : null;
  }
}
