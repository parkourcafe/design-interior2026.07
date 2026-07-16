import type {
  SourceDownloadAuthorization,
  SourceUploadAuthorization,
} from "../postgres";
import { assertCanonicalObjectKey, type ValidatedSourceFile } from "./policy";

export interface StorageErrorLike {
  readonly message?: string;
  readonly statusCode?: string;
}

export interface StorageBucketClient {
  upload(
    path: string,
    body: Uint8Array,
    options: {
      readonly contentType: string;
      readonly upsert: false;
    },
  ): PromiseLike<{ readonly data: unknown; readonly error: StorageErrorLike | null }>;
  remove(
    paths: readonly string[],
  ): PromiseLike<{ readonly data: unknown; readonly error: StorageErrorLike | null }>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): PromiseLike<{
    readonly data: { readonly signedUrl: string } | null;
    readonly error: StorageErrorLike | null;
  }>;
}

export interface PrivateStorageClient {
  from(bucket: string): StorageBucketClient;
}

export class ProjectSourceStorageAdapter {
  constructor(private readonly storage: PrivateStorageClient) {}

  async uploadAuthorized(
    authorization: SourceUploadAuthorization,
    file: ValidatedSourceFile,
  ): Promise<{
    readonly bucket: "client-uploads";
    readonly objectKey: string;
    readonly created: boolean;
  }> {
    if (
      authorization.bucket !== "client-uploads" ||
      authorization.upsert !== false ||
      authorization.checksum !== file.checksumHex ||
      authorization.mediaType !== file.mediaType
    ) {
      throw new Error("project_ceo.storage_authorization_mismatch");
    }
    assertCanonicalObjectKey({
      objectKey: authorization.objectKey,
      checksumHex: file.checksumHex,
      extension: file.extension,
      sourceRole: file.sourceRole,
    });
    const { error } = await this.storage
      .from(authorization.bucket)
      .upload(authorization.objectKey, file.bytes, {
        contentType: file.mediaType,
        upsert: false,
      });
    if (error && error.statusCode !== "409") {
      throw new Error("project_ceo.storage_upload_failed");
    }
    return {
      bucket: authorization.bucket,
      objectKey: authorization.objectKey,
      created: !error,
    };
  }

  async cleanupAuthorized(
    authorization: Pick<SourceUploadAuthorization, "bucket" | "objectKey">,
  ): Promise<void> {
    await this.storage
      .from(authorization.bucket)
      .remove([authorization.objectKey]);
  }

  async createAuthorizedSignedUrl(
    authorization: SourceDownloadAuthorization,
  ): Promise<{ readonly signedUrl: string; readonly expiresIn: number }> {
    if (
      authorization.bucket !== "client-uploads" ||
      authorization.ttlSeconds <= 0 ||
      authorization.ttlSeconds > 900
    ) {
      throw new Error("project_ceo.storage_download_authorization_mismatch");
    }
    const { data, error } = await this.storage
      .from(authorization.bucket)
      .createSignedUrl(authorization.objectKey, authorization.ttlSeconds);
    if (error || !data) {
      throw new Error("project_ceo.storage_signed_url_failed");
    }
    return {
      signedUrl: data.signedUrl,
      expiresIn: authorization.ttlSeconds,
    };
  }
}
