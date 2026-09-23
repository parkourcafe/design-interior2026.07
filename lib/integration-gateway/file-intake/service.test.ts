import { describe, expect, it, vi } from "vitest";
import type { PrivateStorageClient } from "@/lib/project-intelligence/adapters/storage";
import { FileIntakeService, validateUpload, type FileIntakeProjection } from "./service";

const projectId = "82111111-1111-4111-8111-111111111111";
const intakeId = "83111111-1111-4111-8111-111111111111";
const organizationId = "81111111-1111-4111-8111-111111111111";
const upload = validateUpload({ bytes: new TextEncoder().encode("%PDF-1.7 test"),
  filename: "fixture.pdf", browserMediaType: "application/pdf", sourceRole: "document" });
const authorization = {
  intakeId, projectId, packageId: projectId, organizationId,
  bucket: "client-uploads", checksumHex: upload.checksumHex,
  mediaType: upload.mediaType, extension: "pdf", sourceRole: "document",
  objectKey: `project-intelligence/ru/${organizationId}/${projectId}/quarantine/${intakeId}/${upload.checksumHex}/document.pdf`,
  internalObjectKey: `project-intelligence/ru/${organizationId}/${projectId}/sources/${upload.checksumHex}/document.pdf`,
  status: "requested", reused: false,
};
const projection: FileIntakeProjection = {
  intakeId, projectId, packageId: projectId, originalFilename: "fixture.pdf",
  mediaType: upload.mediaType, extension: "pdf", sourceRole: "document", sizeBytes: upload.sizeBytes,
  status: "scan_pending", scanOutcome: null, reviewDecision: null, sourceId: null,
  createdAt: "2026-09-23T00:00:00Z", publishedAt: null, createdBy: null,
  quarantineObjectKey: authorization.objectKey, internalObjectKey: null, clientProjection: false,
};

function harness(replay = true) {
  const storageUpload = vi.fn(async (): Promise<{ data: null; error: { statusCode: string } | null }> => ({ data: null, error: null }));
  const storage: PrivateStorageClient = { from: () => ({
    upload: storageUpload, remove: async () => ({ data: null, error: null }),
    createSignedUrl: async () => ({ data: null, error: null }),
  }) };
  const service = new FileIntakeService({ schema: () => ({ rpc: async () => { throw new Error("unexpected_rpc"); } }) }, storage);
  vi.spyOn(service, "create").mockResolvedValue({ operation: "create_file_intake", replay, result: authorization });
  const list = vi.spyOn(service, "list").mockResolvedValue([projection]);
  const mark = vi.spyOn(service, "markUploaded").mockResolvedValue({ operation: "mark_file_intake_uploaded", replay: false, result: {} });
  return { service, storageUpload, list, mark };
}

describe("file intake HTTP orchestration replay", () => {
  it("does not write bytes again when create replay contains stale requested status", async () => {
    const h = harness();
    const result = await h.service.createAndUpload({ projectId, upload, idempotencyKey: "same-key" });
    expect(result).toMatchObject({ replay: true, result: { intakeId, status: "scan_pending", uploaded: true } });
    expect(h.storageUpload).not.toHaveBeenCalled();
    expect(h.mark).not.toHaveBeenCalled();
  });

  it("resumes a replay whose upload has not happened", async () => {
    const h = harness(); h.list.mockResolvedValue([{ ...projection, status: "requested" }]);
    await h.service.createAndUpload({ projectId, upload, idempotencyKey: "same-key" });
    expect(h.storageUpload).toHaveBeenCalledOnce();
    expect(h.mark).toHaveBeenCalledOnce();
  });

  it("fails closed if the replayed intake is no longer visible", async () => {
    const h = harness(); h.list.mockResolvedValue([]);
    await expect(h.service.createAndUpload({ projectId, upload, idempotencyKey: "same-key" })).rejects.toThrow();
    expect(h.storageUpload).not.toHaveBeenCalled();
  });

  it("uploads a first request without consulting the replay projection", async () => {
    const h = harness(false);
    await h.service.createAndUpload({ projectId, upload, idempotencyKey: "new-key" });
    expect(h.list).not.toHaveBeenCalled();
    expect(h.storageUpload).toHaveBeenCalledOnce();
  });

  it("recovers only when another same-key call has durably finished uploading", async () => {
    const h = harness();
    h.list.mockResolvedValueOnce([{ ...projection, status: "requested" }]).mockResolvedValueOnce([projection]);
    h.storageUpload.mockRejectedValueOnce(new Error("concurrent_storage_denial"));
    await expect(h.service.createAndUpload({ projectId, upload, idempotencyKey: "same-key" }))
      .resolves.toMatchObject({ replay: true, result: { intakeId, status: "scan_pending" } });
    expect(h.mark).not.toHaveBeenCalled();
  });

  it("does not reinterpret a storage error as success while still requested", async () => {
    const h = harness(); h.list.mockResolvedValue([{ ...projection, status: "requested" }]);
    h.storageUpload.mockRejectedValueOnce(new Error("storage_unavailable"));
    await expect(h.service.createAndUpload({ projectId, upload, idempotencyKey: "same-key" }))
      .rejects.toThrow("storage_unavailable");
    expect(h.mark).not.toHaveBeenCalled();
  });

  it("does not treat an unverified object conflict as an uploaded file", async () => {
    const h = harness(); h.list.mockResolvedValue([{ ...projection, status: "requested" }]);
    h.storageUpload.mockResolvedValueOnce({ data: null, error: { statusCode: "409" } });
    await expect(h.service.createAndUpload({ projectId, upload, idempotencyKey: "same-key" })).rejects.toThrow();
    expect(h.mark).not.toHaveBeenCalled();
  });

  it("does not use replay recovery for a first-request storage failure", async () => {
    const h = harness(false); h.storageUpload.mockRejectedValueOnce(new Error("storage_unavailable"));
    await expect(h.service.createAndUpload({ projectId, upload, idempotencyKey: "new-key" })).rejects.toThrow("storage_unavailable");
    expect(h.list).not.toHaveBeenCalled(); expect(h.mark).not.toHaveBeenCalled();
  });

  it("fails if visibility is revoked during concurrent-replay recovery", async () => {
    const h = harness(); h.list.mockResolvedValueOnce([{ ...projection, status: "requested" }]).mockRejectedValueOnce(new Error("forbidden"));
    h.storageUpload.mockRejectedValueOnce(new Error("storage_unavailable"));
    await expect(h.service.createAndUpload({ projectId, upload, idempotencyKey: "same-key" })).rejects.toThrow("forbidden");
    expect(h.mark).not.toHaveBeenCalled();
  });

  it("fails closed on unknown future projection states", async () => {
    const h = harness(); h.list.mockResolvedValue([{ ...projection, status: "unknown_state" }]);
    await expect(h.service.createAndUpload({ projectId, upload, idempotencyKey: "same-key" })).rejects.toThrow();
    expect(h.mark).not.toHaveBeenCalled(); expect(h.storageUpload).not.toHaveBeenCalled();
  });
});

