import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { PrivateStorageClient } from "@/lib/project-intelligence/adapters/storage";
import { FileIntakeStorageAdapter, type FileIntakeStorageAuthorization } from "./storage";

const organizationId = "81111111-1111-4111-8111-111111111111";
const projectId = "82111111-1111-4111-8111-111111111111";
const intakeId = "83111111-1111-4111-8111-111111111111";
const checksumHex = "a".repeat(64);
const bytes = new TextEncoder().encode("file-bytes");

const authorization: FileIntakeStorageAuthorization = {
  bucket: "client-uploads",
  organizationId,
  projectId,
  intakeId,
  checksumHex,
  extension: "pdf",
  sourceRole: "document",
  mediaType: "application/pdf",
  objectKey: `project-intelligence/ru/${organizationId}/${projectId}/quarantine/${intakeId}/${checksumHex}/document.pdf`,
  internalObjectKey: `project-intelligence/ru/${organizationId}/${projectId}/sources/${checksumHex}/document.pdf`,
  upsert: false,
};

function storageWithCopyResult(error: { statusCode: string } | null): {
  storage: PrivateStorageClient;
  copy: ReturnType<typeof vi.fn>;
} {
  const copy = vi.fn(async () => ({ data: null, error }));
  const storage: PrivateStorageClient = {
    from: () => ({
      upload: async () => ({ data: null, error: null }),
      remove: async () => ({ data: null, error: null }),
      copy,
      createSignedUrl: async () => ({ data: { signedUrl: "unused" }, error: null }),
    }),
  };
  return { storage, copy };
}

describe("file intake storage copy", () => {
  it("rejects quarantine bytes whose checksum is not authorized", async () => {
    const harness = storageWithCopyResult(null);
    await expect(new FileIntakeStorageAdapter(harness.storage).uploadQuarantine(
      authorization,
      bytes,
    )).rejects.toThrow("file_intake_storage_checksum_mismatch");
    expect(harness.copy).not.toHaveBeenCalled();
  });

  it("accepts quarantine bytes matching the authorized checksum", async () => {
    const harness = storageWithCopyResult(null);
    const matchingAuthorization = {
      ...authorization,
      checksumHex: createHash("sha256").update(bytes).digest("hex"),
      objectKey: authorization.objectKey.replace(checksumHex, createHash("sha256").update(bytes).digest("hex")),
    };
    await expect(new FileIntakeStorageAdapter(harness.storage).uploadQuarantine(
      matchingAuthorization,
      bytes,
    )).resolves.toBe(true);
  });

  it("treats a destination conflict as an idempotent replay", async () => {
    const harness = storageWithCopyResult({ statusCode: "409" });
    await expect(new FileIntakeStorageAdapter(harness.storage).copyToInternal({
      authorization,
      internalObjectKey: authorization.internalObjectKey ?? "",
    })).resolves.toBeUndefined();
    expect(harness.copy).toHaveBeenCalledWith(authorization.objectKey, authorization.internalObjectKey);
  });

  it("fails non-conflict copy errors", async () => {
    const harness = storageWithCopyResult({ statusCode: "500" });
    await expect(new FileIntakeStorageAdapter(harness.storage).copyToInternal({
      authorization,
      internalObjectKey: authorization.internalObjectKey ?? "",
    })).rejects.toThrow("file_intake_storage_copy_failed");
  });

  it("rejects copy authorization outside the private bucket contract", async () => {
    const harness = storageWithCopyResult(null);
    await expect(new FileIntakeStorageAdapter(harness.storage).copyToInternal({
      authorization: { ...authorization, bucket: "public" as "client-uploads" },
      internalObjectKey: authorization.internalObjectKey ?? "",
    })).rejects.toThrow("file_intake_storage_authorization_mismatch");
    expect(harness.copy).not.toHaveBeenCalled();
  });
});
