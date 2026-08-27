import { createHash } from "node:crypto";
import type { PrivateStorageClient, StorageErrorLike } from "@/lib/project-intelligence/adapters/storage";
import {
  assertFileIntakeInternalKey,
  assertFileIntakeQuarantineKey,
} from "./policy";

export interface FileIntakeStorageAuthorization {
  readonly bucket: "client-uploads";
  readonly objectKey: string;
  readonly internalObjectKey?: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly intakeId: string;
  readonly checksumHex: string;
  readonly extension: string;
  readonly sourceRole: string;
  readonly mediaType: string;
  readonly upsert: false;
}

export interface FileIntakeDownloadAuthorization {
  readonly bucket: "client-uploads";
  readonly objectKey: string;
  readonly ttlSeconds: number;
}

export class FileIntakeStorageAdapter {
  constructor(private readonly storage: PrivateStorageClient) {}

  async uploadQuarantine(
    authorization: FileIntakeStorageAuthorization,
    bytes: Uint8Array,
  ): Promise<boolean> {
    if (authorization.bucket !== "client-uploads" || authorization.upsert !== false) {
      throw new Error("file_intake_storage_authorization_mismatch");
    }
    const checksumHex = createHash("sha256").update(bytes).digest("hex");
    if (checksumHex !== authorization.checksumHex) {
      throw new Error("file_intake_storage_checksum_mismatch");
    }
    assertFileIntakeQuarantineKey({
      objectKey: authorization.objectKey,
      organizationId: authorization.organizationId,
      projectId: authorization.projectId,
      intakeId: authorization.intakeId,
      checksumHex: authorization.checksumHex,
      sourceRole: authorization.sourceRole,
      extension: authorization.extension,
    });
    const { error } = await this.storage.from(authorization.bucket).upload(
      authorization.objectKey,
      bytes,
      { contentType: authorization.mediaType, upsert: false },
    );
    if (error && error.statusCode !== "409") {
      throw new Error("file_intake_storage_upload_failed");
    }
    return !error;
  }

  async copyToInternal(input: {
    readonly authorization: FileIntakeStorageAuthorization;
    readonly internalObjectKey: string;
  }): Promise<void> {
    const { authorization, internalObjectKey } = input;
    if (
      authorization.bucket !== "client-uploads" ||
      authorization.upsert !== false ||
      !authorization.internalObjectKey ||
      authorization.internalObjectKey !== internalObjectKey
    ) {
      throw new Error("file_intake_storage_authorization_mismatch");
    }
    assertFileIntakeQuarantineKey({
      objectKey: authorization.objectKey,
      organizationId: authorization.organizationId,
      projectId: authorization.projectId,
      intakeId: authorization.intakeId,
      checksumHex: authorization.checksumHex,
      sourceRole: authorization.sourceRole,
      extension: authorization.extension,
    });
    assertFileIntakeInternalKey({
      objectKey: internalObjectKey,
      organizationId: authorization.organizationId,
      projectId: authorization.projectId,
      checksumHex: authorization.checksumHex,
      sourceRole: authorization.sourceRole,
      extension: authorization.extension,
    });
    const bucket = this.storage.from(authorization.bucket);
    if (!bucket.copy) throw new Error("file_intake_storage_copy_unavailable");
    const { error } = await bucket.copy(authorization.objectKey, internalObjectKey);
    // The destination is content-addressed and the source/key pair was authorized above.
    // A conflict means the immutable copy already exists after a lost response.
    if (error && error.statusCode !== "409") throw new Error("file_intake_storage_copy_failed");
  }

  async createSignedUrl(
    authorization: FileIntakeDownloadAuthorization,
  ): Promise<{ readonly signedUrl: string; readonly expiresIn: number }> {
    if (
      authorization.bucket !== "client-uploads" ||
      authorization.ttlSeconds < 1 ||
      authorization.ttlSeconds > 900
    ) {
      throw new Error("file_intake_storage_download_authorization_mismatch");
    }
    const result = await this.storage
      .from(authorization.bucket)
      .createSignedUrl(authorization.objectKey, authorization.ttlSeconds);
    const data = result.data;
    if (result.error || !data?.signedUrl) throw new Error("file_intake_storage_signed_url_failed");
    return { signedUrl: data.signedUrl, expiresIn: authorization.ttlSeconds };
  }
}

export type FileIntakeStorageError = StorageErrorLike;