describe("publication of a server-verified canonical scan copy", () => {
  const input = { projectId, intakeId, idempotencyKey: "publish-verified" };
  function publication() {
    const h = harness();
    const context = vi.spyOn(h.service, "storageAuthorization").mockResolvedValue({ ...authorization,
      bucket: "client-uploads", upsert: false, status: "ingested_candidate", canonicalReceipt: null });
    const copy = vi.spyOn(h.service, "copyToInternal").mockResolvedValue();
    const publish = vi.spyOn(h.service, "publish").mockResolvedValue({ operation: "publish_file_intake", replay: false, result: {} });
    return { ...h, context, copy, publish };
  }
  const receipt = { receiptId: intakeId, evidenceDigest: "f".repeat(64), checksumHex: upload.checksumHex, byteLength: upload.sizeBytes };

  it("uses the existing human publication RPC without recopying a verified canonical object", async () => {
    const h = publication(); h.context.mockResolvedValue({ ...authorization, bucket: "client-uploads", upsert: false,
      status: "ingested_candidate", canonicalReceipt: receipt });
    await h.service.publishWithStorage(input);
    expect(h.context).toHaveBeenCalledWith(input); expect(h.copy).not.toHaveBeenCalled();
    expect(h.publish).toHaveBeenCalledWith(input);
  });
  it("does not infer a receipt merely from ingested status or a content-addressed key", async () => {
    const h = publication(); await h.service.publishWithStorage(input);
    expect(h.copy).toHaveBeenCalledOnce(); expect(h.publish).toHaveBeenCalledOnce();
  });
  it("does not publish after request-bound authorization is denied", async () => {
    const h = publication(); h.context.mockRejectedValue(new Error("forbidden"));
    await expect(h.service.publishWithStorage(input)).rejects.toThrow("forbidden");
    expect(h.copy).not.toHaveBeenCalled(); expect(h.publish).not.toHaveBeenCalled();
  });
  it("rejects a receipt for other bytes", async () => {
    const h = publication(); h.context.mockResolvedValue({ ...authorization, bucket: "client-uploads", upsert: false,
      status: "ingested_candidate", canonicalReceipt: { ...receipt, checksumHex: "a".repeat(64) } });
    await expect(h.service.publishWithStorage(input)).rejects.toThrow("file_intake_canonical_receipt_mismatch");
    expect(h.copy).not.toHaveBeenCalled(); expect(h.publish).not.toHaveBeenCalled();
  });
  it("preserves publish replay without another copy", async () => {
    const h = publication(); h.context.mockResolvedValue({ ...authorization, bucket: "client-uploads", upsert: false,
      status: "published_internal_copy", canonicalReceipt: receipt });
    await h.service.publishWithStorage(input); expect(h.copy).not.toHaveBeenCalled(); expect(h.publish).toHaveBeenCalledOnce();
  });
  it("rejects storage context for another project", async () => {
    const h = publication(); h.context.mockResolvedValue({ ...authorization, projectId: organizationId,
      bucket: "client-uploads", upsert: false, status: "ingested_candidate", canonicalReceipt: receipt });
    await expect(h.service.publishWithStorage(input)).rejects.toThrow("file_intake_canonical_receipt_mismatch");
    expect(h.copy).not.toHaveBeenCalled(); expect(h.publish).not.toHaveBeenCalled();
  });
  it("does not suppress publication authorization revoked after context lookup", async () => {
    const h = publication(); h.context.mockResolvedValue({ ...authorization, bucket: "client-uploads", upsert: false,
      status: "ingested_candidate", canonicalReceipt: receipt });
    h.publish.mockRejectedValue(new Error("forbidden"));
    await expect(h.service.publishWithStorage(input)).rejects.toThrow("forbidden");
    expect(h.copy).not.toHaveBeenCalled();
  });
  it("rejects a malformed receipt returned by the context RPC", async () => {
    const h = publication();
    const client = { schema: () => ({ rpc: async () => ({ data: { ...authorization, upsert: false,
      status: "ingested_candidate", canonicalReceipt: { receiptId: intakeId } }, error: null }) }) };
    const service = new FileIntakeService(client, { from: () => ({ upload: h.storageUpload,
      remove: async () => ({ data: null, error: null }), createSignedUrl: async () => ({ data: null, error: null }) }) });
    const publish = vi.spyOn(service, "publish");
    await expect(service.publishWithStorage(input)).rejects.toThrow(); expect(publish).not.toHaveBeenCalled();
  });
});
